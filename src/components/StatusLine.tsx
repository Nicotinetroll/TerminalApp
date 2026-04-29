import { useState, useEffect, useRef } from "react";
import { HOSTNAME } from "@/config";

interface Props {
  historyLength: number;
  username: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const rm = min % 60;
  return `${hr}h${rm > 0 ? `${pad(rm)}m` : ""}`;
}

export function StatusLine({ historyLength, username }: Props) {
  const [time, setTime] = useState(() => new Date());
  const sessionStart = useRef(Date.now());

  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const uptime = formatUptime(Date.now() - sessionStart.current);
  const clock = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;

  return (
    <div className="status-line">
      <span className="status-line-segment">[{clock}]</span>
      <span className="status-line-sep">|</span>
      <span className="status-line-segment">{username}@{HOSTNAME}</span>
      <span className="status-line-sep">|</span>
      <span className="status-line-segment">{historyLength} cmds</span>
      <span className="status-line-sep">|</span>
      <span className="status-line-segment">{uptime} uptime</span>
      <span className="status-line-right">
        <span className="status-line-dot" />
        online
      </span>
    </div>
  );
}
