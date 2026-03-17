import { useState, useEffect, useCallback, useRef } from "react";
import { getSocket } from "@/lib/socket";
import type { Socket } from "socket.io-client";

export const LOBBY_ID = "open";
export const AVAILABLE_REACTIONS = ["💀", "🔥", "💩", "👻", "🤡", "⚰️"];
export const MAX_MESSAGE_LENGTH = 500;

export interface OnlineUser {
  sessionAnonId: string;
  online: boolean;
}

export interface ReactionData {
  messageId: number;
  emoji: string;
  count: number;
  reacted: boolean;
}

export interface ReplyInfo {
  id: number;
  content: string;
  anonHandle: string;
}

export interface ChatMessage {
  id: number;
  roomId: string;
  content: string;
  anonHandle: string;
  created_at: string;
  reactions: ReactionData[];
  replyTo: ReplyInfo | null;
}

export interface RoomParticipant {
  anonHandle: string;
  online: boolean;
}

export interface RoomInfo {
  id: string;
  name: string | null;
  anonHandle: string;
  participants: RoomParticipant[];
  lastMessage: { content: string; anonHandle: string; created_at: string } | null;
  unread: number;
}

export interface DmRequest {
  id: number;
  fromAnonId: string;
  fromAnon: string;
  status: string;
}

interface TypingState {
  [roomId: string]: string[];
}

