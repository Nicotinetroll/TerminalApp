import { useState, useCallback, useRef, useEffect } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { getMediaInfo, getToken } from "@/lib/api";
import type { MediaInfo } from "@/lib/api";

type View = "input" | "fetching" | "preview" | "downloading" | "done" | "error";
type DlPhase = "fetch" | "download" | "convert";

const API_BASE = import.meta.env["VITE_API_URL"] as string || "/api";

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "youtube",
  instagram: "instagram",
  tiktok: "tiktok",
  twitter: "twitter/x",
  soundcloud: "soundcloud",
  reddit: "reddit",
  facebook: "facebook",
  twitch: "twitch",
  vimeo: "vimeo",
  other: "other",
};

const FETCH_MSGS = [
  "asking the internet nicely...",
  "resolving stream metadata...",
  "parsing media formats...",
  "interrogating their servers...",
  "handshake in progress...",
  "yt-dlp doing its thing...",
];

const DL_MSGS = [
  "server is doing its thing...",
  "extracting pixels from the void...",
  "negotiating with their servers...",
  "downloading at the speed of meh...",
  "bytes are flowing. slowly.",
  "converting your regrets into files...",
  "almost there... probably...",
  "hold tight. or don't. idc.",
  "stealing content legally...",
  "ripping bits from the cloud...",
];

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function RotatingMsg({ msgs }: { msgs: readonly string[] }) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * msgs.length));
  useEffect(() => {
    const iv = setInterval(() => setIdx(i => (i + 1) % msgs.length), 3000);
    return () => clearInterval(iv);
  }, [msgs]);
  return <span className="yt-rotate-msg">{msgs[idx]}</span>;
}

// Scanning line effect for fetching
function ScanGrid({ accent }: { accent?: boolean }) {
  return (
    <div className="yt-scan-grid">
      {Array.from({ length: 24 }, (_, i) => (
        <div key={i} className={`yt-scan-cell${accent ? " yt-scan-accent" : ""}`} style={{ animationDelay: `${i * 40}ms` }} />
      ))}
    </div>
  );
}

