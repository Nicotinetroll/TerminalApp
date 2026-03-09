import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { getMemes, voteMeme, deleteMeme, uploadMeme } from "@/lib/api";
import { MemeCard } from "./MemeCard";
import type { MemeData } from "./MemeCard";

type Sort = "hot" | "top" | "new";

export function MemesPanel({ user }: WindowContentProps) {
  const [sort, setSort] = useState<Sort>("hot");
  const [memes, setMemes] = useState<MemeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Sentinel for infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Drag & drop
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const isGuest = user.role === "guest" || user.role === "code";
  const isAdmin = user.role === "admin";

  const loadMemes = useCallback(async (p: number, sortBy: Sort, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await getMemes(sortBy, p);
      if (append) {
        setMemes(prev => [...prev, ...data.memes]);
      } else {
        setMemes(data.memes);
      }
      setHasMore(data.has_more);
      setPage(p);
    } catch {
      setError("failed to load memes");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadMemes(1, sort, false);
  }, [sort, loadMemes]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting && hasMore && !loadingMore && !loading) {
          void loadMemes(page + 1, sort, true);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, page, sort, loadMemes]);

  const handleVote = async (memeId: number, value: 1 | -1) => {
    const result = await voteMeme(memeId, value);
    setMemes(prev =>
      prev.map(m => m.id === memeId ? { ...m, score: result.score, my_vote: result.my_vote } : m)
    );
  };

  const handleDelete = async (memeId: number) => {
    await deleteMeme(memeId);
    setMemes(prev => prev.filter(m => m.id !== memeId));
  };

  // Upload handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) selectFile(file);
  };

  const handleUpload = async () => {
    if (!uploadFile || uploading) return;
    setUploading(true);
    setUploadError(null);

    try {
      const result = await uploadMeme(uploadFile);
      // Add new meme at top if sorted by new
      const newMeme: MemeData = {
        ...result.meme,
        time_ago: "just now",
        created_at: new Date().toISOString(),
      };
      setMemes(prev => [newMeme, ...prev]);
      closeUpload();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  };

  const closeUpload = () => {
    setShowUpload(false);
    setUploadFile(null);
    setUploadPreview(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  const selectFile = (file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError("images only bitch — jpeg, png, gif, webp");
      setShowUpload(true);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("max 10MB. compress that shit.");
      setShowUpload(true);
      return;
    }
    setUploadFile(file);
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = () => setUploadPreview(reader.result as string);
    reader.readAsDataURL(file);
    setShowUpload(true);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    dragCounter.current = 0;
    if (isGuest) return;
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  };

  const changeSort = (s: Sort) => {
    if (s === sort) return;
    setSort(s);
    setPage(1);
    setMemes([]);
  };

  return (
    <div
      className="meme-container"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      <div className="meme-toolbar">
        <div className="meme-sort">
          {(["hot", "top", "new"] as Sort[]).map(s => (
            <button
              key={s}
              className={`meme-sort-btn ${sort === s ? "active" : ""}`}
              onClick={() => changeSort(s)}
            >{s}</button>
          ))}
        </div>
        {!isGuest && (
          <button
            className="btn btn-primary meme-upload-btn"
            onClick={() => setShowUpload(true)}
          >+ upload</button>
        )}
      </div>

      {/* Error */}
      {error && <div className="meme-error">{error}</div>}

      {/* Loading */}
      {loading && (
        <div className="meme-loading">
          <span className="spinner" /> loading memes...
        </div>
      )}

      {/* Empty state */}
      {!loading && memes.length === 0 && !error && (
        <div className="meme-empty">no memes? what is this, linkedin?</div>
      )}

      {/* Grid */}
      {!loading && memes.length > 0 && (
        <div className="meme-grid">
          {memes.map(meme => (
            <MemeCard
              key={meme.id}
              meme={meme}
              currentUsername={user.username}
              isAdmin={isAdmin}
              isGuest={isGuest}
              onVote={handleVote}
              onDelete={handleDelete}
              onLightbox={setLightboxSrc}
            />
          ))}
        </div>
      )}

      {/* Sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />
      {loadingMore && (
        <div className="meme-loading" style={{ padding: "12px 0" }}>
          <span className="spinner" /> loading more...
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="meme-upload-backdrop" onClick={closeUpload}>
          <div className="meme-upload-modal" onClick={e => e.stopPropagation()}>
            <div className="meme-upload-header">
              <span>upload meme</span>
              <button className="meme-upload-close" onClick={closeUpload}>×</button>
            </div>

            {!uploadPreview ? (
              <div
                className="meme-upload-dropzone"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="meme-upload-dropzone-text">
                  click to select image<br />
                  <span style={{ fontSize: 11, opacity: 0.6 }}>jpeg, png, gif, webp — max 10MB</span>
                </div>
              </div>
            ) : (
              <div className="meme-upload-preview-wrap">
                <img src={uploadPreview} alt="preview" className="meme-upload-preview" />
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              style={{ display: "none" }}
              onChange={handleFileSelect}
            />

            {uploadError && <div className="meme-upload-error">{uploadError}</div>}

            <div className="meme-upload-actions">
              {uploadPreview && (
                <button
                  className="btn"
                  onClick={() => {
                    setUploadFile(null);
                    setUploadPreview(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >change</button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => void handleUpload()}
                disabled={!uploadFile || uploading}
              >{uploading ? "uploading..." : "post it"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Drag overlay */}
      {dragging && !isGuest && (
        <div className="meme-drop-overlay">
          <div className="meme-drop-text">drop that meme</div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxSrc && (
        <div className="meme-lightbox" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="meme fullscreen" className="meme-lightbox-img" />
          <button className="meme-lightbox-close" onClick={() => setLightboxSrc(null)}>×</button>
        </div>
      )}
    </div>
  );
}
