import { useState, useEffect, useCallback } from "react";
import type { EmailMessage } from "@/lib/api";
import { getEmail, updateEmail, deleteEmail, downloadAttachment, ApiError } from "@/lib/api";

interface Props {
  emailId: number;
  onBack: () => void;
  onReply: (data: { to: string; subject: string; in_reply_to?: string }) => void;
  onForward: (data: { subject: string; body: string }) => void;
  onDelete: () => void;
  showStatus: (text: string, isError?: boolean) => void;
}

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Minimal markdown-ish renderer for email bodies */
function renderBody(text: string): string {
  // Escape HTML first
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");

  // Inline code: `text`
  html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.06);padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>');

  // Links: [text](url) and bare URLs
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>'
  );
  html = html.replace(
    /(?<!\])\((https?:\/\/[^\s)]+)\)(?!\))/g,
    '(<a href="$1" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>)'
  );
  // Bare URLs (not already in anchor tags)
  html = html.replace(
    /(?<!href="|">)(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>'
  );

  // Newlines to <br>
  html = html.replace(/\n/g, "<br>");

  return html;
}

export function MailView({ emailId, onBack, onReply, onForward, onDelete, showStatus }: Props) {
  const [email, setEmail] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadEmail = useCallback(async () => {
    setLoading(true);
    try {
      const msg = await getEmail(emailId);
      setEmail(msg);
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "couldn't load email", true);
      onBack();
    } finally {
      setLoading(false);
    }
  }, [emailId, showStatus, onBack]);

  useEffect(() => {
    void loadEmail();
  }, [loadEmail]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      switch (e.key) {
        case "r":
          e.preventDefault();
          handleReply();
          break;
        case "t":
          e.preventDefault();
          void handleTrash();
          break;
        case "u":
          e.preventDefault();
          void handleMarkUnread();
          break;
        case "f":
          e.preventDefault();
          handleForward();
          break;
        case "s":
          e.preventDefault();
          void handleToggleStar();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }); // intentionally no deps

  const handleTrash = async () => {
    if (!email) return;
    try {
      if (email.folder === "trash") {
        if (!confirmDelete) {
          setConfirmDelete(true);
          return;
        }
        await deleteEmail(email.id);
        onDelete();
      } else {
        await updateEmail(email.id, { folder: "trash" });
        onBack();
        showStatus("moved to trash");
      }
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "couldn't trash", true);
    }
  };

  const handleReply = () => {
    if (!email) return;
    const reSubject = email.subject.startsWith("Re: ")
      ? email.subject
      : `Re: ${email.subject}`;
    onReply({
      to: email.from_address,
      subject: reSubject,
      in_reply_to: email.message_id ?? undefined,
    });
  };

  const handleForward = () => {
    if (!email) return;
    const fwdSubject = email.subject.startsWith("Fwd: ")
      ? email.subject
      : `Fwd: ${email.subject}`;
    const fwdBody = `\n\n---------- Forwarded message ----------\nFrom: ${email.from_address}\nDate: ${formatFullDate(email.created_at)}\nSubject: ${email.subject}\nTo: ${email.to_address}\n\n${email.body ?? ""}`;
    onForward({ subject: fwdSubject, body: fwdBody });
  };

  const handleMarkUnread = async () => {
    if (!email) return;
    try {
      await updateEmail(email.id, { is_read: false });
      onBack();
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "failed", true);
    }
  };

  const handleToggleStar = async () => {
    if (!email) return;
    try {
      const newStarred = !email.is_starred;
      await updateEmail(email.id, { is_starred: newStarred });
      setEmail({ ...email, is_starred: newStarred });
      showStatus(newStarred ? "starred" : "unstarred");
    } catch (err) {
      showStatus(err instanceof ApiError ? err.message : "failed", true);
    }
  };

  const handleDownload = async (attId: number, filename: string) => {
    try {
      await downloadAttachment(attId, filename);
    } catch {
      showStatus("download failed", true);
    }
  };

  if (loading) {
    return (
      <div className="mail-content-empty">
        <span className="spinner" />
        loading...
      </div>
    );
  }

  if (!email) return null;

  const attachments = email.attachments ?? [];

  return (
    <div className="mail-view">
      <div className="mail-view-header">
        <button className="mail-view-back" onClick={onBack}>&lt; back</button>
        <div className="mail-view-actions">
          <button className="admin-btn" onClick={() => void handleToggleStar()} title="star (s)">
            {email.is_starred ? "★" : "☆"}
          </button>
          <button className="admin-btn" onClick={handleReply} title="reply (r)">reply</button>
          <button className="admin-btn" onClick={handleForward} title="forward (f)">fwd</button>
          <button className="admin-btn" onClick={() => void handleMarkUnread()} title="mark unread (u)">mark unread</button>
          <button className="admin-btn admin-btn-danger" onClick={() => void handleTrash()} title="trash (t)">
            {email.folder === "trash"
              ? (confirmDelete ? "confirm delete?" : "delete forever")
              : "trash"}
          </button>
        </div>
      </div>

      <div className="mail-view-meta">
        <h2 className="mail-view-subject">{email.subject}</h2>
        <div className="mail-view-info">
          <span className="mail-view-from">from: {email.from_address}</span>
          <span className="mail-view-to">to: {email.to_address}</span>
          <span className="mail-view-date">{formatFullDate(email.created_at)}</span>
        </div>
      </div>

      {attachments.length > 0 && (
        <div className="mail-attachments">
          <div className="mail-attachments-label">
            attachments ({attachments.length})
          </div>
          <div className="mail-attachments-list">
            {attachments.map(att => (
              <button
                key={att.id}
                className="mail-attachment-item"
                onClick={() => void handleDownload(att.id, att.filename)}
                title={`${att.filename} (${formatBytes(att.size)})`}
              >
                <span className="mail-attachment-icon">
                  {att.mime_type.startsWith("image/") ? "img" : att.mime_type.startsWith("text/") ? "txt" : "file"}
                </span>
                <span className="mail-attachment-name">{att.filename}</span>
                <span className="mail-attachment-size">{formatBytes(att.size)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className="mail-view-body"
        dangerouslySetInnerHTML={{ __html: renderBody(email.body || "(empty body. a true minimalist.)") }}
      />
    </div>
  );
}
