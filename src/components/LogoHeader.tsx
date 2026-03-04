import { useMemo } from "react";

const LOGO = [
  "░███     ░███            ░███    ░██ ░██                                 ",
  "░████   ░████            ░████   ░██                                     ",
  "░██░██ ░██░██ ░██    ░██ ░██░██  ░██ ░██ ░████████  ░████████  ░██████   ",
  "░██ ░████ ░██ ░██    ░██ ░██ ░██ ░██ ░██░██    ░██ ░██    ░██       ░██  ",
  "░██  ░██  ░██ ░██    ░██ ░██  ░██░██ ░██░██    ░██ ░██    ░██  ░███████  ",
  "░██       ░██ ░██   ░███ ░██   ░████ ░██░██   ░███ ░██   ░███ ░██   ░██  ",
  "░██       ░██  ░█████░██ ░██    ░███ ░██ ░█████░██  ░█████░██  ░█████░██ ",
  "                     ░██                       ░██        ░██            ",
  "               ░███████                  ░███████   ░███████             ",
];

const ANIM_NAMES = [
  "logo-pulse-a",
  "logo-pulse-b",
  "logo-pulse-c",
  "logo-pulse-d",
  "logo-pulse-e",
];

interface Props {
  subtitle?: string;
}

export function LogoHeader({ subtitle }: Props) {
  const lines = useMemo(() => {
    return LOGO.map((line) =>
      line.split("").map((ch) => {
        if (ch === " ") return { ch, anim: "", delay: 0, duration: 0 };
        return {
          ch,
          anim: ANIM_NAMES[Math.floor(Math.random() * ANIM_NAMES.length)]!,
          delay: Math.random() * 20,
          duration: 5 + Math.random() * 10,
        };
      })
    );
  }, []);

  return (
    <div className="logo-header select-none">
      <div className="logo-art">
        {lines.map((chars, row) => (
          <div key={row} className="whitespace-pre">
            {chars.map((c, col) => {
              if (c.ch === " ") return " ";
              return (
                <span
                  key={col}
                  className="logo-char"
                  style={{
                    animationName: c.anim,
                    animationDelay: `${c.delay}s`,
                    animationDuration: `${c.duration}s`,
                  }}
                >
                  {c.ch}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="logo-text-mobile glow-text">MyNigga</div>
      {subtitle && (
        <div className="logo-subtitle">{subtitle}</div>
      )}
    </div>
  );
}
