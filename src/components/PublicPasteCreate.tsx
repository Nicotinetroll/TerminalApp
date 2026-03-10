import { useState, useEffect, useRef } from "react";
import { createPublicPaste, getPublicPaste, ApiError } from "@/lib/api";
import { LANGUAGES, detectLanguage } from "@/lib/langDetect";
import { AnalysisPanel } from "@/apps/paste/AnalysisPanel";

interface Props {
  forkId: string | null;
  onClose: () => void;
  onViewPaste: (id: string) => void;
}

export function PublicPasteCreate({ forkId, onClose, onViewPaste }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [forkLoading, setForkLoading] = useState(false);
  const [forkTitle, setForkTitle] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const manualLang = useRef(false);
  const analysisRef = useRef<HTMLDivElement>(null);

  // Load parent paste for forking
  useEffect(() => {
    if (!forkId) return;
    setForkLoading(true);
    getPublicPaste(forkId)
      .then((paste) => {
        setContent(paste.content);
        setLanguage(paste.language);
        setTitle(`fork of ${paste.title}`);
        setForkTitle(paste.title);
        manualLang.current = true;
      })
      .catch(() => setError("couldn't load the paste you're trying to fork. it probably expired."))
      .finally(() => setForkLoading(false));
  }, [forkId]);

  useEffect(() => {
    if (showAnalysis && analysisRef.current) {
      analysisRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showAnalysis]);

  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    if (!manualLang.current && newContent.length > 20) {
      const detected = detectLanguage(newContent);
      if (detected) setLanguage(detected);
    }
  };

  const handleCreate = async () => {
    if (!content.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createPublicPaste({
        title: title.trim() || undefined,
        content,
        language,
        parent_id: forkId ?? undefined,
      });
      setShareUrl(result.paste.url);
      setShareId(result.paste.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "create failed. try again.");
    } finally {
      setCreating(false);
    }
  };

  // Success view
  if (shareUrl && shareId) {
    return (
      <div className="paste-viewer-page">
        <div className="paste-viewer-header">
          <div className="paste-viewer-brand" onClick={onClose}>
            mynig.ga/paste
          </div>
          <div className="paste-viewer-actions">
            <button className="paste-viewer-btn" onClick={onClose}>
              go to terminal →
            </button>
          </div>
        </div>
        <div className="paste-viewer-body">
          <div className="paste-public-success">
            <div className="paste-public-success-icon">✓</div>
            <div className="paste-public-success-title">
              {forkId ? "fork created" : "paste created"}
            </div>
            <div className="paste-public-success-note">
              expires in 6 hours · no account needed
            </div>
            <div className="paste-public-success-url">
              <input
                readOnly
                value={shareUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button onClick={() => void navigator.clipboard.writeText(shareUrl)}>
                copy
              </button>
            </div>
            <div className="paste-public-success-actions">
              <button onClick={() => onViewPaste(shareId)}>
                view paste →
              </button>
              <button onClick={() => {
                setShareUrl(null);
                setShareId(null);
                setTitle("");
                setContent("");
                setLanguage("plaintext");
                setError(null);
                manualLang.current = false;
              }}>
                create another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="paste-viewer-page">
      <div className="paste-viewer-header">
        <div className="paste-viewer-brand" onClick={onClose}>
          mynig.ga/paste
        </div>
        <div className="paste-viewer-info">
          <span className="paste-viewer-title">
            {forkId ? `forking: ${forkTitle ?? forkId}` : "new paste"}
          </span>
          <span className="paste-viewer-meta">
            anonymous · expires in 6 hours · max 10 per day
          </span>
        </div>
        <div className="paste-viewer-actions">
          <button className="paste-viewer-btn" onClick={onClose}>
            go to terminal →
          </button>
        </div>
      </div>

      <div className="paste-viewer-body">
        {forkLoading ? (
          <div className="paste-viewer-status">loading paste to fork...</div>
        ) : (
          <div className="paste-public-form">
            <div className="paste-public-row">
              <input
                className="paste-public-input"
                placeholder="title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
              />
              <select
                className="paste-public-select"
                value={language}
                onChange={(e) => { manualLang.current = true; setLanguage(e.target.value); }}
              >
                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <textarea
              className="paste-public-textarea"
              placeholder={forkId ? "edit the forked code..." : "paste your code here..."}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              spellCheck={false}
              autoFocus
            />

            {error && <div className="paste-public-error">{error}</div>}

            <div className="paste-public-footer">
              <span className="paste-public-chars">
                {content.length.toLocaleString()} chars
              </span>
              <button
                className="paste-public-btn"
                onClick={() => {
                  if (!content.trim()) return;
                  setShowAnalysis(true);
                }}
                disabled={!content.trim()}
              >
                analyze
              </button>
              <button
                className="paste-public-btn paste-public-btn-primary"
                onClick={() => void handleCreate()}
                disabled={!content.trim() || creating}
              >
                {creating ? "creating..." : forkId ? "create fork" : "create paste"}
              </button>
            </div>

            {showAnalysis && (
              <div ref={analysisRef}>
                <AnalysisPanel
                  code={content}
                  language={language}
                  onClose={() => setShowAnalysis(false)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
