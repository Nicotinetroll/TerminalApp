import type { StorageStats } from "@/lib/api";

interface Props {
  stats: StorageStats;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getUsageLabel(percent: number): string {
  if (percent === 42) return "the answer.";
  if (percent === 69) return "nice.";
  if (percent === 0) return "empty. like my soul.";
  if (percent < 10) return "barely touched. you antisocial or something?";
  if (percent < 25) return "just getting started. keep going.";
  if (percent < 50) return "looking healthy. not too fat, not too skinny.";
  if (percent < 75) return "getting thicc in here.";
  if (percent < 90) return "getting a little crowded... maybe delete some stuff?";
  if (percent < 95) return "dangerously thicc. one more meme and it's over.";
  if (percent < 100) return "YOU'RE ABOUT TO BLOW. DELETE SOMETHING. NOW.";
  return "how the fuck did you even save this? you broke physics.";
}

function getBarColor(percent: number): string {
  if (percent > 95) return "var(--error, #ff4444)";
  if (percent > 80) return "var(--warning, #ffaa00)";
  return "var(--accent)";
}

export function StorageBar({ stats }: Props) {
  const isUnlimited = stats.limit === 0;
  const percent = isUnlimited ? 0 : Math.min(100, Math.round((stats.used / stats.limit) * 100));

  return (
    <div style={{ padding: "0 4px" }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: "8px",
      }}>
        <span style={{ color: "var(--text-muted)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px" }}>
          cloud storage
        </span>
        <span style={{ color: "var(--text-primary)", fontSize: "13px" }}>
          {formatBytes(stats.used)}
          {isUnlimited ? " / ∞" : ` / ${formatBytes(stats.limit)}`}
          {!isUnlimited && (
            <span style={{ color: "var(--text-muted)", marginLeft: "6px" }}>
              ({percent}%)
            </span>
          )}
        </span>
      </div>

      <div style={{
        width: "100%",
        height: "20px",
        background: "var(--bg-secondary, rgba(255,255,255,0.05))",
        borderRadius: "4px",
        overflow: "hidden",
        border: "1px solid var(--border, rgba(255,255,255,0.1))",
      }}>
        <div style={{
          width: isUnlimited ? "2%" : `${Math.max(percent, 1)}%`,
          height: "100%",
          background: isUnlimited ? "var(--accent)" : getBarColor(percent),
          borderRadius: "3px",
          transition: "width 0.5s ease, background 0.3s ease",
        }} />
      </div>

      <div style={{
        marginTop: "8px",
        fontSize: "12px",
        color: "var(--text-muted)",
        fontStyle: "italic",
      }}>
        {isUnlimited
          ? "unlimited storage. because you're built different."
          : getUsageLabel(percent)}
      </div>
    </div>
  );
}
