import { useState, useEffect, useCallback, useRef } from "react";
import type { CasinoPlayer, CasinoConfig, CasinoPlayerDetailData, CasinoBalancePoint } from "@/lib/api";
import { getCasinoPlayers, getCasinoConfig, setCasinoConfig, grantNiggaBytes, resetCasinoPlayer, getCasinoPlayerDetail, ApiError } from "@/lib/api";

function fmtMB(bytes: number): string {
  if (bytes === 0) return "0 MB";
  const abs = Math.abs(bytes);
  const mb = abs / (1024 * 1024);
  const sign = bytes < 0 ? "-" : "";
  if (mb >= 1000) return `${sign}${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${sign}${mb.toFixed(1)} MB`;
  return `${sign}${(abs / 1024).toFixed(0)} KB`;
}

function fmtNB(nb: number): string {
  if (nb >= 1000000) return `${(nb / 1000000).toFixed(1)}M`;
  if (nb >= 1000) return `${(nb / 1000).toFixed(1)}K`;
  return String(nb);
}

function fmtTime(dateStr: string): string {
  const d = new Date(dateStr + "Z");
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

type Tab = "config" | "players";

// ── Balance Graph (pure SVG) ──

function BalanceGraph({ points }: { points: CasinoBalancePoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; nb: number; ts: string } | null>(null);

  if (points.length < 2) {
    return <div className="casino-graph-empty">not enough data for a graph yet. tell em to gamble more.</div>;
  }

  const W = 500;
  const H = 130;
  const PAD_X = 8;
  const PAD_Y = 12;

  const nbs = points.map(p => p.nb);
  const minNB = Math.min(...nbs);
  const maxNB = Math.max(...nbs);
  const range = maxNB - minNB || 1;

  const scaleX = (i: number) => PAD_X + (i / (points.length - 1)) * (W - PAD_X * 2);
  const scaleY = (nb: number) => PAD_Y + (1 - (nb - minNB) / range) * (H - PAD_Y * 2);

  const polyPoints = points.map((p, i) => `${scaleX(i)},${scaleY(p.nb)}`).join(" ");

  // Gradient fill area
  const fillPoints = `${scaleX(0)},${H} ${polyPoints} ${scaleX(points.length - 1)},${H}`;

  // Grid lines (4 horizontal)
  const gridLines = [0.25, 0.5, 0.75].map(frac => {
    const y = PAD_Y + frac * (H - PAD_Y * 2);
    return { y, label: fmtNB(Math.round(maxNB - frac * range)) };
  });

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width * W;
    const idx = Math.round(((relX - PAD_X) / (W - PAD_X * 2)) * (points.length - 1));
    const clamped = Math.max(0, Math.min(points.length - 1, idx));
    const pt = points[clamped]!;
    setTooltip({ x: scaleX(clamped), y: scaleY(pt.nb), nb: pt.nb, ts: pt.ts });
  };

  return (
    <svg
      ref={svgRef}
      className="casino-graph-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setTooltip(null)}
    >
      {/* Grid lines */}
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={PAD_X} y1={g.y} x2={W - PAD_X} y2={g.y} stroke="var(--border-subtle)" strokeWidth="0.5" strokeDasharray="4,4" />
          <text x={PAD_X + 2} y={g.y - 3} fill="var(--text-ghost)" fontSize="8" fontFamily="inherit">{g.label}</text>
        </g>
      ))}
      {/* Y labels top/bottom */}
      <text x={PAD_X + 2} y={PAD_Y - 2} fill="var(--text-ghost)" fontSize="8" fontFamily="inherit">{fmtNB(maxNB)}</text>
      <text x={PAD_X + 2} y={H - 2} fill="var(--text-ghost)" fontSize="8" fontFamily="inherit">{fmtNB(minNB)}</text>

      {/* Gradient fill */}
      <defs>
        <linearGradient id="nbFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill="url(#nbFill)" />

      {/* Line */}
      <polyline points={polyPoints} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />

      {/* Tooltip dot */}
      {tooltip && (
        <>
          <circle cx={tooltip.x} cy={tooltip.y} r="3" fill="var(--accent)" stroke="var(--bg-primary)" strokeWidth="1.5" />
          <rect
            x={Math.min(tooltip.x - 30, W - 70)}
            y={Math.max(tooltip.y - 28, 2)}
            width="60" height="18" rx="3"
            fill="var(--bg-primary)" stroke="var(--border-subtle)" strokeWidth="0.5"
          />
          <text
            x={Math.min(tooltip.x, W - 40)}
            y={Math.max(tooltip.y - 15, 14)}
            fill="#fbbf24" fontSize="9" fontFamily="inherit" textAnchor="middle"
          >{fmtNB(tooltip.nb)} NB</text>
        </>
      )}
    </svg>
  );
}

