import { useState, useEffect, useRef } from "react";
import type { HistoryEntry, OutputBlock } from "@/types/terminal";
import { shortenPath } from "@/core/utils";
import { HOSTNAME } from "@/config";

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

function BlockContent({ block }: { block: OutputBlock }) {
  if (block.animated) {
    return <AnimatedText text={block.content} />;
  }
  return <>{block.content}</>;
}

interface Props {
  entries: HistoryEntry[];
  homePath: string;
  username: string;
}

export function TerminalOutput({ entries, homePath, username }: Props) {
  return (
    <>
      {entries.map((entry) => (
        <div key={entry.id} className="mb-3">
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
              className="font-mono whitespace-pre-wrap leading-relaxed"
              style={{
                color: entry.result.isError ? "var(--error)" : "var(--text-secondary)",
              }}
            >
              {entry.result.isError && <span style={{ opacity: 0.5 }}>{"\u2717"} </span>}
              {entry.result.text}
            </div>
          )}

          {entry.result.blocks?.map((block, i) => (
            <div
              key={i}
              className="mt-2 mb-1 overflow-hidden"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
              }}
            >
              <div
                className="px-4 py-1.5 font-semibold uppercase theme-transition"
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
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
