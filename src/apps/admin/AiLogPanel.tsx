import { useState, useEffect, useCallback } from "react";
import { getToken } from "@/lib/api";

interface AiConversation {
  id: number;
  user_id: number;
  username: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface AiMessage {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

const API_BASE = "/api";

async function fetchConversations(): Promise<AiConversation[]> {
  const res = await fetch(`${API_BASE}/ai/admin/conversations`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const data = await res.json();
  return (data as { conversations: AiConversation[] }).conversations;
}

async function fetchMessages(convoId: number): Promise<AiMessage[]> {
  const res = await fetch(`${API_BASE}/ai/admin/conversations/${convoId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const data = await res.json();
  return (data as { messages: AiMessage[] }).messages;
}

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr + "Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function AiLogPanel() {
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessages, setSelectedMessages] = useState<AiMessage[] | null>(null);
  const [selectedConvo, setSelectedConvo] = useState<AiConversation | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const handleSelectConvo = useCallback(async (convo: AiConversation) => {
    setLoadingMessages(true);
    try {
      const msgs = await fetchMessages(convo.id);
      setSelectedMessages(msgs);
      setSelectedConvo(convo);
    } catch {
      // fail silently
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="admin-loading">
        <span className="spinner" />
        loading AI conversations...
      </div>
    );
  }

  if (selectedMessages && selectedConvo) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button className="btn" onClick={() => { setSelectedMessages(null); setSelectedConvo(null); }}>
            back
          </button>
          <span style={{ fontSize: "13px", color: "var(--accent)" }}>
            {selectedConvo.username}
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-ghost)" }}>
            ({selectedMessages.length} messages)
          </span>
        </div>

        <div className="terminal-scroll" style={{ flex: 1, overflow: "auto" }}>
          {selectedMessages.length === 0 ? (
            <div className="admin-empty">empty convo. they opened it and said nothing. legend.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "4px 0" }}>
              {selectedMessages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    padding: "6px 10px",
                    borderRadius: "4px",
                    background: msg.role === "user"
                      ? "rgba(255,255,255,0.03)"
                      : "rgba(var(--accent-rgb, 139,92,246),0.06)",
                    borderLeft: `2px solid ${msg.role === "user" ? "var(--text-muted)" : "var(--accent)"}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: msg.role === "user" ? "var(--text-secondary)" : "var(--accent)",
                    }}>
                      {msg.role === "user" ? selectedConvo.username : "nigga AI"}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--text-ghost)" }}>
                      {formatDate(msg.created_at)}
                    </span>
                  </div>
                  <div style={{
                    fontSize: "13px",
                    color: "var(--text-primary)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    lineHeight: "1.4",
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-scroll" style={{ flex: 1, overflow: "auto" }}>
      {loadingMessages && (
        <div className="admin-loading">
          <span className="spinner" />
          loading messages...
        </div>
      )}
      {conversations.length === 0 ? (
        <div className="admin-empty">no AI conversations. nobody's talking to nigga yet. sad.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>user</th>
              <th>messages</th>
              <th>started</th>
              <th>last active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {conversations.map((convo) => (
              <tr key={convo.id}>
                <td style={{ color: "var(--accent)", fontWeight: 500 }}>{convo.username}</td>
                <td>{convo.message_count}</td>
                <td style={{ whiteSpace: "nowrap", fontSize: "11px" }}>{formatDate(convo.created_at)}</td>
                <td style={{ whiteSpace: "nowrap", fontSize: "11px" }}>{formatDate(convo.updated_at)}</td>
                <td>
                  <button
                    className="btn"
                    style={{ fontSize: "11px", padding: "2px 8px" }}
                    onClick={() => void handleSelectConvo(convo)}
                  >
                    view
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
