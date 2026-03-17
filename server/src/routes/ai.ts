import { Router, Response } from 'express';
import db from '../db.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware.js';
import { callGroq, checkUserRate } from '../lib/groq.js';
import type { GroqMessage } from '../lib/groq.js';

const router = Router();

// ── Types ──

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

// ── Web Search (Tavily) ──

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

async function searchWeb(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return 'Search not configured. Answer from your own knowledge.';
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.error('Tavily API error:', res.status);
      return 'Search failed. Answer from your own knowledge.';
    }

    const data = await res.json() as TavilyResponse;
    const parts: string[] = [];

    if (data.answer) {
      parts.push(`Summary: ${data.answer}`);
    }

    if (data.results) {
      for (const r of data.results.slice(0, 5)) {
        parts.push(`- ${r.title}: ${r.content.slice(0, 300)} (${r.url})`);
      }
    }

    return parts.length > 0 ? parts.join('\n') : 'No results found. Use your own knowledge.';
  } catch (err) {
    console.error('Tavily search error:', err);
    return 'Search failed — use your own knowledge to answer.';
  }
}

// Tool definitions for Groq
const SEARCH_TOOLS = [{
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: 'Search the web for current information, facts, definitions, or anything you want to verify or research. Use this when the user asks about current events, specific facts, people, places, technical info, or anything you want to double-check.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'The search query — be specific and concise' }
      },
      required: ['query']
    }
  }
}];

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

    // First call — with tools enabled so the model can search if needed
    let groqData = await callGroq(apiKey, messages, { tools: SEARCH_TOOLS, toolChoice: 'auto' });

    if (groqData.error) {
      console.error('Groq API error:', groqData.error.message);
      res.status(502).json({ error: 'AI brain damage detected. try again later.' });
      return;
    }

    const firstChoice = groqData.choices?.[0];
    let reply: string;

    // Handle tool calls — execute search and re-call
    if (firstChoice?.message?.tool_calls && firstChoice.message.tool_calls.length > 0) {
      const toolCalls = firstChoice.message.tool_calls;

      // Add the assistant's tool call message
      messages.push({
        role: 'assistant',
        content: firstChoice.message.content,
        tool_calls: toolCalls,
      });

      // Execute each tool call
      for (const tc of toolCalls) {
        let toolResult = 'Unknown tool.';

        if (tc.function.name === 'web_search') {
          try {
            const args = JSON.parse(tc.function.arguments) as { query?: string };
            const query = args.query ?? trimmed;
            console.log(`[AI] web_search: "${query}" (user: ${user.username})`);
            toolResult = await searchWeb(query);
          } catch {
            toolResult = 'Failed to parse search query. Answer from your own knowledge.';
          }
        }

        messages.push({
          role: 'tool',
          content: toolResult,
          tool_call_id: tc.id,
        });
      }

      // Second call — with search results, no tools (to get final answer)
      groqData = await callGroq(apiKey, messages);

      if (groqData.error) {
        console.error('Groq API error (second call):', groqData.error.message);
        res.status(502).json({ error: 'AI brain damage on the second try. rough day.' });
        return;
      }

      reply = groqData.choices?.[0]?.message?.content ?? 'searched but brain still empty. sorry.';
    } else {
      // No tool calls — direct response
      reply = firstChoice?.message?.content ?? 'i got nothing. brain empty.';
    }

    // Insert assistant message (only the final text reply)
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
