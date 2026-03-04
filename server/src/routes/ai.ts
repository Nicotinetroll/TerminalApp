import { Router, Response } from 'express';
import db from '../db.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware.js';

const router = Router();

// Rate limit: per-user, 20 requests per minute
const userRateLimit = new Map<number, number[]>();

function checkUserRate(userId: number): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 20;
  const attempts = (userRateLimit.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (attempts.length >= maxRequests) return false;
  attempts.push(now);
  userRateLimit.set(userId, attempts);
  return true;
}

// Cleanup every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [uid, times] of userRateLimit) {
    const fresh = times.filter((t) => now - t < 60_000);
    if (fresh.length === 0) userRateLimit.delete(uid);
    else userRateLimit.set(uid, fresh);
  }
}, 5 * 60_000);

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqChoice {
  message: { role: string; content: string };
}

interface GroqResponse {
  choices: GroqChoice[];
  error?: { message: string };
}

interface DbMessage {
  role: string;
  content: string;
}

interface DbConversation {
  id: number;
  user_id: number;
  updated_at: string;
}

interface AdminConversation {
  id: number;
  user_id: number;
  username: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface AdminMessage {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

// POST /api/ai/chat
router.post('/chat', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user!;

  if (user.role === 'guest') {
    res.status(403).json({ error: 'guests can\'t talk to the AI. upgrade your life first.' });
    return;
  }

  if (!checkUserRate(user.userId)) {
    res.status(429).json({ error: 'slow down speed demon. 20 messages per minute max.' });
    return;
  }

  const { message, newConversation } = req.body as { message?: string; newConversation?: boolean };

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'say something. i\'m not a mind reader... yet.' });
    return;
  }

  const trimmed = message.trim();
  if (trimmed.length > 2000) {
    res.status(400).json({ error: 'bro that message is longer than my patience. 2000 chars max.' });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GROQ_API_KEY not configured. the AI is having an existential crisis.' });
    return;
  }

  try {
    // Get or create conversation
    let conversation: DbConversation | undefined;

    if (!newConversation) {
      conversation = db.prepare(
        'SELECT id, user_id, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1'
      ).get(user.userId) as DbConversation | undefined;
    }

    if (!conversation) {
      const result = db.prepare('INSERT INTO ai_conversations (user_id) VALUES (?)').run(user.userId);
      conversation = {
        id: result.lastInsertRowid as number,
        user_id: user.userId,
        updated_at: new Date().toISOString(),
      };
    }

    // Insert user message
    db.prepare('INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)').run(
      conversation.id, 'user', trimmed
    );

    // Fetch last 20 messages for context
    const history = db.prepare(
      'SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(conversation.id) as DbMessage[];
    history.reverse();

    // Load system prompt from global settings
    const systemPromptRow = db.prepare("SELECT value FROM global_settings WHERE key = 'ai_system_prompt'").get() as { value: string } | undefined;
    const systemPrompt = systemPromptRow?.value ?? 'You are an AI assistant.';

    // Build messages for Groq
    const messages: GroqMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    // Call Groq API
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 1024,
        temperature: 0.9,
      }),
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.text();
      console.error('Groq API error:', groqRes.status, errBody);
      res.status(502).json({ error: 'the AI had a brain fart. groq is having a moment. try again.' });
      return;
    }

    const groqData = await groqRes.json() as GroqResponse;

    if (groqData.error) {
      console.error('Groq API error:', groqData.error.message);
      res.status(502).json({ error: 'AI brain damage detected. try again later.' });
      return;
    }

    const reply = groqData.choices?.[0]?.message?.content ?? 'i got nothing. brain empty.';

    // Insert assistant message
    db.prepare('INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)').run(
      conversation.id, 'assistant', reply
    );

    // Update conversation timestamp
    db.prepare("UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?").run(conversation.id);

    res.json({ reply, conversationId: conversation.id });
  } catch (err) {
    console.error('AI chat error:', err);
    res.status(500).json({ error: 'something broke in the AI void. not my fault (probably).' });
  }
});

// DELETE /api/ai/chat — clear user's conversations
router.delete('/chat', authMiddleware, (req: AuthRequest, res: Response): void => {
  const user = req.user!;

  const convos = db.prepare('SELECT id FROM ai_conversations WHERE user_id = ?').all(user.userId) as { id: number }[];

  for (const c of convos) {
    db.prepare('DELETE FROM ai_messages WHERE conversation_id = ?').run(c.id);
  }
  db.prepare('DELETE FROM ai_conversations WHERE user_id = ?').run(user.userId);

  res.json({ ok: true, deleted: convos.length });
});

// GET /api/ai/admin/conversations — admin: list all conversations
router.get('/admin/conversations', authMiddleware, adminMiddleware, (_req: AuthRequest, res: Response): void => {
  const conversations = db.prepare(`
    SELECT c.id, c.user_id, u.username, c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM ai_messages WHERE conversation_id = c.id) as message_count
    FROM ai_conversations c
    JOIN users u ON u.id = c.user_id
    ORDER BY c.updated_at DESC
    LIMIT 100
  `).all() as AdminConversation[];

  res.json({ conversations });
});

// GET /api/ai/admin/conversations/:id — admin: view messages in a conversation
router.get('/admin/conversations/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response): void => {
  const conversationId = parseInt(req.params['id'] as string, 10);

  const messages = db.prepare(
    'SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId) as AdminMessage[];

  res.json({ messages });
});

export default router;
