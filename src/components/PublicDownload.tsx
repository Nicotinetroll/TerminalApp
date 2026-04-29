import { useState, useEffect, useCallback } from "react";
import { getPublicShareInfo, getShareDownloadUrl } from "@/lib/api";
import type { CloudShare } from "@/lib/api";
import { formatBytes } from "@/apps/cloud/helpers";
import { LogoHeader } from "./LogoHeader";

interface Props {
  shareId: string;
  onClose: () => void;
}

const SHARE_TITLES = [
  "someone shared their shit with you",
  "incoming file drop",
  "a wild file appeared!",
  "grab this before it self-destructs",
  "your download awaits, peasant",
  "file delivery service, no tip required",
  "somebody thought you deserved this",
  "digital handoff in progress",
  "free stuff. no strings attached. probably.",
  "a generous soul has blessed you",
  "accept this offering from the cloud gods",
  "file transfer complete. your move.",
  "here's your file. don't say we never did anything for you.",
  "someone sent you bytes. how romantic.",
  "shared with love. or boredom. hard to tell.",
];

function getShareTitle(): string {
  return SHARE_TITLES[Math.floor(Math.random() * SHARE_TITLES.length)]!;
}

function getMimeIcon(mime: string): string {
  if (mime.startsWith("image/")) return "\u{1F5BC}";
  if (mime.startsWith("video/")) return "\u{1F3AC}";
  if (mime.startsWith("audio/")) return "\u{1F3B5}";
  if (mime.startsWith("text/")) return "\u{1F4C4}";
  if (mime.includes("pdf")) return "\u{1F4D1}";
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar")) return "\u{1F4E6}";
  if (mime.includes("json") || mime.includes("xml")) return "\u{1F4CB}";
  return "\u{1F4BE}";
}

function getDownloadQuip(count: number): string {
  if (count === 0) return "first download. you're the pioneer.";
  if (count === 1) return "downloaded once before. you're second.";
  if (count === 69) return "nice.";
  if (count === 420) return "blaze it.";
  if (count === 1337) return "l33t downloads achieved.";
  if (count > 100) return `downloaded ${count} times. this file is famous.`;
  if (count > 10) return `downloaded ${count} times. popular file.`;
  return `downloaded ${count} time${count !== 1 ? "s" : ""}.`;
}

