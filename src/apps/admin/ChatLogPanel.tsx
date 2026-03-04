import { useState, useEffect, useCallback } from "react";
import { getToken } from "@/lib/api";

interface ChatParticipant {
  anon_handle: string;
  username: string;
}

interface ChatRoom {
  id: string;
  created_at: string;
  message_count: number;
  participants: ChatParticipant[];
}

interface ChatMessageDetail {
  id: number;
  content: string;
  created_at: string;
  sender_id: number;
  username: string;
  anon_handle: string;
}

interface RoomDetail {
  id: string;
  participants: (ChatParticipant & { user_id: number })[];
  messages: ChatMessageDetail[];
}

const API_BASE = "/api";

async function clearRoomMessages(roomId: string): Promise<{ ok: boolean; deleted: number }> {
  const res = await fetch(`${API_BASE}/admin/chats/${roomId}/messages`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  return res.json() as Promise<{ ok: boolean; deleted: number }>;
}

async function fetchRooms(): Promise<ChatRoom[]> {
  const res = await fetch(`${API_BASE}/admin/chats`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const data = await res.json();
  return (data as { rooms: ChatRoom[] }).rooms;
}

async function fetchRoomDetail(roomId: string): Promise<RoomDetail> {
  const res = await fetch(`${API_BASE}/admin/chats/${roomId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const data = await res.json();
  return (data as { room: RoomDetail }).room;
}

export function ChatLogPanel() {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState<RoomDetail | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(false);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRooms();
      setRooms(data);
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  const handleSelectRoom = useCallback(async (roomId: string) => {
    setLoadingRoom(true);
    try {
      const detail = await fetchRoomDetail(roomId);
      setSelectedRoom(detail);
    } catch {
      // fail silently
    } finally {
      setLoadingRoom(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="admin-loading">
        <span className="spinner" />
        loading rooms...
      </div>
    );
  }

  if (selectedRoom) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <button className="admin-btn" onClick={() => setSelectedRoom(null)}>
            back
          </button>
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            room: {selectedRoom.id.slice(0, 12)}...
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-ghost)" }}>
            ({selectedRoom.participants.map((p) => `${p.username} as ${p.anon_handle}`).join(", ")})
          </span>
          <button
            className="admin-btn"
            style={{ fontSize: "11px", padding: "2px 8px", color: "var(--error)", borderColor: "rgba(248,113,113,0.3)", marginLeft: "auto" }}
            onClick={async () => {
              if (!confirm(`nuke all messages in this room?`)) return;
              await clearRoomMessages(selectedRoom.id);
              setSelectedRoom(null);
              void loadRooms();
            }}
          >
            clear messages
          </button>
        </div>

        <div className="terminal-scroll" style={{ flex: 1, overflow: "auto" }}>
          {selectedRoom.messages.length === 0 ? (
            <div className="admin-empty">no messages. just ghosts staring at each other.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>time</th>
                  <th>user</th>
                  <th>alias</th>
                  <th>message</th>
                </tr>
              </thead>
              <tbody>
                {selectedRoom.messages.map((msg) => (
                  <tr key={msg.id}>
                    <td style={{ whiteSpace: "nowrap", fontSize: "11px" }}>{msg.created_at}</td>
                    <td style={{ color: "var(--accent)" }}>{msg.username}</td>
                    <td style={{ color: "var(--text-ghost)" }}>{msg.anon_handle}</td>
                    <td>{msg.content}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-scroll" style={{ flex: 1, overflow: "auto" }}>
      {loadingRoom && (
        <div className="admin-loading">
          <span className="spinner" />
          loading messages...
        </div>
      )}
      {rooms.length === 0 ? (
        <div className="admin-empty">no whisper rooms yet. the void is empty.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>room</th>
              <th>participants</th>
              <th>messages</th>
              <th>created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.id}>
                <td style={{ fontFamily: "monospace", fontSize: "11px" }}>{room.id.slice(0, 12)}...</td>
                <td>
                  {room.participants.map((p) => (
                    <span key={p.username} style={{ marginRight: "8px" }}>
                      <span style={{ color: "var(--accent)" }}>{p.username}</span>
                      <span style={{ color: "var(--text-ghost)", fontSize: "11px" }}> ({p.anon_handle})</span>
                    </span>
                  ))}
                </td>
                <td>{room.message_count}</td>
                <td style={{ whiteSpace: "nowrap", fontSize: "11px" }}>{room.created_at}</td>
                <td style={{ display: "flex", gap: "4px" }}>
                  <button
                    className="admin-btn"
                    style={{ fontSize: "11px", padding: "2px 8px" }}
                    onClick={() => void handleSelectRoom(room.id)}
                  >
                    view
                  </button>
                  <button
                    className="admin-btn"
                    style={{ fontSize: "11px", padding: "2px 8px", color: "var(--error)", borderColor: "rgba(248,113,113,0.3)" }}
                    onClick={async () => {
                      if (!confirm(`nuke all ${room.message_count} messages?`)) return;
                      await clearRoomMessages(room.id);
                      void loadRooms();
                    }}
                  >
                    clear
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
