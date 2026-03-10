import { useState, useEffect, useRef, useCallback } from "react";
import { getServerLogs, ApiError } from "@/lib/api";
import type { LogEntry } from "@/lib/api";

type LogLevel = "all" | "http" | "info" | "warn" | "error" | "imap";

const LEVEL_LABELS: Record<LogLevel, string> = {
  all: "all",
  http: "http",
  info: "info",
  warn: "warn",
  error: "error",
  imap: "imap",
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

function logsToText(entries: LogEntry[]): string {
  return entries
    .map((e) => `${formatTime(e.ts)} [${e.level}] ${e.message}`)
    .join("\n");
}

export function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel>("all");
  const [error, setError] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const sinceRef = useRef(0);
  const svcSinceRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const newLogs = await getServerLogs(sinceRef.current, svcSinceRef.current);
      if (newLogs.length > 0) {
        // Track separate max IDs for API logs (<900000) and service logs (>=900000)
        for (const l of newLogs) {
          if (l.id >= 900000) {
            if (l.id > svcSinceRef.current) svcSinceRef.current = l.id;
          } else {
            if (l.id > sinceRef.current) sinceRef.current = l.id;
          }
        }

        setLogs((prev) => {
          const existingIds = new Set(prev.map((l) => l.id));
          const unique = newLogs.filter((l) => !existingIds.has(l.id));
          if (unique.length === 0) return prev;
          const merged = [...prev, ...unique];
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

  const filtered = filter === "all"
    ? logs
    : filter === "imap"
      ? logs.filter((l) => l.message.includes("[IMAP]"))
      : logs.filter((l) => l.level === filter);

  const handleCopy = () => {
    const text = logsToText(filtered);
    void navigator.clipboard.writeText(text).then(() => {
      setCopyMsg("copied");
      setTimeout(() => setCopyMsg(null), 1500);
    });
  };

  const handleSave = () => {
    const text = logsToText(filtered);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${filter}-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        <div className="stats-log-actions">
          {copyMsg && <span className="stats-log-copy-msg">{copyMsg}</span>}
          <button className="stats-log-action-btn" onClick={handleCopy} title="copy to clipboard">
            copy
          </button>
          <button className="stats-log-action-btn" onClick={handleSave} title="save as .txt">
            save
          </button>
          <button
            className="stats-log-clear"
            onClick={() => setLogs([])}
          >
            clear
          </button>
        </div>
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