export function PublicDownload({ shareId, onClose }: Props) {
  const [share, setShare] = useState<CloudShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [title] = useState(getShareTitle);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [unlockedPw, setUnlockedPw] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const info = await getPublicShareInfo(shareId);
        setShare(info);
      } catch (err) {
        setError(err instanceof Error ? err.message : "share not found");
      } finally {
        setLoading(false);
      }
    })();
  }, [shareId]);

  const handleCopyLink = useCallback(() => {
    const url = `${window.location.origin}/d/${shareId}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [shareId]);

  const handleUnlock = useCallback(async () => {
    if (!pwInput.trim()) return;
    setPwError(null);
    try {
      // HEAD + redirect:manual — success = opaqueredirect (status 0), wrong pw = 403
      const res = await fetch(getShareDownloadUrl(shareId, pwInput), { method: "HEAD", redirect: "manual" });
      if (res.type === "opaqueredirect" || res.status === 0) {
        // Server responded with 302 redirect → password correct
        setUnlocked(true);
        setUnlockedPw(pwInput);
      } else if (res.status === 403) {
        setPwError("wrong password. try again or ask the owner.");
      } else {
        setPwError("something went wrong. try again.");
      }
    } catch {
      setPwError("network error. try again.");
    }
  }, [shareId, pwInput]);

  const wrap = (content: React.ReactNode) => (
    <div className="pu-page">
      <div className="pu-scanlines" />
      <div className="pu-vignette" />
      <div className="pu-content">
        <LogoHeader />
        <div className="pu-card-wrap">{content}</div>
      </div>
    </div>
  );

  if (loading) {
    return wrap(
      <div className="pu-card screen-flicker">
        <div className="pu-card-grid" />
        <div className="pu-card-glow" />
        <div className="pu-card-body">
          <div className="admin-loading"><span className="spinner" /> loading share...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return wrap(
      <div className="pu-card screen-flicker">
        <div className="pu-card-grid" />
        <div className="pu-card-body">
          <h1 className="pu-title" style={{ color: "var(--error)" }}>not_found</h1>
          <p className="pu-subtitle">{error}</p>
          <button className="btn pu-btn-full" onClick={onClose}>cd /home</button>
        </div>
      </div>
    );
  }

  if (!share) return null;

  if (share.expired) {
    return wrap(
      <div className="pu-card screen-flicker">
        <div className="pu-card-grid" />
        <div className="pu-card-body">
          <h1 className="pu-title" style={{ color: "var(--error)" }}>link_expired</h1>
          <p className="pu-subtitle">this share link is dead. ask the owner for a fresh one.</p>
          <button className="btn pu-btn-full" onClick={onClose}>cd /home</button>
        </div>
      </div>
    );
  }

  const needsPassword = share.has_password && !unlocked;
  const mimeShort = share.mime_type.split("/").pop() ?? "file";

  return wrap(
    <div className="pu-card screen-flicker">
      <div className="pu-card-grid" />
      <div className="pu-card-glow" />
      <div className="pu-card-body">
        <h1 className="pu-title"><span className="pu-prompt">$</span> {title}</h1>

        <div style={{
          display: "flex", alignItems: "center", gap: "12px",
          padding: "12px", margin: "12px 0",
          background: "rgba(var(--accent-rgb, 100,100,100), 0.08)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
        }}>
          <span style={{ fontSize: "32px", lineHeight: 1 }}>{getMimeIcon(share.mime_type)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: "var(--text-primary)", fontWeight: 600,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {share.filename}
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "2px" }}>
              {formatBytes(share.size)} &middot; {mimeShort}
            </div>
          </div>
        </div>

        <div style={{
          display: "flex", justifyContent: "space-between",
          color: "var(--text-muted)", fontSize: "12px",
          padding: "0 4px", marginBottom: "12px",
        }}>
          <span>{getDownloadQuip(share.downloads)}</span>
          <span>expires {new Date(share.expires_at + "Z").toLocaleDateString()}</span>
        </div>

        {needsPassword ? (
          <>
            <div style={{
              color: "var(--text-muted)", fontSize: "12px",
              textAlign: "center", marginBottom: 12,
            }}>
              this file is password-protected. enter the password to unlock.
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input
                type="password"
                placeholder="password"
                value={pwInput}
                onChange={(e) => { setPwInput(e.target.value); setPwError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") void handleUnlock(); }}
                style={{
                  flex: 1, padding: "8px 10px",
                  background: "var(--bg-elevated)", border: "1px solid var(--border-medium)",
                  color: "var(--text-primary)", fontFamily: "inherit", fontSize: "13px",
                  borderRadius: "4px",
                }}
                autoFocus
              />
              <button
                className="btn btn-primary"
                onClick={() => void handleUnlock()}
                disabled={!pwInput.trim()}
              >
                unlock
              </button>
            </div>
            {pwError && (
              <div style={{ color: "var(--error)", fontSize: "12px", textAlign: "center", marginBottom: 8 }}>
                {pwError}
              </div>
            )}
          </>
        ) : (
          <a
            href={getShareDownloadUrl(shareId, unlockedPw || undefined)}
            className="btn btn-primary pu-btn-full"
            target="_blank"
            rel="noopener noreferrer"
          >
            &darr; download
          </a>
        )}
        <button className="btn pu-btn-full" onClick={handleCopyLink} style={{ marginTop: 6 }}>
          {copied ? "copied!" : "copy link"}
        </button>
        <button className="btn pu-btn-full" onClick={onClose} style={{ marginTop: 6, color: "var(--text-muted)" }}>
          cd /home
        </button>
      </div>
    </div>
  );
}
