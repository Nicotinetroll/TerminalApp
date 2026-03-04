import { useEffect, useState } from "react";

const LOGO = [
  "███╗   ███╗██╗   ██╗███╗   ██╗██╗ ██████╗  ██████╗  █████╗",
  "████╗ ████║╚██╗ ██╔╝████╗  ██║██║██╔════╝ ██╔════╝ ██╔══██╗",
  "██╔████╔██║ ╚████╔╝ ██╔██╗ ██║██║██║  ███╗██║  ███╗███████║",
  "██║╚██╔╝██║  ╚██╔╝  ██║╚██╗██║██║██║   ██║██║   ██║██╔══██║",
  "██║ ╚═╝ ██║   ██║   ██║ ╚████║██║╚██████╔╝╚██████╔╝██║  ██║",
  "╚═╝     ╚═╝   ╚═╝   ╚═╝  ╚═══╝╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝",
];

interface Props {
  subtitle?: string;
  animate?: boolean;
}

export function LogoHeader({ subtitle, animate = true }: Props) {
  const [visible, setVisible] = useState(!animate);

  useEffect(() => {
    if (animate) {
      const t = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(t);
    }
  }, [animate]);

  return (
    <div className="shrink-0 px-4 pt-4 pb-2 select-none">
      <div
        className={`grid-box ${visible ? "grid-box-animated" : ""}`}
        style={{ opacity: visible ? undefined : 0 }}
      >
        <div className="grid-box-glow">
          <div className="px-8 py-6 overflow-x-auto">
            <div className="min-w-fit">
              {LOGO.map((line, i) => (
                <div
                  key={i}
                  className={`whitespace-pre ${visible ? "logo-line-animated" : ""}`}
                  style={{
                    color: "var(--accent)",
                    fontSize: "clamp(10px, 1.8vw, 14px)",
                    lineHeight: 1.15,
                    textShadow: "0 0 10px var(--accent-mid), 0 0 30px var(--accent-soft)",
                    animationDelay: visible ? `${200 + i * 60}ms` : undefined,
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
            {subtitle && (
              <div
                className="mt-3 flex items-center justify-between logo-line-animated"
                style={{
                  color: "var(--text-muted)",
                  fontSize: "12px",
                  animationDelay: "600ms",
                }}
              >
                <span>{subtitle}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
