import { useState, useEffect, useRef } from "react";
import { HighlightedCode } from "@/components/HighlightedCode";
import { AnalysisPanel } from "@/apps/paste/AnalysisPanel";

interface PasteData {
  id: string;
  username: string;
  title: string;
  content: string;
  language: string;
  expires_at: string | null;
  created_at: string;
  time_ago: string;
}

interface Props {
  pasteId: string;
  onClose: () => void;
}

const API_BASE = import.meta.env["VITE_API_URL"] as string || "/api";

export function PasteViewer({ pasteId, onClose }: Props) {
  const [paste, setPaste] = useState<PasteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const analysisRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/pastes/${encodeURIComponent(pasteId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "paste not found");
        }
        return res.json() as Promise<{ paste: PasteData }>;
      })
      .then((data) => setPaste(data.paste))
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load paste"))
      .finally(() => setLoading(false));
  }, [pasteId]);

  useEffect(() => {
    if (showAnalysis && analysisRef.current) {
      analysisRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showAnalysis]);

  const copyContent = () => {
    if (!paste) return;
    void navigator.clipboard.writeText(paste.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="paste-viewer-page">
      <div className="paste-viewer-header">
        <div className="paste-viewer-brand" onClick={onClose}>
          mynig.ga/paste
        </div>
        {paste && (
          <div className="paste-viewer-info">
            <span className="paste-viewer-title">{paste.title}</span>
            <span className="paste-viewer-meta">
              by {paste.username} · {paste.time_ago} · {paste.language}
            </span>
          </div>
        )}
        <div className="paste-viewer-actions">
          {paste && (
            <>
              <button className="paste-viewer-btn" onClick={copyContent}>
                {copied ? "copied!" : "copy"}
              </button>
              <button
                className="paste-viewer-btn paste-viewer-btn-cta"
                onClick={() => setShowAnalysis(s => !s)}
              >
                {showAnalysis ? "hide analysis" : "analyze"}
              </button>
            </>
          )}
          <button className="paste-viewer-btn" onClick={onClose}>
            go to terminal →
          </button>
        </div>
      </div>

      <div className="paste-viewer-body">
        {loading && (
          <div className="paste-viewer-status">loading paste...</div>
        )}
        {error && (
          <div className="paste-viewer-status paste-viewer-error">{error}</div>
        )}
        {paste && (
          <>
            <HighlightedCode
              code={paste.content}
              language={paste.language}
              className="paste-viewer-code"
            />
            {showAnalysis && (
              <div className="paste-viewer-analysis-wrap" ref={analysisRef}>
                <AnalysisPanel
                  code={paste.content}
                  language={paste.language}
                  onClose={() => setShowAnalysis(false)}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
