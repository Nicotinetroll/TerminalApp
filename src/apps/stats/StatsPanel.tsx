import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { getServerStats, getVpsStats, ApiError } from "@/lib/api";
import type { ServerStats, VpsStats } from "@/lib/api";
import { LogViewer } from "./LogViewer";
import { DiskChart } from "./DiskChart";

type Tab = "dashboard" | "logs";
type DiskRange = "24h" | "7d" | "30d";

export function StatsPanel(_props: WindowContentProps) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const [ago, setAgo] = useState(0);
  const [diskRange, setDiskRange] = useState<DiskRange>("24h");
  const [vpsStats, setVpsStats] = useState<VpsStats | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const tickRef = useRef<ReturnType<typeof setInterval>>();
  const diskIntervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchVps = useCallback(async (range: DiskRange) => {
    try {
      const data = await getVpsStats(range);
      setVpsStats(data);
    } catch {
      // silently ignore — not critical
    }
  }, []);

  useEffect(() => {
    void fetchVps(diskRange);
    clearInterval(diskIntervalRef.current);
    diskIntervalRef.current = setInterval(() => void fetchVps(diskRange), 30000);
    return () => clearInterval(diskIntervalRef.current);
  }, [diskRange, fetchVps]);

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

        {/* IMAP */}
        <div className="stats-card">
          <div className="stats-card-title">imap</div>
          <div className="stats-card-body">
            <StatRow label="events" value={String(s.imap.total_events)} />
            <StatRow label="logins" value={String(s.imap.logins)} />
            <StatRow label="failed logins" value={s.imap.login_fails === 0 ? "0" : `${s.imap.login_fails} (hackers?)`} />
            <StatRow label="errors" value={s.imap.errors === 0 ? "0 (clean af)" : String(s.imap.errors)} />
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

        {/* VPS Disk */}
        {vpsStats && vpsStats.current && (
          <div className="stats-card">
            <div className="stats-card-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>vps disk</span>
              <div className="stats-disk-ranges">
                {(["24h", "7d", "30d"] as const).map((r) => (
                  <button
                    key={r}
                    className={`stats-disk-range${diskRange === r ? " stats-disk-range-active" : ""}`}
                    onClick={() => setDiskRange(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="stats-card-body">
              <StatRow label="used" value={vpsStats.current.used_human} />
              <StatRow label="free" value={vpsStats.current.free_human} />
              <StatRow label="total" value={vpsStats.current.total_human} />
              <StatRow
                label="usage"
                value={
                  vpsStats.current.used_pct === 69
                    ? "69% — nice."
                    : vpsStats.current.used_pct > 90
                      ? `${vpsStats.current.used_pct}% — yo clean up`
                      : `${vpsStats.current.used_pct}%`
                }
              />

              {/* Usage bar */}
              <div className="stats-disk-bar-container">
                <div
                  className={`stats-disk-bar${vpsStats.current.used_pct > 90 ? " stats-disk-bar-danger" : ""}`}
                  style={{ width: `${Math.min(vpsStats.current.used_pct, 100)}%` }}
                />
              </div>

              {/* Chart */}
              <DiskChart history={vpsStats.history} range={diskRange} />
            </div>
          </div>
        )}
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
