import type { Server as HttpServer } from 'http';
import type Database from 'better-sqlite3';
import { Server } from 'socket.io';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from './db.js';

// Properly typed statement that accepts variadic binding params
type Stmt = Database.Statement<unknown[]>;

const LOBBY_ID = 'open';
const RATE_LIMIT_WINDOW = 5000;
const RATE_LIMIT_MAX = 5;
const AVAILABLE_REACTIONS = ['💀', '🔥', '💩', '👻', '🤡', '⚰️'];

interface AuthPayload {
  userId: number;
  username: string;
  role: string;
}

interface OnlineUser {
  socketId: string;
  userId: number;
  username: string;
  role: string;
  sessionAnonId: string;
}

interface RoomInfo {
  id: string;
  name: string | null;
  anonHandle: string;
  participants: { anonHandle: string; online: boolean }[];
  lastMessage: { content: string; anonHandle: string; created_at: string } | null;
  unread: number;
}

// ── Migrations (must run BEFORE prepared statements) ──

// Add reply_to column if missing
try {
  db.prepare("SELECT reply_to FROM chat_messages LIMIT 0").run();
} catch {
  db.exec("ALTER TABLE chat_messages ADD COLUMN reply_to INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL");
  console.log('[whisper] migrated: added reply_to column');
}

// Fix reactions PK to (message_id, user_id) — only if old 3-col PK detected
try {
  const info = db.prepare("PRAGMA table_info(chat_reactions)").all() as { name: string; pk: number }[];
  const pkCols = info.filter(c => c.pk > 0);
  // Only migrate if old schema had 3+ PK columns (message_id, user_id, emoji)
  if (pkCols.length >= 3) {
    db.exec(`
      DROP TABLE IF EXISTS chat_reactions;
      CREATE TABLE chat_reactions (
        message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        emoji TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (message_id, user_id)
      );
    `);
    console.log('[whisper] migrated: fixed chat_reactions PK');
  }
} catch {
  // table doesn't exist, will be created by db.ts
}

// ── Prepared statements (lazy-init to avoid race with ALTER TABLE migrations) ──

let _stmtsReady = false;
let stmtInsertRoom: Stmt;
let stmtInsertParticipant: Stmt;
let stmtUpdateHandle: Stmt;
let stmtGetParticipantWithTimestamp: Stmt;
let stmtGetParticipant: Stmt;
let stmtGetRoomParticipants: Stmt;
let stmtInsertMessage: Stmt;
let stmtGetMessages: Stmt;
let stmtGetMessageById: Stmt;
let stmtGetUserRooms: Stmt;
let stmtGetLastMessage: Stmt;
let stmtRoomExists: Stmt;
let stmtCleanupMessages: Stmt;
let stmtCleanupEmptyRooms: Stmt;
let stmtUpsertReaction: Stmt;
let stmtRemoveReaction: Stmt;
let stmtGetReactions: Stmt;
let stmtGetUserReaction: Stmt;
let stmtGetMessageReactionsForRoom: Stmt;
let stmtGetUserReactionsForRoom: Stmt;
let stmtGetMessageRoom: Stmt;
let stmtInsertDmRequest: Stmt;
let stmtGetPendingRequests: Stmt;
let stmtGetRequest: Stmt;
let stmtUpdateRequestStatus: Stmt;
let stmtCheckExistingRequest: Stmt;

