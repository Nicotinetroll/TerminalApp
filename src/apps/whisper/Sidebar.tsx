import { useCallback } from "react";
import { LOBBY_ID } from "@/hooks/useChat";
import type { OnlineUser, RoomInfo, DmRequest } from "@/hooks/useChat";

interface SidebarProps {
  sessionAnonId: string | null;
  onlineUsers: OnlineUser[];
  rooms: RoomInfo[];
  activeRoomId: string | null;
  dmRequests: DmRequest[];
  onRequestDm: (sessionAnonId: string) => void;
  onRespondDm: (requestId: number, accept: boolean) => void;
  onSelectRoom: (roomId: string) => void;
  onInviteLink: (roomId: string) => void;
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len) + "...";
}

function timeAgo(dateStr: string): string {
  try {
    const d = new Date(dateStr.replace(" ", "T") + "Z");
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  } catch {
    return "";
  }
}

export function Sidebar({
  sessionAnonId,
  onlineUsers,
  rooms,
  activeRoomId,
  dmRequests,
  onRequestDm,
  onRespondDm,
  onSelectRoom,
  onInviteLink,
}: SidebarProps) {
  const others = onlineUsers;
  const lobby = rooms.find((r) => r.id === LOBBY_ID);
  const dmRooms = rooms.filter((r) => r.id !== LOBBY_ID);

  const handleCopyLink = useCallback(
    (e: React.MouseEvent, roomId: string) => {
      e.stopPropagation();
      onInviteLink(roomId);
    },
    [onInviteLink]
  );

  return (
    <div className="whisper-sidebar">
      {/* open chat — always at top */}
      {lobby && (
        <div
          className={`whisper-lobby-item ${activeRoomId === LOBBY_ID ? "whisper-room-active" : ""}`}
          onClick={() => onSelectRoom(LOBBY_ID)}
        >
          <span className="whisper-lobby-name"># open chat</span>
          {lobby.unread > 0 && (
            <span className="whisper-unread">{lobby.unread}</span>
          )}
        </div>
      )}

      {/* DM requests */}
      {dmRequests.length > 0 && (
        <div className="whisper-dm-requests">
          <div className="whisper-section-label">dm requests</div>
          {dmRequests.map((req) => (
            <div key={req.id} className="whisper-dm-request">
              <span className="whisper-dm-request-name">{req.fromAnon}</span>
              <div className="whisper-dm-request-actions">
                <button
                  className="whisper-dm-accept"
                  onClick={() => onRespondDm(req.id, true)}
                >
                  ok
                </button>
                <button
                  className="whisper-dm-decline"
                  onClick={() => onRespondDm(req.id, false)}
                >
                  nah
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DMs section */}
      {dmRooms.length > 0 && (
        <div className="whisper-section">
          <div className="whisper-section-label">dms</div>
          {dmRooms.map((room) => {
            const otherParticipants = room.participants.filter(
              (p) => p.anonHandle !== room.anonHandle
            );
            const roomLabel = otherParticipants.map((p) => p.anonHandle).join(", ") || "empty room";

            return (
              <div
                key={room.id}
                className={`whisper-room-item ${room.id === activeRoomId ? "whisper-room-active" : ""}`}
                onClick={() => onSelectRoom(room.id)}
              >
                <div className="whisper-room-top">
                  <span className="whisper-room-name">{truncate(roomLabel, 18)}</span>
                  <div className="whisper-room-meta">
                    {room.unread > 0 && (
                      <span className="whisper-unread">{room.unread}</span>
                    )}
                    <button
                      className="whisper-link-btn"
                      onClick={(e) => handleCopyLink(e, room.id)}
                      title="copy invite link"
                    >
                      +
                    </button>
                  </div>
                </div>
                {room.lastMessage && (
                  <div className="whisper-room-preview">
                    <span className="whisper-preview-text">
                      {truncate(room.lastMessage.content, 28)}
                    </span>
                    <span className="whisper-preview-time">
                      {timeAgo(room.lastMessage.created_at)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Online users — click to request DM */}
      <div className="whisper-section whisper-section-grow">
        <div className="whisper-section-label">online ({others.length})</div>
        <div className="whisper-sidebar-list terminal-scroll">
          {others.length === 0 ? (
            <div className="whisper-sidebar-empty">
              nobody here. just the void.
            </div>
          ) : (
            others.map((u) => {
              const isSelf = u.sessionAnonId === sessionAnonId;
              return (
                <div
                  key={u.sessionAnonId}
                  className={`whisper-user-item ${isSelf ? "whisper-user-self" : ""}`}
                  onClick={() => { if (!isSelf) onRequestDm(u.sessionAnonId); }}
                  title={isSelf ? "that's you, genius" : "request DM"}
                >
                  <span className="whisper-user-dot" />
                  <span className="whisper-user-name">
                    {u.sessionAnonId}{isSelf ? " (you)" : ""}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
