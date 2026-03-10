import { useState, useRef, useCallback } from "react";
import type { VpsDiskPoint } from "@/lib/api";

interface Props {
  history: VpsDiskPoint[];
  range: string;
}

const W = 600;
const H = 200;
const PAD_L = 52;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 28;

function formatGB(bytes: number): string {
  return (bytes / (1024 ** 3)).toFixed(1) + " GB";
}

function formatTime(ts: string, range: string): string {
  const d = new Date(ts + (ts.endsWith("Z") ? "" : "Z"));
  if (range === "24h") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "7d") {
    return d.toLocaleDateString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function DiskChart({ history, range }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; point: VpsDiskPoint; pct: number } | null>(null);

  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  // Compute Y bounds (always show from 0 to max total)
  const maxTotal = history.reduce((m, p) => Math.max(m, p.total), 0);
  const yMax = maxTotal > 0 ? maxTotal : 1;

  // Map data to chart coords
  const points = history.map((p, i) => ({
    x: PAD_L + (history.length > 1 ? (i / (history.length - 1)) * chartW : chartW / 2),
    y: PAD_T + chartH - (p.used / yMax) * chartH,
    data: p,
  }));

  // Build area path
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = points.length > 0
    ? `${linePath} L${points[points.length - 1]!.x},${PAD_T + chartH} L${points[0]!.x},${PAD_T + chartH} Z`
    : "";

  // Grid lines (4 horizontal)
  const gridLines = [0.25, 0.5, 0.75, 1.0].map(frac => ({
    y: PAD_T + chartH - frac * chartH,
    label: formatGB(frac * yMax),
  }));

  // X-axis labels (up to 5 evenly spaced)
  const xLabels: { x: number; label: string }[] = [];
  if (history.length > 0) {
    const count = Math.min(5, history.length);
    for (let i = 0; i < count; i++) {
      const idx = count > 1 ? Math.floor((i / (count - 1)) * (history.length - 1)) : 0;
      const p = history[idx];
      if (!p) continue;
      xLabels.push({
        x: PAD_L + (history.length > 1 ? (idx / (history.length - 1)) * chartW : chartW / 2),
        label: formatTime(p.ts, range),
      });
    }
  }

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;

    // Find closest point
    let closest = points[0]!;
    let minDist = Infinity;
    for (const p of points) {
      const dist = Math.abs(p.x - mouseX);
      if (dist < minDist) {
        minDist = dist;
        closest = p;
      }
    }

    const pct = closest.data.total > 0
      ? Math.round((closest.data.used / closest.data.total) * 1000) / 10
      : 0;

    setHover({ x: closest.x, y: closest.y, point: closest.data, pct });
  }, [points]);

  const handleMouseLeave = useCallback(() => setHover(null), []);

  if (history.length === 0) {
    return (
      <div className="stats-chart-empty">
        no data yet. waiting for first collection...
      </div>
    );
  }

  return (
    <div className="stats-chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="stats-chart-svg"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Grid lines */}
        {gridLines.map(g => (
          <g key={g.label}>
            <line
              x1={PAD_L} y1={g.y} x2={W - PAD_R} y2={g.y}
              className="stats-chart-grid"
            />
            <text x={PAD_L - 6} y={g.y + 3} className="stats-chart-ylabel">
              {g.label}
            </text>
          </g>
        ))}

        {/* Base line */}
        <line
          x1={PAD_L} y1={PAD_T + chartH} x2={W - PAD_R} y2={PAD_T + chartH}
          className="stats-chart-grid"
        />

        {/* X labels */}
        {xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={PAD_T + chartH + 16} className="stats-chart-xlabel">
            {xl.label}
          </text>
        ))}

        {/* Area fill */}
        {areaPath && (
          <path d={areaPath} className="stats-chart-area" />
        )}

        {/* Line */}
        {linePath && (
          <path d={linePath} className="stats-chart-line" fill="none" />
        )}

        {/* Hover crosshair + dot */}
        {hover && (
          <>
            <line
              x1={hover.x} y1={PAD_T} x2={hover.x} y2={PAD_T + chartH}
              className="stats-chart-crosshair"
            />
            <circle
              cx={hover.x} cy={hover.y} r={3.5}
              className="stats-chart-dot"
            />
          </>
        )}
      </svg>

      {/* Tooltip */}
      {hover && (
        <div
          className="stats-chart-tooltip"
          style={{
            left: `${(hover.x / W) * 100}%`,
            top: `${(hover.y / H) * 100}%`,
          }}
        >
          <div className="stats-chart-tooltip-time">
            {formatTime(hover.point.ts, range)}
          </div>
          <div className="stats-chart-tooltip-val">
            {formatGB(hover.point.used)} / {formatGB(hover.point.total)}
          </div>
          <div className="stats-chart-tooltip-pct">
            {hover.pct === 69 ? "69% — nice." : `${hover.pct}%`}
          </div>
        </div>
      )}
    </div>
  );
}
