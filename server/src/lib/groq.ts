// ── Shared Groq API + Rate Limiter ──

// Rate limit: per-user, 20 requests per minute
const userRateLimit = new Map<number, number[]>();

export function checkUserRate(userId: number): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 20;
  const attempts = (userRateLimit.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (attempts.length >= maxRequests) return false;
  attempts.push(now);
  userRateLimit.set(userId, attempts);
  return true;
}

// Rate limit: per-IP, 5 requests per minute (for anonymous users)
const ipRateLimit = new Map<string, number[]>();

export function checkIpRate(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 5;
  const attempts = (ipRateLimit.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (attempts.length >= maxRequests) return false;
  attempts.push(now);
  ipRateLimit.set(ip, attempts);
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
  for (const [ip, times] of ipRateLimit) {
    const fresh = times.filter((t) => now - t < 60_000);
    if (fresh.length === 0) ipRateLimit.delete(ip);
    else ipRateLimit.set(ip, fresh);
  }
}, 5 * 60_000);

// ── Types ──

export interface GroqToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
}

export interface GroqChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: GroqToolCall[];
  };
  finish_reason: string;
}

export interface GroqUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface GroqResponse {
  choices: GroqChoice[];
  usage?: GroqUsage;
  model?: string;
  error?: { message: string };
}

// ── API Call ──

export interface CallGroqOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: unknown[];
  toolChoice?: string;
}

export async function callGroq(
  apiKey: string,
  messages: GroqMessage[],
  options: CallGroqOptions = {}
): Promise<GroqResponse> {
  const body: Record<string, unknown> = {
    model: 'moonshotai/kimi-k2-instruct',
    messages,
    max_tokens: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.9,
  };

  if (options.tools) {
    body['tools'] = options.tools;
    body['tool_choice'] = options.toolChoice ?? 'auto';
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error('Groq API error:', res.status, errBody);
    throw new Error(`Groq API ${res.status}`);
  }

  return res.json() as Promise<GroqResponse>;
}