function initStatements(): void {
  if (_stmtsReady) return;
  stmtInsertRoom = db.prepare('INSERT INTO chat_rooms (id, created_by) VALUES (?, ?)');
  stmtInsertParticipant = db.prepare('INSERT OR IGNORE INTO chat_participants (room_id, user_id, anon_handle, handle_updated_at) VALUES (?, ?, ?, datetime(\'now\'))');
  stmtUpdateHandle = db.prepare('UPDATE chat_participants SET anon_handle = ?, handle_updated_at = datetime(\'now\') WHERE room_id = ? AND user_id = ?');
  stmtGetParticipantWithTimestamp = db.prepare('SELECT anon_handle, handle_updated_at FROM chat_participants WHERE room_id = ? AND user_id = ?');
  stmtGetParticipant = db.prepare('SELECT anon_handle FROM chat_participants WHERE room_id = ? AND user_id = ?');
  stmtGetRoomParticipants = db.prepare('SELECT user_id, anon_handle FROM chat_participants WHERE room_id = ?');
  stmtInsertMessage = db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, reply_to) VALUES (?, ?, ?, ?)');
  stmtGetMessages = db.prepare(
    `SELECT m.id, m.content, m.created_at, m.reply_to, p.anon_handle
     FROM chat_messages m
     JOIN chat_participants p ON p.room_id = m.room_id AND p.user_id = m.sender_id
     WHERE m.room_id = ?
     ORDER BY m.created_at DESC
     LIMIT ?`
  );
  stmtGetMessageById = db.prepare(
    `SELECT m.id, m.content, p.anon_handle
     FROM chat_messages m
     JOIN chat_participants p ON p.room_id = m.room_id AND p.user_id = m.sender_id
     WHERE m.id = ?`
  );
  stmtGetUserRooms = db.prepare(
    `SELECT r.id, r.created_at FROM chat_rooms r
     JOIN chat_participants p ON p.room_id = r.id
     WHERE p.user_id = ?
     ORDER BY r.created_at DESC`
  );
  stmtGetLastMessage = db.prepare(
    `SELECT m.content, m.created_at, p.anon_handle
     FROM chat_messages m
     JOIN chat_participants p ON p.room_id = m.room_id AND p.user_id = m.sender_id
     WHERE m.room_id = ?
     ORDER BY m.created_at DESC
     LIMIT 1`
  );
  stmtRoomExists = db.prepare('SELECT id FROM chat_rooms WHERE id = ?');
  stmtCleanupMessages = db.prepare("DELETE FROM chat_messages WHERE created_at < datetime('now', '-24 hours')");
  stmtCleanupEmptyRooms = db.prepare(
    `DELETE FROM chat_rooms WHERE id != ? AND id NOT IN (SELECT DISTINCT room_id FROM chat_messages)`
  );
  stmtUpsertReaction = db.prepare(
    'INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES (?, ?, ?) ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji'
  );
  stmtRemoveReaction = db.prepare('DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ?');
  stmtGetReactions = db.prepare('SELECT emoji, COUNT(*) as count FROM chat_reactions WHERE message_id = ? GROUP BY emoji');
  stmtGetUserReaction = db.prepare('SELECT emoji FROM chat_reactions WHERE message_id = ? AND user_id = ?');
  stmtGetMessageReactionsForRoom = db.prepare(
    `SELECT r.message_id, r.emoji, COUNT(*) as count
     FROM chat_reactions r JOIN chat_messages m ON m.id = r.message_id
     WHERE m.room_id = ? GROUP BY r.message_id, r.emoji`
  );
  stmtGetUserReactionsForRoom = db.prepare(
    `SELECT r.message_id, r.emoji
     FROM chat_reactions r JOIN chat_messages m ON m.id = r.message_id
     WHERE m.room_id = ? AND r.user_id = ?`
  );
  stmtGetMessageRoom = db.prepare('SELECT room_id FROM chat_messages WHERE id = ?');
  stmtInsertDmRequest = db.prepare("INSERT INTO dm_requests (from_user_id, to_user_id, from_anon, status) VALUES (?, ?, ?, 'pending')");
  stmtGetPendingRequests = db.prepare("SELECT id, from_user_id, from_anon FROM dm_requests WHERE to_user_id = ? AND status = 'pending'");
  stmtGetRequest = db.prepare('SELECT id, from_user_id, to_user_id, from_anon, status FROM dm_requests WHERE id = ?');
  stmtUpdateRequestStatus = db.prepare('UPDATE dm_requests SET status = ? WHERE id = ?');
  stmtCheckExistingRequest = db.prepare("SELECT id FROM dm_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'");
  _stmtsReady = true;
}

// ── Ensure lobby ──
function ensureLobby(): void {
  initStatements();
  const exists = stmtRoomExists.get(LOBBY_ID);
  if (!exists) {
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: number } | undefined;
    const creatorId = admin?.id ?? 1;
    try {
      db.prepare('INSERT INTO chat_rooms (id, created_by) VALUES (?, ?)').run(LOBBY_ID, creatorId);
      console.log('[whisper] created lobby room');
    } catch {
      db.pragma('foreign_keys = OFF');
      db.prepare('INSERT OR IGNORE INTO chat_rooms (id, created_by) VALUES (?, 0)').run(LOBBY_ID);
      db.pragma('foreign_keys = ON');
      console.log('[whisper] created lobby room (no users yet)');
    }
  }
}
ensureLobby();

