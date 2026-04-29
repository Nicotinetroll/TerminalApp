import { useState, useEffect, useRef, useCallback } from "react";
import { getPublicTransferInfo, getTransferPresignedUrl, confirmTransferUpload, getTransferDownloadUrl } from "@/lib/api";
import type { Transfer } from "@/lib/api";
import { formatBytes } from "@/apps/cloud/helpers";
import { LogoHeader } from "./LogoHeader";
import JSZip from "jszip";

interface Props {
  transferId: string;
  onClose: () => void;
}

const DEFAULT_MAX_SIZE = 1024 * 1024 * 1024; // 1 GB fallback
const MIN_ZIP_MS = 1500;

interface UploadStats {
  loaded: number;
  total: number;
  percent: number;
  speed: number;
  eta: number;
}

type Phase = "idle" | "zipping" | "uploading" | "confirming" | "complete";

// ── Compress Fragments: scattered blocks assemble into a grid ──

const CF_COLS = 10;
const CF_ROWS = 4;
const CF_TOTAL = CF_COLS * CF_ROWS;

function shuffled(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

function CompressVisual({ progress, files, complete }: { progress: number; files: File[]; complete: boolean }) {
  const [fileIdx, setFileIdx] = useState(0);

  // Stable random scatter positions + fill order (lazy init, never changes)
  const [scatters] = useState(() =>
    Array.from({ length: CF_TOTAL }, () => ({
      x: (Math.random() - 0.5) * 140,
      y: (Math.random() - 0.5) * 100,
      r: (Math.random() - 0.5) * 90,
    }))
  );
  const [fillOrder] = useState(() => shuffled(CF_TOTAL));

  useEffect(() => {
    if (files.length <= 1) return;
    const iv = setInterval(() => setFileIdx(p => (p + 1) % files.length), 700);
    return () => clearInterval(iv);
  }, [files.length]);

  const filledCount = Math.floor((progress / 100) * CF_TOTAL);
  const filledSet = new Set(fillOrder.slice(0, filledCount));
  const cx = (CF_COLS - 1) / 2;
  const cy = (CF_ROWS - 1) / 2;

  return (
    <div className={`cf-wrap${complete ? " cf-done" : ""}`}>
      <div className="cf-grid">
        {Array.from({ length: CF_TOTAL }, (_, i) => {
          const s = scatters[i] ?? { x: 0, y: 0, r: 0 };
          const filled = filledSet.has(i);
          const col = i % CF_COLS;
          const row = Math.floor(i / CF_COLS);
          const dist = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2);
          return (
            <div
              key={i}
              className={`cf-block${filled ? " cf-filled" : ""}${complete ? " cf-complete" : ""}`}
              style={{
                "--sx": `${s.x}px`,
                "--sy": `${s.y}px`,
                "--sr": `${s.r}deg`,
                transitionDelay: complete ? `${Math.round(dist * 45)}ms` : undefined,
              } as React.CSSProperties}
            />
          );
        })}
      </div>

      <div className="cf-bar-track">
        <div className="cf-bar-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="cf-info">
        <span className="cf-label">{complete ? "compressed" : "compressing"}</span>
        <span className="cf-sep">//</span>
        <span className="cf-file">{files[fileIdx]?.name ?? "..."}</span>
        <span className="cf-pct">{progress}%</span>
      </div>
    </div>
  );
}

// ── File thumbnail component ──

function FileThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const objUrl = URL.createObjectURL(file);
    setUrl(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [file]);

  if (file.type.startsWith("image/") && url) {
    return <img src={url} className="pu-file-thumb" alt="" />;
  }
  if (file.type.startsWith("video/")) {
    return <span className="pu-file-icon" title="video">&#127916;</span>;
  }
  return <span className="pu-file-icon">&#9633;</span>;
}

// ── Helpers ──

function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "almost there...";
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s left`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m left`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Download titles — random rotation ──

