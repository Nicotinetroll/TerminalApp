import { Router } from 'express';
import type { Response } from 'express';
import db from '../db.js';
import { authMiddleware, adminMiddleware } from '../middleware.js';
import type { AuthRequest } from '../middleware.js';

const router = Router();

// All routes require admin
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/chats — list all rooms with real usernames
router.get('/chats', (_req: AuthRequest, res: Response): void => {
  const rooms = db.prepare(`
    SELECT
      r.id,
      r.created_at,
      (SELECT COUNT(*) FROM chat_messages WHERE room_id = r.id) as message_count
    FROM chat_rooms r
    ORDER BY r.created_at DESC
  `).all() as { id: string; created_at: string; message_count: number }[];

  const result = rooms.map((room) => {
    const participants = db.prepare(`
      SELECT p.anon_handle, u.username
      FROM chat_participants p
      JOIN users u ON u.id = p.user_id
      WHERE p.room_id = ?
    `).all(room.id) as { anon_handle: string; username: string }[];

    return {
      id: room.id,
      created_at: room.created_at,
      message_count: room.message_count,
      participants,
    };
  });

  res.json({ rooms: result });
});

// GET /api/admin/chats/:roomId — get all messages with real usernames
router.get('/chats/:roomId', (req: AuthRequest, res: Response): void => {
  const { roomId } = req.params;

  const room = db.prepare('SELECT id FROM chat_rooms WHERE id = ?').get(roomId) as { id: string } | undefined;
  if (!room) {
    res.status(404).json({ error: 'room not found. it ghosted.' });
    return;
  }

  const participants = db.prepare(`
    SELECT p.anon_handle, p.user_id, u.username
    FROM chat_participants p
    JOIN users u ON u.id = p.user_id
    WHERE p.room_id = ?
  `).all(roomId) as { anon_handle: string; user_id: number; username: string }[];

  const messages = db.prepare(`
    SELECT m.id, m.content, m.created_at, m.sender_id, u.username, p.anon_handle
    FROM chat_messages m
    JOIN users u ON u.id = m.sender_id
    JOIN chat_participants p ON p.room_id = m.room_id AND p.user_id = m.sender_id
    WHERE m.room_id = ?
    ORDER BY m.created_at ASC
  `).all(roomId) as {
    id: number;
    content: string;
    created_at: string;
    sender_id: number;
    username: string;
    anon_handle: string;
  }[];

  res.json({
    room: {
      id: roomId,
      participants,
      messages,
    },
  });
});

// DELETE /api/admin/chats/:roomId/messages — clear all messages in a room
router.delete('/chats/:roomId/messages', (req: AuthRequest, res: Response): void => {
  const { roomId } = req.params;

  const room = db.prepare('SELECT id FROM chat_rooms WHERE id = ?').get(roomId) as { id: string } | undefined;
  if (!room) {
    res.status(404).json({ error: 'room not found.' });
    return;
  }

  // Delete reactions first (FK), then messages
  db.prepare('DELETE FROM chat_reactions WHERE message_id IN (SELECT id FROM chat_messages WHERE room_id = ?)').run(roomId);
  const result = db.prepare('DELETE FROM chat_messages WHERE room_id = ?').run(roomId);

  res.json({ ok: true, deleted: result.changes });
});

export default router;
