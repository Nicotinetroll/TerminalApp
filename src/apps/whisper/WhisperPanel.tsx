import { useCallback, useEffect, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { useChat } from "@/hooks/useChat";
import { useNotifications } from "@/hooks/useNotifications";
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
    refreshHandle,
    generateInviteLink,
  } = useChat(initialRoomId);

  const { playChatSound, showBrowserNotification } = useNotifications();
  const prevMsgCount = useRef(messages.length);

  // Play sound on incoming messages from others
  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      const newMsgs = messages.slice(prevMsgCount.current);
      const hasOtherMsg = newMsgs.some(m => m.anonHandle !== myAnonHandle);
      if (hasOtherMsg) {
        playChatSound();
        const lastMsg = newMsgs[newMsgs.length - 1];
        if (lastMsg) {
          showBrowserNotification("whisper", `${lastMsg.anonHandle}: ${lastMsg.content.slice(0, 80)}`);
        }
      }
    }
    prevMsgCount.current = messages.length;
  }, [messages, myAnonHandle, playChatSound, showBrowserNotification]);

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
              onRefreshHandle={refreshHandle}
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
