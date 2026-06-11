"""
WebSocket endpoint that bridges ACP (stdio NDJSON) ↔ browser WebSocket.

Protocol (client ↔ server):
  Client sends:  {"type": "prompt", "text": "..."}
                 {"type": "cancel"}
                 {"type": "permission_response", "id": "...", "optionId": "..."|null}
  Server sends:  {"type": "text_chunk", "text": "..."}
                 {"type": "tool_call", "id": "...", "title": "...", "kind": "...", "input": {...}}
                 {"type": "tool_update", "id": "...", "status": "running"|"completed", "output": "..."}
                 {"type": "permission_request", "id": "...", "tool": "...", "input": {...}, "options": [...]}
                 {"type": "done", "stop_reason": "end_turn"|"cancelled"}
                 {"type": "error", "message": "..."}
                 {"type": "session_info", "session_id": "...", "title": "..."}
"""

import asyncio
import json
import logging
import re
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.acp_session import manager, get_acp_bin, set_acp_bin

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)


@router.get("/sessions")
async def list_sessions(workspace: str = ""):
    """List ACP sessions for a workspace using the stored .clause-cowork list.

    All agents (Claude, Kiro, Gemini) use the same path for consistent UX.
    Only sessions created through this app appear — which is the same constraint
    for all agents since Kiro/Gemini don't implement session/list at all.

    # DO NOT DELETE — enables session/list RPC for agents that support it (currently Claude only;
    # Kiro and Gemini return -32601 Method not found). When other agents implement session/list,
    # uncommenting this will surface sessions created outside this app (e.g. from the terminal).
    # Left commented to keep UX consistent across agents — all agents show only app-created sessions.
    #
    # session = manager.get_running(workspace)
    # if session and session.supports_list:
    #     try:
    #         result = await manager._rpc(session, "session/list", {"cwd": workspace})
    #         sessions = result.get("sessions", [])
    #         if sessions:
    #             return {"sessions": sessions}
    #     except Exception as e:
    #         logger.debug("list_sessions rpc failed: %s", e)
    """
    if not workspace:
        return {"sessions": []}
    return {"sessions": manager.list_stored_sessions(workspace)}


@router.post("/sessions/new")
async def new_session(workspace: str = ""):
    """Force-create a new ACP session for workspace, discarding the current one."""
    if not workspace:
        return {"error": "workspace required"}
    try:
        session = await manager.new_session(workspace)
        return {"session_id": session.session_id}
    except Exception as e:
        logger.error("new_session error: %s", e)
        return {"error": str(e)}


@router.get("/agent-config")
async def get_agent_config():
    return {"acp_bin": get_acp_bin()}


@router.put("/agent-config")
async def save_agent_config(body: dict):
    from fastapi import HTTPException
    acp_bin = body.get("acp_bin", "").strip()
    if not acp_bin:
        raise HTTPException(status_code=400, detail="acp_bin must not be empty")
    set_acp_bin(acp_bin)
    # Kill any running session for the given workspace so next connect uses the new binary.
    # workspace is optional — if not provided, all running sessions are killed.
    workspace = body.get("workspace", "").strip()
    if workspace:
        await manager.kill_workspace(workspace)
    else:
        await manager.shutdown()
    return {"acp_bin": acp_bin}


@router.post("/install-skills")
async def install_skills(body: dict):
    """Copy skill files and context docs into the workspace for the configured agent.
    Called automatically by the frontend after a successful Connect."""
    from services.skill_installer import install_skills as _install
    workspace = body.get("workspace", "").strip()
    acp_bin = body.get("acp_bin", "").strip() or get_acp_bin()
    if not workspace:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="workspace required")
    result = _install(workspace, acp_bin)
    return result