const DOWNLOAD_TITLES = [
  "your shit is ready",
  "come get your files bitch",
  "files acquired. grab em.",
  "download or regret it forever",
  "somebody left you a package",
  "digital goods, hot & fresh",
  "files.zip is waiting patiently",
  "your data has arrived, peasant",
  "grab this before it expires",
  "incoming transmission received",
  "the files have spoken. download them.",
  "special delivery, no signature needed",
  "your bytes await, your majesty",
  "files so good they zipped themselves",
  "this link won't last forever bro",
  "someone thought of you. how sweet.",
  "certified fresh files, no cap",
  "a wild .zip appeared!",
  "downloading is free, not downloading is cringe",
  "the courier has arrived. tip not required.",
];

function getDownloadTitle(): string {
  return DOWNLOAD_TITLES[Math.floor(Math.random() * DOWNLOAD_TITLES.length)]!;
}

// ── Main Component ──

export function PublicUpload({ transferId, onClose }: Props) {
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [zipProgress, setZipProgress] = useState(0);
  const [zipComplete, setZipComplete] = useState(false);
  const [stats, setStats] = useState<UploadStats | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dlTitle] = useState(getDownloadTitle);
  const [rawMode, setRawMode] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const startTimeRef = useRef(0);
  const cancelledRef = useRef(false);

  // Smooth upload progress via rAF lerp
  const [displayPercent, setDisplayPercent] = useState(0);
  const targetRef = useRef(0);
  const currentRef = useRef(0);
  const rafRef = useRef(0);

  const uploading = phase !== "idle";

  // Auto-toggle raw mode based on file count
  useEffect(() => {
    setRawMode(files.length <= 1);
  }, [files.length]);

  // rAF lerp for upload/confirm phases
  useEffect(() => {
    if (phase !== "uploading" && phase !== "confirming") {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    if (phase === "uploading" && stats) targetRef.current = stats.percent;
    else if (phase === "confirming") targetRef.current = 100;

    const tick = () => {
      const diff = targetRef.current - currentRef.current;
      currentRef.current += diff * 0.06;
      if (Math.abs(diff) < 0.3) currentRef.current = targetRef.current;
      setDisplayPercent(Math.round(currentRef.current));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, stats]);

  // Fetch transfer info
  useEffect(() => {
    void (async () => {
      try {
        const info = await getPublicTransferInfo(transferId);
        setTransfer(info);
      } catch (err) {
        setError(err instanceof Error ? err.message : "transfer not found");
      } finally {
        setLoading(false);
      }
    })();
  }, [transferId]);

  useEffect(() => {
    return () => { xhrRef.current?.abort(); };
  }, []);

  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const maxSize = transfer?.max_size ?? DEFAULT_MAX_SIZE;
  const overLimit = totalSize > maxSize;

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    setFiles(prev => {
      const existing = new Set(prev.map(f => `${f.name}\0${f.size}\0${f.lastModified}`));
      const unique = Array.from(newFiles).filter(f => !existing.has(`${f.name}\0${f.size}\0${f.lastModified}`));
      return [...prev, ...unique];
    });
    setUploadError(null);
  }, []);

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    xhrRef.current?.abort();
    xhrRef.current = null;
    setPhase("idle");
    setStats(null);
    setZipProgress(0);
    setZipComplete(false);
    setDisplayPercent(0);
    currentRef.current = 0;
    targetRef.current = 0;
    setUploadError("aborted.");
  }, []);

  const handleCopyLink = useCallback(() => {
    const url = `${window.location.origin}/t/${transferId}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [transferId]);

  // ── Shared XHR upload helper ──
  const doXhrUpload = (uploadUrl: string, body: Blob | File): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("PUT", uploadUrl);

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const el = (Date.now() - startTimeRef.current) / 1000;
        const speed = el > 0 ? e.loaded / el : 0;
        const remaining = e.total - e.loaded;
        const eta = speed > 0 ? remaining / speed : Infinity;
        setStats({ loaded: e.loaded, total: e.total, percent: Math.round((e.loaded / e.total) * 100), speed, eta });
      };

      xhr.onload = () => {
        xhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          const text = xhr.responseText || "";
          const code = text.match(/<Code>(.*?)<\/Code>/)?.[1];
          const msg = text.match(/<Message>(.*?)<\/Message>/)?.[1];
          reject(new Error(code ? `${code}: ${msg ?? ""}` : `upload failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => { xhrRef.current = null; reject(new Error("network error")); };
      xhr.onabort = () => { xhrRef.current = null; reject(new Error("cancelled")); };
      xhr.send(body);
    });
  };

  const handleUpload = async () => {
    if (files.length === 0 || overLimit || uploading) return;
    cancelledRef.current = false;
    setStats(null);
    setUploadError(null);
    setDisplayPercent(0);
    currentRef.current = 0;
    targetRef.current = 0;

    const useRaw = rawMode && files.length === 1;

    try {
      if (useRaw) {
        // ── RAW MODE: skip zip, upload file directly ──
        const file = files[0]!;
        const contentType = file.type || "application/octet-stream";

        setPhase("uploading");
        startTimeRef.current = Date.now();

        const { uploadUrl } = await getTransferPresignedUrl(transferId, contentType);
        if (cancelledRef.current) return;

        await doXhrUpload(uploadUrl, file);
        if (cancelledRef.current) return;

        // ── CONFIRM ──
        setPhase("confirming");
        await confirmTransferUpload(transferId, [file.name], file.size);

        // ── SUCCESS ──
        setPhase("complete");
        await sleep(1200);
        setTransfer(prev => prev ? {
          ...prev,
          status: "uploaded",
          uploaded_at: new Date().toISOString(),
          original_names: [file.name],
          size: file.size,
          content_type: contentType,
        } : prev);
        setPhase("idle");
      } else {
        // ── ZIP MODE: existing flow ──
        setPhase("zipping");
        setZipComplete(false);
        setZipProgress(0);

        const zipStart = Date.now();
        let zipBlob: Blob | null = null;
        let realZipDone = false;
        let zipError: Error | null = null;

        const zipPromise = (async () => {
          const z = new JSZip();
          for (const f of files) z.file(f.name, f);
          return z.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 5 } });
        })();
        void zipPromise.then(
          b => { zipBlob = b; realZipDone = true; },
          (e: unknown) => { zipError = e instanceof Error ? e : new Error(String(e)); realZipDone = true; }
        );

        // Smooth fake progress
        await new Promise<void>((resolve) => {
          let p = 0;
          const tick = () => {
            if (cancelledRef.current) { resolve(); return; }
            const elapsed = Date.now() - zipStart;
            if (!realZipDone) {
              const t = Math.min(elapsed / MIN_ZIP_MS, 1);
              const target = t * t * (3 - 2 * t) * 88;
              p += (target - p) * 0.08;
            } else {
              p += (100 - p) * 0.12;
            }
            setZipProgress(Math.round(Math.min(p, 100)));
            if (p >= 99.5 && realZipDone && elapsed >= MIN_ZIP_MS) {
              setZipProgress(100);
              resolve();
            } else {
              requestAnimationFrame(tick);
            }
          };
          requestAnimationFrame(tick);
        });

        if (cancelledRef.current) return;
        if (zipError) throw zipError;
        if (!zipBlob) return;
        const blob = zipBlob;

        // ── CELEBRATE ──
        setZipComplete(true);
        const presignPromise = getTransferPresignedUrl(transferId);
        await sleep(900);
        if (cancelledRef.current) return;

        // ── UPLOAD TO S3 ──
        const { uploadUrl } = await presignPromise;
        if (cancelledRef.current) return;

        setPhase("uploading");
        startTimeRef.current = Date.now();
        currentRef.current = 0;
        targetRef.current = 0;
        setDisplayPercent(0);

        await doXhrUpload(uploadUrl, blob);
        if (cancelledRef.current) return;

        // ── CONFIRM ──
        setPhase("confirming");
        await confirmTransferUpload(transferId, files.map(f => f.name), blob.size);

        // ── SUCCESS ──
        setPhase("complete");
        await sleep(1200);
        setTransfer(prev => prev ? {
          ...prev,
          status: "uploaded",
          uploaded_at: new Date().toISOString(),
          original_names: files.map(f => f.name),
          size: blob.size,
        } : prev);
        setPhase("idle");
      }
    } catch (err) {
      if (cancelledRef.current) return;
      setUploadError(err instanceof Error ? err.message : "upload failed");
      setPhase("idle");
      setStats(null);
      setZipProgress(0);
      setZipComplete(false);
    }
  };

  // ── Card wrapper (logo + card, fixed layout) ──
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
          <div className="admin-loading"><span className="spinner" /> loading transfer...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return wrap(
      <div className="pu-card screen-flicker">
        <div className="pu-card-grid" />
        <div className="pu-card-body">
          <h1 className="pu-title" style={{ color: "var(--error)" }}>error</h1>
          <p className="pu-subtitle">{error}</p>
          <button className="btn pu-btn-full" onClick={onClose}>cd /home</button>
        </div>
      </div>
    );
  }

  if (!transfer) return null;

  const isExpired = transfer.status === "expired" || transfer.expired;

  if (isExpired) {
    return wrap(
      <div className="pu-card screen-flicker">
        <div className="pu-card-grid" />
        <div className="pu-card-body">
          <h1 className="pu-title" style={{ color: "var(--error)" }}>link_expired</h1>
          <p className="pu-subtitle">this upload link is dead. ask for a new one.</p>
          <button className="btn pu-btn-full" onClick={onClose}>cd /home</button>
        </div>
      </div>
    );
  }

  // ── Download view (transfer already uploaded — visitor wants to download) ──
  if (transfer.status === "uploaded" && phase === "idle") {
    const names = transfer.original_names ?? [];
    const isRaw = !!transfer.content_type;
    const isImage = isRaw && transfer.content_type!.startsWith("image/");
    const isVideo = isRaw && transfer.content_type!.startsWith("video/");
    const downloadUrl = getTransferDownloadUrl(transferId);

    return wrap(
      <div className="pu-card screen-flicker">
        <div className="pu-card-grid" />
        <div className="pu-card-glow" />
        <div className="pu-card-body">
          <h1 className="pu-title"><span className="pu-prompt">$</span> {dlTitle}</h1>
          <p className="pu-subtitle">
            {isRaw && names[0]
              ? <>{names[0]} &middot; {formatBytes(transfer.size)}</>
              : names.length > 0
                ? `${names.length} file${names.length !== 1 ? "s" : ""} \u00b7 ${formatBytes(transfer.size)}`
                : "files ready for download"}
            {transfer.expires_at && <> &middot; expires {new Date(transfer.expires_at + "Z").toLocaleString()}</>}
          </p>

          {/* Preview for raw images */}
          {isImage && (
            <div className="pu-preview-wrap">
              <img src={downloadUrl} className="pu-preview-img" alt={names[0] ?? "preview"} />
            </div>
          )}

          {/* Preview for raw videos */}
          {isVideo && (
            <div className="pu-preview-wrap">
              <video src={downloadUrl} className="pu-preview-video" controls preload="metadata" />
            </div>
          )}

          {/* File list for zip mode */}
          {!isRaw && names.length > 0 && (
            <div className="pu-filelist" style={{ marginBottom: 16, flex: "none" }}>
              {names.map(name => (
                <div key={name} className="pu-file">
                  <span className="pu-file-icon">&#9633;</span>
                  <span className="pu-file-name">{name}</span>
                </div>
              ))}
            </div>
          )}

          <a href={downloadUrl} className="btn btn-primary pu-btn-full" target="_blank" rel="noopener noreferrer">
            &darr; download{isRaw ? "" : " .zip"}
          </a>
          <button className="btn pu-btn-full" onClick={handleCopyLink} style={{ marginTop: 6 }}>
            {copied ? "copied!" : "copy link"}
          </button>
          <button className="btn pu-btn-full" onClick={onClose} style={{ marginTop: 6, color: "var(--text-muted)" }}>cd /home</button>
        </div>
      </div>
    );
  }

  // ── Upload form ──
  return wrap(
    <div className="pu-card screen-flicker">
      <div className="pu-card-grid" />
      <div className="pu-card-glow" />
      <div className="pu-card-body">

        <h1 className="pu-title">
          <span className="pu-prompt">$</span> file_transfer
        </h1>
        <p className="pu-subtitle">
          max {formatBytes(maxSize)} &middot; expires {new Date(transfer.expires_at + "Z").toLocaleString()}
        </p>

        {/* Hidden file input (outside dropzone to avoid click propagation issues) */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
        />

        {/* Dropzone */}
        {phase === "idle" && (
          <div
            className={`pu-dropzone${dragOver ? " pu-dropzone-active" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="pu-dropzone-arrow">
              <span>&#8593;</span>
              <span>&#8593;</span>
              <span>&#8593;</span>
            </div>
            <div className="pu-dropzone-text">
              {dragOver ? "// drop it like it's hot" : "// drag & drop or click to select"}
            </div>
          </div>
        )}

        {/* File list */}
        {files.length > 0 && phase === "idle" && (
          <div className="pu-filelist">
            {files.map((f, i) => (
              <div key={`${f.name}-${f.size}-${f.lastModified}`} className="pu-file">
                <FileThumb file={f} />
                <span className="pu-file-name">{f.name}</span>
                <span className="pu-file-size">{formatBytes(f.size)}</span>
                <button className="pu-file-rm" onClick={() => removeFile(i)}>&times;</button>
              </div>
            ))}
            <div className="pu-total">
              <span>{files.length} file{files.length !== 1 ? "s" : ""} ready</span>
              <span className={overLimit ? "pu-overlimit" : ""}>{formatBytes(totalSize)} / {formatBytes(maxSize)}</span>
            </div>
          </div>
        )}

        {/* Raw/zip mode toggle — only shown for single file */}
        {files.length === 1 && phase === "idle" && (
          <button
            className="pu-mode-toggle"
            onClick={() => setRawMode(p => !p)}
          >
            {rawMode ? "// upload as .zip instead" : "// upload raw (no zip)"}
          </button>
        )}

        {/* Multi-file note */}
        {files.length > 1 && phase === "idle" && (
          <div className="pu-mode-note">// multiple files &rarr; auto-zipped</div>
        )}

        {/* ── COMPRESS: Fragment assembly ── */}
        {phase === "zipping" && (
          <div className="pu-progress-zone">
            <CompressVisual progress={zipProgress} files={files} complete={zipComplete} />
            <button className="btn pu-btn-full pu-cancel-btn" onClick={handleCancel}>cancel</button>
          </div>
        )}

        {/* ── UPLOAD / CONFIRM ── */}
        {(phase === "uploading" || phase === "confirming") && (
          <div className="pu-progress-zone">
            <div className="pu-percent">{displayPercent}<span className="pu-percent-sign">%</span></div>

            <div className="pu-bar-wrap">
              {phase === "uploading" && !stats ? (
                <div className="pu-bar pu-bar-indeterminate" />
              ) : (
                <>
                  <div className="pu-bar" style={{ width: `${displayPercent}%` }}>
                    <div className="pu-bar-shine" />
                  </div>
                  <div className="pu-bar-glow" style={{ left: `${displayPercent}%` }} />
                </>
              )}
            </div>

            {phase === "uploading" && stats && (
              <div className="pu-stats-row">
                <span>{formatBytes(stats.loaded)} / {formatBytes(stats.total)}</span>
                <span className="pu-speed">{formatSpeed(stats.speed)}</span>
                <span>{formatEta(stats.eta)}</span>
              </div>
            )}

            <div className="pu-phase-label">{phase === "confirming" ? "finalizing..." : "uploading..."}</div>
            <button className="btn pu-btn-full pu-cancel-btn" onClick={handleCancel}>cancel</button>
          </div>
        )}

        {/* ── COMPLETE: Brief success flash (then auto-transitions to download view) ── */}
        {phase === "complete" && (
          <div className="pu-progress-zone pu-success-zone">
            <div className="pu-done-check" style={{ fontSize: 48, marginBottom: 8 }}>&#10003;</div>
            <div style={{ textAlign: "center", color: "var(--success)", fontWeight: 600, fontSize: 14 }}>transfer_complete</div>
          </div>
        )}

        {uploadError && <div className="pu-error">{uploadError}</div>}
        {overLimit && <div className="pu-error">total exceeds {formatBytes(maxSize)}. remove some files.</div>}

        {files.length > 0 && phase === "idle" && (
          <button
            className="btn btn-primary pu-btn-full pu-upload-btn"
            disabled={overLimit}
            onClick={() => void handleUpload()}
          >
            upload{rawMode && files.length === 1 ? "" : " .zip"} &middot; {files.length} file{files.length !== 1 ? "s" : ""} ({formatBytes(totalSize)})
          </button>
        )}
      </div>
    </div>
  );
}
