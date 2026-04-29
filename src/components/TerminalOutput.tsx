import { useState, useEffect, useRef } from "react";
import type { HistoryEntry, OutputBlock } from "@/types/terminal";
import { shortenPath } from "@/core/utils";
import { HOSTNAME } from "@/config";

// ── Standard typing animation for non-AI blocks ──
function AnimatedText({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayed("");
    setDone(false);

    const interval = setInterval(() => {
      indexRef.current++;
      if (indexRef.current >= text.length) {
        setDisplayed(text);
        setDone(true);
        clearInterval(interval);
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, 18);

    return () => clearInterval(interval);
  }, [text]);

  return (
    <span>
      {displayed}
      {!done && (
        <span
          className="inline-block animate-pulse"
          style={{ color: "var(--accent)", marginLeft: 1 }}
        >
          ▌
        </span>
      )}
    </span>
  );
}

// ── AI response — thinking bars + burst typing ──
const THINK_PHRASES = [
  "processing your bullshit",
  "consulting the void",
  "neurons firing",
  "loading braincells",
  "computing roast",
  "buffering wisdom",
  "asking the shadow realm",
  "hacking the mainframe",
  "downloading opinions",
  "accessing forbidden knowledge",
  "decrypting thoughts",
  "querying the abyss",
];

function AiAnimatedText({ text }: { text: string }) {
  const [phase, setPhase] = useState<"thinking" | "typing" | "done">("thinking");
  const [displayed, setDisplayed] = useState("");
  const [thinkText] = useState(() => THINK_PHRASES[Math.floor(Math.random() * THINK_PHRASES.length)]!);
  const indexRef = useRef(0);

  // Thinking → typing after a brief pause
  useEffect(() => {
    const delay = 600 + Math.random() * 500;
    const timer = setTimeout(() => setPhase("typing"), delay);
    return () => clearTimeout(timer);
  }, []);

  // Burst typing — variable speed, chunks of 1-4 chars
  useEffect(() => {
    if (phase !== "typing") return;
    indexRef.current = 0;
    setDisplayed("");

    let timeout: ReturnType<typeof setTimeout>;
    const tick = () => {
      const chunk = Math.random() < 0.3 ? 1 : Math.random() < 0.6 ? 2 : Math.random() < 0.85 ? 3 : 4;
      indexRef.current = Math.min(indexRef.current + chunk, text.length);
      setDisplayed(text.slice(0, indexRef.current));

      if (indexRef.current >= text.length) {
        setPhase("done");
        return;
      }
      const char = text[indexRef.current - 1];
      const isPunc = char === "." || char === "!" || char === "?" || char === ",";
      const delay = isPunc ? 60 + Math.random() * 80 : 8 + Math.random() * 16;
      timeout = setTimeout(tick, delay);
    };
    timeout = setTimeout(tick, 50);
    return () => clearTimeout(timeout);
  }, [phase, text]);

  if (phase === "thinking") {
    return (
      <div className="ai-think-phase">
        <span className="ai-think-indicator">
          <span className="ai-think-bar" />
          <span className="ai-think-bar" />
          <span className="ai-think-bar" />
          <span className="ai-think-bar" />
          <span className="ai-think-bar" />
        </span>
        <span className="ai-think-text">{thinkText}</span>
      </div>
    );
  }

  return (
    <span className="ai-typed-text">
      {displayed}
      {phase === "typing" && <span className="ai-cursor" />}
    </span>
  );
}

// ── Block rendering ──
function BlockContent({ block }: { block: OutputBlock }) {
  const isAi = block.label === "nigga";
  if (block.animated && isAi) return <AiAnimatedText text={block.content} />;
  if (block.animated) return <AnimatedText text={block.content} />;
  return <>{block.content}</>;
}

interface Props {
  entries: HistoryEntry[];
  homePath: string;
  username: string;
}

export function TerminalOutput({ entries, homePath, username }: Props) {
  const prevLenRef = useRef(0);
  const newStartIdx = prevLenRef.current;

  useEffect(() => {
    prevLenRef.current = entries.length;
  }, [entries.length]);

  return (
    <>
      {entries.map((entry, idx) => {
        const isNew = idx >= newStartIdx;
        const staggerDelay = isNew ? (idx - newStartIdx) * 30 : 0;

        return (
          <div
            key={entry.id}
            className={`mb-3${isNew ? " line-stagger" : ""}`}
            style={isNew ? { animationDelay: `${staggerDelay}ms` } : undefined}
          >
            {entry.command && (
              <div className="font-mono whitespace-pre">
                <span className="prompt-full">
                  <span className="glow-text theme-transition" style={{ color: "var(--accent)" }}>
                    {username}@{HOSTNAME}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>:</span>
                  <span style={{ color: "var(--accent)", opacity: 0.8 }}>
                    {shortenPath(entry.cwd || "/", homePath)}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>$ </span>
                </span>
                <span className="prompt-short">
                  <span style={{ color: "var(--accent)", opacity: 0.8 }}>
                    {shortenPath(entry.cwd || "/", homePath)}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>$ </span>
                </span>
                <span style={{ color: "var(--text-primary)" }}>{entry.command}</span>
              </div>
            )}

            {entry.result.text && (
              <div
                className={`font-mono whitespace-pre-wrap leading-relaxed${entry.result.isError ? " error-shake" : ""}`}
                style={{
                  color: entry.result.isError ? "var(--error)" : "var(--text-secondary)",
                }}
              >
                {entry.result.isError && <span style={{ opacity: 0.5 }}>{"\u2717"} </span>}
                {entry.result.text}
              </div>
            )}

            {entry.result.blocks?.map((block, i) => {
              const isAi = block.label === "nigga";
              return (
                <div
                  key={i}
                  className={`mt-2 mb-1 overflow-hidden${isAi ? " ai-block" : ""}`}
                  style={isAi ? undefined : {
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                  }}
                >
                  {isAi ? (
                    <>
                      <div className="ai-block-glow" />
                      <div className="ai-block-inner">
                        <div className="ai-block-accent" />
                        <div className="ai-block-content">
                          <div className="ai-block-header">
                            <span className="ai-block-sigil">//</span>
                            <span className="ai-block-label" data-text={block.label}>{block.label}</span>
                            <span className="ai-block-tag">AI</span>
                            <span className="ai-block-line" />
                          </div>
                          <div className="ai-block-body">
                            <BlockContent block={block} />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className="px-4 py-2.5 font-semibold uppercase theme-transition"
                        style={{
                          color: "var(--accent)",
                          background: "var(--accent-soft)",
                          letterSpacing: "0.08em",
                          fontSize: "12px",
                          borderBottom: "1px solid var(--border-subtle)",
                        }}
                      >
                        {block.label}
                      </div>
                      <div
                        className="px-4 py-3 font-mono whitespace-pre-wrap"
                        style={{ color: "var(--text-secondary)", lineHeight: 1.8 }}
                      >
                        <BlockContent block={block} />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
