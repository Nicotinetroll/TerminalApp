import { useState, useEffect, useCallback, useRef } from "react";
import type { EmailMessage } from "@/lib/api";
import { getEmails, ApiError } from "@/lib/api";

interface Props {
  folder: string;
  onSelect: (id: number) => void;
  onCompose: () => void;
  onQuickTrash?: (id: number) => void;
  onQuickToggleRead?: (id: number, currentlyRead: boolean) => void;
  onQuickStar?: (id: number, currentlyStarred: boolean) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return "yesterday";
  }

  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getEmptyMessage(folder: string): { title: string; sub: string } {
  switch (folder) {
    case "inbox":
      return {
        title: "inbox zero",
        sub: "either you're productive or nobody likes you.",
      };
    case "sent":
      return {
        title: "no sent mail",
        sub: "you haven't sent shit. go bother someone.",
      };
    case "trash":
      return {
        title: "trash is empty",
        sub: "cleaner than your browser history.",
      };
    case "starred":
      return {
        title: "no starred mail",
        sub: "nothing's important enough for you? cool.",
      };
    case "drafts":
      return {
        title: "no drafts",
        sub: "all your thoughts just... gone.",
      };
    default:
      return { title: "nothing here", sub: "move along." };
  }
}

function isNoSubject(subject: string): boolean {
  return subject === "(no subject, just vibes)";
}

export function MailList({ folder, onSelect, onCompose, onQuickTrash, onQuickToggleRead, onQuickStar }: Props) {
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const isStarredView = folder === "starred";

  const loadEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const msgs = await getEmails(
        isStarredView ? "inbox" : folder,
        50, 0,
        debouncedSearch,
        isStarredView
      );
      setEmails(msgs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "couldn't load emails");
    } finally {
      setLoading(false);
    }
  }, [folder, debouncedSearch, isStarredView]);

  useEffect(() => {
    void loadEmails();
  }, [loadEmails]);

  if (loading) {
    return (
      <div className="mail-content-empty">
        <span className="spinner" />
        loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mail-content-empty">
        <div className="mail-empty-icon">!</div>
        <div className="mail-empty-text">{error}</div>
      </div>
    );
  }

  if (emails.length === 0 && !debouncedSearch) {
    const empty = getEmptyMessage(folder);
    return (
      <div className="mail-content-empty">
        <div className="mail-empty-icon">
          {folder === "inbox" ? ">" : folder === "sent" ? "<" : folder === "starred" ? "*" : "x"}
        </div>
        <div className="mail-empty-text">{empty.title}</div>
        <div className="mail-empty-sub">{empty.sub}</div>
        {folder === "inbox" && (
          <button className="admin-btn admin-btn-primary" style={{ marginTop: "16px" }} onClick={onCompose}>
            compose something
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mail-list">
      <div className="mail-list-header">
        <span>{folder} ({emails.length})</span>
        <input
          type="text"
          className="mail-search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search..."
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div className="mail-list-items terminal-scroll">
        {emails.length === 0 && debouncedSearch && (
          <div className="mail-content-empty" style={{ padding: 30 }}>
            <div className="mail-empty-text">no results for "{debouncedSearch}"</div>
            <div className="mail-empty-sub">try harder or lower your standards.</div>
          </div>
        )}
        {emails.map(email => (
          <div
            key={email.id}
            className={`mail-list-item${email.is_read ? "" : " unread"}`}
            onClick={() => onSelect(email.id)}
            onMouseEnter={() => setHoveredId(email.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div className="mail-list-item-top">
              <span className="mail-list-from">
                {email.is_starred && <span className="mail-star-icon active">*</span>}
                {folder === "sent" ? email.to_address : email.from_address}
              </span>
              <span className="mail-list-date">
                {hoveredId === email.id && (
                  <span className="mail-quick-actions">
                    {onQuickStar && (
                      <button
                        className="mail-quick-btn"
                        onClick={(e) => { e.stopPropagation(); void onQuickStar(email.id, email.is_starred); }}
                        title={email.is_starred ? "unstar" : "star"}
                      >
                        {email.is_starred ? "★" : "☆"}
                      </button>
                    )}
                    {onQuickToggleRead && (
                      <button
                        className="mail-quick-btn"
                        onClick={(e) => { e.stopPropagation(); void onQuickToggleRead(email.id, email.is_read); }}
                        title={email.is_read ? "mark unread" : "mark read"}
                      >
                        {email.is_read ? "●" : "○"}
                      </button>
                    )}
                    {onQuickTrash && folder !== "trash" && (
                      <button
                        className="mail-quick-btn mail-quick-btn-danger"
                        onClick={(e) => { e.stopPropagation(); void onQuickTrash(email.id); }}
                        title="trash"
                      >
                        x
                      </button>
                    )}
                  </span>
                )}
                {formatDate(email.created_at)}
              </span>
            </div>
            <div className={`mail-list-subject${isNoSubject(email.subject) ? " mail-no-subject" : ""}`}>
              {(email.attachment_count ?? 0) > 0 && (
                <span className="mail-list-attachment-icon" title={`${email.attachment_count} attachment${(email.attachment_count ?? 0) > 1 ? "s" : ""}`}>
                  [+]
                </span>
              )}
              {email.subject}
              {email.subject.toLowerCase().includes("69") && (
                <span className="mail-nice"> nice.</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
