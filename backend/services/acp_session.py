"""
ACP session manager — one claude-agent-acp subprocess per workspace, kept alive.

Lifecycle:
  - First WS connection for a workspace → spawn process, run ACP handshake
  - Subsequent connections → reuse existing session
  - Idle for TTL_SECONDS with no active WS → kill process
  - Backend shutdown → kill all processes
"""

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator

logger = logging.getLogger(__name__)

ACP_BIN = os.environ.get("ACP_BIN", "npx @agentclientprotocol/claude-agent-acp")
TTL_SECONDS = 1800  # kill idle process after 30 min

_AGENT_CONFIG_PATH = Path(__file__).parent.parent / "data" / "agent_config.json"


def _read_agent_config() -> dict:
    try:
        return json.loads(_AGENT_CONFIG_PATH.read_text())
    except Exception:
        return {}


def get_acp_bin() -> str:
    """Return the currently configured ACP binary path, falling back to ACP_BIN env/default."""
    return _read_agent_config().get("acp_bin") or ACP_BIN


def set_acp_bin(path: str) -> None:
    _AGENT_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        existing = json.loads(_AGENT_CONFIG_PATH.read_text())
    except Exception:
        existing = {}
    existing["acp_bin"] = path
    _AGENT_CONFIG_PATH.write_text(json.dumps(existing))


@dataclass
class AcpSession:
    workspace: str
    proc: asyncio.subprocess.Process
    session_id: str
    reader_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # pending requests: id → Future
    pending: dict[str | int, asyncio.Future] = field(default_factory=dict)
    # broadcast queue for session/update notifications → all connected WS clients
    updates: asyncio.Queue = field(default_factory=asyncio.Queue)
    last_active: float = field(default_factory=time.time)
    _reader_task: asyncio.Task | None = None
    ws_count: int = 0  # number of active WS connections — reaper skips sessions with ws_count > 0
    current_model: str = ""
    available_models: list = field(default_factory=list)  # list of {modelId, name, description}
    has_history_chunks: bool = False  # set True when session/load was used (history queued for drain)
    supports_list: bool = False  # set True when agent supports session/list (e.g. Claude)

    def touch(self) -> None:
        self.last_active = time.time()


class AcpSessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, AcpSession] = {}
        self._lock = asyncio.Lock()
        self._reaper: asyncio.Task | None = None

    # ------------------------------------------------------------------ #
    # Public API                                                           #
    # ------------------------------------------------------------------ #

    def get_running(self, workspace: str) -> "AcpSession | None":
        """Return the running session for workspace without spawning a new one."""
        session = self._sessions.get(workspace)
        if session and session.proc.returncode is None:
            return session
        return None

    async def get_or_create(self, workspace: str, resume_session_id: str | None = None) -> AcpSession:
        async with self._lock:
            session = self._sessions.get(workspace)
            # If a specific session_id is requested and differs from the running one, respawn
            if session and session.proc.returncode is None:
                if resume_session_id and resume_session_id != session.session_id:
                    await self._kill(session)
                else:
                    session.touch()
                    return session
            session = await self._spawn(workspace, resume_session_id=resume_session_id)
            self._sessions[workspace] = session
            if self._reaper is None or self._reaper.done():
                self._reaper = asyncio.create_task(self._reap_loop())
            return session

    async def new_session(self, workspace: str) -> AcpSession:
        """Kill any existing session for workspace and start a fresh one."""
        async with self._lock:
            existing = self._sessions.get(workspace)
            if existing:
                await self._kill(existing)
            # Do NOT delete the store file — previous sessions must remain in history.
            # _record_session will prepend the new session to the existing list.
            session = await self._spawn(workspace, force_new=True)
            self._sessions[workspace] = session
            if self._reaper is None or self._reaper.done():
                self._reaper = asyncio.create_task(self._reap_loop())
            return session

    async def load_session(self, workspace: str, session_id: str) -> "AcpSession":
        """Kill any existing session and spawn fresh using session/load (replays history)."""
        async with self._lock:
            existing = self._sessions.get(workspace)
            if existing:
                await self._kill(existing)
            session = await self._spawn(workspace, load_session_id=session_id)
            self._sessions[workspace] = session
            if self._reaper is None or self._reaper.done():
                self._reaper = asyncio.create_task(self._reap_loop())
            return session

    async def kill_workspace(self, workspace: str) -> None:
        """Kill the running session for a workspace. The store file is preserved."""
        async with self._lock:
            session = self._sessions.pop(workspace, None)
            if session:
                await self._kill(session)

    async def shutdown(self) -> None:
        async with self._lock:
            for session in self._sessions.values():
                await self._kill(session)
            self._sessions.clear()
        if self._reaper:
            self._reaper.cancel()

    # ------------------------------------------------------------------ #
    # Internal                                                             #
    # ------------------------------------------------------------------ #

    def _session_store_path(self, workspace: str) -> Path:
        """Per-workspace file storing ACP session history, lives in <workspace>/.clause-cowork/."""
        return Path(workspace) / ".clause-cowork" / "acp-session.json"

    def _load_store(self, workspace: str) -> dict:
        """Return the full store dict: {acp_bin: [{sessionId, title, updatedAt}], ..., lastSessionId: str}"""
        try:
            return json.loads(self._session_store_path(workspace).read_text())
        except Exception:
            return {}

    def _save_store(self, workspace: str, store: dict) -> None:
        try:
            p = self._session_store_path(workspace)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(store))
        except Exception as e:
            logger.warning("acp: failed to persist session store: %s", e)

    def _load_session_id(self, workspace: str) -> str | None:
        """Return the most recently used session ID for the current acp_bin."""
        store = self._load_store(workspace)
        acp_bin = get_acp_bin()
        sessions = store.get(acp_bin, [])
        return sessions[0]["sessionId"] if sessions else None

    def _record_session(self, workspace: str, session_id: str, title: str | None = None) -> None:
        """Upsert session into the per-workspace, per-agent list (most recent first, max 50)."""
        from datetime import datetime, timezone
        store = self._load_store(workspace)
        acp_bin = get_acp_bin()
        sessions: list[dict] = store.get(acp_bin, [])
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        existing = next((s for s in sessions if s["sessionId"] == session_id), None)
        if existing:
            existing["updatedAt"] = now
            if title:
                existing["title"] = title
            sessions = [existing] + [s for s in sessions if s["sessionId"] != session_id]
        else:
            sessions = [{"sessionId": session_id, "title": title, "updatedAt": now}] + sessions
        store[acp_bin] = sessions[:50]
        self._save_store(workspace, store)

    def update_session_title(self, workspace: str, session_id: str, title: str) -> None:
        """Update the title of a stored session — called from chat_ws on session_info_update."""
        self._record_session(workspace, session_id, title=title)

    def list_stored_sessions(self, workspace: str) -> list[dict]:
        """Return stored sessions for the current acp_bin, most recent first."""
        store = self._load_store(workspace)
        return store.get(get_acp_bin(), [])

    async def _spawn(self, workspace: str, resume_session_id: str | None = None,
                     load_session_id: str | None = None, force_new: bool = False) -> AcpSession:
        logger.info("acp: spawning process cwd=%s", workspace)
        bin_path = get_acp_bin()
        acp_argv = bin_path.split() if " " in bin_path else [bin_path]
        proc = await asyncio.create_subprocess_exec(
            *acp_argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=workspace,
            limit=10 * 1024 * 1024,  # 10 MB — prevents read_loop crash on large tool responses
        )

        session = AcpSession(workspace=workspace, proc=proc, session_id="")
        session._reader_task = asyncio.create_task(self._read_loop(session))

        init_result = await self._rpc(session, "initialize", {
            "protocolVersion": 1,
            "clientCapabilities": {},
        })
        caps = init_result.get("agentCapabilities", {})
        session_caps = caps.get("sessionCapabilities", {})
        session.supports_list = "list" in session_caps
        logger.info("acp: capabilities loadSession=%s sessionCapabilities=%s supports_list=%s",
                    caps.get("loadSession"), list(session_caps.keys()), session.supports_list)

        # Explicit session/load request (user picked a session from history)
        if load_session_id:
            try:
                result = await self._rpc(session, "session/load", {
                    "sessionId": load_session_id,
                    "cwd": workspace,
                    "mcpServers": [],
                })
                session.session_id = load_session_id
                session.has_history_chunks = True
                self._capture_models(session, result)
                self._record_session(workspace, session.session_id)
                logger.info("acp: loaded session_id=%s model=%s workspace=%s",
                            session.session_id, session.current_model, workspace)
                return session
            except Exception as e:
                logger.warning("acp: session/load failed (%s), falling through to new", e)

        # Auto-resume: try the most recently used session for this agent via session/load.
        #
        # Cross-process session persistence by agent (as of 2026-05):
        #   Claude Code (claude-agent-acp) — persists to disk, session/load works across restarts ✅
        #   Gemini CLI (gemini)            — persists to disk (~/.gemini/sessions/), works ✅
        #   Kiro CLI (kiro-cli acp)        — persists to SQLite, session/load works across restarts ✅
        target_id = None if force_new else (resume_session_id or self._load_session_id(workspace))
        if target_id:
            try:
                result = await self._rpc(session, "session/load", {
                    "sessionId": target_id,
                    "cwd": workspace,
                    "mcpServers": [],
                })
                session.session_id = target_id
                session.has_history_chunks = True
                self._capture_models(session, result)
                # Auto-resume of an existing session: update updatedAt to signal active use
                self._record_session(workspace, session.session_id)
                logger.info("acp: load-resumed session_id=%s model=%s workspace=%s",
                            session.session_id, session.current_model, workspace)
                return session
            except Exception as e:
                logger.warning("acp: session/load failed (%s), creating new session", e)

        # force_new = True means user explicitly requested a new session (POST /sessions/new).
        # Record immediately so it appears in history. Otherwise defer until first message
        # to avoid ghost sessions from reconnecting frontends that never send anything.
        result = await self._rpc(session, "session/new", {"cwd": workspace, "mcpServers": []})
        session.session_id = result["sessionId"]
        self._capture_models(session, result)
        if force_new:
            self._record_session(workspace, session.session_id)
            logger.info("acp: new session_id=%s model=%s workspace=%s",
                        session.session_id, session.current_model, workspace)
        else:
            logger.info("acp: new session_id=%s model=%s workspace=%s (deferred record — awaiting first message)",
                        session.session_id, session.current_model, workspace)
        return session

    def _capture_models(self, session: "AcpSession", result: dict) -> None:
        models = result.get("models") or {}
        session.current_model = models.get("currentModelId", "")
        session.available_models = models.get("availableModels", [])

    async def _read_loop(self, session: AcpSession) -> None:
        """Read NDJSON lines from the ACP process stdout and dispatch them."""
        assert session.proc.stdout
        stderr_task = asyncio.create_task(self._log_stderr(session))
        try:
            async for raw in session.proc.stdout:
                line = raw.decode().strip()
                if not line:
                    continue
                logger.debug("acp: ← raw %s", line[:300])
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("acp: bad json: %s", line[:200])
                    continue

                msg_id = msg.get("id")
                if msg_id is not None and msg_id in session.pending:
                    # Response to a request we sent
                    fut = session.pending.pop(msg_id)
                    if "error" in msg:
                        err = msg["error"]
                        message = err.get("message", "acp error")
                        detail = err.get("data", "")
                        fut.set_exception(RuntimeError(f"{message}: {detail}" if detail else message))
                    else:
                        fut.set_result(msg.get("result", {}))
                elif "error" in msg:
                    # Unsolicited JSON-RPC error (no matching pending future) — forward to WS clients
                    err = msg["error"]
                    message = err.get("message", "acp error")
                    detail = err.get("data", "")
                    full = f"{message}: {detail}" if detail else message
                    logger.warning("acp: unsolicited error id=%s: %s", msg_id, full)
                    await session.updates.put({"method": "_wg/error", "params": {"message": full}})
                elif msg.get("method"):
                    method = msg["method"]
                    # Log every inbound notification so we can trace what ACP sends
                    if method == "session/update":
                        kind = msg.get("params", {}).get("update", {}).get("sessionUpdate")
                        logger.debug("acp: ← %s kind=%s", method, kind)
                    else:
                        logger.info("acp: ← %s", method)
                    await session.updates.put(msg)
        except Exception as e:
            logger.error("acp: read_loop error: %s", e)
        finally:
            stderr_task.cancel()
            logger.info("acp: read_loop ended workspace=%s", session.workspace)

    async def _log_stderr(self, session: AcpSession) -> None:
        assert session.proc.stderr
        async for raw in session.proc.stderr:
            line = raw.decode().rstrip()
            if line:
                logger.info("acp[stderr]: %s", line)

    async def _rpc(self, session: AcpSession, method: str, params: dict, timeout: float = 30.0) -> dict:
        if session.proc.returncode is not None or not session.proc.stdin or session.proc.stdin.is_closing():
            raise RuntimeError("acp process is not running")
        req_id = str(uuid.uuid4())
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        session.pending[req_id] = fut
        msg = json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})
        logger.debug("acp: → %s %s", method, req_id)
        session.proc.stdin.write((msg + "\n").encode())
        await session.proc.stdin.drain()
        return await asyncio.wait_for(fut, timeout=timeout)

    async def _kill(self, session: AcpSession) -> None:
        if session.proc.returncode is None and session.session_id:
            # Ask the agent to tear down the session cleanly — this cancels any
            # in-flight Claude query so agent.dispose() completes immediately
            try:
                await asyncio.wait_for(
                    self._rpc(session, "session/close", {"sessionId": session.session_id}),
                    timeout=5.0,
                )
            except Exception as e:
                logger.debug("acp: session/close failed (ok): %s", e)

        if session._reader_task:
            session._reader_task.cancel()

        if session.proc.returncode is None:
            try:
                # Closing stdin signals EOF → connection.closed → shutdown()
                if session.proc.stdin:
                    session.proc.stdin.close()
                await asyncio.wait_for(session.proc.wait(), timeout=3)
            except asyncio.TimeoutError:
                logger.warning("acp: process did not exit after EOF, sending SIGTERM")
                session.proc.terminate()
                try:
                    await asyncio.wait_for(session.proc.wait(), timeout=3)
                except asyncio.TimeoutError:
                    logger.warning("acp: process did not exit after SIGTERM, sending SIGKILL")
                    session.proc.kill()
            except Exception:
                pass

        logger.info("acp: killed workspace=%s", session.workspace)

    async def _reap_loop(self) -> None:
        while True:
            await asyncio.sleep(60)
            now = time.time()
            async with self._lock:
                stale = [w for w, s in self._sessions.items()
                         if s.proc.returncode is not None or
                         (s.ws_count == 0 and now - s.last_active > TTL_SECONDS)]
                for w in stale:
                    logger.info("acp: reaping idle session workspace=%s", w)
                    await self._kill(self._sessions.pop(w))


# Singleton
manager = AcpSessionManager()
