import { useState, useEffect, useRef, useCallback } from "react";
import { getServerLogs, ApiError } from "@/lib/api";
import type { LogEntry } from "@/lib/api";

type LogLevel = "all" | "http" | "info" | "warn" | "error";

const LEVEL_LABELS: Record<LogLevel, string> = {
  all: "all",
  http: "http",
  info: "info",
  warn: "warn",
  error: "error",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

function decorateMessage(entry: LogEntry): string {
  let msg = entry.message;
  if (msg.includes("UNIQUE constraint")) msg += " (skill issue)";
  return msg;
}

export function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel>("all");
  const [error, setError] = useState<string | null>(null);
  const sinceRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const newLogs = await getServerLogs(sinceRef.current);
      if (newLogs.length > 0) {
        sinceRef.current = newLogs[newLogs.length - 1]!.id;
        setLogs((prev) => {
          const merged = [...prev, ...newLogs];
          return merged.length > 500 ? merged.slice(-500) : merged;
        });
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "log fetch failed");
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), 2000);
    return () => clearInterval(id);
  }, [poll]);

  // Auto-scroll when sticky
  useEffect(() => {
    if (stickyRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stickyRef.current = atBottom;
  };

  const filtered = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  return (
    <div className="stats-log-viewer">
      <div className="stats-log-toolbar">
        <div className="stats-log-filters">
          {(Object.keys(LEVEL_LABELS) as LogLevel[]).map((lvl) => (
            <button
              key={lvl}
              className={`stats-log-filter ${filter === lvl ? "stats-log-filter-active" : ""}`}
              onClick={() => setFilter(lvl)}
            >
              {LEVEL_LABELS[lvl]}
            </button>
          ))}
        </div>
        <button
          className="stats-log-clear"
          onClick={() => { setLogs([]); sinceRef.current = 0; }}
        >
          clear
        </button>
      </div>

      {error && <div className="stats-error-bar">{error}</div>}

      <div className="stats-log-scroll" ref={scrollRef} onScroll={handleScroll}>
        {filtered.length === 0 ? (
          <div className="stats-log-empty">
            {logs.length === 0
              ? "no logs yet. server's being suspiciously quiet..."
              : "nothing matches this filter. try 'all' or stop being picky."}
          </div>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id} className={`stats-log-entry stats-log-level-${entry.level}`}>
              <span className="stats-log-ts">{formatTime(entry.ts)}</span>
              <span className={`stats-log-badge stats-log-badge-${entry.level}`}>{entry.level}</span>
              <span className="stats-log-msg">{decorateMessage(entry)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
