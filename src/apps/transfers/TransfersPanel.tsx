import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import type { Transfer } from "@/lib/api";
import {
  createTransferLink, getMyTransfers, deleteTransfer,
  getTransferDownloadUrl, ApiError,
} from "@/lib/api";
import { formatBytes } from "@/apps/cloud/helpers";

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr + "Z").getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt + "Z").getTime() - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d`;
}

// ── Idle animation: grid blocks that pulse in waves ──

const IDLE_COLS = 16;
const IDLE_ROWS = 10;
const IDLE_TOTAL = IDLE_COLS * IDLE_ROWS;

function IdleGrid({ onGenerate, generating }: { onGenerate: () => void; generating: boolean }) {
  const [wave, setWave] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setWave(w => w + 1), 200);
    return () => clearInterval(iv);
  }, []);

  const cx = (IDLE_COLS - 1) / 2;
  const cy = (IDLE_ROWS - 1) / 2;

  return (
    <div style={{
      display: "grid",
      gridTemplate: "1fr / 1fr",
      width: "100%",
      height: "100%",
      overflow: "hidden",
    }}>
      {/* Layer 1: animated grid background */}
      <div style={{
        gridArea: "1 / 1",
        display: "grid",
        gridTemplateColumns: `repeat(${IDLE_COLS}, 1fr)`,
        gap: 3,
        padding: 8,
      }}>
        {Array.from({ length: IDLE_TOTAL }, (_, i) => {
          const col = i % IDLE_COLS;
          const row = Math.floor(i / IDLE_COLS);
          const dist = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2);
          const phase = ((wave - Math.floor(dist * 2)) % 20 + 20) % 20;
          const lit = phase < 4;
          return (
            <div
              key={i}
              style={{
                background: lit ? "var(--accent)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${lit ? "var(--accent)" : "rgba(255,255,255,0.04)"}`,
                borderRadius: 2,
                boxShadow: lit ? "0 0 10px var(--accent-mid), 0 0 3px var(--accent)" : "none",
                opacity: lit ? 0.5 : 1,
                transition: "background 0.4s, border-color 0.4s, box-shadow 0.4s, opacity 0.4s",
              }}
            />
          );
        })}
      </div>

      {/* Layer 2: dark overlay */}
      <div style={{
        gridArea: "1 / 1",
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.85) 100%)",
        zIndex: 1,
      }} />

      {/* Layer 3: centered content */}
      <div style={{
        gridArea: "1 / 1",
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        textAlign: "center",
        padding: 24,
      }}>
        <div style={{
          color: "var(--accent)",
          opacity: 0.6,
          marginBottom: 4,
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div style={{
          fontSize: 16,
          fontWeight: 600,
          color: "var(--text-primary)",
        }}>
          no transfers yet
        </div>
        <div style={{
          fontSize: 12,
          color: "var(--text-muted)",
          marginBottom: 4,
        }}>
          generate a link &middot; share it &middot; receive files
        </div>
        <button
          className="btn btn-primary"
          onClick={onGenerate}
          disabled={generating}
        >
          {generating ? "generating..." : "generate upload link"}
        </button>
        <div style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 4 }}>
          links expire after 12 hours
        </div>
      </div>
    </div>
  );
}

