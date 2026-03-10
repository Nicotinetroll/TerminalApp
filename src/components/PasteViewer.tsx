import { useState, useEffect, useRef } from "react";
import { HighlightedCode } from "@/components/HighlightedCode";
import { AnalysisPanel } from "@/apps/paste/AnalysisPanel";
import { getPublicPaste } from "@/lib/api";
import type { Paste } from "@/lib/api";
import { computeDiff } from "@/lib/diff";
import type { DiffLine } from "@/lib/diff";

interface Props {
  pasteId: string;
  onClose: () => void;
  onFork: (parentId: string) => void;
  onViewPaste: (id: string) => void;
}

export function PasteViewer({ pasteId, onClose, onFork, onViewPaste }: Props) {
  const [paste, setPaste] = useState<Paste | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const analysisRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setShowDiff(false);
    setDiff(null);

    getPublicPaste(pasteId)
      .then((data) => {
        setPaste(data);
        // Pre-compute diff if has parent
        if (data.parent) {
          const d = computeDiff(data.parent.content, data.content);
          setDiff(d);
        }
      })
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

  const hasDiff = paste?.parent && diff;

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
              {paste.parent_id && (
                <>
                  {" · forked from "}
                  <span
                    className="paste-viewer-parent-link"
                    onClick={() => onViewPaste(paste.parent_id!)}
                  >{paste.parent?.title ?? paste.parent_id}</span>
                </>
              )}
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
                className="paste-viewer-btn"
                onClick={() => onFork(paste.id)}
              >
                fork
              </button>
              {hasDiff && (
                <button
                  className={`paste-viewer-btn${showDiff ? " paste-viewer-btn-active" : ""}`}
                  onClick={() => setShowDiff(s => !s)}
                >
                  {showDiff ? "code" : "diff"}
                </button>
              )}
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
            {showDiff && diff ? (
              <DiffView diff={diff} />
            ) : (
              <HighlightedCode
                code={paste.content}
                language={paste.language}
                className="paste-viewer-code"
              />
            )}
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

function DiffView({ diff }: { diff: DiffLine[] }) {
  return (
    <div className="paste-diff">
      <div className="paste-diff-header">
        <span className="paste-diff-stat paste-diff-add">+{diff.filter(l => l.type === "add").length}</span>
        <span className="paste-diff-stat paste-diff-del">-{diff.filter(l => l.type === "del").length}</span>
      </div>
      <div className="paste-diff-lines">
        {diff.map((line, i) => (
          <div key={i} className={`paste-diff-line paste-diff-${line.type}`}>
            <span className="paste-diff-ln paste-diff-ln-old">
              {line.type !== "add" ? line.oldNum : ""}
            </span>
            <span className="paste-diff-ln paste-diff-ln-new">
              {line.type !== "del" ? line.newNum : ""}
            </span>
            <span className="paste-diff-marker">
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
            </span>
            <span className="paste-diff-text">{line.text || "\u00a0"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
