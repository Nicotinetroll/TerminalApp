import { shortenPath } from "@/core/utils";

interface Props {
  username: string;
  cwd: string;
  homePath: string;
  commandCount: number;
}

export function StatusBar({ username, cwd, homePath, commandCount }: Props) {
  return (
    <div
      className="flex items-center justify-between px-8 h-8 font-mono shrink-0 select-none"
      style={{
        color: "var(--text-ghost)",
        fontSize: "12px",
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--bg-surface)",
      }}
    >
      <span>{commandCount} cmds</span>
      <div className="flex items-center gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full theme-transition"
          style={{ background: "var(--accent)", boxShadow: "0 0 6px var(--accent-mid)" }}
        />
        <span>{shortenPath(cwd, homePath)}</span>
      </div>
      <span>{username}@nsh</span>
    </div>
  );
}
