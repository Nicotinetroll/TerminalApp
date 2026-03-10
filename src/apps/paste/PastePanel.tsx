import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { getMyPastes, createPaste, deletePaste, getPaste, ApiError } from "@/lib/api";
import type { PasteListItem, Paste } from "@/lib/api";
import { HighlightedCode } from "@/components/HighlightedCode";
import { AnalysisPanel } from "./AnalysisPanel";
import { LANGUAGES, detectLanguage } from "@/lib/langDetect";
import { computeDiff } from "@/lib/diff";
import type { DiffLine } from "@/lib/diff";

type View = "list" | "create" | "view";

const EXPIRY_OPTIONS = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "never" },
];

export function PastePanel({ user }: WindowContentProps) {
  const [view, setView] = useState<View>("list");
  const [pastes, setPastes] = useState<PasteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [expiresIn, setExpiresIn] = useState("7d");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [forkParentId, setForkParentId] = useState<string | null>(null);
  const manualLang = useRef(false);

  // View paste
  const [viewPaste, setViewPaste] = useState<Paste | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState<DiffLine[] | null>(null);

  // Analysis
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisCode, setAnalysisCode] = useState("");
  const [analysisLang, setAnalysisLang] = useState("plaintext");

  const isAdmin = user.role === "admin";

  const loadPastes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMyPastes();
      setPastes(data.pastes);
    } catch {
      setError("failed to load pastes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPastes();
  }, [loadPastes]);

  const handleCreate = async () => {
    if (!content.trim() || creating) return;
    setCreating(true);
    setCreateError(null);

    try {
      const result = await createPaste({
        title: title.trim() || undefined,
        content,
        language,
        expires_in: expiresIn,
        parent_id: forkParentId ?? undefined,
      });
      setShareUrl(result.paste.url);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "create failed");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePaste(id);
      setPastes(prev => prev.filter(p => p.id !== id));
    } catch { /* silent */ }
  };

  const openPaste = async (id: string) => {
    setViewLoading(true);
    setView("view");
    setShowDiff(false);
    setDiff(null);
    try {
      const paste = await getPaste(id);
      setViewPaste(paste);
      // Pre-compute diff if has parent
      if (paste.parent) {
        const d = computeDiff(paste.parent.content, paste.content);
        setDiff(d);
      }
    } catch {
      setError("paste not found");
      setView("list");
    } finally {
      setViewLoading(false);
    }
  };

  const startFork = (paste: Paste) => {
    setTitle(`fork of ${paste.title}`);
    setContent(paste.content);
    setLanguage(paste.language);
    setExpiresIn("7d");
    setForkParentId(paste.id);
    manualLang.current = true;
    setCreateError(null);
    setShareUrl(null);
    setView("create");
  };

  const resetCreate = () => {
    setTitle("");
    setContent("");
    setLanguage("plaintext");
    setExpiresIn("7d");
    setCreateError(null);
    setShareUrl(null);
    setForkParentId(null);
    manualLang.current = false;
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    if (!manualLang.current && newContent.length > 20) {
      const detected = detectLanguage(newContent);
      if (detected) setLanguage(detected);
    }
  };

  const handleLanguageChange = (lang: string) => {
    manualLang.current = true;
    setLanguage(lang);
  };

  // ── View: Created paste success ──
  if (view === "create" && shareUrl) {
    return (
      <div className="paste-container">
        <div className="paste-toolbar">
          <button className="btn" onClick={() => { resetCreate(); setView("list"); void loadPastes(); }}>
            ← back
          </button>
        </div>
        <div className="paste-success">
          <div className="paste-success-title">
            {forkParentId ? "fork created" : "paste created"}
          </div>
          <div className="paste-success-url">
            <input
              className="paste-input"
              readOnly
              value={shareUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className="btn btn-primary" onClick={() => copyToClipboard(shareUrl)}>
              copy
            </button>
          </div>
          <div className="paste-success-hint">
            anyone with this link can view your paste — no login required
          </div>
          <button
            className="btn"
            onClick={() => { resetCreate(); }}
            style={{ marginTop: 12 }}
          >create another</button>
        </div>
      </div>
    );
  }

  // ── View: Create paste form ──
  if (view === "create") {
    return (
      <div className="paste-container">
        <div className="paste-toolbar">
          <button className="btn" onClick={() => { resetCreate(); setView("list"); }}>
            ← back
          </button>
          <span className="paste-toolbar-title">
            {forkParentId ? "fork paste" : "new paste"}
          </span>
        </div>

        <div className="paste-form">
          <div className="paste-form-row">
            <input
              className="paste-input"
              placeholder="title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="paste-form-row paste-form-options">
            <select
              className="paste-select"
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
            >
              {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <select
              className="paste-select"
              value={expiresIn}
              onChange={(e) => setExpiresIn(e.target.value)}
            >
              {EXPIRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <textarea
            className="paste-textarea"
            placeholder={forkParentId ? "edit the forked code..." : "paste your code here..."}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            spellCheck={false}
            autoFocus
          />

          {createError && <div className="paste-error">{createError}</div>}

          <div className="paste-form-actions">
            <span className="paste-char-count">{content.length.toLocaleString()} chars</span>
            <button
              className="btn btn-analyze"
              onClick={() => {
                if (!content.trim()) return;
                setAnalysisCode(content);
                setAnalysisLang(language);
                setShowAnalysis(true);
              }}
              disabled={!content.trim()}
            >analyze</button>
            <button
              className="btn btn-primary"
              onClick={() => void handleCreate()}
              disabled={!content.trim() || creating}
            >{creating ? "creating..." : forkParentId ? "create fork" : "create paste"}</button>
          </div>
        </div>

        {showAnalysis && (
          <AnalysisPanel
            code={analysisCode}
            language={analysisLang}
            onClose={() => setShowAnalysis(false)}
          />
        )}
      </div>
    );
  }

  // ── View: Paste detail ──
  if (view === "view") {
    const hasDiff = viewPaste?.parent && diff;
    return (
      <div className="paste-container">
        <div className="paste-toolbar">
          <button className="btn" onClick={() => { setViewPaste(null); setShowDiff(false); setDiff(null); setView("list"); }}>
            ← back
          </button>
          {viewPaste && (
            <>
              <span className="paste-toolbar-title">{viewPaste.title}</span>
              <div className="paste-toolbar-right">
                <span className="paste-meta-lang">{viewPaste.language}</span>
                <button className="btn" onClick={() => copyToClipboard(viewPaste.content)}>
                  copy
                </button>
                <button className="btn" onClick={() => copyToClipboard(`https://mynig.ga/paste/${viewPaste.id}`)}>
                  share
                </button>
                <button className="btn" onClick={() => startFork(viewPaste)}>
                  fork
                </button>
                {hasDiff && (
                  <button
                    className={`btn${showDiff ? " btn-active" : ""}`}
                    onClick={() => setShowDiff(s => !s)}
                  >
                    {showDiff ? "code" : "diff"}
                  </button>
                )}
                <button
                  className="btn btn-analyze"
                  onClick={() => {
                    setAnalysisCode(viewPaste.content);
                    setAnalysisLang(viewPaste.language);
                    setShowAnalysis(true);
                  }}
                >analyze</button>
              </div>
            </>
          )}
        </div>
        {viewLoading ? (
          <div className="paste-loading"><span className="spinner" /> loading paste...</div>
        ) : viewPaste ? (
          <div className="paste-view">
            <div className="paste-view-meta">
              by {viewPaste.username} · {viewPaste.time_ago}
              {viewPaste.expires_at && ` · expires ${new Date(viewPaste.expires_at + 'Z').toLocaleDateString()}`}
              {viewPaste.parent_id && ` · forked from ${viewPaste.parent?.title ?? viewPaste.parent_id}`}
            </div>
            {showDiff && diff ? (
              <PasteDiffView diff={diff} />
            ) : (
              <HighlightedCode code={viewPaste.content} language={viewPaste.language} className="paste-code" />
            )}
            {showAnalysis && (
              <AnalysisPanel
                code={analysisCode}
                language={analysisLang}
                onClose={() => setShowAnalysis(false)}
              />
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // ── View: List ──
  return (
    <div className="paste-container">
      <div className="paste-toolbar">
        <span className="paste-toolbar-title">my pastes</span>
        <button className="btn btn-primary" onClick={() => setView("create")}>
          + new paste
        </button>
      </div>

      {error && <div className="paste-error">{error}</div>}

      {loading ? (
        <div className="paste-loading"><span className="spinner" /> loading pastes...</div>
      ) : pastes.length === 0 ? (
        <div className="paste-empty">
          no pastes yet. create one and share some code.
        </div>
      ) : (
        <div className="paste-list">
          {pastes.map(p => (
            <div key={p.id} className="paste-list-item" onClick={() => void openPaste(p.id)}>
              <div className="paste-list-title">{p.title}</div>
              <div className="paste-list-meta">
                <span className="paste-meta-lang">{p.language}</span>
                <span>{p.time_ago}</span>
                {p.expires_at && <span>expires {new Date(p.expires_at + 'Z').toLocaleDateString()}</span>}
              </div>
              <div className="paste-list-actions">
                <button
                  className="btn"
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(`https://mynig.ga/paste/${p.id}`); }}
                >share</button>
                {isAdmin && (
                  <button
                    className="btn"
                    onClick={(e) => { e.stopPropagation(); void handleDelete(p.id); }}
                    style={{ color: "#ef4444" }}
                  >delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PasteDiffView({ diff }: { diff: DiffLine[] }) {
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
