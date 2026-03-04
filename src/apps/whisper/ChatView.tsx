import { useState, useRef, useEffect } from "react";
import type { ChatMessage, ReplyInfo } from "@/hooks/useChat";
import { AVAILABLE_REACTIONS, LOBBY_ID, MAX_MESSAGE_LENGTH } from "@/hooks/useChat";

interface ChatViewProps {
  roomId: string;
  roomName: string | null;
  messages: ChatMessage[];
  myAnonHandle: string | null;
  typingUsers: string[];
  replyToMsg: ChatMessage | null;
  onSend: (text: string, replyTo?: number) => void;
  onTyping: (typing: boolean) => void;
  onReaction: (messageId: number, emoji: string) => void;
  onReply: (msg: ChatMessage | null) => void;
  onInviteLink: (roomId: string) => void;
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr.replace(" ", "T") + "Z");
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function getRandomPlaceholder(): string {
  const placeholders = [
    "whisper something...",
    "type into the void...",
    "say it. no one will know.",
    "gone in 24h...",
    "speak, ghost.",
    "the void listens...",
  ];
  return placeholders[Math.floor(Math.random() * placeholders.length)] ?? "whisper something...";
}

function ReactionPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div className="whisper-reaction-picker" ref={ref}>
      {AVAILABLE_REACTIONS.map((emoji) => (
        <button key={emoji} onClick={() => { onPick(emoji); onClose(); }}>
          {emoji}
        </button>
      ))}
    </div>
  );
}

function ReplyPreview({ replyTo }: { replyTo: ReplyInfo }) {
  return (
    <div className="whisper-reply-preview">
      <span className="whisper-reply-handle">{replyTo.anonHandle}</span>
      <span className="whisper-reply-text">{replyTo.content.length > 60 ? replyTo.content.slice(0, 60) + "..." : replyTo.content}</span>
    </div>
  );
}

export function ChatView({ roomId, roomName, messages, myAnonHandle, typingUsers, replyToMsg, onSend, onTyping, onReaction, onReply, onInviteLink }: ChatViewProps) {
  const [input, setInput] = useState("");
  const [placeholder] = useState(getRandomPlaceholder);
  const [pickerMsgId, setPickerMsgId] = useState<number | null>(null);
  const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [roomId]);

  // Focus input when reply is set
  useEffect(() => {
    if (replyToMsg) {
      inputRef.current?.focus();
    }
  }, [replyToMsg]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH) return;
    onSend(text, replyToMsg?.id);
    setInput("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.length <= MAX_MESSAGE_LENGTH) {
      setInput(val);
      onTyping(val.length > 0);
    }
  };

  const isLobby = roomId === LOBBY_ID;
  const charCount = input.length;
  const charWarn = charCount > MAX_MESSAGE_LENGTH * 0.9;

  return (
    <div className="whisper-chat">
      <div className="whisper-chat-header">
        <span className="whisper-chat-room-id">
          {roomName ? `# ${roomName}` : `room: ${roomId.slice(0, 8)}...`}
        </span>
        {!isLobby && (
          <button
            className="whisper-invite-btn"
            onClick={() => onInviteLink(roomId)}
            title="copy invite link"
          >
            link
          </button>
        )}
      </div>

      <div className="whisper-messages terminal-scroll">
        <div className="whisper-notice">
          {isLobby
            ? "public room. everyone sees this. messages vanish after 24h."
            : "messages self-destruct after 24h. no traces left behind."}
        </div>
        {messages.map((msg) => {
          const isOwn = msg.anonHandle === myAnonHandle;
          const isHovered = hoveredMsgId === msg.id;
          return (
            <div
              key={msg.id}
              className={`whisper-msg ${isOwn ? "whisper-msg-own" : ""}`}
              onMouseEnter={() => setHoveredMsgId(msg.id)}
              onMouseLeave={() => setHoveredMsgId(null)}
            >
              {/* Reply quote */}
              {msg.replyTo && <ReplyPreview replyTo={msg.replyTo} />}

              <div className="whisper-msg-header">
                <span className="whisper-msg-handle">{msg.anonHandle}</span>
                <span className="whisper-msg-time">{formatTime(msg.created_at)}</span>
              </div>
              <div className="whisper-msg-content">{msg.content}</div>

              {/* Reactions display */}
              {msg.reactions.length > 0 && (
                <div className="whisper-msg-reactions">
                  {msg.reactions.map((r) => (
                    <span
                      key={r.emoji}
                      className={`whisper-reaction ${r.reacted ? "whisper-reaction-active" : ""}`}
                      onClick={() => onReaction(msg.id, r.emoji)}
                    >
                      {r.emoji}
                      <span className="whisper-reaction-count">{r.count}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Action buttons — visible on hover or touch */}
              {(isHovered || pickerMsgId === msg.id) && (
                <div className="whisper-msg-actions">
                  <button
                    className="whisper-action-btn"
                    onClick={() => onReply(msg)}
                  >
                    reply
                  </button>
                  <span style={{ position: "relative" }}>
                    <button
                      className="whisper-action-btn"
                      onClick={() => setPickerMsgId(pickerMsgId === msg.id ? null : msg.id)}
                    >
                      react
                    </button>
                    {pickerMsgId === msg.id && (
                      <ReactionPicker
                        onPick={(emoji) => onReaction(msg.id, emoji)}
                        onClose={() => setPickerMsgId(null)}
                      />
                    )}
                  </span>
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {typingUsers.length > 0 && (
        <div className="whisper-typing">
          {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing...
        </div>
      )}

      {/* Reply indicator bar */}
      {replyToMsg && (
        <div className="whisper-reply-bar">
          <span className="whisper-reply-bar-text">
            replying to <strong>{replyToMsg.anonHandle}</strong>
          </span>
          <button className="whisper-reply-bar-close" onClick={() => onReply(null)}>×</button>
        </div>
      )}

      <form className="whisper-input" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder={replyToMsg ? `reply to ${replyToMsg.anonHandle}...` : placeholder}
          maxLength={MAX_MESSAGE_LENGTH}
          autoComplete="off"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape" && replyToMsg) {
              onReply(null);
            }
          }}
        />
        {charCount > 0 && (
          <span className={`whisper-char-count ${charWarn ? "whisper-char-count-warn" : ""}`}>
            {charCount}/{MAX_MESSAGE_LENGTH}
          </span>
        )}
        <button type="submit" disabled={!input.trim() || charCount > MAX_MESSAGE_LENGTH}>
          send
        </button>
      </form>
    </div>
  );
}
