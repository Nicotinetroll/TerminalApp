export interface LogEntry {
  id: number;
  ts: string;
  level: 'info' | 'warn' | 'error' | 'http';
  message: string;
  meta?: Record<string, unknown>;
}

const MAX_ENTRIES = 500;
const logs: LogEntry[] = [];
let nextId = 1;

function push(level: LogEntry['level'], message: string, meta?: Record<string, unknown>): void {
  logs.push({ id: nextId++, ts: new Date().toISOString(), level, message, meta });
  if (logs.length > MAX_ENTRIES) logs.shift();
}

// ── Console capture ──

const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;

export function captureConsole(): void {
  console.log = (...args: unknown[]) => {
    _origLog(...args);
    push('info', args.map(String).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    _origWarn(...args);
    push('warn', args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    _origError(...args);
    push('error', args.map(String).join(' '));
  };
}

// ── HTTP request logging ──

const NOISY_PATHS = ['/api/admin/logs', '/api/admin/stats'];

export function logHttp(method: string, path: string, status: number, ms: number, username?: string): void {
  if (NOISY_PATHS.some(p => path.startsWith(p))) return;
  const who = username ? ` [${username}]` : '';
  push('http', `${method} ${path} ${status} ${ms}ms${who}`, { method, path, status, ms, username });
}

// ── Query ──

export function getLogs(sinceId = 0): LogEntry[] {
  if (sinceId <= 0) return [...logs];
  const idx = logs.findIndex(e => e.id > sinceId);
  if (idx === -1) return [];
  return logs.slice(idx);
}
