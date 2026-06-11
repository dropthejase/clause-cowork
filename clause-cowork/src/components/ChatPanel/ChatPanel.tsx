import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "../../ThemeContext";
import { useAppStore } from "../../store";
import { setModel } from "../../api";
import { FONT } from "@word-graph/shared";

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

interface Block {
  type: "text" | "tool";
  text?: string;
  tool?: ToolUse;
  toolId?: string;
  status?: string;
  output?: string;
}

interface Message {
  role: "user" | "assistant";
  blocks: Block[];
}

interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

interface PermissionRequest {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  options: PermissionOption[];
}

interface SessionInfo {
  sessionId: string;
  title?: string;
  updatedAt?: string;
}

// Requested WS connection intent — null = default (resume persisted), string = specific session, "new" = force new
type SessionRequest = string | "new" | null;

const WS_BASE = "ws://localhost:8765";
const HTTP_BASE = "http://localhost:8765";

function HeaderButton({ onClick, title, children, muted, style: extraStyle }: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  muted?: boolean;
  style?: React.CSSProperties;
}) {
  const { theme } = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? theme.base : "none",
        border: `1px solid ${theme.edgeBorder}`, borderRadius: 4,
        cursor: "pointer", fontSize: FONT.sm, lineHeight: "16px",
        color: muted ? theme.muted : theme.black,
        padding: "3px 10px", flexShrink: 0, alignSelf: "center",
        transition: "background 0.1s",
        ...extraStyle,
      }}
    >{children}</button>
  );
}

function SessionOption({ session, isCurrent, theme, onClick }: {
  session: SessionInfo;
  isCurrent: boolean;
  theme: ReturnType<typeof useTheme>["theme"];
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "block", width: "100%", textAlign: "left", padding: "6px 10px",
        background: isCurrent ? theme.taupe : hovered ? theme.base : "transparent",
        border: "none", borderBottom: `1px solid ${theme.edgeBorder}`,
        cursor: "pointer", fontSize: FONT.sm, color: theme.black,
        transition: "background 0.1s",
      }}
    >
      <div style={{ fontWeight: 500 }}>{session.title || session.sessionId.slice(0, 16) + "…"}</div>
      {session.updatedAt && (
        <div style={{ fontSize: FONT.sm, color: theme.muted, marginTop: 1 }}>
          {new Date(session.updatedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
        </div>
      )}
    </button>
  );
}

function ModelOption({ model, isCurrent, theme, onClick }: {
  model: { modelId: string; name: string; description?: string };
  isCurrent: boolean;
  theme: ReturnType<typeof useTheme>["theme"];
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "6px 10px",
        background: isCurrent ? theme.taupe : hovered ? theme.base : "transparent",
        border: "none", borderBottom: `1px solid ${theme.edgeBorder}`,
        cursor: "pointer", fontSize: FONT.sm, color: theme.black,
        transition: "background 0.1s",
      }}
    >
      <div style={{ fontWeight: isCurrent ? 600 : 400 }}>{model.name || model.modelId}</div>
      {model.description && <div style={{ fontSize: FONT.sm, color: theme.muted, marginTop: 1 }}>{model.description}</div>}
    </button>
  );
}

function storageKey(sessionId: string) {
  return `cc-chat-messages-v4:${sessionId}`;
}

function loadMessages(sessionId: string): Message[] {
  try { return JSON.parse(localStorage.getItem(storageKey(sessionId)) ?? "[]"); } catch { return []; }
}

function saveMessages(sessionId: string, messages: Message[]) {
  try { localStorage.setItem(storageKey(sessionId), JSON.stringify(messages)); } catch {}
}



