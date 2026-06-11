"""
Fake claude-agent-acp binary for integration tests.

Reads NDJSON from stdin, responds on stdout.  Controlled by the MOCK_ACP_SCRIPT
env var which points to a JSON file describing the sequence of responses to send
for each session/prompt call.  If no script file is given it uses hardcoded
defaults.

Protocol implemented:
  initialize        → capabilities (loadSession, resume, list, close)
  session/new       → {sessionId: "test-session-1"}
  session/resume    → {sessionId: <requested id>}
  session/list      → {sessions: [{sessionId:"test-session-1",title:"Test",cwd:cwd}]}
  session/cancel    → {}  (also sets a flag so the next prompt resolves quickly)
  session/close     → {}
  session/prompt    → streams session/update notifications then returns result
                      behaviour driven by MOCK_PROMPT_RESPONSES env var (JSON list)
"""

import sys
import json
import os
import time

def send(msg: dict):
    line = json.dumps(msg)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()

def respond(req_id, result: dict):
    send({"jsonrpc": "2.0", "id": req_id, "result": result})

def notify(method: str, params: dict):
    send({"jsonrpc": "2.0", "method": method, "params": params})

def session_update(session_id: str, update: dict):
    notify("session/update", {"sessionId": session_id, "update": update})

# MOCK_SUPPORTS_LIST=0 simulates agents that don't implement session/list (e.g. Kiro)
_supports_list = os.environ.get("MOCK_SUPPORTS_LIST", "1") != "0"

CAPABILITIES = {
    "loadSession": True,
    "sessionCapabilities": {
        "resume": {},
        **({"list": {}} if _supports_list else {}),
        "close": {},
        "delete": {},
        "fork": {},
    },
    "promptCapabilities": {"image": False, "embeddedContext": False},
    "mcpCapabilities": {"http": False, "sse": False},
}

# Each entry: list of updates to emit before the prompt response.
# Loaded from MOCK_PROMPT_RESPONSES env var (JSON) or defaults to one text reply.
def get_prompt_responses():
    raw = os.environ.get("MOCK_PROMPT_RESPONSES")
    if raw:
        return json.loads(raw)
    return [
        [{"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "Hello!"}, "messageId": "m1"}]
    ]

prompt_call_index = 0
cancelled = False
session_id = "test-session-1"

for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        continue

    req_id = msg.get("id")
    method = msg.get("method", "")
    params = msg.get("params", {})

    if method == "initialize":
        respond(req_id, {
            "protocolVersion": 1,
            "agentCapabilities": CAPABILITIES,
            "agentInfo": {"name": "mock-acp", "title": "Mock ACP", "version": "0.0.1"},
            "authMethods": [],
        })

    elif method == "session/new":
        session_id = "test-session-1"
        respond(req_id, {"sessionId": session_id})

    elif method == "session/resume":
        session_id = params.get("sessionId", "test-session-1")
        respond(req_id, {"sessionId": session_id})

    elif method == "session/load":
        session_id = params.get("sessionId", "test-session-1")
        # Replay a minimal history
        session_update(session_id, {
            "sessionUpdate": "user_message_chunk",
            "content": {"type": "text", "text": "old user message"},
            "messageId": "hist-u1",
        })
        session_update(session_id, {
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "old assistant reply"},
            "messageId": "hist-a1",
        })
        respond(req_id, {"sessionId": session_id})

    elif method == "session/list":
        if _supports_list:
            respond(req_id, {"sessions": [
                {"sessionId": session_id, "title": "Test Session",
                 "cwd": params.get("cwd", "/tmp"), "updatedAt": "2026-01-01T00:00:00Z"},
            ]})
        else:
            send({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": "Method not found", "data": "session/list"}})

    elif method == "session/cancel":
        cancelled = True
        respond(req_id, {})

    elif method == "session/close":
        respond(req_id, {})
        break

    elif method == "session/delete":
        respond(req_id, {})

    elif method == "session/prompt":
        # MOCK_PROMPT_ERROR: if set, respond with a JSON-RPC error instead of a result
        prompt_error = os.environ.get("MOCK_PROMPT_ERROR")
        if prompt_error:
            err = json.loads(prompt_error)
            send({"jsonrpc": "2.0", "id": req_id, "error": err})
            continue

        responses = get_prompt_responses()
        updates = responses[prompt_call_index % len(responses)]
        prompt_call_index += 1
        cancelled = False

        for update in updates:
            # Check for cancellation signal — re-read stdin non-blocking
            import select
            if select.select([sys.stdin], [], [], 0)[0]:
                line = sys.stdin.readline().strip()
                if line:
                    try:
                        cancel_msg = json.loads(line)
                        if cancel_msg.get("method") == "session/cancel":
                            cancelled = True
                            respond(cancel_msg.get("id"), {})
                    except Exception:
                        pass
            if cancelled:
                break
            session_update(session_id, update)

        stop_reason = "cancelled" if cancelled else "end_turn"
        respond(req_id, {"sessionId": session_id, "stopReason": stop_reason, "cost": {}})

    elif method == "terminal/output":
        respond(req_id, {"output": "mock terminal output\n", "truncated": False})
