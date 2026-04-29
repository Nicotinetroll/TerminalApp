import { useState, useEffect, useRef } from "react";

const GLYPHS = "█▓▒░╔╗╚╝═║╬┼┤├─│▀▄▌▐◢◣◤◥■□●○◆◇★☆";
const TAIL_GLYPHS = "⣾⣽⣻⢿⡿⣟⣯⣷";

interface Props {
  text: string;
  /** ms per character lock-in (default 55) */
  speed?: number;
  /** initial scramble duration before lock-in starts (default 500ms) */
  delay?: number;
}

export function ScrambleText({ text, speed = 55, delay = 500 }: Props) {
  const [display, setDisplay] = useState("");
  const [tailChar, setTailChar] = useState("");
  const [done, setDone] = useState(false);
  const frameRef = useRef(0);
  const startRef = useRef(0);

  useEffect(() => {
    startRef.current = performance.now();
    let running = true;

    const rng = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
    const rngTail = () => TAIL_GLYPHS[Math.floor(Math.random() * TAIL_GLYPHS.length)]!;

    const tick = (now: number) => {
      if (!running) return;
      const elapsed = now - startRef.current;
      const locked = elapsed > delay
        ? Math.min(text.length, Math.floor((elapsed - delay) / speed))
        : 0;

      let result = "";
      for (let i = 0; i < text.length; i++) {
        if (i < locked) {
          result += text[i];
        } else if (text[i] === " ") {
          result += " ";
        } else {
          result += rng();
        }
      }
      setDisplay(result);

      if (locked >= text.length) {
        setDisplay(text);
        setDone(true);
        // Keep animating a spinner tail after text is locked
        const spinTail = () => {
          if (!running) return;
          setTailChar(rngTail());
          frameRef.current = requestAnimationFrame(spinTail);
        };
        // small gap before spinner starts
        setTimeout(() => { if (running) frameRef.current = requestAnimationFrame(spinTail); }, 150);
      } else {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [text, speed, delay]);

  return (
    <span className="scramble-text">
      <span className={`scramble-text-content${done ? " scramble-done" : ""}`}>{display}</span>
      {done
        ? <span className="scramble-spinner">{tailChar}</span>
        : <span className="scramble-cursor" />
      }
    </span>
  );
}