@router.post("/agent-config/test")
async def test_agent_config(body: dict):
    """Spawn the configured ACP binary, run initialize, and return agent info or error."""
    from fastapi import HTTPException
    import asyncio
    acp_bin = body.get("acp_bin", "").strip() or get_acp_bin()
    workspace = body.get("workspace", "/tmp").strip() or "/tmp"
    acp_argv = acp_bin.split() if " " in acp_bin else [acp_bin]
    try:
        proc = await asyncio.create_subprocess_exec(
            *acp_argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workspace,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=400, detail=f"Command not found: {acp_argv[0]!r} — check it is installed and on your PATH")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    import uuid, json as _json
    req_id = str(uuid.uuid4())
    msg = _json.dumps({"jsonrpc": "2.0", "id": req_id, "method": "initialize",
                       "params": {"protocolVersion": 1, "clientCapabilities": {}}})
    try:
        proc.stdin.write((msg + "\n").encode())
        await proc.stdin.drain()
        line = await asyncio.wait_for(proc.stdout.readline(), timeout=30.0)
        result = _json.loads(line.decode().strip())
        agent_info = result.get("result", {}).get("agentInfo", {})
        return {
            "ok": True,
            "agent": agent_info.get("title") or agent_info.get("name") or "Unknown agent",
            "version": agent_info.get("version", ""),
        }
    except asyncio.TimeoutError:
        raise HTTPException(status_code=400, detail="Agent did not respond within 30s — check the command is correct")
    except Exception as e:
        stderr = b""
        try:
            stderr = await asyncio.wait_for(proc.stderr.read(500), timeout=1.0)
        except Exception:
            pass
        detail = str(e)
        if stderr:
            detail += f" — stderr: {stderr.decode()[:200]}"
        raise HTTPException(status_code=400, detail=detail)
    finally:
        try:
            proc.kill()
        except Exception:
            pass


