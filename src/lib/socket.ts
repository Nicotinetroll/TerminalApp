import { io, type Socket } from "socket.io-client";
import { getToken } from "@/lib/api";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket?.connected) return socket;

  const token = getToken();
  if (!token) {
    throw new Error("no token — can't connect to whisper");
  }

  socket = io({
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
  });

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}

export function getSocketIfConnected(): Socket | null {
  return socket?.connected ? socket : null;
}