// ── In-memory state ──

const onlineUsers = new Map<string, OnlineUser>();
const rateLimits = new Map<number, number[]>();

function getHandleRefreshHours(): number {
  try {
    const row = db.prepare("SELECT value FROM global_settings WHERE key = 'handle_refresh_hours'").get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) || 48 : 48;
  } catch { return 48; }
}

function generateAnonHandle(): string { return 'anon-' + crypto.randomBytes(4).toString('hex'); }
function generateRoomId(): string { return crypto.randomBytes(16).toString('hex'); }
function generateSessionAnonId(): string { return 'ghost-' + crypto.randomBytes(2).toString('hex'); }

function checkRateLimit(userId: number): boolean {
  const now = Date.now();
  const timestamps = rateLimits.get(userId) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  rateLimits.set(userId, recent);
  return true;
}

function getOnlineList(): { sessionAnonId: string; online: boolean }[] {
  const seen = new Set<number>();
  const list: { sessionAnonId: string; online: boolean }[] = [];
  for (const u of onlineUsers.values()) {
    if (seen.has(u.userId)) continue;
    seen.add(u.userId);
    list.push({ sessionAnonId: u.sessionAnonId, online: true });
  }
  return list;
}

function findUserBySessionAnon(sessionAnonId: string): OnlineUser | undefined {
  for (const u of onlineUsers.values()) { if (u.sessionAnonId === sessionAnonId) return u; }
  return undefined;
}

function findOnlineUserByUserId(userId: number): OnlineUser | undefined {
  for (const u of onlineUsers.values()) { if (u.userId === userId) return u; }
  return undefined;
}

function getRoomName(roomId: string): string | null { return roomId === LOBBY_ID ? 'open chat' : null; }

interface ReactionData { messageId: number; emoji: string; count: number; reacted: boolean; }

function getReactionsForMessages(roomId: string, userId: number): Map<number, ReactionData[]> {
  const allReactions = stmtGetMessageReactionsForRoom.all(roomId) as { message_id: number; emoji: string; count: number }[];
  const userReactions = stmtGetUserReactionsForRoom.all(roomId, userId) as { message_id: number; emoji: string }[];
  const userReactedSet = new Set(userReactions.map((r) => `${r.message_id}:${r.emoji}`));
  const map = new Map<number, ReactionData[]>();
  for (const r of allReactions) {
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id)!.push({
      messageId: r.message_id, emoji: r.emoji, count: r.count,
      reacted: userReactedSet.has(`${r.message_id}:${r.emoji}`),
    });
  }
  return map;
}

interface ReplyInfo { id: number; content: string; anonHandle: string; }

function getReplyInfo(replyTo: number | null): ReplyInfo | null {
  if (!replyTo) return null;
  const row = stmtGetMessageById.get(replyTo) as { id: number; content: string; anon_handle: string } | undefined;
  if (!row) return null;
  return { id: row.id, content: row.content, anonHandle: row.anon_handle };
}

function getUserRoomsWithInfo(userId: number): RoomInfo[] {
  const rooms = stmtGetUserRooms.all(userId) as { id: string; created_at: string }[];
  return rooms.map((room) => {
    const myP = stmtGetParticipant.get(room.id, userId) as { anon_handle: string } | undefined;
    const parts = stmtGetRoomParticipants.all(room.id) as { user_id: number; anon_handle: string }[];
    const lastMsg = stmtGetLastMessage.get(room.id) as { content: string; anon_handle: string; created_at: string } | undefined;
    return {
      id: room.id, name: getRoomName(room.id), anonHandle: myP?.anon_handle ?? 'unknown',
      participants: parts.map((p) => ({ anonHandle: p.anon_handle, online: !!findOnlineUserByUserId(p.user_id) })),
      lastMessage: lastMsg ? { content: lastMsg.content, anonHandle: lastMsg.anon_handle, created_at: lastMsg.created_at } : null, unread: 0,
    };
  });
}

function ensureLobbyParticipant(userId: number): string {
  const existing = stmtGetParticipant.get(LOBBY_ID, userId) as { anon_handle: string } | undefined;
  if (existing) return existing.anon_handle;
  const handle = generateAnonHandle();
  stmtInsertParticipant.run(LOBBY_ID, userId, handle);
  return handle;
}