@router.post("/set-model")
async def set_model(body: dict):
    """Switch the active model for a running ACP session."""
    from fastapi import HTTPException
    workspace = body.get("workspace", "").strip()
    model_id = body.get("model_id", "").strip()
    if not workspace or not model_id:
        raise HTTPException(status_code=400, detail="workspace and model_id required")
    session = manager.get_running(workspace)
    if not session:
        raise HTTPException(status_code=404, detail="no active session for workspace")
    try:
        result = await manager._rpc(session, "session/set_model", {
            "sessionId": session.session_id,
            "modelId": model_id,
        })
        session.current_model = result.get("currentModelId") or model_id
        logger.info("set_model: workspace=%s model=%s", workspace, session.current_model)
        return {"current_model": session.current_model}
    except Exception as e:
        logger.error("set_model error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket, workspace: str = "", session_id: str = "", new: str = "", load: str = ""):
    await websocket.accept()
    logger.info("ws: connected workspace=%s session_id=%s new=%s load=%s",
                workspace, session_id or "(default)", new, load)

    if not workspace:
        await websocket.send_text(json.dumps({"type": "error", "message": "workspace param required"}))
        await websocket.close()
        return

    try:
        if new == "1":
            session = await manager.new_session(workspace)
        elif load == "1" and session_id:
            # session/load replays history as session/update notifications — must connect first
            session = await manager.load_session(workspace, session_id)
        else:
            session = await manager.get_or_create(workspace, resume_session_id=session_id or None)
    except Exception as e:
        logger.error("ws: failed to get session: %s", e)
        await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        await websocket.close()
        return

    # Track active WS connections so the reaper never kills a session with a live browser tab
    session.ws_count += 1

    # Send current session info to client so it can display title / know which session is active
    await websocket.send_text(json.dumps({
        "type": "session_info",
        "session_id": session.session_id,
        "current_model": session.current_model,
        "available_models": session.available_models,
    }))

    # Drain any notifications queued during spawn (e.g. available_commands_update, session_info_update)
    # For load sessions (explicit load=1 OR Kiro auto-resume via session/load), history chunks are
    # collected in `deferred` and put back after the loop so the history drain below can process them.
    # Never put back inside the loop — that causes an infinite loop.
    has_history = load == "1" or session.has_history_chunks
    deferred: list = []
    while True:
        try:
            queued = session.updates.get_nowait()
        except asyncio.QueueEmpty:
            break
        method = queued.get("method", "")
        params_q = queued.get("params", {})
        if method == "session/update":
            update = params_q.get("update", {})
            kind = update.get("sessionUpdate")
            # History chunks: defer for load sessions, discard otherwise
            if kind in ("user_message_chunk", "agent_message_chunk"):
                if has_history:
                    deferred.append(queued)
                # else: discard — session/resume replays history we already have in localStorage
                continue
            if kind == "available_commands_update":
                commands = update.get("availableCommands", [])
                await websocket.send_text(json.dumps({"type": "available_commands", "commands": commands}))
            elif kind == "session_info_update":
                title = update.get("title")
                if title:
                    manager.update_session_title(workspace, session.session_id, title)
                    await websocket.send_text(json.dumps({"type": "session_title_update", "title": title}))
        elif method == "_kiro.dev/commands/available":
            # Kiro top-level notification for slash commands
            commands = params_q.get("commands", [])
            if commands:
                await websocket.send_text(json.dumps({"type": "available_commands", "commands": commands}))
        elif method == "_wg/error":
            await websocket.send_text(json.dumps({"type": "error", "message": params_q.get("message", "Unknown ACP error")}))

    # Put deferred history chunks back so the history drain below can process them
    for item in deferred:
        await session.updates.put(item)

    # Two queues: client messages and permission responses (kept separate so
    # permission responses don't get consumed by the main control loop)
    client_queue: asyncio.Queue = asyncio.Queue()

    async def receive_from_client() -> None:
        try:
            while True:
                raw = await websocket.receive_text()
                await client_queue.put(json.loads(raw))
        except WebSocketDisconnect:
            await client_queue.put(None)
        except Exception as e:
            logger.warning("ws: receive error: %s", e)
            await client_queue.put(None)

    async def cancel_active_prompt() -> None:
        """Send session/cancel notification to ACP (no id — it's a notification, not a request)."""
        if session.proc.returncode is not None or not session.session_id:
            return
        try:
            msg = json.dumps({
                "jsonrpc": "2.0",
                "method": "session/cancel",
                "params": {"sessionId": session.session_id},
            })
            session.proc.stdin.write((msg + "\n").encode())
            await session.proc.stdin.drain()
            logger.info("ws: sent session/cancel notification workspace=%s", workspace)
        except Exception as e:
            logger.info("ws: session/cancel notification failed: %s", e)

    async def safe_send(payload: dict) -> bool:
        """Send JSON to websocket, return False if the connection is already closed."""
        try:
            await websocket.send_text(json.dumps(payload))
            return True
        except Exception:
            return False

    # If this was a session/load (explicit or Kiro auto-resume), drain history notifications
    # queued by _spawn. Group chunks by messageId+role into complete messages before sending.
    # After draining, clear has_history_chunks so reconnects don't re-send history.
    if has_history:
        logger.info("ws: draining history for session_id=%s", session.session_id)
        history: dict[str, dict] = {}
        order: list[str] = []

        while True:
            try:
                update_msg = session.updates.get_nowait()
            except asyncio.QueueEmpty:
                break
            method = update_msg.get("method", "")
            params = update_msg.get("params", {})
            if method != "session/update":
                continue
            update = params.get("update", {})
            kind = update.get("sessionUpdate")
            if kind in ("user_message_chunk", "agent_message_chunk"):
                role = "user" if kind == "user_message_chunk" else "assistant"
                mid = update.get("messageId") or f"{role}-{len(order)}"
                text = update.get("content", {}).get("text", "")
                if mid not in history:
                    history[mid] = {"role": role, "text": ""}
                    order.append(mid)
                history[mid]["text"] += text

        session.has_history_chunks = False  # consumed — reconnects won't re-replay

        # Derive title from first user message if none stored yet (Kiro never sends session_info_update)
        stored = manager.list_stored_sessions(workspace)
        current_stored = next((s for s in stored if s["sessionId"] == session.session_id), None)
        if current_stored and not current_stored.get("title"):
            first_user = next((history[mid]["text"] for mid in order if history[mid]["role"] == "user"), None)
            if first_user:
                derived_title = first_user[:60].strip()
                manager.update_session_title(workspace, session.session_id, derived_title)
                await safe_send({"type": "session_title_update", "title": derived_title})

        for mid in order:
            entry = history[mid]
            if entry["text"]:
                await safe_send({"type": "history_message", "role": entry["role"], "text": entry["text"]})
        await safe_send({"type": "history_done"})
        logger.info("ws: history drain complete messages=%d", len(order))

    async def handle_prompt(text: str, cancel_event: asyncio.Event) -> None:
        nonlocal session
        # Record session on first user message (deferred from spawn to avoid ghost sessions).
        # Also derive a title from the first message for agents that never send session_info_update.
        stored = manager.list_stored_sessions(workspace)
        current_stored = next((s for s in stored if s["sessionId"] == session.session_id), None)
        if not current_stored:
            manager._record_session(workspace, session.session_id, title=text[:60].strip())
            logger.info("ws: session recorded on first message session_id=%s workspace=%s", session.session_id, workspace)
            await safe_send({"type": "session_title_update", "title": text[:60].strip()})
        elif not current_stored.get("title"):
            derived_title = text[:60].strip()
            manager.update_session_title(workspace, session.session_id, derived_title)
            await safe_send({"type": "session_title_update", "title": derived_title})

        # Respawn if the ACP process was reaped while the WS stayed open
        if session.proc.returncode is not None:
            logger.info("ws: acp process dead, respawning for workspace=%s", workspace)
            try:
                session = await manager.get_or_create(workspace, resume_session_id=session.session_id)
                await safe_send({"type": "session_info", "session_id": session.session_id})
            except Exception as e:
                await safe_send({"type": "error", "message": f"Session expired and could not restart: {e}"})
                return

        session.touch()
        req_id = str(uuid.uuid4())

        loop = asyncio.get_event_loop()
        prompt_fut: asyncio.Future = loop.create_future()
        session.pending[req_id] = prompt_fut

        msg = json.dumps({
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "session/prompt",
            "params": {
                "sessionId": session.session_id,
                "prompt": [{"type": "text", "text": text}],
            },
        })
        try:
            session.proc.stdin.write((msg + "\n").encode())
            await session.proc.stdin.drain()
        except Exception as e:
            session.pending.pop(req_id, None)
            await safe_send({"type": "error", "message": f"Failed to send prompt: {e}"})
            return

        try:
            while not prompt_fut.done():
                try:
                    update_msg = await asyncio.wait_for(session.updates.get(), timeout=0.1)
                except asyncio.TimeoutError:
                    continue

                method = update_msg.get("method", "")
                params = update_msg.get("params", {})

                if method == "session/update":
                    update = params.get("update", {})
                    kind = update.get("sessionUpdate")

                    # Discard history replay chunks — these arrive on session/resume for
                    # past user messages and should not be forwarded as new text
                    if kind == "user_message_chunk":
                        continue

                    if kind == "session_info_update":
                        title = update.get("title")
                        if title:
                            manager.update_session_title(workspace, session.session_id, title)
                            await safe_send({"type": "session_title_update", "title": title})

                    elif kind == "available_commands_update":
                        commands = update.get("availableCommands", [])
                        await safe_send({"type": "available_commands", "commands": commands})

                    elif kind == "agent_message_chunk":
                        text_chunk = update.get("content", {}).get("text", "")
                        if text_chunk:
                            if not await safe_send({"type": "text_chunk", "text": text_chunk}):
                                return

                    elif kind == "tool_call":
                        logger.info("ws: tool_call title=%r kind=%r input=%r",
                                    update.get("title"), update.get("kind"), str(update.get("rawInput", {}))[:120])
                        await safe_send({
                            "type": "tool_call",
                            "id": update.get("toolCallId"),
                            "title": update.get("title", ""),
                            "kind": update.get("kind", ""),
                            "input": update.get("rawInput", {}),
                        })

                    elif kind == "tool_call_update":
                        content_blocks = update.get("content") or []
                        status = update.get("status") or ""
                        logger.info("ws: tool_call_update id=%r status=%r blocks=%r",
                                    update.get("toolCallId"), status,
                                    [b.get("type") for b in content_blocks])
                        output_parts = []
                        for b in content_blocks:
                            btype = b.get("type")
                            if btype == "content":
                                text = b.get("content", {}).get("text", "")
                                if text:
                                    output_parts.append(text)
                            elif btype == "terminal":
                                # Terminal output is fetched separately via terminal/output RPC
                                terminal_id = b.get("terminalId")
                                if terminal_id and session.proc.returncode is None:
                                    try:
                                        tout = await asyncio.wait_for(
                                            manager._rpc(session, "terminal/output",
                                                         {"sessionId": session.session_id,
                                                          "terminalId": terminal_id}),
                                            timeout=10.0,
                                        )
                                        text = tout.get("output", "")
                                        if text:
                                            output_parts.append(text)
                                    except Exception as e:
                                        logger.warning("ws: terminal/output failed: %s", e)
                        raw_input = update.get("rawInput")
                        tool_msg: dict = {
                            "type": "tool_update",
                            "id": update.get("toolCallId"),
                            "status": status,
                            "output": "\n".join(output_parts),
                        }
                        if raw_input:
                            tool_msg["input"] = raw_input
                        await safe_send(tool_msg)

                    else:
                        logger.info("ws: unhandled session/update kind=%r update=%s", kind, str(update)[:300])

                elif method == "_kiro.dev/commands/available":
                    # Kiro sends slash commands via a top-level notification rather than session/update
                    commands = params.get("commands", [])
                    if commands:
                        await safe_send({"type": "available_commands", "commands": commands})

                elif method == "_wg/error":
                    await safe_send({"type": "error", "message": params.get("message", "Unknown ACP error")})

                elif method == "session/request_permission":
                    perm_id = update_msg.get("id")
                    tool_call = params.get("toolCall", {})
                    options = params.get("options", [])
                    _title = re.sub(r"/Users/[^/]+/", "~/", tool_call.get("title") or "")
                    logger.info("ws: permission_request tool=%r options=%r",
                                _title, [o.get("optionId") for o in options])
                    await safe_send({
                        "type": "permission_request",
                        "id": perm_id,
                        "tool": tool_call.get("title") or tool_call.get("kind") or "",
                        "input": tool_call.get("rawInput", {}),
                        "options": options,
                    })
                    # Wait for permission response or cancellation
                    while True:
                        if cancel_event.is_set():
                            outcome = {"outcome": "cancelled"}
                            break
                        try:
                            perm_resp = await asyncio.wait_for(client_queue.get(), timeout=0.1)
                        except asyncio.TimeoutError:
                            continue
                        if perm_resp is None:
                            # Client disconnected
                            outcome = {"outcome": "cancelled"}
                            break
                        if perm_resp.get("type") == "cancel":
                            cancel_event.set()
                            outcome = {"outcome": "cancelled"}
                            break
                        if perm_resp.get("type") == "permission_response":
                            option_id = perm_resp.get("optionId")
                            outcome = {"outcome": "selected", "optionId": option_id} if option_id else {"outcome": "cancelled"}
                            break
                        # Any other message (e.g. another prompt) — re-queue and deny permission
                        await client_queue.put(perm_resp)
                        outcome = {"outcome": "cancelled"}
                        break

                    reply = json.dumps({"jsonrpc": "2.0", "id": perm_id, "result": {"outcome": outcome}})
                    assert session.proc.stdin
                    session.proc.stdin.write((reply + "\n").encode())
                    await session.proc.stdin.drain()


        except asyncio.CancelledError:
            session.pending.pop(req_id, None)
            await cancel_active_prompt()
            raise

        if cancel_event.is_set():
            await safe_send({"type": "done", "stop_reason": "cancelled"})
            return

        # Drain any updates that arrived concurrently with the prompt response
        # (e.g. tool_call_update that was queued just before prompt_fut resolved)
        while True:
            try:
                update_msg = session.updates.get_nowait()
            except asyncio.QueueEmpty:
                break
            method = update_msg.get("method", "")
            params = update_msg.get("params", {})
            if method == "session/update":
                update = params.get("update", {})
                kind = update.get("sessionUpdate")
                if kind == "tool_call_update":
                    content_blocks = update.get("content") or []
                    status = update.get("status") or ""
                    output_parts = [
                        b.get("content", {}).get("text", "")
                        for b in content_blocks
                        if b.get("type") == "content" and b.get("content", {}).get("text")
                    ]
                    tool_msg: dict = {
                        "type": "tool_update",
                        "id": update.get("toolCallId"),
                        "status": status,
                        "output": "\n".join(output_parts),
                    }
                    if update.get("rawInput"):
                        tool_msg["input"] = update["rawInput"]
                    await safe_send(tool_msg)

        if prompt_fut.exception():
            exc = prompt_fut.exception()
            logger.error("ws: prompt error: %s", exc)
            await safe_send({"type": "error", "message": str(exc)})
            return
        result = prompt_fut.result()
        stop_reason = result.get("stopReason", "end_turn")
        logger.info("ws: done stop_reason=%s result=%s", stop_reason, str(result)[:500])
        await safe_send({"type": "done", "stop_reason": stop_reason})

    receiver_task = asyncio.create_task(receive_from_client())
    active_prompt_task: asyncio.Task | None = None
    cancel_event: asyncio.Event | None = None

    try:
        while True:
            msg = await client_queue.get()
            if msg is None:
                break

            if msg.get("type") == "cancel":
                if active_prompt_task and not active_prompt_task.done() and cancel_event:
                    logger.info("ws: client requested cancel")
                    cancel_event.set()
                    await cancel_active_prompt()

            elif msg.get("type") == "prompt":
                # Ignore new prompts while one is already in flight
                if active_prompt_task and not active_prompt_task.done():
                    logger.warning("ws: prompt received while one in flight — ignoring")
                    continue

                logger.info("ws: prompt received text=%r", msg.get("text", "")[:80])
                cancel_event = asyncio.Event()
                active_prompt_task = asyncio.create_task(handle_prompt(msg["text"], cancel_event))

                # Concurrently wait for prompt completion and client messages.
                # We keep a single persistent get_task so it is never abandoned —
                # an abandoned client_queue.get() silently drops the next message,
                # which causes the second prompt to be lost (stuck on loading).
                get_task: asyncio.Task = asyncio.ensure_future(client_queue.get())
                while not active_prompt_task.done():
                    done, _ = await asyncio.wait(
                        {active_prompt_task, get_task},
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if get_task in done:
                        try:
                            client_msg = get_task.result()
                        except Exception:
                            client_msg = None
                        if client_msg is None:
                            if cancel_event:
                                cancel_event.set()
                            await cancel_active_prompt()
                            break
                        if client_msg.get("type") == "cancel":
                            logger.info("ws: client cancelled mid-prompt")
                            if cancel_event:
                                cancel_event.set()
                            await cancel_active_prompt()
                        else:
                            # Re-queue anything else (permission responses etc.)
                            await client_queue.put(client_msg)
                        # Prompt still running — issue a new get for the next message
                        if not active_prompt_task.done():
                            get_task = asyncio.ensure_future(client_queue.get())
                # Prompt finished — if get_task is still pending, put its eventual
                # result back on the queue so the outer loop receives it.
                if not get_task.done():
                    get_task.cancel()
                    try:
                        await get_task
                    except (asyncio.CancelledError, Exception):
                        pass
                elif not get_task.cancelled():
                    try:
                        leftover = get_task.result()
                        if leftover is not None:
                            await client_queue.put(leftover)
                    except Exception:
                        pass

                if active_prompt_task.exception() if not active_prompt_task.cancelled() else False:
                    exc = active_prompt_task.exception()
                    logger.error("ws: prompt task error: %s", exc)
                    await safe_send({"type": "error", "message": str(exc)})

                active_prompt_task = None
                cancel_event = None

    except Exception as e:
        logger.error("ws: handler error: %s", e)
        await safe_send({"type": "error", "message": str(e)})
    finally:
        if active_prompt_task and not active_prompt_task.done():
            if cancel_event:
                cancel_event.set()
            active_prompt_task.cancel()
            await cancel_active_prompt()
        receiver_task.cancel()
        session.ws_count = max(0, session.ws_count - 1)
        session.touch()  # reset TTL so reaper counts from disconnect, not last prompt
        logger.info("ws: disconnected workspace=%s ws_count=%d", workspace, session.ws_count)
