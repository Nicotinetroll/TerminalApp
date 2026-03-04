import { useState, useEffect, useRef, useCallback } from "react";
import { SYSTEM_VERSION } from "@/config";

const BOOT_LINES = [
  "POST check... OK",
  "Memory: 65536 KB OK",
  "Detecting hardware...",
  "  CPU: NigGa Labs vCPU @ 4.2GHz",
  "  GPU: Virtual Terminal Adapter",
  "  NET: lo0 (loopback)",
  "Loading kernel modules......... done",
  "Mounting virtual filesystem... done",
  "Starting shell daemon... done",
  "Initializing display server...",
  "",
];

const LOGO_LINES = [
  "███╗   ███╗██╗   ██╗███╗   ██╗██╗ ██████╗  ██████╗  █████╗",
  "████╗ ████║╚██╗ ██╔╝████╗  ██║██║██╔════╝ ██╔════╝ ██╔══██╗",
  "██╔████╔██║ ╚████╔╝ ██╔██╗ ██║██║██║  ███╗██║  ███╗███████║",
  "██║╚██╔╝██║  ╚██╔╝  ██║╚██╗██║██║██║   ██║██║   ██║██╔══██║",
  "██║ ╚═╝ ██║   ██║   ██║ ╚████║██║╚██████╔╝╚██████╔╝██║  ██║",
  "╚═╝     ╚═╝   ╚═╝   ╚═╝  ╚═══╝╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝",
];

interface Props {
  onComplete: () => void;
}

export function BootScreen({ onComplete }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const [showVersion, setShowVersion] = useState(false);
  const [done, setDone] = useState(false);
  const skipRef = useRef(false);
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const skip = useCallback(() => {
    if (skipRef.current) return;
    skipRef.current = true;
    onComplete();
  }, [onComplete]);

  // single animation sequence — guarded against StrictMode double-mount
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const allLines = [...BOOT_LINES, ...LOGO_LINES];
    let i = 0;

    const showNext = () => {
      if (cancelled || skipRef.current) return;
      if (i >= allLines.length) {
        setShowVersion(true);
        setDone(true);
        setTimeout(() => {
          if (!cancelled && !skipRef.current) onComplete();
        }, 1500);
        return;
      }
      const line = allLines[i]!;
      setLines(prev => [...prev, line]);
      i++;
      const delay = i <= BOOT_LINES.length ? 90 : 80;
      setTimeout(showNext, delay);
    };

    setTimeout(showNext, 300);

    return () => { cancelled = true; };
  }, [onComplete]);

  // auto scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // skip on keypress or click
  useEffect(() => {
    const handler = () => skip();
    window.addEventListener("keydown", handler);
    window.addEventListener("click", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("click", handler);
    };
  }, [skip]);

  return (
    <div className="h-full flex flex-col px-8 py-6 font-mono overflow-hidden select-none">
      <div ref={scrollRef} className="flex-1 overflow-y-auto terminal-scroll">
        {lines.map((line, i) => {
          const isLogo = i >= BOOT_LINES.length && line.includes("█");
          return (
            <div
              key={i}
              className="whitespace-pre leading-relaxed"
              style={{
                color: isLogo ? "var(--accent)" : "var(--text-secondary)",
                textShadow: isLogo ? "0 0 12px var(--accent-mid), 0 0 30px var(--accent-soft)" : undefined,
                fontSize: isLogo ? "clamp(10px, 1.8vw, 14px)" : undefined,
              }}
            >
              {line || "\u00A0"}
            </div>
          );
        })}
        {!done && (
          <span className="cursor-blink inline-block" style={{ color: "var(--accent)" }}>▊</span>
        )}
        {showVersion && (
          <div className="mt-3" style={{ color: "var(--text-muted)" }}>
            v{SYSTEM_VERSION} — press any key to continue
          </div>
        )}
      </div>
    </div>
  );
}