let ioInstance: Server | null = null;

export function getIO(): Server | null {
  return ioInstance;
}

export function getOnlineUsers(): { username: string; role: string }[] {
  const seen = new Map<number, { username: string; role: string }>();
  for (const u of onlineUsers.values()) {
    if (!seen.has(u.userId)) {
      seen.set(u.userId, { username: u.username, role: u.role });
    }
  }
  return Array.from(seen.values());
}

export function broadcastEvent(data: { type: string; message: string }): void {
  if (!ioInstance) return;
  ioInstance.emit('global:event', data);
}

export function emitToUser(userId: number, event: string, data: unknown): void {
  if (!ioInstance) return;
  for (const u of onlineUsers.values()) {
    if (u.userId === userId) {
      const sock = ioInstance.sockets.sockets.get(u.socketId);
      if (sock) sock.emit(event, data);
    }
  }
}

export function setupSocket(server: HttpServer): Server {
  const ALLOWED_ORIGINS = ['https://mynig.ga', 'http://localhost:5173'];
  const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS, credentials: true } });
  ioInstance = io;

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('no token provided. who are you?'));
    const secret = process.env.JWT_SECRET;
    if (!secret) return next(new Error('server misconfigured'));
    try {
      const decoded = jwt.verify(token, secret) as AuthPayload;
      if (decoded.role === 'guest') return next(new Error('guests cant whisper. register first.'));
      socket.data.user = decoded;
      next();
    } catch { return next(new Error('invalid token. nice try.')); }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthPayload;
    const sessionAnonId = generateSessionAnonId();

    // ── Per-socket rate limiter: 30 events per 10 sec ──
    const SOCKET_RATE_WINDOW = 10_000;
    const SOCKET_RATE_MAX = 30;
    const socketEventTimestamps: number[] = [];
    function checkSocketRate(): boolean {
      const now = Date.now();
      while (socketEventTimestamps.length > 0 && now - socketEventTimestamps[0]! > SOCKET_RATE_WINDOW) socketEventTimestamps.shift();
      if (socketEventTimestamps.length >= SOCKET_RATE_MAX) return false;
      socketEventTimestamps.push(now);
      return true;
    }

    // wrap socket.on to inject rate limiting on all custom events
    const originalOn = socket.on.bind(socket);
    socket.on = ((event: string, listener: (...args: unknown[]) => void) => {
      if (['disconnect', 'error', 'disconnecting'].includes(event)) return originalOn(event, listener);
      return originalOn(event, (...args: unknown[]) => {
        if (!checkSocketRate()) {
          // if last arg is a callback, call it with error
          const lastArg = args[args.length - 1];
          if (typeof lastArg === 'function') (lastArg as (r: { ok: boolean; error: string }) => void)({ ok: false, error: 'slow down. you\'re spamming.' });
          return;
        }
        listener(...args);
      });
    }) as typeof socket.on;

    onlineUsers.set(socket.id, {
      socketId: socket.id, userId: user.userId, username: user.username,
      role: user.role, sessionAnonId,
    });

    ensureLobbyParticipant(user.userId);
    const existingRooms = stmtGetUserRooms.all(user.userId) as { id: string }[];
    for (const room of existingRooms) void socket.join(`room:${room.id}`);

    io.emit('users:online', getOnlineList());
    socket.emit('session:info', { sessionAnonId });

    // pending DM requests
    const pending = stmtGetPendingRequests.all(user.userId) as { id: number; from_user_id: number; from_anon: string }[];
    if (pending.length > 0) {
      socket.emit('dm:pending', pending.map((r) => {
        const fromUser = findOnlineUserByUserId(r.from_user_id);
        return { id: r.id, fromAnonId: fromUser?.sessionAnonId ?? 'offline', fromAnon: r.from_anon, status: 'pending' };
      }));
    }

    socket.on('rooms:list', (callback: (rooms: RoomInfo[]) => void) => {
      const rooms = getUserRoomsWithInfo(user.userId);
      rooms.sort((a, b) => { if (a.id === LOBBY_ID) return -1; if (b.id === LOBBY_ID) return 1; return 0; });
      callback(rooms);
    });

    // ── dm:request ──
    socket.on('dm:request', (data: { targetSessionAnonId: string }, callback: (r: { ok: boolean; error?: string }) => void) => {
      const target = findUserBySessionAnon(data.targetSessionAnonId);
      if (!target) { callback({ ok: false, error: 'ghost vanished. they went offline.' }); return; }
      if (target.userId === user.userId) { callback({ ok: false, error: 'talking to yourself? seek therapy.' }); return; }
      const existing = stmtCheckExistingRequest.get(user.userId, target.userId) as { id: number } | undefined;
      if (existing) { callback({ ok: false, error: 'already sent. be patient, weirdo.' }); return; }
      const myRooms = stmtGetUserRooms.all(user.userId) as { id: string }[];
      for (const room of myRooms) {
        if (room.id === LOBBY_ID) continue;
        const parts = stmtGetRoomParticipants.all(room.id) as { user_id: number }[];
        if (parts.length === 2 && parts.some((p) => p.user_id === target.userId)) {
          callback({ ok: false, error: 'you already have a DM with them.' }); return;
        }
      }
      try { stmtInsertDmRequest.run(user.userId, target.userId, sessionAnonId); } catch { callback({ ok: false, error: 'request failed.' }); return; }
      const req = stmtCheckExistingRequest.get(user.userId, target.userId) as { id: number } | undefined;
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket && req) {
        targetSocket.emit('dm:incoming', { id: req.id, fromAnonId: sessionAnonId, fromAnon: sessionAnonId, status: 'pending' });
      }
      callback({ ok: true });
    });

    // ── dm:respond ──
    socket.on('dm:respond', (data: { requestId: number; accept: boolean }, callback: (r: { ok: boolean; room?: RoomInfo; error?: string }) => void) => {
      const req = stmtGetRequest.get(data.requestId) as { id: number; from_user_id: number; to_user_id: number; from_anon: string; status: string } | undefined;
      if (!req || req.to_user_id !== user.userId) { callback({ ok: false, error: 'invalid request.' }); return; }
      if (req.status !== 'pending') { callback({ ok: false, error: 'already responded.' }); return; }
      if (!data.accept) {
        stmtUpdateRequestStatus.run('declined', req.id);
        const fromUser = findOnlineUserByUserId(req.from_user_id);
        if (fromUser) { const s = io.sockets.sockets.get(fromUser.socketId); if (s) s.emit('dm:declined', { requestId: req.id }); }
        callback({ ok: true }); return;
      }
      stmtUpdateRequestStatus.run('accepted', req.id);
      const roomId = generateRoomId();
      const myHandle = generateAnonHandle();
      const theirHandle = generateAnonHandle();
      db.transaction(() => { stmtInsertRoom.run(roomId, req.from_user_id); stmtInsertParticipant.run(roomId, req.from_user_id, theirHandle); stmtInsertParticipant.run(roomId, user.userId, myHandle); })();
      void socket.join(`room:${roomId}`);
      const fromUser = findOnlineUserByUserId(req.from_user_id);
      if (fromUser) {
        const s = io.sockets.sockets.get(fromUser.socketId);
        if (s) { void s.join(`room:${roomId}`); const ri = getUserRoomsWithInfo(req.from_user_id).find((r) => r.id === roomId); if (ri) s.emit('room:new', ri); s.emit('dm:accepted', { requestId: req.id, roomId }); }
      }
      callback({ ok: true, room: getUserRoomsWithInfo(user.userId).find((r) => r.id === roomId) });
    });

    // ── room:join ──
    socket.on('room:join', (data: { roomId: string }, callback: (r: { ok: boolean; room?: RoomInfo; error?: string }) => void) => {
      const room = stmtRoomExists.get(data.roomId) as { id: string } | undefined;
      if (!room) { callback({ ok: false, error: 'room doesn\'t exist. you got catfished.' }); return; }
      const existing = stmtGetParticipant.get(data.roomId, user.userId) as { anon_handle: string } | undefined;
      if (existing) {
        // already a participant — just rejoin the socket room
        void socket.join(`room:${data.roomId}`);
        callback({ ok: true, room: getUserRoomsWithInfo(user.userId).find((r) => r.id === data.roomId) });
        return;
      }
      if (data.roomId === LOBBY_ID) {
        // lobby is open to everyone
        const handle = generateAnonHandle();
        stmtInsertParticipant.run(data.roomId, user.userId, handle);
        void socket.join(`room:${data.roomId}`);
        callback({ ok: true, room: getUserRoomsWithInfo(user.userId).find((r) => r.id === data.roomId) });
        return;
      }
      // invite-link join: knowing the room ID = having the invite
      // room IDs are 32 hex chars (16 bytes) — unguessable
      const handle = generateAnonHandle();
      stmtInsertParticipant.run(data.roomId, user.userId, handle);
      socket.to(`room:${data.roomId}`).emit('room:user-joined', { roomId: data.roomId, anonHandle: handle });
      void socket.join(`room:${data.roomId}`);
      callback({ ok: true, room: getUserRoomsWithInfo(user.userId).find((r) => r.id === data.roomId) });
    });

    // ── message:send (with optional reply_to) ──
    socket.on('message:send', (data: { roomId: string; content: string; replyTo?: number }, callback: (r: { ok: boolean; error?: string }) => void) => {
      const content = data.content?.trim();
      if (!content) { callback({ ok: false, error: 'empty message. say something.' }); return; }
      if (content.length > 500) { callback({ ok: false, error: 'max 500 chars. this ain\'t your diary.' }); return; }
      if (!checkRateLimit(user.userId)) { callback({ ok: false, error: 'slow down. you\'re not that interesting.' }); return; }
      const participant = stmtGetParticipantWithTimestamp.get(data.roomId, user.userId) as { anon_handle: string; handle_updated_at: string | null } | undefined;
      if (!participant) { callback({ ok: false, error: 'you\'re not in this room. creep.' }); return; }

      // Auto-refresh handle if expired
      let currentHandle = participant.anon_handle;
      if (participant.handle_updated_at) {
        const updatedAt = new Date(participant.handle_updated_at + 'Z').getTime();
        const refreshHours = getHandleRefreshHours();
        if (Date.now() - updatedAt > refreshHours * 3600_000) {
          const oldHandle = currentHandle;
          const newHandle = generateAnonHandle();
          stmtUpdateHandle.run(newHandle, data.roomId, user.userId);
          currentHandle = newHandle;
          io.to(`room:${data.roomId}`).emit('handle:changed', { roomId: data.roomId, oldHandle, newHandle });
        }
      }

      const replyTo = data.replyTo ?? null;
      if (replyTo !== null) {
        const replyMsg = stmtGetMessageRoom.get(replyTo) as { room_id: string } | undefined;
        if (!replyMsg || replyMsg.room_id !== data.roomId) { callback({ ok: false, error: 'reply target not in this room. nice try.' }); return; }
      }
      const result = stmtInsertMessage.run(data.roomId, user.userId, content, replyTo);
      const replyInfo = getReplyInfo(replyTo);

      const message = {
        id: result.lastInsertRowid as number,
        roomId: data.roomId, content,
        anonHandle: currentHandle,
        created_at: new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0],
        reactions: [] as ReactionData[],
        replyTo: replyInfo,
      };
      io.to(`room:${data.roomId}`).emit('message:new', message);
      callback({ ok: true });
    });

    // ── message:history ──
    socket.on('message:history', (data: { roomId: string; limit?: number }, callback: (messages: unknown[]) => void) => {
      const participant = stmtGetParticipant.get(data.roomId, user.userId) as { anon_handle: string } | undefined;
      if (!participant) { callback([]); return; }
      const limit = Math.min(data.limit ?? 50, 200);
      const messages = stmtGetMessages.all(data.roomId, limit) as { id: number; content: string; created_at: string; anon_handle: string; reply_to: number | null }[];
      const reactionsMap = getReactionsForMessages(data.roomId, user.userId);
      callback(messages.reverse().map((m) => ({
        id: m.id, roomId: data.roomId, content: m.content, anonHandle: m.anon_handle, created_at: m.created_at,
        reactions: reactionsMap.get(m.id) ?? [],
        replyTo: getReplyInfo(m.reply_to),
      })));
    });

    // ── reaction:toggle (one per user per message — same emoji removes, different replaces) ──
    socket.on('reaction:toggle', (data: { messageId: number; emoji: string }, callback: (r: { ok: boolean; error?: string }) => void) => {
      if (!AVAILABLE_REACTIONS.includes(data.emoji)) { callback({ ok: false, error: 'invalid reaction.' }); return; }
      const msg = stmtGetMessageRoom.get(data.messageId) as { room_id: string } | undefined;
      if (!msg) { callback({ ok: false, error: 'message not found.' }); return; }
      const participant = stmtGetParticipant.get(msg.room_id, user.userId) as { anon_handle: string } | undefined;
      if (!participant) { callback({ ok: false, error: 'not in this room.' }); return; }

      const current = stmtGetUserReaction.get(data.messageId, user.userId) as { emoji: string } | undefined;
      let wasAdded: boolean;
      if (current?.emoji === data.emoji) {
        // same emoji → remove (toggle off)
        stmtRemoveReaction.run(data.messageId, user.userId);
        wasAdded = false;
      } else {
        // different or no reaction → set/replace
        stmtUpsertReaction.run(data.messageId, user.userId, data.emoji);
        wasAdded = true;
      }

      const reactions = stmtGetReactions.all(data.messageId) as { emoji: string; count: number }[];
      io.to(`room:${msg.room_id}`).emit('reaction:update', {
        messageId: data.messageId,
        reactions: reactions.map((r) => ({ messageId: data.messageId, emoji: r.emoji, count: r.count })),
        toggledBy: participant.anon_handle, toggledEmoji: data.emoji, wasAdded,
      });
      callback({ ok: true });
    });

    // ── typing ──
    socket.on('typing:start', (data: { roomId: string }) => {
      const p = stmtGetParticipant.get(data.roomId, user.userId) as { anon_handle: string } | undefined;
      if (p) socket.to(`room:${data.roomId}`).emit('typing:update', { roomId: data.roomId, anonHandle: p.anon_handle, typing: true });
    });
    socket.on('typing:stop', (data: { roomId: string }) => {
      const p = stmtGetParticipant.get(data.roomId, user.userId) as { anon_handle: string } | undefined;
      if (p) socket.to(`room:${data.roomId}`).emit('typing:update', { roomId: data.roomId, anonHandle: p.anon_handle, typing: false });
    });

    // ── handle:refresh — manually regenerate anon handle ──
    socket.on('handle:refresh', (data: { roomId: string }, callback: (r: { ok: boolean; newHandle?: string; error?: string }) => void) => {
      const existing = stmtGetParticipant.get(data.roomId, user.userId) as { anon_handle: string } | undefined;
      if (!existing) { callback({ ok: false, error: "you're not in this room." }); return; }
      const oldHandle = existing.anon_handle;
      const newHandle = generateAnonHandle();
      stmtUpdateHandle.run(newHandle, data.roomId, user.userId);
      io.to(`room:${data.roomId}`).emit('handle:changed', { roomId: data.roomId, oldHandle, newHandle });
      callback({ ok: true, newHandle });
    });

    socket.on('room:invite-link', (data: { roomId: string }, callback: (r: { ok: boolean; url?: string; error?: string }) => void) => {
      const p = stmtGetParticipant.get(data.roomId, user.userId) as { anon_handle: string } | undefined;
      if (!p) { callback({ ok: false, error: 'you\'re not in this room.' }); return; }
      callback({ ok: true, url: `https://mynig.ga/?room=${data.roomId}` });
    });

    socket.on('admin:subscribe', () => {
      if (user.role !== 'admin') return;
      const all = db.prepare('SELECT id FROM chat_rooms').all() as { id: string }[];
      for (const room of all) void socket.join(`room:${room.id}`);
    });

    socket.on('disconnect', () => { onlineUsers.delete(socket.id); io.emit('users:online', getOnlineList()); });
  });

  setInterval(() => {
    try {
      const d = stmtCleanupMessages.run();
      if (d.changes > 0) console.log(`[whisper] cleaned up ${d.changes} expired messages`);
      const dr = stmtCleanupEmptyRooms.run(LOBBY_ID);
      if (dr.changes > 0) console.log(`[whisper] cleaned up ${dr.changes} empty rooms`);
      db.prepare("DELETE FROM dm_requests WHERE status != 'pending' AND created_at < datetime('now', '-1 hour')").run();
    } catch (err) { console.error('[whisper] cleanup error:', err); }
  }, 15 * 60 * 1000);

  console.log('[whisper] socket.io attached');
  return io;
}
