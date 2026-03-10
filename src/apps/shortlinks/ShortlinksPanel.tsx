import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { getMyShortlinks, createShortlink, deleteShortlink } from "@/lib/api";
import type { Shortlink } from "@/lib/api";

type View = "list" | "create";

function truncateUrl(url: string, max = 40): string {
  if (url.length <= max) return url;
  return url.slice(0, max - 1) + "\u2026";
}

function fmtClicks(n: number): string {
  if (n === 0) return "\u2013";
  if (n === 69) return "69 (nice)";
  if (n === 420) return "420 (blaze it)";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr + "Z").getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function ShortlinksPanel({ user }: WindowContentProps) {
  const [view, setView] = useState<View>("list");
  const [links, setLinks] = useState<Shortlink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // Create form
  const [url, setUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<Shortlink | null>(null);

  const isAdmin = user.role === "admin";

  useEffect(() => {
    return () => { if (statusTimer.current) clearTimeout(statusTimer.current); };
  }, []);

  const showStatus = useCallback((text: string, isError = false) => {
    setStatus({ text, isError });
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 3000);
  }, []);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMyShortlinks();
      setLinks(data);
    } catch {
      setError("failed to load links");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  const handleCreate = async () => {
    if (!url.trim()) return;
    setCreating(true);
    try {
      const link = await createShortlink({
        url: url.trim(),
        slug: slug.trim() || undefined,
        title: title.trim() || undefined,
      });
      setCreatedLink(link);
      setUrl("");
      setSlug("");
      setTitle("");
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "creation failed", true);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteShortlink(id);
      setLinks((prev) => prev.filter((l) => l.id !== id));
      showStatus("link deleted");
    } catch {
      showStatus("couldn't delete that", true);
    }
  };

  const copyLink = (s: string) => {
    const full = `https://mynig.ga/s/${s}`;
    void navigator.clipboard.writeText(full);
    showStatus("copied to clipboard");
  };

  const getShortUrl = (s: string) => `https://mynig.ga/s/${s}`;

  // ── Create view ──
  if (view === "create") {
    return (
      <div className="panel-view">
        <div className="panel-view-header">
          <h2>{createdLink ? "link created" : "new shortlink"}</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {status && (
              <span className={`admin-status${status.isError ? " error" : ""}`}>
                {status.text}
              </span>
            )}
            <button className="btn btn-sm" onClick={() => { setView("list"); setCreatedLink(null); void loadLinks(); }}>
              \u2190 back
            </button>
          </div>
        </div>

        {createdLink ? (
          <div className="sl-created">
            <div className="sl-created-icon">\u2714</div>
            <div className="sl-created-url-wrap">
              <code className="sl-created-url">{getShortUrl(createdLink.slug)}</code>
              <button className="btn btn-sm btn-primary" onClick={() => copyLink(createdLink.slug)}>
                copy
              </button>
            </div>
            <div className="sl-created-target">
              \u2192 {truncateUrl(createdLink.target_url, 60)}
            </div>
            <button className="btn btn-sm" onClick={() => setCreatedLink(null)} style={{ marginTop: 16 }}>
              create another
            </button>
          </div>
        ) : (
          <div className="sl-form">
            <div className="sl-field">
              <label className="sl-label">destination url</label>
              <input
                className="admin-input"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/some/long/url"
                autoFocus
              />
            </div>
            <div className="sl-field">
              <label className="sl-label">
                custom slug <span style={{ color: "var(--text-ghost)" }}>(optional)</span>
              </label>
              <div className="sl-slug-input">
                <span className="sl-slug-prefix">mynig.ga/s/</span>
                <input
                  className="admin-input"
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                  placeholder="auto"
                  maxLength={32}
                  style={{ borderLeft: "none" }}
                />
              </div>
            </div>
            <div className="sl-field">
              <label className="sl-label">
                title <span style={{ color: "var(--text-ghost)" }}>(optional)</span>
              </label>
              <input
                className="admin-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="my cool link"
                maxLength={200}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={() => void handleCreate()}
              disabled={creating || !url.trim()}
              style={{ alignSelf: "flex-start", marginTop: 4 }}
            >
              {creating ? "creating..." : "shorten it"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="panel-view">
      <div className="panel-view-header">
        <h2>shortlinks</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {status && (
            <span className={`admin-status${status.isError ? " error" : ""}`}>
              {status.text}
            </span>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setView("create")}>
            + new link
          </button>
        </div>
      </div>

      {loading && (
        <div className="admin-loading">
          <span className="spinner" />
          loading links...
        </div>
      )}

      {error && <div className="admin-empty" style={{ color: "var(--error)" }}>{error}</div>}

      {!loading && links.length === 0 && (
        <div className="admin-empty">
          no links yet. click <strong>+ new link</strong> to create one.
        </div>
      )}

      {!loading && links.length > 0 && (
        <div className="sl-table-wrap terminal-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>slug</th>
                <th>target</th>
                <th style={{ textAlign: "center" }}>clicks</th>
                <th style={{ textAlign: "right" }}>age</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id}>
                  <td>
                    <span
                      className="sl-slug-link"
                      onClick={() => copyLink(link.slug)}
                      title="click to copy short url"
                    >
                      /s/{link.slug}
                    </span>
                    {link.title && (
                      <div style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 1 }}>{link.title}</div>
                    )}
                  </td>
                  <td>
                    <a
                      href={link.target_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sl-target-link"
                      title={link.target_url}
                    >
                      {truncateUrl(link.target_url)}
                    </a>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className="sl-clicks">{fmtClicks(link.click_count)}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span style={{ color: "var(--text-ghost)", fontSize: 12 }}>
                      {timeAgo(link.created_at)}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => copyLink(link.slug)}
                        title="copy short url"
                      >
                        copy
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => void handleDelete(link.id)}
                        title={isAdmin ? "admin delete" : "delete"}
                      >
                        \u00d7
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
