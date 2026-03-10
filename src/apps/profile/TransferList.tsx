import type { Transfer } from "@/lib/api";
import { getTransferDownloadUrl } from "@/lib/api";
import { formatBytes } from "@/apps/cloud/helpers";

interface Props {
  transfers: Transfer[];
  onDelete: (id: string) => void;
  onCopyLink: (id: string) => void;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr + "Z").getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt + "Z").getTime() - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m left`;
}

export function TransferList({ transfers, onDelete, onCopyLink }: Props) {
  if (transfers.length === 0) {
    return (
      <div style={{ color: "var(--text-ghost)", fontSize: 13, padding: "8px 0" }}>
        no transfers yet. generate an upload link above.
      </div>
    );
  }

  return (
    <div className="transfer-list">
      {transfers.map((t) => {
        const expired = t.expired;
        const uploaded = !!t.uploaded_at;
        const status = expired ? "expired" : uploaded ? "uploaded" : "pending";
        const statusClass = status === "uploaded" ? "transfer-status-uploaded" : status === "expired" ? "transfer-status-expired" : "transfer-status-pending";

        return (
          <div key={t.id} className={`transfer-item${expired ? " transfer-expired" : ""}`}>
            <div className="transfer-item-top">
              <span className={`transfer-status-badge ${statusClass}`}>{status}</span>
              <span className="transfer-id">{t.id.slice(0, 8)}</span>
              <span className="transfer-time">{timeAgo(t.created_at)}</span>
              {!expired && <span className="transfer-expires">{timeLeft(t.expires_at)}</span>}
            </div>

            {uploaded && (
              <div className="transfer-item-files">
                <span className="transfer-filenames">
                  {t.original_names.length === 1
                    ? (t.original_names[0] ?? "file")
                    : `${t.original_names.length} files`}
                </span>
                <span className="transfer-size">{formatBytes(t.size)}</span>
              </div>
            )}

            <div className="transfer-item-actions">
              {!expired && !uploaded && (
                <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => onCopyLink(t.id)}>
                  copy link
                </button>
              )}
              {uploaded && !expired && (
                <a
                  href={getTransferDownloadUrl(t.id)}
                  className="btn"
                  style={{ fontSize: 11, padding: "2px 8px", textDecoration: "none" }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  download
                </a>
              )}
              <button
                className="btn"
                style={{ fontSize: 11, padding: "2px 8px", color: "var(--error)" }}
                onClick={() => onDelete(t.id)}
              >
                delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