// ── Player Detail View ──

type AmountMode = "storage" | "nb";
const PAGE_SIZE = 25;

function fmtAmount(bytes: number, mode: AmountMode): string {
  if (mode === "nb") {
    const nb = Math.round(bytes / (1024 * 1024));
    return `${fmtNB(nb)} NB`;
  }
  return fmtMB(bytes);
}

function PlayerDetailView({ detail, onBack }: { detail: CasinoPlayerDetailData; onBack: () => void }) {
  const { player, history, balance_history } = detail;
  const [amountMode, setAmountMode] = useState<AmountMode>("storage");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const totalGames = player.slots_spins + player.cf_flips;
  const totalWins = player.slots_wins + player.cf_wins;
  const overallWR = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
  const netPL = player.total_won - player.total_lost;

  const visibleHistory = history.slice(0, visibleCount);
  const hasMore = visibleCount < history.length;

  return (
    <div className="casino-detail">
      {/* Header */}
      <div className="casino-detail-header">
        <button className="casino-detail-back" onClick={onBack}>&larr; back</button>
        <span className="casino-detail-username">{player.username}</span>
        <span className={`casino-detail-role role-${player.role}`}>{player.role}</span>
      </div>

      {/* Stats cards */}
      <div className="casino-detail-stats">
        <div className="casino-detail-stat">
          <div className="casino-detail-stat-val nb-color">{fmtNB(player.niggabytes)}</div>
          <div className="casino-detail-stat-label">NB balance</div>
        </div>
        <div className="casino-detail-stat">
          <div className="casino-detail-stat-val win-color">{fmtMB(player.total_won)}</div>
          <div className="casino-detail-stat-label">total won</div>
        </div>
        <div className="casino-detail-stat">
          <div className="casino-detail-stat-val lose-color">{fmtMB(player.total_lost)}</div>
          <div className="casino-detail-stat-label">total lost</div>
        </div>
        <div className="casino-detail-stat">
          <div className={`casino-detail-stat-val ${netPL >= 0 ? "win-color" : "lose-color"}`}>
            {netPL >= 0 ? "+" : ""}{fmtMB(netPL)}
          </div>
          <div className="casino-detail-stat-label">net P/L</div>
        </div>
        <div className="casino-detail-stat">
          <div className="casino-detail-stat-val">{totalGames}</div>
          <div className="casino-detail-stat-label">games</div>
        </div>
        <div className="casino-detail-stat">
          <div className={`casino-detail-stat-val ${overallWR >= 50 ? "win-color" : "lose-color"}`}>{overallWR}%</div>
          <div className="casino-detail-stat-label">win rate</div>
        </div>
      </div>

      {/* Balance graph */}
      <div className="casino-graph">
        <div className="casino-graph-title">NB balance over time</div>
        <BalanceGraph points={balance_history} />
      </div>

      {/* History table */}
      <div className="casino-history">
        <div className="casino-history-bar">
          <span className="casino-history-title">history ({history.length})</span>
          <div className="casino-history-toggle">
            <button
              className={`casino-history-toggle-btn ${amountMode === "storage" ? "casino-history-toggle-active" : ""}`}
              onClick={() => setAmountMode("storage")}
            >MB</button>
            <button
              className={`casino-history-toggle-btn casino-history-toggle-nb ${amountMode === "nb" ? "casino-history-toggle-active" : ""}`}
              onClick={() => setAmountMode("nb")}
            >NB</button>
          </div>
        </div>
        <div className="casino-history-scroll">
          <div className="casino-history-thead">
            <span className="casino-history-col-time">time</span>
            <span className="casino-history-col-game"></span>
            <span className="casino-history-col-bet">bet</span>
            <span className="casino-history-col-result">result</span>
            <span className="casino-history-col-payout">payout</span>
          </div>
          {visibleHistory.map((h, i) => (
            <div key={i} className={`casino-history-row ${h.result === "win" ? "win-row" : "lose-row"}`}>
              <span className="casino-history-col-time">{fmtTime(h.created_at)}</span>
              <span className="casino-history-col-game">{h.type === "slots" ? "🎰" : "🪙"}</span>
              <span className="casino-history-col-bet">{fmtAmount(h.bet, amountMode)}</span>
              <span className="casino-history-col-result">{h.detail}</span>
              <span className="casino-history-col-payout">
                {h.payout > 0 ? `+${fmtAmount(h.payout, amountMode)}` : "—"}
              </span>
            </div>
          ))}
          {history.length === 0 && (
            <div className="casino-graph-empty">no history yet. this mf hasn't gambled.</div>
          )}
          {hasMore && (
            <button
              className="casino-history-more"
              onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
            >
              show more ({history.length - visibleCount} remaining)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ──

export function CasinoAdminPanel() {
  const [tab, setTab] = useState<Tab>("config");
  const [players, setPlayers] = useState<CasinoPlayer[]>([]);
  const [config, setConfig] = useState<CasinoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Config state
  const [rtpSlider, setRtpSlider] = useState(92);
  const [savedRtp, setSavedRtp] = useState(92);
  const [wcSlider, setWcSlider] = useState(50);
  const [savedWc, setSavedWc] = useState(50);
  const [savingConfig, setSavingConfig] = useState(false);

  // Players state
  const [confirmResetId, setConfirmResetId] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const [grantingId, setGrantingId] = useState<number | null>(null);
  const [grantAmount, setGrantAmount] = useState("");
  const [grantMsg, setGrantMsg] = useState<string | null>(null);

  // Detail view state
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);
  const [playerDetail, setPlayerDetail] = useState<CasinoPlayerDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([getCasinoPlayers(), getCasinoConfig()]);
      setPlayers(p);
      setConfig(c);
      setRtpSlider(c.slots_rtp_target);
      setSavedRtp(c.slots_rtp_target);
      setWcSlider(c.coinflip_win_chance);
      setSavedWc(c.coinflip_win_chance);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to load casino data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const configChanged = rtpSlider !== savedRtp || wcSlider !== savedWc;

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const updates: { slots_rtp_target?: number; coinflip_win_chance?: number } = {};
      if (rtpSlider !== savedRtp) updates.slots_rtp_target = rtpSlider;
      if (wcSlider !== savedWc) updates.coinflip_win_chance = wcSlider;
      await setCasinoConfig(updates);
      setSavedRtp(rtpSlider);
      setSavedWc(wcSlider);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "save failed");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleReset = async (userId: number) => {
    setResetting(true);
    try {
      await resetCasinoPlayer(userId);
      setConfirmResetId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "reset failed");
    } finally {
      setResetting(false);
    }
  };

  const handleGrant = async (userId: number) => {
    const amt = parseInt(grantAmount, 10);
    if (isNaN(amt) || amt === 0) return;
    try {
      const result = await grantNiggaBytes(userId, amt);
      setGrantMsg(result.message);
      setGrantingId(null);
      setGrantAmount("");
      // Update local state
      setPlayers(prev => prev.map(p => p.userId === userId ? { ...p, niggabytes: result.niggabytes } : p));
      setTimeout(() => setGrantMsg(null), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "grant failed");
    }
  };

  const handleSelectPlayer = async (userId: number) => {
    setSelectedPlayer(userId);
    setDetailLoading(true);
    try {
      const detail = await getCasinoPlayerDetail(userId);
      setPlayerDetail(detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to load player detail");
      setSelectedPlayer(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleBackToList = () => {
    setSelectedPlayer(null);
    setPlayerDetail(null);
  };

  if (loading) {
    return <div className="slots-admin-loading"><span className="spinner" /> loading the house...</div>;
  }

  if (error) {
    return <div className="slots-admin-error">{error} <button className="slots-admin-reset-btn" onClick={() => { setError(null); void load(); }}>retry</button></div>;
  }

  // Detail view
  if (selectedPlayer !== null) {
    if (detailLoading) {
      return <div className="slots-admin"><div className="slots-admin-loading"><span className="spinner" /> pulling up their file...</div></div>;
    }
    if (playerDetail) {
      return <div className="slots-admin"><PlayerDetailView detail={playerDetail} onBack={handleBackToList} /></div>;
    }
  }

  const houseEdge = (100 - rtpSlider).toFixed(1);

  return (
    <div className="slots-admin">
      {/* Tabs */}
      <div className="casino-admin-tabs">
        <button className={`casino-admin-tab ${tab === "config" ? "casino-admin-tab-active" : ""}`} onClick={() => setTab("config")}>CONFIG</button>
        <button className={`casino-admin-tab ${tab === "players" ? "casino-admin-tab-active" : ""}`} onClick={() => setTab("players")}>PLAYERS</button>
      </div>

      {grantMsg && <div className="slots-admin-config-hint" style={{ color: "#fbbf24", textAlign: "center", padding: "4px" }}>{grantMsg}</div>}

      {tab === "config" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "8px 0" }}>
          {/* Slots RTP */}
          <div className="slots-admin-config">
            <div className="slots-admin-config-header">SLOTS</div>
            <div className="slots-admin-config-row">
              <label className="slots-admin-config-label">RTP</label>
              <input type="range" min={80} max={99} step={0.5} value={rtpSlider} onChange={e => setRtpSlider(Number(e.target.value))} className="slots-admin-slider" />
              <span className="slots-admin-config-val">{rtpSlider}%</span>
            </div>
            <div className="slots-admin-config-stats">
              <span>house edge: {houseEdge}%</span>
              {config && <span>payout factor: {config.slots_payout_factor}x</span>}
            </div>
            <div className="slots-admin-config-hint">
              {rtpSlider < 85 ? "brutal. house eats everything." :
               rtpSlider < 90 ? "tight. they'll feel the squeeze." :
               rtpSlider < 94 ? "fair casino. proper house edge." :
               rtpSlider < 97 ? "generous. players will profit short-term." :
               "basically charity. house barely scrapes by."}
            </div>
          </div>

          {/* Coinflip win chance */}
          <div className="slots-admin-config">
            <div className="slots-admin-config-header">COINFLIP</div>
            <div className="slots-admin-config-row">
              <label className="slots-admin-config-label">win %</label>
              <input type="range" min={5} max={80} value={wcSlider} onChange={e => setWcSlider(Number(e.target.value))} className="slots-admin-slider" />
              <span className="slots-admin-config-val">{wcSlider}%</span>
            </div>
            <div className="slots-admin-config-hint">
              {wcSlider < 30 ? "house always wins. classic." :
               wcSlider < 50 ? "slight house edge. sneaky." :
               wcSlider === 50 ? "fair 50/50. boring but honest." :
               wcSlider < 65 ? "player favored. feeling generous?" :
               "basically free money. why even have a casino."}
            </div>
          </div>

          {configChanged && (
            <button
              className="slots-admin-save-btn"
              style={{ alignSelf: "center", padding: "6px 24px", fontSize: "13px" }}
              onClick={() => void handleSaveConfig()}
              disabled={savingConfig}
            >{savingConfig ? "saving..." : "SAVE"}</button>
          )}
        </div>
      )}

      {tab === "players" && (
        <>
          <div className="slots-admin-header">
            <span>CASINO PLAYERS</span>
            <span className="slots-admin-count">{players.length} degen{players.length !== 1 ? "s" : ""}</span>
          </div>

          {players.length === 0 ? (
            <div className="slots-admin-empty">no one has gambled yet. cowards.</div>
          ) : (
            <div className="slots-admin-table">
              <div className="slots-admin-thead">
                <span className="slots-admin-col-user">user</span>
                <span className="slots-admin-col-sm casino-admin-nb-col">NB</span>
                <span className="slots-admin-col-num">bonus</span>
                <span className="slots-admin-col-sm">slots</span>
                <span className="slots-admin-col-sm">wr%</span>
                <span className="slots-admin-col-sm">flips</span>
                <span className="slots-admin-col-sm">wr%</span>
                <span className="slots-admin-col-act">act</span>
              </div>
              {players.map(p => (
                <div key={p.userId} className="slots-admin-row" onClick={() => void handleSelectPlayer(p.userId)} style={{ cursor: "pointer" }}>
                  <span className="slots-admin-col-user">
                    <span className={`slots-admin-role role-${p.role}`}>{p.role[0]!.toUpperCase()}</span>
                    {p.username}
                  </span>
                  <span className="slots-admin-col-sm casino-admin-nb-col">{p.niggabytes}</span>
                  <span className={`slots-admin-col-num ${p.bonus_bytes > 0 ? "slots-admin-pos" : p.bonus_bytes < 0 ? "slots-admin-neg" : ""}`}>
                    {p.bonus_bytes > 0 ? "+" : ""}{fmtMB(p.bonus_bytes)}
                  </span>
                  <span className="slots-admin-col-sm">{p.slots_spins}</span>
                  <span className="slots-admin-col-sm">{Math.round(p.slots_wr * 100)}%</span>
                  <span className="slots-admin-col-sm">{p.cf_flips}</span>
                  <span className="slots-admin-col-sm">{Math.round(p.cf_wr * 100)}%</span>
                  <span className="slots-admin-col-act" onClick={e => e.stopPropagation()}>
                    {grantingId === p.userId ? (
                      <span className="casino-admin-nb-grant">
                        <input
                          className="casino-admin-nb-input"
                          type="number"
                          placeholder="NB"
                          value={grantAmount}
                          onChange={e => setGrantAmount(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") void handleGrant(p.userId); if (e.key === "Escape") { setGrantingId(null); setGrantAmount(""); } }}
                          autoFocus
                        />
                        <button className="slots-admin-confirm-yes" onClick={() => void handleGrant(p.userId)}>ok</button>
                        <button className="slots-admin-confirm-no" onClick={() => { setGrantingId(null); setGrantAmount(""); }}>x</button>
                      </span>
                    ) : confirmResetId === p.userId ? (
                      <span className="slots-admin-confirm">
                        <button className="slots-admin-confirm-yes" onClick={() => void handleReset(p.userId)} disabled={resetting}>{resetting ? "..." : "yes"}</button>
                        <button className="slots-admin-confirm-no" onClick={() => setConfirmResetId(null)} disabled={resetting}>no</button>
                      </span>
                    ) : (
                      <>
                        <button className="casino-admin-grant-btn" onClick={() => { setGrantingId(p.userId); setGrantAmount(""); }} title="grant NB">+NB</button>
                        <button className="slots-admin-reset-btn" onClick={() => setConfirmResetId(p.userId)} title="reset all casino data">RST</button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