export function useChat(initialRoomId?: string | null) {
  const [connected, setConnected] = useState(false);
  const [sessionAnonId, setSessionAnonId] = useState<string | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingState>({});
  const [error, setError] = useState<string | null>(null);
  const [dmRequests, setDmRequests] = useState<DmRequest[]>([]);
  const [replyToMsg, setReplyToMsg] = useState<ChatMessage | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const initialRoomJoined = useRef(false);
  const lobbySelected = useRef(false);
  const activeRoomIdRef = useRef<string | null>(null);
  const myAnonHandleRef = useRef<string | null>(null);

  // Keep refs in sync for use in closures
  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  // Connect
  useEffect(() => {
    let socket: Socket;
    try {
      socket = getSocket();
    } catch {
      setError("couldn't connect. are you logged in?");
      return;
    }
    socketRef.current = socket;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onError = (err: Error) => setError(err.message);

    const onSessionInfo = (data: { sessionAnonId: string }) => {
      setSessionAnonId(data.sessionAnonId);
    };

    const onUsersOnline = (users: OnlineUser[]) => {
      setOnlineUsers(users);
    };

    const onMessageNew = (msg: ChatMessage) => {
      // Only add to messages if it's for the active room
      setMessages((prev) => {
        if (msg.roomId !== activeRoomIdRef.current) return prev;
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setRooms((prev) =>
        prev.map((r) =>
          r.id === msg.roomId
            ? {
                ...r,
                lastMessage: { content: msg.content, anonHandle: msg.anonHandle, created_at: msg.created_at },
                unread: r.id === activeRoomIdRef.current ? r.unread : r.unread + 1,
              }
            : r
        )
      );
    };

    const onRoomNew = (room: RoomInfo) => {
      setRooms((prev) => {
        if (prev.some((r) => r.id === room.id)) return prev;
        return [room, ...prev];
      });
    };

    const onHandleChanged = (data: { roomId: string; oldHandle: string; newHandle: string }) => {
      // Update room participant lists
      setRooms((prev) =>
        prev.map((r) => {
          if (r.id !== data.roomId) return r;
          return {
            ...r,
            anonHandle: r.anonHandle === data.oldHandle ? data.newHandle : r.anonHandle,
            participants: r.participants.map((p) =>
              p.anonHandle === data.oldHandle ? { ...p, anonHandle: data.newHandle } : p
            ),
          };
        })
      );
      // Inject system message
      setMessages((prev) => {
        if (data.roomId !== activeRoomIdRef.current) return prev;
        const sysMsg: ChatMessage = {
          id: Date.now() * -1, // negative to avoid collision
          roomId: data.roomId,
          content: `${data.oldHandle} morphed into ${data.newHandle}`,
          anonHandle: "system",
          created_at: new Date().toISOString().replace("T", " ").split(".")[0] ?? "",
          reactions: [],
          replyTo: null,
        };
        return [...prev, sysMsg];
      });
    };

    const onRoomUserJoined = (data: { roomId: string; anonHandle: string }) => {
      setRooms((prev) =>
        prev.map((r) =>
          r.id === data.roomId
            ? { ...r, participants: [...r.participants, { anonHandle: data.anonHandle, online: true }] }
            : r
        )
      );
    };

    const onTypingUpdate = (data: { roomId: string; anonHandle: string; typing: boolean }) => {
      setTypingUsers((prev) => {
        const current = prev[data.roomId] ?? [];
        if (data.typing) {
          if (current.includes(data.anonHandle)) return prev;
          return { ...prev, [data.roomId]: [...current, data.anonHandle] };
        } else {
          return { ...prev, [data.roomId]: current.filter((h) => h !== data.anonHandle) };
        }
      });
    };

    // DM request events
    const onDmPending = (requests: DmRequest[]) => {
      setDmRequests(requests);
    };

    const onDmIncoming = (request: DmRequest) => {
      setDmRequests((prev) => {
        if (prev.some((r) => r.id === request.id)) return prev;
        return [...prev, request];
      });
    };

    const onDmAccepted = (_data: { requestId: number; roomId: string }) => {
      // Room will be delivered via room:new
    };

    const onDmDeclined = (data: { requestId: number }) => {
      setError("dm request declined. they don't want you.");
      // Remove from our pending if we had it
      setDmRequests((prev) => prev.filter((r) => r.id !== data.requestId));
    };

    // Reaction updates from server — single source of truth (no optimistic updates)
    const onReactionUpdate = (data: {
      messageId: number;
      reactions: { messageId: number; emoji: string; count: number }[];
      toggledBy: string;
      toggledEmoji: string;
      wasAdded: boolean;
    }) => {
      const myHandle = myAnonHandleRef.current;
      const isMe = data.toggledBy === myHandle;
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== data.messageId) return msg;
          const newReactions = data.reactions.map((r) => {
            if (isMe) {
              // I toggled: one reaction per user, so only toggledEmoji (if added) is mine
              return {
                messageId: data.messageId,
                emoji: r.emoji,
                count: r.count,
                reacted: data.wasAdded && r.emoji === data.toggledEmoji,
              };
            }
            // Someone else toggled: preserve my existing reacted state
            const existing = msg.reactions.find((er) => er.emoji === r.emoji);
            return {
              messageId: data.messageId,
              emoji: r.emoji,
              count: r.count,
              reacted: existing?.reacted ?? false,
            };
          });
          return { ...msg, reactions: newReactions };
        })
      );
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onError);
    socket.on("session:info", onSessionInfo);
    socket.on("users:online", onUsersOnline);
    socket.on("message:new", onMessageNew);
    socket.on("room:new", onRoomNew);
    socket.on("room:user-joined", onRoomUserJoined);
    socket.on("handle:changed", onHandleChanged);
    socket.on("typing:update", onTypingUpdate);
    socket.on("dm:pending", onDmPending);
    socket.on("dm:incoming", onDmIncoming);
    socket.on("dm:accepted", onDmAccepted);
    socket.on("dm:declined", onDmDeclined);
    socket.on("reaction:update", onReactionUpdate);

    if (socket.connected) {
      setConnected(true);
    }

    // Load existing rooms — auto-select lobby
    socket.emit("rooms:list", (roomsList: RoomInfo[]) => {
      setRooms(roomsList);
      if (!initialRoomId && !lobbySelected.current) {
        const lobby = roomsList.find((r) => r.id === LOBBY_ID);
        if (lobby) {
          lobbySelected.current = true;
          setActiveRoomId(LOBBY_ID);
        }
      }
    });

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onError);
      socket.off("session:info", onSessionInfo);
      socket.off("users:online", onUsersOnline);
      socket.off("message:new", onMessageNew);
      socket.off("room:new", onRoomNew);
      socket.off("room:user-joined", onRoomUserJoined);
      socket.off("handle:changed", onHandleChanged);
      socket.off("typing:update", onTypingUpdate);
      socket.off("dm:pending", onDmPending);
      socket.off("dm:incoming", onDmIncoming);
      socket.off("dm:accepted", onDmAccepted);
      socket.off("dm:declined", onDmDeclined);
      socket.off("reaction:update", onReactionUpdate);
      // Don't disconnect — socket stays alive for badge notifications (useAppBadges)
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-join initial room (from invite link)
  useEffect(() => {
    if (!initialRoomId || !connected || initialRoomJoined.current) return;
    initialRoomJoined.current = true;
    joinRoom(initialRoomId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoomId, connected]);

  // Load message history when switching rooms
  useEffect(() => {
    if (!activeRoomId || !socketRef.current) return;
    socketRef.current.emit("message:history", { roomId: activeRoomId, limit: 100 }, (msgs: ChatMessage[]) => {
      setMessages(msgs);
    });
    setRooms((prev) =>
      prev.map((r) => (r.id === activeRoomId ? { ...r, unread: 0 } : r))
    );
  }, [activeRoomId]);

  // ── DM request (instead of direct room creation) ──
  const requestDm = useCallback((targetSessionAnonId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("dm:request", { targetSessionAnonId }, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) {
        setError(result.error ?? "request failed");
      }
    });
  }, []);

  const respondDm = useCallback((requestId: number, accept: boolean) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("dm:respond", { requestId, accept }, (result: { ok: boolean; room?: RoomInfo; error?: string }) => {
      if (result.ok && result.room) {
        setRooms((prev) => {
          if (prev.some((r) => r.id === result.room!.id)) return prev;
          return [result.room!, ...prev];
        });
        setActiveRoomId(result.room.id);
      }
      // Remove from pending
      setDmRequests((prev) => prev.filter((r) => r.id !== requestId));
    });
  }, []);

  const joinRoom = useCallback((roomId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("room:join", { roomId }, (result: { ok: boolean; room?: RoomInfo; error?: string }) => {
      if (result.ok && result.room) {
        setRooms((prev) => {
          if (prev.some((r) => r.id === result.room!.id)) return prev;
          return [result.room!, ...prev];
        });
        setActiveRoomId(result.room.id);
      } else {
        setError(result.error ?? "couldn't join room");
      }
    });
  }, []);

  const sendMessage = useCallback(
    (text: string, replyTo?: number) => {
      const socket = socketRef.current;
      if (!socket || !activeRoomId) return;
      socket.emit("message:send", { roomId: activeRoomId, content: text, replyTo }, (result: { ok: boolean; error?: string }) => {
        if (!result.ok) {
          setError(result.error ?? "message failed");
        }
      });
      setReplyToMsg(null);
      if (isTypingRef.current) {
        socket.emit("typing:stop", { roomId: activeRoomId });
        isTypingRef.current = false;
      }
    },
    [activeRoomId]
  );

  const toggleReaction = useCallback(
    (messageId: number, emoji: string) => {
      const socket = socketRef.current;
      if (!socket) return;
      socket.emit("reaction:toggle", { messageId, emoji }, (result: { ok: boolean; error?: string }) => {
        if (!result.ok) {
          setError(result.error ?? "reaction failed");
        }
        // No optimistic update — server broadcasts reaction:update which handles everything
      });
    },
    []
  );

  const setTyping = useCallback(
    (typing: boolean) => {
      const socket = socketRef.current;
      if (!socket || !activeRoomId) return;

      if (typing && !isTypingRef.current) {
        isTypingRef.current = true;
        socket.emit("typing:start", { roomId: activeRoomId });
      }

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      if (typing) {
        typingTimeoutRef.current = setTimeout(() => {
          if (isTypingRef.current && socketRef.current && activeRoomId) {
            socketRef.current.emit("typing:stop", { roomId: activeRoomId });
            isTypingRef.current = false;
          }
        }, 3000);
      } else if (isTypingRef.current) {
        isTypingRef.current = false;
        socket.emit("typing:stop", { roomId: activeRoomId });
      }
    },
    [activeRoomId]
  );

  const refreshHandle = useCallback(
    (roomId: string) => {
      const socket = socketRef.current;
      if (!socket) return;
      socket.emit("handle:refresh", { roomId }, (result: { ok: boolean; newHandle?: string; error?: string }) => {
        if (!result.ok) {
          setError(result.error ?? "handle refresh failed");
        }
      });
    },
    []
  );

  const generateInviteLink = useCallback(
    (roomId: string): Promise<string> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket) {
          reject(new Error("not connected"));
          return;
        }
        socket.emit("room:invite-link", { roomId }, (result: { ok: boolean; url?: string; error?: string }) => {
          if (result.ok && result.url) {
            resolve(result.url);
          } else {
            reject(new Error(result.error ?? "failed to generate link"));
          }
        });
      });
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  const activeRoom = rooms.find((r) => r.id === activeRoomId) ?? null;
  const myAnonHandle = activeRoom?.anonHandle ?? null;
  myAnonHandleRef.current = myAnonHandle;
  const activeTyping = (activeRoomId ? typingUsers[activeRoomId] : null) ?? [];

  const setReplyTo = useCallback((msg: ChatMessage | null) => {
    setReplyToMsg(msg);
  }, []);

  const clearReply = useCallback(() => {
    setReplyToMsg(null);
  }, []);

  return {
    connected,
    sessionAnonId,
    onlineUsers,
    rooms,
    activeRoom,
    activeRoomId,
    setActiveRoomId,
    messages,
    myAnonHandle,
    typingUsers: activeTyping,
    error,
    clearError,
    dmRequests,
    replyToMsg,
    setReplyTo,
    clearReply,
    requestDm,
    respondDm,
    joinRoom,
    sendMessage,
    toggleReaction,
    setTyping,
    refreshHandle,
    generateInviteLink,
  };
}
