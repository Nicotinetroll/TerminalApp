import { useState, useEffect, useCallback, useRef } from "react";
import type { EmailMessage } from "@/lib/api";
import { getEmail, updateEmail, deleteEmail, downloadAttachment, ApiError } from "@/lib/api";
import DOMPurify from "dompurify";

interface Props {
  emailId: number;
  onBack: () => void;
  onReply: (data: { to: string; subject: string; in_reply_to?: string; from?: string }) => void;
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

/** Minimal markdown-ish renderer for plain text email bodies */
function renderPlainText(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");

  // Inline code: `text`
  html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.06);padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>');

  // Bare URLs (not already in anchor tags)
  html = html.replace(
    /(?<!href="|">)(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>'
  );

  // Newlines to <br>
  html = html.replace(/\n/g, "<br>");

  return html;
}

/** Sanitize HTML email body — allows safe tags, forces link target */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "a", "b", "i", "u", "em", "strong", "p", "br", "hr", "div", "span",
      "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote",
      "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "img",
      "font", "center", "small", "sub", "sup", "dl", "dt", "dd",
    ],
    ALLOWED_ATTR: [
      "href", "target", "rel", "style", "class", "src", "alt", "width",
      "height", "align", "valign", "border", "cellpadding", "cellspacing",
      "bgcolor", "color", "size", "face",
    ],
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input"],
  });
}

/** Detect if body looks like HTML */
function isHtml(text: string): boolean {
  return /<\s*(html|body|div|p|br|table|a|img|span)\b/i.test(text);
}

export function MailView({ emailId, onBack, onReply, onForward, onDelete, showStatus }: Props) {
  const [email, setEmail] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showHtml, setShowHtml] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
      from: email.to_address,
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
        <button className="mail-view-back" onClick={onBack}>← back</button>
        <div className="mail-view-actions">
          <button className="mail-view-action-btn" onClick={handleReply} title="reply (r)">↩ reply</button>
          <button className="mail-view-action-btn" onClick={handleForward} title="forward (f)">→ fwd</button>
          <button className="mail-view-action-btn" onClick={() => void handleToggleStar()} title="star (s)">
            {email.is_starred ? "★" : "☆"}
          </button>
          <button className="mail-view-action-btn" onClick={() => void handleMarkUnread()} title="mark unread (u)">○ unread</button>
          <button className="mail-view-action-btn mail-view-action-danger" onClick={() => void handleTrash()} title="trash (t)">
            {email.folder === "trash"
              ? (confirmDelete ? "confirm?" : "✕ delete")
              : "✕ trash"}
          </button>
        </div>
      </div>

      <div className="mail-view-meta">
        <h2 className="mail-view-subject">{email.subject}</h2>
        <div className="mail-view-sender-row">
          <div className="mail-sender-avatar">
            {email.from_address[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="mail-view-info">
            <span className="mail-view-from">{email.from_address}</span>
            <span className="mail-view-to">to {email.to_address}</span>
          </div>
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

      <MailBody email={email} showHtml={showHtml} setShowHtml={setShowHtml} iframeRef={iframeRef} />
    </div>
  );
}

/** Renders email body — HTML emails in sandboxed iframe, plain text inline */
function MailBody({ email, showHtml, setShowHtml, iframeRef }: {
  email: EmailMessage;
  showHtml: boolean;
  setShowHtml: (v: boolean) => void;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}) {
  const rawHtml = email.body_html ?? null;
  const body = email.body || "";
  const hasHtml = rawHtml ? true : isHtml(body);
  const htmlContent = rawHtml ?? (hasHtml ? body : null);

  // Build srcdoc string for fully sandboxed iframe (no allow-same-origin)
  const srcdoc = (() => {
    if (!showHtml || !htmlContent) return "";
    const sanitized = sanitizeHtml(htmlContent);
    // Rewrite links: add target="_blank" rel="noopener noreferrer"
    const withLinks = sanitized.replace(
      /<a\b([^>]*)>/gi,
      (match, attrs: string) => {
        let cleaned = attrs.replace(/target\s*=\s*["'][^"']*["']/gi, "").replace(/rel\s*=\s*["'][^"']*["']/gi, "");
        return `<a${cleaned} target="_blank" rel="noopener noreferrer">`;
      }
    );
    return `<!DOCTYPE html><html><head><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; line-height: 1.6; color: #e0e0e0;
        background: transparent; padding: 0;
        word-wrap: break-word; overflow-wrap: break-word;
      }
      a { color: #DA7756; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; border-collapse: collapse; }
      blockquote { border-left: 2px solid #555; padding-left: 10px; margin: 8px 0; color: #aaa; }
      pre, code { font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
    </style></head><body>${withLinks}</body></html>`;
  })();

  // Auto-resize iframe to fit HTML content
  useEffect(() => {
    if (!showHtml || !htmlContent || !iframeRef.current) return;
    const iframe = iframeRef.current;

    const resize = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          // Reset height first so scrollHeight reflects true content height
          iframe.style.height = "0px";
          const h = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight ?? 0);
          iframe.style.height = h + 16 + "px";
        }
      } catch { /* sandbox fallback — shouldn't happen with allow-same-origin */ }
    };

    // Resize on load + poll a few times for lazy-loading images/fonts
    const onLoad = () => {
      resize();
      let n = 0;
      const poll = () => { resize(); if (++n < 8) setTimeout(poll, 400); };
      setTimeout(poll, 300);
    };

    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [showHtml, htmlContent, iframeRef]);

  if (!body && !htmlContent) {
    return (
      <div className="mail-view-body" style={{ fontStyle: "italic", color: "var(--text-muted)" }}>
        (empty body. a true minimalist.)
      </div>
    );
  }

  if (hasHtml && showHtml) {
    return (
      <div className="mail-view-body">
        <div className="mail-view-html-toggle">
          <button className="mail-view-toggle-btn active" onClick={() => setShowHtml(true)}>HTML</button>
          <button className="mail-view-toggle-btn" onClick={() => setShowHtml(false)}>Plain text</button>
        </div>
        <iframe
          ref={iframeRef}
          className="mail-view-html-frame"
          srcDoc={srcdoc}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          title="Email content"
        />
      </div>
    );
  }

  // Plain text (or "show plain" toggle for HTML emails)
  const plainText = body || "(no plain text version)";
  return (
    <div className="mail-view-body">
      {hasHtml && (
        <div className="mail-view-html-toggle">
          <button className="mail-view-toggle-btn" onClick={() => setShowHtml(true)}>HTML</button>
          <button className="mail-view-toggle-btn active" onClick={() => setShowHtml(false)}>Plain text</button>
        </div>
      )}
      <div dangerouslySetInnerHTML={{ __html: renderPlainText(plainText) }} />
    </div>
  );
}