export function TransfersPanel({ user: _user }: WindowContentProps) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => { if (statusTimer.current) clearTimeout(statusTimer.current); };
  }, []);

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 3000);
  }, []);

  const loadTransfers = useCallback(async () => {
    try {
      const data = await getMyTransfers();
      setTransfers(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't load transfers";
      showStatus(msg, true);
    } finally {
      setLoading(false);
    }
  }, [showStatus]);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await createTransferLink();
      setLastUrl(result.url);
      setCopied(false);
      try { await navigator.clipboard.writeText(result.url); setCopied(true); } catch { /* clipboard blocked */ }
      showStatus("link generated" + (copied ? " & copied" : ""));
      const updated = await getMyTransfers();
      setTransfers(updated);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't generate link";
      showStatus(msg, true);
    } finally {
      setGenerating(false);
    }
  }, [showStatus, copied]);

  const handleCopyLink = useCallback(async (id: string) => {
    const url = `${window.location.origin}/t/${id}`;
    try { await navigator.clipboard.writeText(url); } catch { /* clipboard blocked */ }
    showStatus("link copied");
  }, [showStatus]);

  const handleCopyLast = useCallback(async () => {
    if (!lastUrl) return;
    try { await navigator.clipboard.writeText(lastUrl); } catch { /* clipboard blocked */ }
    setCopied(true);
    showStatus("copied");
  }, [lastUrl, showStatus]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteTransfer(id);
      setTransfers(prev => prev.filter(t => t.id !== id));
      showStatus("obliterated");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "couldn't delete";
      showStatus(msg, true);
    }
  }, [showStatus]);

  if (loading) {
    return (
      <div className="admin-panel" style={{ flexDirection: "column" }}>
        <div className="admin-loading" style={{ flex: 1 }}>
          <span className="spinner" />
          loading transfers...
        </div>
      </div>
    );
  }

  // Empty state — show idle animation
  if (transfers.length === 0 && !lastUrl) {
    return <IdleGrid onGenerate={() => void handleGenerate()} generating={generating} />;
  }

  const active = transfers.filter(t => !t.expired);
  const expired = transfers.filter(t => t.expired);

  return (
    <div className="admin-panel" style={{ flexDirection: "column" }}>
      {/* Header */}
      <div className="admin-content-header">
        <h2>file transfers</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {status && (
            <span className={`admin-status${status.isError ? " error" : ""}`}>
              {status.text}
            </span>
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void handleGenerate()}
            disabled={generating}
          >
            {generating ? "generating..." : "+ new link"}
          </button>
        </div>
      </div>

      {/* Last generated URL */}
      {lastUrl && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 16px",
          margin: "0 12px",
          borderRadius: 0,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}>
          <span style={{
            fontSize: 10,
            color: "var(--text-ghost)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
            flexShrink: 0,
          }}>link</span>
          <code style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11,
            color: "var(--accent)",
          }}>{lastUrl}</code>
          <button
            className="btn btn-sm"
            style={{ padding: "2px 10px", fontSize: 11, flexShrink: 0 }}
            onClick={() => void handleCopyLast()}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="admin-content-body">
        <div className="sl-table-wrap terminal-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>status</th>
                <th>id</th>
                <th>files</th>
                <th style={{ textAlign: "right" }}>size</th>
                <th style={{ textAlign: "right" }}>age</th>
                <th style={{ textAlign: "right" }}>expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map(t => (
                <TransferRow
                  key={t.id}
                  transfer={t}
                  onCopyLink={handleCopyLink}
                  onDelete={handleDelete}
                />
              ))}
              {expired.length > 0 && active.length > 0 && (
                <tr>
                  <td colSpan={7} style={{
                    padding: "6px 12px",
                    fontSize: 10,
                    color: "var(--text-ghost)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    borderTop: "1px solid var(--border-subtle)",
                  }}>
                    <span>expired ({expired.length})</span>
                  </td>
                </tr>
              )}
              {expired.map(t => (
                <TransferRow
                  key={t.id}
                  transfer={t}
                  onCopyLink={handleCopyLink}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TransferRow({ transfer: t, onCopyLink, onDelete }: {
  transfer: Transfer;
  onCopyLink: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isExpired = t.expired;
  const isUploaded = !!t.uploaded_at;
  const status = isExpired ? "expired" : isUploaded ? "uploaded" : "pending";
  const roleClass = status === "uploaded" ? "role-premium"
    : status === "expired" ? "role-guest"
    : "role-basic";

  const fileLabel = isUploaded
    ? t.original_names.length === 1
      ? (t.original_names[0] ?? "file")
      : `${t.original_names.length} files`
    : "\u2013";

  return (
    <tr style={isExpired ? { opacity: 0.45 } : undefined}>
      <td>
        <span className={`role-badge ${roleClass}`}>{status}</span>
      </td>
      <td>
        <code style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.id.slice(0, 8)}</code>
      </td>
      <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {fileLabel}
      </td>
      <td style={{ textAlign: "right" }}>
        {isUploaded ? (
          <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{formatBytes(t.size)}</span>
        ) : "\u2013"}
      </td>
      <td style={{ textAlign: "right" }}>
        <span style={{ color: "var(--text-ghost)", fontSize: 12 }}>{timeAgo(t.created_at)}</span>
      </td>
      <td style={{ textAlign: "right" }}>
        <span style={{ color: isExpired ? "var(--text-ghost)" : "var(--text-muted)", fontSize: 12 }}>
          {isExpired ? "expired" : timeLeft(t.expires_at)}
        </span>
      </td>
      <td style={{ textAlign: "right" }}>
        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
          {!isExpired && (
            <button
              className="btn btn-sm"
              onClick={() => onCopyLink(t.id)}
              title="copy upload link"
            >
              copy
            </button>
          )}
          {isUploaded && !isExpired && (
            <a
              href={getTransferDownloadUrl(t.id)}
              className="btn btn-sm btn-primary"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              dl
            </a>
          )}
          <button
            className="btn btn-sm btn-danger"
            onClick={() => void onDelete(t.id)}
            title="delete transfer"
          >
            ×
          </button>
        </div>
      </td>
    </tr>
  );
}
