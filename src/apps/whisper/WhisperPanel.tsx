import { useCallback } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { useChat } from "@/hooks/useChat";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { EmptyState } from "./EmptyState";

export function WhisperPanel({ user: _user, initialRoomId }: WindowContentProps & { initialRoomId?: string }) {
  const {
    connected,
    sessionAnonId,
    onlineUsers,
    rooms,
    activeRoom,
    activeRoomId,
    setActiveRoomId,
    messages,
    myAnonHandle,
    typingUsers,
    error,
    clearError,
    dmRequests,
    replyToMsg,
    setReplyTo,
    requestDm,
    respondDm,
    sendMessage,
    toggleReaction,
    setTyping,
    generateInviteLink,
  } = useChat(initialRoomId);

  const handleInviteLink = useCallback(
    async (roomId: string) => {
      try {
        const url = await generateInviteLink(roomId);
        await navigator.clipboard.writeText(url);
      } catch {
        // silently fail
      }
    },
    [generateInviteLink]
  );

  if (!connected) {
    return (
      <div className="whisper-panel">
        <div className="whisper-connecting">
          <span className="spinner" />
          connecting to the void...
        </div>
      </div>
    );
  }

  return (
    <div className="whisper-panel">
      {error && (
        <div className="whisper-error" onClick={clearError}>
          {error} <span style={{ opacity: 0.5 }}>(click to dismiss)</span>
        </div>
      )}
      <div className="whisper-layout">
        <Sidebar
          sessionAnonId={sessionAnonId}
          onlineUsers={onlineUsers}
          rooms={rooms}
          activeRoomId={activeRoomId}
          dmRequests={dmRequests}
          onRequestDm={requestDm}
          onRespondDm={respondDm}
          onSelectRoom={setActiveRoomId}
          onInviteLink={(roomId) => void handleInviteLink(roomId)}
        />
        <div className="whisper-main">
          {activeRoom ? (
            <ChatView
              roomId={activeRoom.id}
              roomName={activeRoom.name}
              messages={messages}
              myAnonHandle={myAnonHandle}
              typingUsers={typingUsers}
              replyToMsg={replyToMsg}
              onSend={sendMessage}
              onTyping={setTyping}
              onReaction={toggleReaction}
              onReply={setReplyTo}
              onInviteLink={(roomId) => void handleInviteLink(roomId)}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}