export function ChatPanel() {
  const { theme } = useTheme();
  const { activeWorkspace } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [wsReady, setWsReady] = useState(false);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [currentModel, setCurrentModel] = useState<string>("");
  const [availableModels, setAvailableModels] = useState<{ modelId: string; name: string; description?: string }[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelSwitching, setModelSwitching] = useState(false);

  // connectionKey increments to trigger a new WS connection.
  // sessionIntentRef holds the session ID / "new" for the *next* connect only —
  // cleared after the first successful session_info so backoff reconnects use default.
  const [connectionKey, setConnectionKey] = useState(0);
  const sessionIntentRef = useRef<SessionRequest>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingPermRef = useRef<PermissionRequest | null>(null);
  const historyDrainingRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(null);

  // Clear messages when workspace changes — session_info will load the right ones
  useEffect(() => {
    if (activeWorkspace) {
      setMessages([]);
      setActiveSessionId(null);
      setCurrentModel("");
      setAvailableModels([]);
      sessionIntentRef.current = null;
    }
  }, [activeWorkspace]);

  // Persist messages per session, not during streaming
  useEffect(() => {
    if (!activeSessionId || streaming) return;
    const toSave = messages.filter((m) => !(m.role === "assistant" && m.blocks.length === 0));
    saveMessages(activeSessionId, toSave);
  }, [messages, streaming, activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchSessions = useCallback(async (workspace: string) => {
    try {
      const res = await fetch(`${HTTP_BASE}/chat/sessions?workspace=${encodeURIComponent(workspace)}`);
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {}
  }, []);

  // Single WebSocket owner — reconnects when workspace changes or connectionKey increments.
  // sessionIntentRef is read once on the initial connect, then cleared so backoff
  // reconnects always use the default (resume persisted session), never a stale ID.
  useEffect(() => {
    if (!activeWorkspace) return;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout>;
    let destroyed = false;

    let fatalError = false;

    async function connect() {
      if (destroyed) return;
      fatalError = false;

      // Consume the intent once — subsequent reconnects (backoff) use default.
      const intent = sessionIntentRef.current;
      sessionIntentRef.current = null;

      const params = new URLSearchParams({ workspace: activeWorkspace! });

      if (intent === "new") {
        params.set("new", "1");
      } else if (intent?.startsWith("load:")) {
        const sid = intent.slice(5);
        params.set("session_id", sid);
        params.set("load", "1");
      } else if (intent) {
        params.set("session_id", intent);
      }

      const ws = new WebSocket(`${WS_BASE}/chat/ws?${params}`);
      wsRef.current = ws;
      setWsReady(false);
      setShowModelPicker(false);
      historyDrainingRef.current = false;
      // Keep currentModel/availableModels visible until session_info confirms the new session's model

      ws.onopen = () => { attempt = 0; fatalError = false; setWsReady(true); };

      ws.onclose = () => {
        setWsReady(false);
        setStreaming(false);
        if (destroyed) return;
        if (fatalError) return;  // spawn failure — don't retry
        const delay = Math.max(1000, Math.min(1000 * 2 ** attempt, 30000));
        attempt++;
        retryTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => { setStreaming(false); };

      ws.onmessage = (evt) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(evt.data); } catch { return; }
        const type = msg.type as string;

        if (type === "session_info") {
          const sid = msg.session_id as string;
          activeSessionIdRef.current = sid;
          setActiveSessionId(sid);
          if (msg.current_model) setCurrentModel(msg.current_model as string);
          if (Array.isArray(msg.available_models)) setAvailableModels(msg.available_models as { modelId: string; name: string }[]);
          if (intent?.startsWith("load:")) {
            // Clear stale messages — history_message events will populate them
            setMessages([]);
          } else {
            setMessages(loadMessages(sid));
          }
          fetchSessions(activeWorkspace!);

        } else if (type === "text_chunk") {
          const text = msg.text as string;
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (!last || last.role !== "assistant") return prev;
            const blocks = [...last.blocks];
            const tail = blocks[blocks.length - 1];
            if (tail?.type === "text") {
              blocks[blocks.length - 1] = { ...tail, text: (tail.text ?? "") + text };
            } else {
              blocks.push({ type: "text", text });
            }
            updated[updated.length - 1] = { ...last, blocks };
            return updated;
          });

        } else if (type === "tool_call") {
          const id = msg.id as string;
          const name = (msg.title as string) || (msg.kind as string) || "tool";
          const inp = (msg.input ?? {}) as Record<string, unknown>;
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (!last || last.role !== "assistant") return prev;
            return [
              ...updated.slice(0, -1),
              { ...last, blocks: [...last.blocks, { type: "tool" as const, tool: { name, input: inp }, toolId: id, status: "running" }] },
            ];
          });

        } else if (type === "tool_update") {
          const id = msg.id as string;
          const status = msg.status as string;
          const updatedInput = msg.input as Record<string, unknown> | undefined;
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (!last || last.role !== "assistant") return prev;
            const blocks = last.blocks.map((b) => {
              if (b.toolId !== id) return b;
              const merged: Block = { ...b, status };
              if (updatedInput && b.tool) {
                merged.tool = { ...b.tool, input: { ...b.tool.input, ...updatedInput } };
              }
              return merged;
            });
            return [...updated.slice(0, -1), { ...last, blocks }];
          });

        } else if (type === "permission_request") {
          const req: PermissionRequest = {
            id: msg.id as string,
            tool: msg.tool as string,
            input: (msg.input ?? {}) as Record<string, unknown>,
            options: (msg.options ?? []) as PermissionOption[],
          };
          pendingPermRef.current = req;
          setPermissionRequest(req);

        } else if (type === "history_message") {
          const role = msg.role as "user" | "assistant";
          const text = msg.text as string;
          // First history_message signals start of a history drain — clear stale messages once
          if (!historyDrainingRef.current) {
            historyDrainingRef.current = true;
            setMessages([]);
          }
          setMessages((prev) => [
            ...prev,
            { role, blocks: [{ type: "text" as const, text }] },
          ]);

        } else if (type === "session_title_update") {
          const title = msg.title as string;
          if (title) {
            setSessions((prev) => prev.map((s) => s.sessionId === activeSessionIdRef.current ? { ...s, title } : s));
          }

        } else if (type === "history_done") {
          historyDrainingRef.current = false;

        } else if (type === "done") {
          setStreaming(false);
          setPermissionRequest(null);
          pendingPermRef.current = null;

        } else if (type === "error") {
          const errMsg = msg.message as string;
          // Spawn failures (command not found etc.) are fatal — stop reconnect loop
          const isSpawnError = errMsg.includes("No such file") || errMsg.includes("not found") ||
            errMsg.includes("failed to get session");
          if (isSpawnError) {
            fatalError = true;
            setMessages([{ role: "assistant", blocks: [{ type: "text", text: `⚠️ Agent connection failed: ${errMsg}\n\nCheck Settings → Agent Server and make sure the command is installed.` }] }]);
          } else {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === "assistant") {
                updated[updated.length - 1] = { ...last, blocks: [{ type: "text", text: `Error: ${errMsg}` }] };
              }
              return updated;
            });
          }
          setStreaming(false);
          setPermissionRequest(null);
          pendingPermRef.current = null;
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
      setWsReady(false);
    };
  }, [activeWorkspace, connectionKey, fetchSessions]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streaming || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setInput("");
    const userMsg: Message = { role: "user", blocks: [{ type: "text", text }] };
    const assistantMsg: Message = { role: "assistant", blocks: [] };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);
    wsRef.current.send(JSON.stringify({ type: "prompt", text }));
  }, [input, streaming]);

  const stopStreaming = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "cancel" }));
    setStreaming(false);
  }, []);

  const respondPermission = useCallback((optionId: string | null) => {
    const req = pendingPermRef.current;
    if (!req || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "permission_response", id: req.id, optionId }));
    pendingPermRef.current = null;
    setPermissionRequest(null);
  }, []);

  const startNewSession = useCallback(() => {
    if (!activeWorkspace) return;
    setShowSessionPicker(false);
    setMessages([]);
    sessionIntentRef.current = "new";
    setConnectionKey((k) => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace]);

  const resumeSession = useCallback((sessionId: string) => {
    setShowSessionPicker(false);
    // Don't clear messages yet — history_message events will replace them.
    // Clearing here causes the user's first new message to appear above history.
    sessionIntentRef.current = `load:${sessionId}`;
    setConnectionKey((k) => k + 1);
  }, []);

  const switchModel = useCallback(async (modelId: string) => {
    if (!activeWorkspace || modelSwitching) return;
    setShowModelPicker(false);
    setModelSwitching(true);
    try {
      const res = await setModel(activeWorkspace, modelId);
      setCurrentModel(res.current_model);
    } catch {
      // If set_model isn't supported by this ACP agent, show the model ID optimistically
      setCurrentModel(modelId);
    } finally {
      setModelSwitching(false);
    }
  }, [activeWorkspace, modelSwitching]);

  const currentSession = sessions.find((s) => s.sessionId === activeSessionId);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Session header */}
      <div style={{
        flexShrink: 0, borderBottom: `1px solid ${theme.edgeBorder}`,
        padding: "4px 10px", display: "flex", alignItems: "center", gap: 6, minHeight: 30,
      }}>
        <div style={{
          flex: 1, fontSize: FONT.sm, color: theme.muted,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 2px",
        }}>
          {currentSession?.title || ""}
        </div>
        <HeaderButton
          onClick={() => { setShowSessionPicker((p) => !p); if (activeWorkspace) fetchSessions(activeWorkspace); }}
          title={currentSession?.title || activeSessionId || ""}
        >
          Chat history
        </HeaderButton>
        <HeaderButton onClick={startNewSession} title="New conversation">+ New</HeaderButton>
        {currentModel && (
          <div style={{ position: "relative", flexShrink: 0, alignSelf: "center" }}>
            <HeaderButton
              onClick={() => setShowModelPicker((p) => !p)}
              title="Switch model"
              muted
              style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: modelSwitching ? 0.5 : 1 }}
            >
              {modelSwitching ? "…" : (availableModels.find((m) => m.modelId === currentModel)?.name || currentModel)}
            </HeaderButton>
            {showModelPicker && availableModels.length > 0 && (
              <div style={{
                position: "absolute", right: 0, top: "100%", marginTop: 2, zIndex: 100,
                background: theme.graphBg, border: `1px solid ${theme.edgeBorder}`,
                borderRadius: 4, minWidth: 200, boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              }}>
                {availableModels.map((m) => (
                  <ModelOption
                    key={m.modelId}
                    model={m}
                    isCurrent={m.modelId === currentModel}
                    theme={theme}
                    onClick={() => switchModel(m.modelId)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Session picker dropdown */}
      {showSessionPicker && (
        <div style={{
          flexShrink: 0, borderBottom: `1px solid ${theme.edgeBorder}`,
          background: theme.graphBg, maxHeight: 180, overflowY: "auto",
        }}>
          {sessions.length === 0
            ? <div style={{ padding: "8px 10px", fontSize: FONT.sm, color: theme.muted }}>No sessions found</div>
            : sessions.map((s) => (
              <SessionOption
                key={s.sessionId}
                session={s}
                isCurrent={s.sessionId === activeSessionId}
                theme={theme}
                onClick={() => resumeSession(s.sessionId)}
              />
            ))
          }
        </div>
      )}

      {/* Message area */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ fontSize: FONT.sm, color: theme.muted, padding: "4px 2px" }}>
            Ask anything about your workspace.
          </div>
        )}
        {messages.map((m, i) => (
          m.role === "user" ? (
            <div key={i} style={{ alignSelf: "flex-end", maxWidth: "80%" }}>
              {m.blocks.map((b, bi) => (
                <div key={bi} style={{
                  background: theme.terracotta, color: "#fff",
                  borderRadius: 8, padding: "7px 10px", fontSize: FONT.sm, lineHeight: 1.5,
                }}>{b.text}</div>
              ))}
            </div>
          ) : (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%",
                background: theme.terracotta, flexShrink: 0, marginTop: 5,
              }} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                {m.blocks.map((b, bi) =>
                  b.type === "tool" && b.tool ? (
                    <ToolBlock key={bi} block={b} theme={theme} workspace={activeWorkspace ?? ""} />
                  ) : (
                    <div key={bi} style={{ fontSize: FONT.sm, lineHeight: 1.5, color: theme.black, minWidth: 0 }}>
                      {b.text
                        ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                            p: ({ children }) => <p style={{ margin: "0 0 6px 0" }}>{children}</p>,
                            strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
                            em: ({ children }) => <em>{children}</em>,
                            code: ({ children }) => <code style={{ fontFamily: "monospace", fontSize: FONT.sm, background: "rgba(128,128,128,0.15)", padding: "1px 4px", borderRadius: 3 }}>{children}</code>,
                            pre: ({ children }) => <pre style={{ fontFamily: "monospace", fontSize: FONT.sm, background: "rgba(128,128,128,0.15)", padding: "6px 8px", borderRadius: 4, overflowX: "auto", margin: "4px 0" }}>{children}</pre>,
                            ul: ({ children }) => <ul style={{ margin: "4px 0", paddingLeft: 16 }}>{children}</ul>,
                            ol: ({ children }) => <ol style={{ margin: "4px 0", paddingLeft: 16 }}>{children}</ol>,
                            li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
                            table: ({ children }) => <table style={{ borderCollapse: "collapse", fontSize: FONT.sm, margin: "4px 0", width: "100%" }}>{children}</table>,
                            th: ({ children }) => <th style={{ border: `1px solid ${theme.edgeBorder}`, padding: "3px 6px", background: theme.taupe, color: theme.black, textAlign: "left", fontWeight: 600 }}>{children}</th>,
                            td: ({ children }) => <td style={{ border: `1px solid ${theme.edgeBorder}`, padding: "3px 6px", color: theme.black }}>{children}</td>,
                          }}>{b.text}</ReactMarkdown>
                        : (streaming && i === messages.length - 1 ? <TypingDots /> : "")}
                    </div>
                  )
                )}
                {m.blocks.length === 0 && streaming && i === messages.length - 1 && <TypingDots />}
              </div>
            </div>
          )
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Permission request — fixed above input, always visible */}
      {permissionRequest && (
        <div style={{
          flexShrink: 0, borderTop: `1px solid ${theme.edgeBorder}`,
          fontSize: FONT.sm, background: theme.base,
        }}>
          <div style={{ padding: "6px 10px", borderBottom: `1px solid ${theme.edgeBorder}` }}>
            <span style={{ fontFamily: "monospace", fontWeight: 600, color: theme.terracotta }}>{permissionRequest.tool.replace(/\/Users\/[^/]+\//g, "~/")}</span>
            {Object.entries(permissionRequest.input).slice(0, 2).map(([k, v]) => (
              <div key={k} style={{ color: theme.muted, fontFamily: "monospace", fontSize: FONT.sm, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {k}: {typeof v === "string" ? v.replace(/\/Users\/[^/]+\//g, "~/") : JSON.stringify(v)}
              </div>
            ))}
          </div>
          {permissionRequest.options.map((opt, i) => {
            const isReject = opt.kind === "reject_once";
            return (
              <button
                key={opt.optionId}
                onClick={() => respondPermission(isReject ? null : opt.optionId)}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = isReject ? theme.edgeBorder : theme.taupe; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                style={{
                  display: "block", width: "100%", padding: "7px 10px",
                  textAlign: "left", cursor: "pointer", fontSize: FONT.sm,
                  borderTop: i === 0 ? "none" : `1px solid ${theme.edgeBorder}`,
                  border: "none",
                  background: "transparent",
                  color: isReject ? theme.muted : theme.black,
                  fontWeight: isReject ? 400 : 500,
                  transition: "background 0.1s",
                }}
              >
                {opt.name.replace(/\/Users\/[^/]+\//g, "~/")}
              </button>
            );
          })}
        </div>
      )}

      {/* Input */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${theme.edgeBorder}` }}>
        {!wsReady && (
          <div style={{ padding: "3px 8px", fontSize: FONT.sm, color: theme.muted, background: theme.graphBg }}>
            Connecting to backend…
          </div>
        )}
        <div style={{ padding: 8, display: "flex", gap: 6, alignItems: "flex-end" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={wsReady ? "Ask about this workspace… (Shift+Enter for newline)" : "Waiting for connection…"}
            disabled={streaming || !wsReady}
            rows={3}
            style={{
              flex: 1, background: theme.graphBg, borderRadius: 4,
              border: `1px solid ${theme.edgeBorder}`, fontSize: FONT.sm,
              color: theme.black, padding: "8px 10px", outline: "none",
              resize: "none", lineHeight: 1.5, fontFamily: "inherit",
              opacity: wsReady ? 1 : 0.5,
            }}
          />
          {streaming ? (
            <button
              onClick={stopStreaming}
              style={{
                width: 36, height: 36, background: "transparent", borderRadius: 4,
                border: `1px solid ${theme.edgeBorder}`, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: theme.black, fontSize: FONT.md, flexShrink: 0,
              }}
              title="Stop generation"
            >■</button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim() || !wsReady}
              style={{
                width: 36, height: 36, background: theme.terracotta, borderRadius: 4,
                border: "none", cursor: !wsReady ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: !input.trim() || !wsReady ? 0.4 : 1,
                color: "#fff", fontSize: FONT.lg, flexShrink: 0,
              }}
            >→</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolBlock({ block, theme, workspace }: { block: Block; theme: ReturnType<typeof useTheme>["theme"]; workspace: string }) {
  const tool = block.tool!;
  const entries = Object.entries(tool.input ?? {});
  const running = block.status === "running";

  const trimPath = (v: string) => {
    if (workspace && v.startsWith(workspace)) return v.slice(workspace.length).replace(/^\//, "");
    return v.replace(/\/Users\/[^/]+\//g, "~/");
  };

  return (
    <div style={{ fontSize: FONT.sm, borderRadius: 4, overflow: "hidden", border: `1px solid ${theme.edgeBorder}`, maxWidth: "100%" }}>
      <div style={{
        padding: "3px 7px", background: theme.taupe, color: theme.black,
        fontFamily: "monospace", fontSize: FONT.sm, display: "flex", alignItems: "center", gap: 4,
      }}>
        <span>{running ? "⟳" : "✓"} {tool.name}</span>
      </div>
      {entries.length > 0 && (
        <div style={{ padding: "4px 7px", background: theme.graphBg, fontFamily: "monospace", lineHeight: 1.6, overflow: "hidden" }}>
          {entries.map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 4, minWidth: 0 }}>
              <span style={{ color: theme.charcoal, fontSize: FONT.sm, flexShrink: 0 }}>{k}:</span>
              <span style={{ color: theme.black, fontSize: FONT.sm, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {typeof v === "string" ? trimPath(v) : JSON.stringify(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <span>
      <style>{`
        @keyframes chatDot { 0%,80%,100%{opacity:0.2} 40%{opacity:1} }
        .chat-dot { display:inline-block; width:5px; height:5px; border-radius:50%; background:currentColor; margin:0 1px; animation:chatDot 1.2s infinite; }
        .chat-dot:nth-child(2){animation-delay:0.2s}
        .chat-dot:nth-child(3){animation-delay:0.4s}
      `}</style>
      <span className="chat-dot" />
      <span className="chat-dot" />
      <span className="chat-dot" />
    </span>
  );
}
