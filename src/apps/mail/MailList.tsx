import { useState, useEffect, useCallback, useRef } from "react";
import type { EmailMessage, MailFolder } from "@/lib/api";
import { getEmails, ApiError } from "@/lib/api";

interface Props {
  folder: string;
  onSelect: (id: number) => void;
  onCompose: () => void;
  onQuickTrash?: (id: number) => void;
  onQuickToggleRead?: (id: number, currentlyRead: boolean) => void;
  onQuickStar?: (id: number, currentlyStarred: boolean) => void;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelectAll: (ids: number[]) => void;
  onDeselectAll: () => void;
  onBulkAction: (action: string) => void;
  customFolders: MailFolder[];
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

export function MailList({
  folder, onSelect, onCompose, onQuickTrash, onQuickToggleRead, onQuickStar,
  selectedIds, onToggleSelect, onSelectAll, onDeselectAll, onBulkAction,
}: Props) {
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

  const allSelected = emails.length > 0 && emails.every(e => selectedIds.has(e.id));
  const someSelected = selectedIds.size > 0;

  const handleSelectAllToggle = () => {
    if (allSelected) {
      onDeselectAll();
    } else {
      onSelectAll(emails.map(e => e.id));
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
          <button className="btn btn-primary" style={{ marginTop: "16px" }} onClick={onCompose}>
            compose something
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mail-list">
      {/* Gmail-style toolbar */}
      <div className="mail-toolbar">
        <div className="mail-toolbar-left">
          <input
            type="checkbox"
            className="mail-checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={handleSelectAllToggle}
            title="select all"
          />
          {someSelected && (
            <>
              {folder !== "trash" && onQuickTrash && (
                <button className="mail-toolbar-btn mail-toolbar-btn-danger" onClick={() => onBulkAction("trash")} title="trash selected">
                  trash
                </button>
              )}
              {onQuickToggleRead && (
                <>
                  <button className="mail-toolbar-btn" onClick={() => onBulkAction("read")} title="mark read">
                    mark read
                  </button>
                  <button className="mail-toolbar-btn" onClick={() => onBulkAction("unread")} title="mark unread">
                    mark unread
                  </button>
                </>
              )}
              <span className="mail-toolbar-count">{selectedIds.size} selected</span>
            </>
          )}
        </div>
        <div className="mail-toolbar-right">
          <input
            type="text"
            className="mail-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search..."
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {/* Email rows */}
      <div className="mail-list-items terminal-scroll">
        {emails.length === 0 && debouncedSearch && (
          <div className="mail-content-empty" style={{ padding: 30 }}>
            <div className="mail-empty-text">no results for &ldquo;{debouncedSearch}&rdquo;</div>
            <div className="mail-empty-sub">try harder or lower your standards.</div>
          </div>
        )}
        {emails.map(email => {
          const isSelected = selectedIds.has(email.id);
          const isHovered = hoveredId === email.id;
          const sender = folder === "sent" ? email.to_address : email.from_address;
          return (
            <div
              key={email.id}
              className={`mail-list-row${isSelected ? " selected" : ""}${email.is_read ? "" : " unread"}`}
              onClick={() => onSelect(email.id)}
              onMouseEnter={() => setHoveredId(email.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <input
                type="checkbox"
                className="mail-checkbox"
                checked={isSelected}
                onChange={(e) => { e.stopPropagation(); onToggleSelect(email.id); }}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                className={`mail-star-btn${email.is_starred ? " starred" : ""}`}
                onClick={(e) => { e.stopPropagation(); onQuickStar?.(email.id, email.is_starred); }}
                title={email.is_starred ? "unstar" : "star"}
              >
                {email.is_starred ? "★" : "☆"}
              </button>
              <span className="mail-row-sender">{sender}</span>
              <span className={`mail-row-subject${isNoSubject(email.subject) ? " mail-no-subject" : ""}`}>
                {(email.attachment_count ?? 0) > 0 && (
                  <span className="mail-list-attachment-icon" title={`${email.attachment_count} attachment${(email.attachment_count ?? 0) > 1 ? "s" : ""}`}>
                    [+]
                  </span>
                )}
                {email.subject}
                {email.subject.toLowerCase().includes("69") && (
                  <span className="mail-nice"> nice.</span>
                )}
              </span>
              <span className="mail-row-right">
                {isHovered ? (
                  <span className="mail-row-actions">
                    {onQuickStar && (
                      <button
                        className="mail-row-action-btn"
                        onClick={(e) => { e.stopPropagation(); onQuickStar(email.id, email.is_starred); }}
                        title={email.is_starred ? "unstar" : "star"}
                      >
                        {email.is_starred ? "★" : "☆"}
                      </button>
                    )}
                    {onQuickToggleRead && (
                      <button
                        className="mail-row-action-btn"
                        onClick={(e) => { e.stopPropagation(); onQuickToggleRead(email.id, email.is_read); }}
                        title={email.is_read ? "mark unread" : "mark read"}
                      >
                        {email.is_read ? "○" : "●"}
                      </button>
                    )}
                    {onQuickTrash && folder !== "trash" && (
                      <button
                        className="mail-row-action-btn mail-row-action-danger"
                        onClick={(e) => { e.stopPropagation(); onQuickTrash(email.id); }}
                        title="trash"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="mail-row-date">{formatDate(email.created_at)}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
