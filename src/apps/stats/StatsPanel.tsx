import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { getServerStats, ApiError } from "@/lib/api";
import type { ServerStats } from "@/lib/api";
import { LogViewer } from "./LogViewer";

type Tab = "dashboard" | "logs";

export function StatsPanel(_props: WindowContentProps) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const [ago, setAgo] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const tickRef = useRef<ReturnType<typeof setInterval>>();

  const fetchStats = useCallback(async () => {
    try {
      const data = await getServerStats();
      setStats(data);
      setError(null);
      setLastFetch(Date.now());
      setAgo(0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "couldn't reach the server. it's probably crying.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
    intervalRef.current = setInterval(() => void fetchStats(), 30000);
    tickRef.current = setInterval(() => {
      setLastFetch((prev) => {
        if (prev > 0) setAgo(Math.floor((Date.now() - prev) / 1000));
        return prev;
      });
    }, 1000);
    return () => {
      clearInterval(intervalRef.current);
      clearInterval(tickRef.current);
    };
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="stats-panel">
        <div className="stats-loading">booting up the surveillance system...</div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="stats-panel">
        <div className="stats-error">{error}</div>
      </div>
    );
  }

  if (!stats) return null;

  const s = stats;

  return (
    <div className="stats-panel">
      <div className="stats-header">
        <div className="stats-header-left">
          <span className={`stats-health ${s.health}`} title={s.health} />
          <div className="stats-tabs">
            <button
              className={`stats-tab ${tab === "dashboard" ? "stats-tab-active" : ""}`}
              onClick={() => setTab("dashboard")}
            >
              dashboard
            </button>
            <button
              className={`stats-tab ${tab === "logs" ? "stats-tab-active" : ""}`}
              onClick={() => setTab("logs")}
            >
              logs
            </button>
          </div>
          {tab === "dashboard" && (
            <span className="stats-ago">
              {ago === 0 ? "just now" : `${ago}s ago`}
            </span>
          )}
        </div>
        {tab === "dashboard" && (
          <button
            className="stats-refresh-btn"
            onClick={() => void fetchStats()}
            title="refresh"
          >
            refresh
          </button>
        )}
      </div>

      {tab === "logs" ? (
        <LogViewer />
      ) : (
        <>
        {error && <div className="stats-error-bar">{error}</div>}

        <div className="stats-grid">
        {/* Server */}
        <div className="stats-card">
          <div className="stats-card-title">server</div>
          <div className="stats-card-body">
            <StatRow label="uptime" value={s.server.uptime_seconds < 60 ? `${s.server.uptime_human} (just woke up)` : s.server.uptime_human} />
            <StatRow label="rss" value={`${s.server.memory_rss_mb} MB`} />
            <StatRow label="heap" value={`${s.server.memory_heap_used_mb} / ${s.server.memory_heap_total_mb} MB`} />
            <StatRow label="node" value={s.server.node_version} />
            <StatRow label="platform" value={s.server.platform} />
            <StatRow label="pid" value={String(s.server.pid)} />
          </div>
        </div>

        {/* Users */}
        <div className="stats-card">
          <div className="stats-card-title">users</div>
          <div className="stats-card-body">
            <StatRow label="total" value={String(s.users.total)} />
            {Object.entries(s.users.by_role).map(([role, count]) => (
              <StatRow key={role} label={role} value={String(count)} />
            ))}
            {s.users.recent.length > 0 && (
              <div className="stats-subsection">
                <div className="stats-sublabel">latest signups</div>
                {s.users.recent.map((u) => (
                  <StatRow key={u.username} label={u.username} value={u.role} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Storage */}
        <div className="stats-card">
          <div className="stats-card-title">storage</div>
          <div className="stats-card-body">
            <StatRow label="total" value={s.storage.total_human} />
            {s.storage.top_users.length > 0 && (
              <div className="stats-subsection">
                <div className="stats-sublabel">top hoarders</div>
                {s.storage.top_users.map((u) => (
                  <StatRow key={u.username} label={u.username} value={u.human} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Chat / Whispers */}
        <div className="stats-card">
          <div className="stats-card-title">whispers</div>
          <div className="stats-card-body">
            <StatRow label="rooms" value={String(s.chat.total_rooms)} />
            <StatRow
              label="messages"
              value={s.chat.total_messages === 0 ? "0 (dead silence)" : String(s.chat.total_messages)}
            />
            <StatRow label="active 24h" value={String(s.chat.active_rooms_24h)} />
          </div>
        </div>

        {/* Mail */}
        <div className="stats-card">
          <div className="stats-card-title">mail</div>
          <div className="stats-card-body">
            <StatRow label="addresses" value={String(s.mail.total_addresses)} />
            <StatRow
              label="emails"
              value={s.mail.total_emails === 69 ? "69 (nice.)" : String(s.mail.total_emails)}
            />
            <StatRow label="today" value={String(s.mail.emails_today)} />
          </div>
        </div>

        {/* Games */}
        <div className="stats-card">
          <div className="stats-card-title">games</div>
          <div className="stats-card-body">
            <StatRow label="total scores" value={String(s.games.total_scores)} />
            {s.games.by_game.length > 0 && (
              <div className="stats-subsection">
                <div className="stats-sublabel">by game</div>
                {s.games.by_game.map((g) => (
                  <StatRow key={g.game} label={g.game} value={String(g.count)} />
                ))}
              </div>
            )}
            {s.games.by_game.length === 0 && (
              <div className="stats-empty-note">no one's playing. tragic.</div>
            )}
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-row">
      <span className="stats-row-label">{label}</span>
      <span className="stats-row-value">{value}</span>
    </div>
  );
}
