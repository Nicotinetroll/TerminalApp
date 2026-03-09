import { useState, useRef, useEffect } from "react";
import { analyzeCode, ApiError } from "@/lib/api";

interface AnalysisPanelProps {
  code: string;
  language: string;
  onClose: () => void;
}

/** Simple markdown-ish renderer for AI analysis output */
function renderAnalysis(text: string): JSX.Element[] {
  const lines = text.split("\n");
  const elements: JSX.Element[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Code block toggle
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${codeKey++}`} className="paste-analysis-codeblock">
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={i} className="paste-analysis-spacer" />);
      continue;
    }

    // Headers
    if (line.startsWith("## ")) {
      elements.push(<h3 key={i} className="paste-analysis-h2">{formatInline(line.slice(3))}</h3>);
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(<h2 key={i} className="paste-analysis-h1">{formatInline(line.slice(2))}</h2>);
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(<h4 key={i} className="paste-analysis-h3">{formatInline(line.slice(4))}</h4>);
      continue;
    }

    // Bullet points
    if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="paste-analysis-bullet">
          <span className="paste-analysis-bullet-dot">-</span>
          <span>{formatInline(line.slice(2))}</span>
        </div>
      );
      continue;
    }

    // Numbered list
    const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      elements.push(
        <div key={i} className="paste-analysis-bullet">
          <span className="paste-analysis-bullet-dot">{numMatch[1]}.</span>
          <span>{formatInline(numMatch[2]!)}</span>
        </div>
      );
      continue;
    }

    // Regular paragraph
    elements.push(<p key={i} className="paste-analysis-p">{formatInline(line)}</p>);
  }

  // Unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre key={`code-${codeKey}`} className="paste-analysis-codeblock">
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
  }

  return elements;
}

/** Inline formatting: **bold**, `code`, *italic* */
function formatInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  // Match **bold**, `code`, *italic*
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`|\*(.+?)\*)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<code key={key++} className="paste-analysis-inline-code">{match[3]}</code>);
    } else if (match[4]) {
      parts.push(<em key={key++}>{match[4]}</em>);
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return parts;
}

export function AnalysisPanel({ code, language, onClose }: AnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeCode(code, language);
      setAnalysis(result.analysis);
      setHasRun(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "analysis failed. the AI is having a bad day.");
    } finally {
      setLoading(false);
    }
  };

  // Auto-run on first mount
  if (!hasRun && !loading && !error) {
    void runAnalysis();
  }

  // Auto-scroll into view when panel appears or content loads
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loading, analysis]);

  return (
    <div className="paste-analysis" ref={panelRef}>
      <div className="paste-analysis-header">
        <span className="paste-analysis-title">nigga analytika</span>
        <div className="paste-analysis-actions">
          {hasRun && !loading && (
            <button className="btn" onClick={() => void runAnalysis()}>
              run again
            </button>
          )}
          <button className="btn" onClick={onClose}>close</button>
        </div>
      </div>
      <div className="paste-analysis-content">
        {loading && (
          <div className="paste-analysis-loading">
            <span className="spinner" /> looking at your code...
          </div>
        )}
        {error && <div className="paste-analysis-error">{error}</div>}
        {analysis && !loading && (
          <div className="paste-analysis-result">
            {renderAnalysis(analysis)}
          </div>
        )}
      </div>
    </div>
  );
}
