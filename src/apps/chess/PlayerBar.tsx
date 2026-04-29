import { useState, useEffect, useRef } from "react";

interface PlayerBarProps {
  name: string;
  timeLeft: number | null;
  isActive: boolean;
  color: "white" | "black";
  isBot?: boolean;
  botLevel?: number | null;
  capturedPieces?: string[];
  isMyBar?: boolean;
}

export function PlayerBar({ name, timeLeft, isActive, color, isBot, botLevel, capturedPieces = [], isMyBar }: PlayerBarProps) {
  const [displayTime, setDisplayTime] = useState(timeLeft);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setDisplayTime(timeLeft);
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (timeLeft !== null && isActive) {
      const start = Date.now();
      intervalRef.current = setInterval(() => {
        const elapsed = Date.now() - start;
        setDisplayTime(Math.max(0, (timeLeft) - elapsed));
      }, 100);
    }

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timeLeft, isActive]);

  const formatTime = (ms: number | null) => {
    if (ms === null) return null;
    const totalSecs = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const timeStr = formatTime(displayTime);
  const isLow = displayTime !== null && displayTime < 30000;

  return (
    <div className={`chess-player-bar ${isActive ? "active" : ""} ${isMyBar ? "mine" : "theirs"}`}>
      <div className="chess-player-info">
        <span className={`chess-player-dot ${color}`} />
        <span className="chess-player-name">
          {name || "Waiting..."}
          {isBot && botLevel !== null && botLevel !== undefined && (
            <span className="chess-bot-badge">BOT Lv.{botLevel}</span>
          )}
        </span>
        {capturedPieces.length > 0 && (
          <span className="chess-captured">{capturedPieces.join("")}</span>
        )}
      </div>
      <div className="chess-player-right">
        {isActive && isMyBar && (
          <span className="chess-your-turn-badge">YOUR MOVE</span>
        )}
        {isActive && !isMyBar && (
          <span className="chess-thinking-badge">thinking...</span>
        )}
        {timeStr !== null && (
          <div className={`chess-timer ${isLow ? "low" : ""} ${isActive ? "ticking" : ""}`}>
            {timeStr}
          </div>
        )}
      </div>
    </div>
  );
}
