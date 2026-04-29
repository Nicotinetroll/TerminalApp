import { useState, useEffect, useMemo } from "react";

const LOGO_LINES = [
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

const PULSE_ANIMS = [
  "logo-pulse-a", "logo-pulse-b", "logo-pulse-c",
  "logo-pulse-d", "logo-pulse-e",
];

interface Props {
  success?: boolean;
}

export function AuthLogo({ success }: Props) {
  const [glitch, setGlitch] = useState(false);

  const chars = useMemo(() =>
    LOGO_LINES.map(line =>
      line.split("").map(ch => {
        if (ch === " ") return { ch, anim: "", delay: 0, duration: 0 };
        return {
          ch,
          anim: PULSE_ANIMS[Math.floor(Math.random() * PULSE_ANIMS.length)]!,
          delay: Math.random() * 20,
          duration: 5 + Math.random() * 10,
        };
      })
    ), []);

  useEffect(() => {
    const fire = () => {
      setGlitch(true);
      setTimeout(() => setGlitch(false), 150);
    };
    const iv = setInterval(fire, 4000 + Math.random() * 3000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className={`auth-logo${glitch ? " auth-logo-glitch" : ""}${success ? " auth-logo-success" : ""}`}>
      <div className="auth-ascii-art">
        {chars.map((row, r) => (
          <div key={r} className="auth-ascii-row">
            {row.map((c, i) => {
              if (c.ch === " ") return <span key={i}> </span>;
              return (
                <span
                  key={i}
                  className="auth-ascii-char"
                  style={{
                    animationName: c.anim,
                    animationDelay: `${c.delay}s`,
                    animationDuration: `${c.duration}s`,
                  }}
                >{c.ch}</span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="auth-logo-mobile">MyNigga</div>
      <p className="auth-tagline">email, cloud, terminal — all in one hood.</p>
    </div>
  );
}