export function DownloadPanel(_props: WindowContentProps) {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [format, setFormat] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState("best");
  const [view, setView] = useState<View>("input");
  const [dlPhase, setDlPhase] = useState<DlPhase>("fetch");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when returning to input view
  useEffect(() => {
    if (view === "input") setTimeout(() => inputRef.current?.focus(), 50);
  }, [view]);

  const fetchInfo = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setView("fetching");
    setError("");
    try {
      const data = await getMediaInfo(trimmed);
      setInfo(data);
      setQuality(data.qualities[0] ? String(data.qualities[0]) : "best");
      setView("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to fetch media info");
      setView("error");
    }
  }, [url]);

  const startDownload = useCallback(() => {
    if (!info) return;
    setView("downloading");
    setDlPhase("fetch");

    const q = format === "audio" ? "best" : quality;
    const params = new URLSearchParams({ url, format, quality: q });
    const token = getToken();
    const downloadUrl = `${API_BASE}/download/download?${params.toString()}`;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const t1 = setTimeout(() => setDlPhase("download"), 2500);
    const t2 = setTimeout(() => setDlPhase("convert"), 18000);

    fetch(downloadUrl, { headers, signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? "download failed");
        }
        return res.blob();
      })
      .then((blob) => {
        clearTimeout(t1);
        clearTimeout(t2);
        setView("done");
        setTimeout(() => {
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          const ext = format === "audio" ? "mp3" : "mp4";
          const safeName = (info.title || "media").replace(/[^a-zA-Z0-9\s\-_().]/g, "").trim();
          a.download = `${safeName}.${ext}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        }, 500);
        setTimeout(() => setView("preview"), 2800);
      })
      .catch((err) => {
        clearTimeout(t1);
        clearTimeout(t2);
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "download failed");
        setView("error");
      });
  }, [info, format, quality, url]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setView(info ? "preview" : "input");
  }, [info]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setUrl("");
    setInfo(null);
    setFormat("video");
    setQuality("best");
    setView("input");
    setError("");
  }, []);

  return (
    <div className="yt-panel">

      {/* INPUT */}
      {view === "input" && (
        <div className="yt-input-view">
          <div className="yt-input-card">
            <div className="yt-input-card-grid" />
            <div className="yt-input-card-glow" />
            <div className="yt-input-card-body">
              <div className="yt-prompt-line">
                <span className="yt-prompt">$</span>
                <span className="yt-prompt-cmd">media_dl</span>
                <span className="yt-cursor" />
              </div>
              <p className="yt-prompt-sub">paste any url. get the goods.</p>

              <div className="yt-field">
                <div className="yt-field-label">target url</div>
                <div className="yt-field-row">
                  <div className="yt-field-prefix">&#8594;</div>
                  <input
                    ref={inputRef}
                    className="yt-url-input"
                    type="text"
                    placeholder="paste any url — youtube, tiktok, instagram, twitter..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void fetchInfo(); }}
                    autoFocus
                    spellCheck={false}
                  />
                </div>
              </div>

              <button
                className="btn yt-cta yt-go-btn"
                onClick={() => void fetchInfo()}
                disabled={!url.trim()}
                type="button"
              >
                fetch info
              </button>

              <div className="yt-input-sites">
                youtube &middot; instagram &middot; tiktok &middot; twitter &middot; soundcloud &middot; 1000+ more
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FETCHING */}
      {view === "fetching" && (
        <div className="yt-fetching">
          <ScanGrid accent />
          <div className="yt-fetch-status">
            <div className="yt-fetch-label">resolving</div>
            <div className="yt-fetch-bar-track">
              <div className="yt-fetch-bar-fill" />
            </div>
            <RotatingMsg msgs={FETCH_MSGS} />
          </div>
        </div>
      )}

      {/* PREVIEW */}
      {view === "preview" && info && (
        <div className="yt-preview">
          {info.thumbnail && (
            <div className="yt-thumb-wrap">
              <img src={info.thumbnail} alt="" className="yt-thumbnail" />
              <div className="yt-thumb-overlay" />
              <div className="yt-thumb-meta">
                <span className="yt-uploader">{info.uploader}</span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className="yt-platform-badge">{PLATFORM_LABELS[info.platform] ?? info.platform}</span>
                  {info.duration > 0 && (
                    <span className="yt-duration">{formatDuration(info.duration)}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {!info.thumbnail && info.platform && (
            <div className="yt-platform-only">
              <span className="yt-platform-badge yt-platform-badge-lg">{PLATFORM_LABELS[info.platform] ?? info.platform}</span>
              {info.duration > 0 && (
                <span className="yt-duration">{formatDuration(info.duration)}</span>
              )}
            </div>
          )}

          <div className="yt-video-title">{info.title}</div>

          <div className="yt-controls">
            <div className="yt-control-group">
              <div className="yt-ctrl-label">format</div>
              <div className="yt-format-toggle">
                <button
                  className={`yt-fmt-btn${format === "video" ? " yt-fmt-active" : ""}`}
                  onClick={() => setFormat("video")}
                  type="button"
                >
                  video
                </button>
                <button
                  className={`yt-fmt-btn${format === "audio" ? " yt-fmt-active" : ""}`}
                  onClick={() => setFormat("audio")}
                  type="button"
                >
                  audio
                </button>
              </div>
            </div>

            {format === "video" && info.hasQualityPicker && (
              <div className="yt-control-group">
                <div className="yt-ctrl-label">quality</div>
                <select
                  className="yt-quality-select"
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                >
                  <option value="best">best</option>
                  {info.qualities.map((q) => (
                    <option key={q} value={String(q)}>{q}p</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="yt-actions">
            <button className="btn yt-cta yt-dl-btn" onClick={startDownload} type="button">
              download .{format === "audio" ? "mp3" : "mp4"}
            </button>
            <button className="btn yt-reset-btn" onClick={reset} type="button">
              new
            </button>
          </div>
        </div>
      )}

      {/* DOWNLOADING */}
      {view === "downloading" && (
        <div className="yt-progress-view">
          <div className="yt-steps">
            {(["fetch", "download", "convert"] as const).map((step, i, arr) => {
              const idx = arr.indexOf(dlPhase);
              const si = i;
              const cls = si < idx ? "done" : si === idx ? "active" : "pending";
              return (
                <div key={step} className="yt-step-row">
                  {i > 0 && <div className={`yt-step-line${cls === "pending" ? "" : " yt-step-line-lit"}`} />}
                  <div className={`yt-step yt-step-${cls}`}>
                    <div className="yt-step-dot" />
                    <span>{step}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="yt-wave">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="yt-wave-bar" style={{ animationDelay: `${i * 0.08}s` }} />
            ))}
          </div>

          <div className="yt-bar-track">
            <div className="yt-bar-fill">
              <div className="yt-bar-shine" />
            </div>
            <div className="yt-bar-glow" />
          </div>

          <div className="yt-dl-info">
            <span className="yt-dl-phase">
              {dlPhase === "fetch" && "fetching stream"}
              {dlPhase === "download" && "downloading"}
              {dlPhase === "convert" && "converting"}
            </span>
            <RotatingMsg msgs={DL_MSGS} />
            {info && <span className="yt-dl-title">{info.title}</span>}
          </div>

          <button className="btn yt-cancel-btn" onClick={cancel} type="button">cancel</button>
        </div>
      )}

      {/* DONE */}
      {view === "done" && (
        <div className="yt-done-view">
          <div className="yt-done-check">&#10003;</div>
          <div className="yt-done-text">download_complete</div>
          <div className="yt-done-sub">check your downloads folder. you're welcome.</div>
        </div>
      )}

      {/* ERROR */}
      {view === "error" && (
        <div className="yt-error-view">
          <div className="yt-error-icon">!</div>
          <div className="yt-error-box">{error}</div>
          <div className="yt-error-actions">
            <button className="btn btn-primary" onClick={() => setView(info ? "preview" : "input")} type="button">
              retry
            </button>
            <button className="btn" onClick={reset} type="button">new url</button>
          </div>
        </div>
      )}
    </div>
  );
}
