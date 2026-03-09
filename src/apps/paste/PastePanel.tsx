import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { getMyPastes, createPaste, deletePaste, getPaste, ApiError } from "@/lib/api";
import type { PasteListItem, Paste } from "@/lib/api";
import { HighlightedCode } from "@/components/HighlightedCode";
import { AnalysisPanel } from "./AnalysisPanel";

type View = "list" | "create" | "view";

const LANGUAGES = [
  "plaintext", "javascript", "typescript", "python", "html", "css",
  "json", "sql", "bash", "go", "rust", "c", "cpp", "csharp", "java",
  "php", "ruby", "kotlin", "swift", "dart", "lua", "perl",
  "powershell", "r", "scala", "haskell", "elixir", "clojure",
  "dockerfile", "graphql", "toml", "ini", "yaml", "markdown", "xml",
  "jsx", "tsx",
];

/* ── Language auto-detection ─────────────────────────────────────── */

interface LangPattern {
  lang: string;
  patterns: RegExp[];
  weight?: number;
}

const LANG_RULES: LangPattern[] = [
  // Strong structural matches first
  { lang: "html",       patterns: [/<!DOCTYPE\s+html/i, /<html[\s>]/i, /<\/(?:div|span|body|head)>/i] },
  { lang: "jsx",        patterns: [/import\s+React/,  /from\s+['"]react['"]/,  /export\s+(?:default\s+)?function\s+\w+.*\breturn\s*\(/s], weight: 3 },
  { lang: "tsx",        patterns: [/import\s+.*from\s+['"]react['"]/, /:\s*React\.FC/, /interface\s+\w+Props/], weight: 3 },
  { lang: "dockerfile", patterns: [/^FROM\s+\S+/m, /^RUN\s+/m, /^COPY\s+/m, /^ENTRYPOINT\s+/m] },
  { lang: "graphql",    patterns: [/^(?:query|mutation|subscription|type|input|enum|schema)\s+\w+/m, /{\s*\w+\s*(?:\(.*?\))?\s*{/] },
  { lang: "yaml",       patterns: [/^---\s*$/m, /^\w[\w-]*:\s+/m], weight: 1 },
  { lang: "toml",       patterns: [/^\[[\w.-]+\]\s*$/m, /^\w+\s*=\s*["'\[{]/m] },
  { lang: "ini",        patterns: [/^\[[\w\s]+\]\s*$/m, /^\w+\s*=\s*\S/m], weight: 1 },
  { lang: "json",       patterns: [/^\s*[{\[]/m, /"\w+":\s*["\d\[{ntf]/], weight: 1 },
  { lang: "markdown",   patterns: [/^#{1,6}\s+\S/m, /^\*\*\w.*\*\*/m, /\[.+\]\(.+\)/] },
  { lang: "sql",        patterns: [/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i, /\bFROM\s+\w+/i, /\bWHERE\s+\w+/i] },
  { lang: "xml",        patterns: [/<\?xml\s/i, /<\/[\w:-]+>/, /<[\w:-]+\s+[\w:-]+=/] },

  // Languages with distinctive keywords
  { lang: "typescript", patterns: [/:\s*(?:string|number|boolean|void|any|unknown|never)\b/, /interface\s+\w+\s*{/, /type\s+\w+\s*=/, /as\s+(?:string|number|boolean|any)\b/], weight: 3 },
  { lang: "csharp",     patterns: [/\busing\s+System/, /\bnamespace\s+\w+/, /\bclass\s+\w+\s*:\s*\w+/, /\b(?:public|private|protected|internal)\s+(?:static\s+)?(?:void|int|string|bool|async\s+Task)/], weight: 3 },
  { lang: "kotlin",     patterns: [/\bfun\s+\w+\(/, /\bval\s+\w+\s*[:=]/, /\bvar\s+\w+\s*[:=]/, /\bdata\s+class\b/], weight: 3 },
  { lang: "swift",      patterns: [/\bfunc\s+\w+\(/, /\blet\s+\w+\s*[:=]/, /\bvar\s+\w+\s*:\s*\w+/, /\bguard\s+let\b/, /\bimport\s+(?:UIKit|Foundation|SwiftUI)\b/], weight: 3 },
  { lang: "dart",       patterns: [/\bimport\s+['"]package:/, /\bvoid\s+main\(\)/, /\bWidget\s+build\(/, /\b(?:StatelessWidget|StatefulWidget)\b/], weight: 3 },
  { lang: "rust",       patterns: [/\bfn\s+\w+\(/, /\blet\s+mut\s+/, /\bimpl\s+\w+/, /\b(?:pub\s+)?(?:struct|enum|trait)\s+\w+/, /::(?:new|from)\(/], weight: 3 },
  { lang: "go",         patterns: [/\bfunc\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+\(/, /\bpackage\s+\w+/, /\bimport\s+\(/, /:=\s*/], weight: 3 },
  { lang: "python",     patterns: [/\bdef\s+\w+\(/, /\bimport\s+\w+/, /\bfrom\s+\w+\s+import\b/, /\bclass\s+\w+.*:$/m, /\bif\s+__name__\s*==\s*['"]__main__['"]/], weight: 2 },
  { lang: "java",       patterns: [/\bpublic\s+class\s+\w+/, /\bpublic\s+static\s+void\s+main\(/, /\bSystem\.out\.print/, /\bimport\s+java\.\w+/], weight: 2 },
  { lang: "php",        patterns: [/<\?php/, /\$\w+\s*=/, /\bfunction\s+\w+\(.*\$/, /\b(?:echo|var_dump|print_r)\b/], weight: 3 },
  { lang: "ruby",       patterns: [/\bdef\s+\w+/, /\bclass\s+\w+\s*</, /\bdo\s*\|/, /\brequire\s+['"]/, /\bend\s*$/m], weight: 2 },
  { lang: "lua",        patterns: [/\bfunction\s+\w+\(/, /\blocal\s+\w+\s*=/, /\bend\s*$/m, /\bthen\s*$/m], weight: 2 },
  { lang: "perl",       patterns: [/^#!.*perl/m, /\bmy\s+\$/, /\buse\s+strict\b/, /\bsub\s+\w+\s*{/], weight: 3 },
  { lang: "powershell", patterns: [/\$\w+\s*=/, /\bfunction\s+\w+-\w+/, /\bGet-\w+/, /\bSet-\w+/, /\bWrite-(?:Host|Output)\b/], weight: 3 },
  { lang: "r",          patterns: [/\b(?:library|require)\(\w+\)/, /<-\s*(?:function|c)\(/, /\bggplot\(/, /\bdata\.frame\(/], weight: 3 },
  { lang: "scala",      patterns: [/\bdef\s+\w+.*:\s*\w+\s*=/, /\bval\s+\w+:\s*\w+/, /\bobject\s+\w+/, /\bcase\s+class\b/], weight: 3 },
  { lang: "haskell",    patterns: [/\bmodule\s+\w+/, /\bimport\s+(?:qualified\s+)?\w+/, /\b::\s*[\w\[\]()\->]+/, /\bwhere\s*$/m], weight: 3 },
  { lang: "elixir",     patterns: [/\bdefmodule\s+\w+/, /\bdef\s+\w+.*\bdo\b/, /\bdefp?\s+\w+/, /\|>\s*/], weight: 3 },
  { lang: "clojure",    patterns: [/^\s*\(ns\s+/, /\(defn?\s+\w+/, /\(let\s+\[/, /\(def\s+\w+/], weight: 3 },
  { lang: "css",        patterns: [/[.#][\w-]+\s*{/, /@media\s*\(/, /:\s*(?:flex|grid|none|block|inherit)\s*;/, /\b(?:margin|padding|background|color)\s*:/], weight: 2 },

  // JavaScript last (very generic patterns)
  { lang: "javascript", patterns: [/\bconst\s+\w+\s*=/, /\bfunction\s+\w+\(/, /\bconsole\.log\(/, /\bmodule\.exports\b/, /\brequire\(['"]/, /=>\s*{/], weight: 1 },
  { lang: "bash",       patterns: [/^#!/m, /\becho\s+/, /\bfi\s*$/m, /\bif\s+\[\s*/, /\bfor\s+\w+\s+in\b/], weight: 1 },
];

function detectLanguage(code: string): string | null {
  if (!code || code.length < 10) return null;

  const scores: Record<string, number> = {};

  for (const rule of LANG_RULES) {
    let matches = 0;
    for (const p of rule.patterns) {
      if (p.test(code)) matches++;
    }
    if (matches > 0) {
      scores[rule.lang] = (scores[rule.lang] ?? 0) + matches * (rule.weight ?? 2);
    }
  }

  // Need at least 2 score to avoid false positives
  let best: string | null = null;
  let bestScore = 1;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }

  return best;
}

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
  const manualLang = useRef(false);

  // View paste
  const [viewPaste, setViewPaste] = useState<Paste | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

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
    try {
      const paste = await getPaste(id);
      setViewPaste(paste);
    } catch {
      setError("paste not found");
      setView("list");
    } finally {
      setViewLoading(false);
    }
  };

  const resetCreate = () => {
    setTitle("");
    setContent("");
    setLanguage("plaintext");
    setExpiresIn("7d");
    setCreateError(null);
    setShareUrl(null);
    manualLang.current = false;
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    // Auto-detect only if user hasn't manually chosen a language
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
          <div className="paste-success-title">paste created</div>
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
          <span className="paste-toolbar-title">new paste</span>
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
            placeholder="paste your code here..."
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
            >{creating ? "creating..." : "create paste"}</button>
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
    return (
      <div className="paste-container">
        <div className="paste-toolbar">
          <button className="btn" onClick={() => { setViewPaste(null); setView("list"); }}>
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
                <button className="btn" onClick={() => copyToClipboard(`https://mynig.ga/?paste=${viewPaste.id}`)}>
                  share
                </button>
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
            </div>
            <HighlightedCode code={viewPaste.content} language={viewPaste.language} className="paste-code" />
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
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(`https://mynig.ga/?paste=${p.id}`); }}
                >share</button>
                {(isAdmin || true) && (
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
