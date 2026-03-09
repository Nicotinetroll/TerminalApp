import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import type { SlotsBalance, SlotsSpinResult, SlotsBonusInfo } from "@/lib/api";
import { getSlotsBalance, spinSlots, ApiError } from "@/lib/api";

interface LocalHistoryEntry {
  id: number;
  bet_bytes: number;
  result: string;
  payout_bytes: number;
  grid: string[][];
  created_at: string;
  currency?: string;
}
import { SlotMachine } from "./SlotMachine";
import { slotsSfx } from "./sounds";
import { getTheme } from "./themes";

const BET_OPTIONS_MB = [1, 5, 10, 25];
const BET_OPTIONS_NB = [1, 2, 5, 10];
const THEME = getTheme("classic");

function fmtMB(bytes: number): string {
  if (bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtNB(bytes: number): string {
  const nb = Math.round(bytes / (1024 * 1024));
  return `${nb} NB`;
}

export function SlotsPanel({ user }: WindowContentProps) {
  const [balance, setBalance] = useState<SlotsBalance | null>(null);
  const [history, setHistory] = useState<LocalHistoryEntry[]>([]);
  const [selectedBet, setSelectedBet] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPayouts, setShowPayouts] = useState(false);

  const [sessionStats, setSessionStats] = useState({ spins: 0, won: 0, lost: 0, wins: 0 });
  const [spinId, setSpinId] = useState(0);
  const [spinResult, setSpinResult] = useState<SlotsSpinResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"win" | "lose" | "jackpot" | "freespin" | "error">("win");
  const [autoSpin, setAutoSpin] = useState(false);

  const [currency, setCurrency] = useState<"storage" | "niggabytes">("storage");

  // Bonus round state
  const [bonusInfo, setBonusInfo] = useState<SlotsBonusInfo | null>(null);
  const [bonusAnnounce, setBonusAnnounce] = useState<SlotsBonusInfo | null>(null);
  const [bonusComplete, setBonusComplete] = useState<SlotsBonusInfo | null>(null);

  const spinResultRef = useRef<SlotsSpinResult | null>(null);
  const autoSpinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSpinRef = useRef(false);
  autoSpinRef.current = autoSpin;
  const busyRef = useRef(false);
  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  const currencyRef = useRef(currency);
  currencyRef.current = currency;
  const bonusInfoRef = useRef(bonusInfo);
  bonusInfoRef.current = bonusInfo;

  const isGuest = user.role === "guest";

  // Control locking: locked during bonus or free spins
  const isLocked = !!bonusInfo || !!bonusAnnounce;
  const isFreeLocked = (spinResult?.is_free_spin ?? false) || (balance?.free_spins ?? 0) > 0;

  const loadData = useCallback(async () => {
    try {
      const bal = await getSlotsBalance();
      setBalance(bal);
      // Restore active bonus from balance
      if (bal.bonus) {
        setBonusInfo(bal.bonus);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to load casino data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isGuest) void loadData();
    else setLoading(false);
  }, [loadData, isGuest]);

  useEffect(() => {
    return () => { if (autoSpinTimerRef.current) clearTimeout(autoSpinTimerRef.current); };
  }, []);

  const doSpin = useCallback(async (bet: number) => {
    if (busyRef.current) return;

    if (balanceRef.current?.free_spins && balanceRef.current.free_spins > 0) {
      slotsSfx.freeSpinTick();
    } else if (bonusInfoRef.current) {
      slotsSfx.freeSpinTick();
    } else {
      slotsSfx.coinInsert();
    }
    busyRef.current = true;
    setBusy(true);
    setSpinResult(null);
    spinResultRef.current = null;
    setMessage(null);
    setSpinId(prev => prev + 1);

    try {
      const result = await spinSlots(bet, "classic", currencyRef.current);
      spinResultRef.current = result;
      setSpinResult(result);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "spin failed.");
      setMessageType("error");
      busyRef.current = false;
      setBusy(false);
      setSpinId(0);
      setAutoSpin(false);
      setBonusInfo(null);
    }
  }, []);

  const handleSpin = useCallback(() => {
    void doSpin(selectedBet);
  }, [doSpin, selectedBet]);

  const handleSpinComplete = useCallback(() => {
    busyRef.current = false;
    setBusy(false);
    const sr = spinResultRef.current;
    if (!sr) return;

    setBalance(prev => prev ? {
      ...prev,
      bonus_bytes: sr.balance.bonus_bytes,
      effective_limit: sr.balance.effective_limit,
      used: sr.balance.used,
      available_to_bet: sr.balance.available_to_bet,
      free_spins: sr.free_spins_remaining,
      niggabytes: sr.nb_balance,
      bonus: sr.bonus,
      stats: sr.stats,
    } : prev);

    setSessionStats(prev => ({
      spins: prev.spins + 1,
      won: prev.won + sr.total_payout_bytes,
      lost: prev.lost + (sr.total_payout_bytes === 0 && !sr.is_free_spin ? sr.bet_bytes : 0),
      wins: prev.wins + (sr.wins.length > 0 ? 1 : 0),
    }));

    setMessage(sr.message);
    if (sr.has_jackpot) {
      setMessageType("jackpot");
    } else if (sr.free_spins_awarded > 0) {
      setMessageType("freespin");
    } else if (sr.wins.length > 0) {
      setMessageType("win");
    } else {
      setMessageType("lose");
    }

    setHistory(prev => [{
      id: Date.now(),
      bet_bytes: sr.bet_bytes,
      result: sr.has_jackpot ? "jackpot" : sr.wins.length > 0 ? "win" : "lose",
      payout_bytes: sr.total_payout_bytes,
      grid: sr.grid,
      created_at: new Date().toISOString(),
      currency: sr.currency,
    }, ...prev].slice(0, 5));

    // ── Bonus flow ──
    // 1. If a new bonus was awarded (from normal spin → triggers bonus)
    if (sr.bonus_awarded && !bonusInfoRef.current) {
      setBonusAnnounce(sr.bonus_awarded);
      slotsSfx.bonusTrigger();
      // After announcement delay (wait for lucky counter to settle + pause), start bonus
      autoSpinTimerRef.current = setTimeout(() => {
        setBonusAnnounce(null);
        setBonusInfo(sr.bonus_awarded);
        // Start first bonus spin
        autoSpinTimerRef.current = setTimeout(() => {
          void doSpin(selectedBet);
        }, 600);
      }, 3000);
      return;
    }

    // 2. If bonus just ended (spins_remaining = 0 and we had an active bonus)
    if (bonusInfoRef.current && sr.bonus === null) {
      // Show completion overlay
      const completedBonus = { ...bonusInfoRef.current, total_bonus: sr.bonus?.total_bonus ?? bonusInfoRef.current.total_bonus };
      // Use the last bonus response's data if available
      if (spinResultRef.current?.bonus) {
        completedBonus.total_bonus = spinResultRef.current.bonus.total_bonus;
      }
      setBonusComplete(completedBonus);
      setBonusInfo(null);
      slotsSfx.bonusComplete();
      autoSpinTimerRef.current = setTimeout(() => {
        setBonusComplete(null);
        // Resume auto-spin if it was on before bonus
        if (autoSpinRef.current) {
          const canAfford = currencyRef.current === "niggabytes"
            ? sr.nb_balance >= selectedBet
            : sr.balance.available_to_bet / (1024 * 1024) >= selectedBet;
          if (canAfford) {
            autoSpinTimerRef.current = setTimeout(() => {
              void doSpin(selectedBet);
            }, 1000);
          } else {
            setAutoSpin(false);
          }
        }
      }, 3000);
      return;
    }

    // 3. If bonus is active and continuing
    if (sr.bonus && sr.bonus.spins_remaining > 0) {
      setBonusInfo(sr.bonus);
      // Force next auto-spin
      autoSpinTimerRef.current = setTimeout(() => {
        void doSpin(selectedBet);
      }, 1800);
      return;
    }

    // 4. Normal auto-spin / free spin logic
    const shouldContinue = sr.free_spins_remaining > 0 || autoSpinRef.current;
    if (shouldContinue) {
      const canAfford = currencyRef.current === "niggabytes"
        ? sr.nb_balance >= selectedBet
        : sr.balance.available_to_bet / (1024 * 1024) >= selectedBet;
      if (sr.free_spins_remaining > 0 || canAfford) {
        autoSpinTimerRef.current = setTimeout(() => {
          void doSpin(selectedBet);
        }, sr.free_spins_remaining > 0 ? 1500 : 2000);
      } else {
        setAutoSpin(false);
      }
    }
  }, [doSpin, selectedBet]);

  // Space to spin, Escape to stop auto-spin (blocked during bonus)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Block escape during bonus round
      if (e.code === "Escape") {
        if (bonusInfo || bonusAnnounce) return; // Blocked!
        if (autoSpin) {
          setAutoSpin(false);
          if (autoSpinTimerRef.current) clearTimeout(autoSpinTimerRef.current);
        }
        return;
      }
      if (e.code === "Space" && !busy && !isGuest && balance && !autoSpin && !bonusInfo && !bonusAnnounce) {
        e.preventDefault();
        void doSpin(selectedBet);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [doSpin, busy, isGuest, balance, autoSpin, selectedBet, bonusInfo, bonusAnnounce]);

  const toggleAutoSpin = useCallback(() => {
    if (bonusInfo || bonusAnnounce) return; // Can't toggle during bonus
    if (autoSpin) {
      setAutoSpin(false);
      if (autoSpinTimerRef.current) clearTimeout(autoSpinTimerRef.current);
    } else {
      setAutoSpin(true);
      if (!busy) void doSpin(selectedBet);
    }
  }, [autoSpin, busy, doSpin, selectedBet, bonusInfo, bonusAnnounce]);

  if (isGuest) {
    return (
      <div className="slots-panel">
        <div className="slots-guest-block">
          <div className="slots-guest-icon">🎰</div>
          <div className="slots-guest-title">CASINO</div>
          <div className="slots-guest-msg">
            nice try freeloader. log in to gamble with your actual storage like a real degenerate.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="slots-panel">
        <div className="slots-loading"><span className="spinner" /> loading the casino...</div>
      </div>
    );
  }

  if (error || !balance) {
    return (
      <div className="slots-panel">
        <div className="slots-error">{error ?? "couldn't load casino."}</div>
      </div>
    );
  }

  const isNB = currency === "niggabytes";
  const nbBal = balance.niggabytes ?? 0;
  const betOptions = isNB ? BET_OPTIONS_NB : BET_OPTIONS_MB;
  const fmt = isNB ? fmtNB : fmtMB;
  const bonusMB = balance.bonus_bytes / (1024 * 1024);
  const availMB = isNB ? nbBal : balance.available_to_bet / (1024 * 1024);
  const isFreeSpin = (spinResult?.is_free_spin ?? false) || balance.free_spins > 0;
  const freeSpinsRemaining = spinResult?.free_spins_remaining ?? balance.free_spins;

  // Controls locked during bonus round or free spins
  const controlsLocked = isLocked || isFreeLocked;

  // Spin button text
  let spinButtonText = "SPIN";
  if (bonusInfo) {
    spinButtonText = bonusInfo.emoji;
  } else if (autoSpin) {
    spinButtonText = "STOP";
  } else if (isFreeSpin) {
    spinButtonText = "FREE";
  }

  return (
    <div className="slots-panel">
      {/* Top bar */}
      <div className="slots-top-bar">
        <div className="slots-balance-bar">
          {isNB ? (
            <div className="slots-bal-item">
              <span className="slots-bal-label">niggabytes</span>
              <span className="slots-bal-val">{nbBal} NB</span>
            </div>
          ) : (
            <>
              <div className="slots-bal-item">
                <span className="slots-bal-label">storage</span>
                <span className="slots-bal-val">
                  {fmtMB(balance.used)}/{balance.effective_limit === 0 ? "\u221E" : fmtMB(balance.effective_limit)}
                </span>
              </div>
              <div className="slots-bal-divider" />
              <div className={`slots-bal-item ${balance.bonus_bytes >= 0 ? "slots-bal-positive" : "slots-bal-negative"}`}>
                <span className="slots-bal-label">bonus</span>
                <span className="slots-bal-val">{balance.bonus_bytes >= 0 ? "+" : ""}{bonusMB.toFixed(1)}</span>
              </div>
              <div className="slots-bal-divider" />
              <div className="slots-bal-item">
                <span className="slots-bal-label">bettable</span>
                <span className="slots-bal-val">{Math.floor(availMB)} MB</span>
              </div>
            </>
          )}
        </div>
        <button
          className={`slots-info-btn ${showPayouts ? "slots-info-btn-active" : ""}`}
          onClick={() => setShowPayouts(!showPayouts)}
          title="payout table"
        >i</button>
      </div>

      {/* Currency toggle */}
      <div className="slots-currency-toggle">
        <button
          className={`slots-curr-btn ${!isNB ? "slots-curr-btn-active" : ""}`}
          onClick={() => { if (!busy && !controlsLocked) { setCurrency("storage"); setHistory([]); setSessionStats({ spins: 0, won: 0, lost: 0, wins: 0 }); if (!BET_OPTIONS_MB.includes(selectedBet)) setSelectedBet(1); } }}
          disabled={busy || controlsLocked}
        >{controlsLocked ? "🔒 storage" : "storage"}</button>
        <button
          className={`slots-curr-btn ${isNB ? "slots-curr-btn-active" : ""}`}
          onClick={() => { if (!busy && nbBal > 0 && !controlsLocked) { setCurrency("niggabytes"); setHistory([]); setSessionStats({ spins: 0, won: 0, lost: 0, wins: 0 }); if (!BET_OPTIONS_NB.includes(selectedBet)) setSelectedBet(1); } }}
          disabled={busy || nbBal === 0 || controlsLocked}
          title={controlsLocked ? "locked during bonus/free spins" : nbBal === 0 ? "no NiggaBytes" : undefined}
        >{controlsLocked ? "🔒 NB" : "NiggaByte"}</button>
      </div>

      {/* Payouts popup */}
      {showPayouts && (
        <div className="slots-payouts-popup" onClick={() => setShowPayouts(false)}>
          <div className="slots-payouts-popup-inner" onClick={e => e.stopPropagation()}>
            <div className="slots-payouts-header">
              <span>PAYOUTS (per line)</span>
              <button className="slots-payouts-close" onClick={() => setShowPayouts(false)}>x</button>
            </div>
            <div className="slots-payouts-list">
              <div className="slots-payouts-row slots-payouts-jackpot">
                <span>{THEME.symbolMap[THEME.jackpot]}{THEME.symbolMap[THEME.jackpot]}{THEME.symbolMap[THEME.jackpot]}</span>
                <span>25x</span>
              </div>
              <div className="slots-payouts-row">
                <span>{THEME.symbolMap[THEME.premium1]}{THEME.symbolMap[THEME.premium1]}{THEME.symbolMap[THEME.premium1]}</span>
                <span>15x</span>
              </div>
              <div className="slots-payouts-row">
                <span>{THEME.symbolMap[THEME.premium2]}{THEME.symbolMap[THEME.premium2]}{THEME.symbolMap[THEME.premium2]}</span>
                <span>10x</span>
              </div>
              <div className="slots-payouts-row">
                <span>{THEME.symbolMap[THEME.premium3]}{THEME.symbolMap[THEME.premium3]}{THEME.symbolMap[THEME.premium3]}</span>
                <span>8x</span>
              </div>
              <div className="slots-payouts-row">
                <span>{THEME.symbolMap[THEME.mid1]}{THEME.symbolMap[THEME.mid1]}{THEME.symbolMap[THEME.mid1]} / {THEME.symbolMap[THEME.mid2]}{THEME.symbolMap[THEME.mid2]}{THEME.symbolMap[THEME.mid2]}</span>
                <span>5x</span>
              </div>
              <div className="slots-payouts-row">
                <span>any triple</span>
                <span>3x</span>
              </div>
              <div className="slots-payouts-dim-note" style={{marginTop: 6, marginBottom: 2, fontWeight: 600, fontStyle: 'normal', color: 'var(--text-secondary)'}}>PAIRS</div>
              <div className="slots-payouts-row">
                <span>{THEME.symbolMap[THEME.jackpot]}{THEME.symbolMap[THEME.jackpot]} pair</span>
                <span>2x</span>
              </div>
              <div className="slots-payouts-row">
                <span>{THEME.symbolMap[THEME.premium1]}{THEME.symbolMap[THEME.premium1]} pair</span>
                <span>1.5x</span>
              </div>
              <div className="slots-payouts-row">
                <span>{THEME.symbolMap[THEME.premium2]}{THEME.symbolMap[THEME.premium2]} pair</span>
                <span>1x</span>
              </div>
            </div>
            <div className="slots-payouts-section">
              <div className="slots-payouts-subtitle">PAYLINES (5)</div>
              <div className="slots-payouts-lines-info">
                <span>- top row</span>
                <span>- middle row</span>
                <span>- bottom row</span>
                <span>\ diagonal</span>
                <span>/ diagonal</span>
              </div>
            </div>
            <div className="slots-payouts-section">
              <div className="slots-payouts-subtitle">SCATTER</div>
              <div className="slots-payouts-scatter">3x {THEME.symbolMap[THEME.scatter]} anywhere = 5 free spins</div>
              <div className="slots-payouts-scatter">4x {THEME.symbolMap[THEME.scatter]} = 8 | 5x+ {THEME.symbolMap[THEME.scatter]} = 12</div>
            </div>
          </div>
        </div>
      )}

      {/* Machine */}
      <div className="slots-main">
        <SlotMachine
          spinId={spinId}
          grid={spinResult?.grid ?? null}
          wins={spinResult?.wins ?? []}
          hasJackpot={spinResult?.has_jackpot ?? false}
          isFreeSpin={isFreeSpin}
          freeSpinsRemaining={freeSpinsRemaining}
          freeSpinsAwarded={spinResult?.free_spins_awarded ?? 0}
          onSpinComplete={handleSpinComplete}
          theme={THEME}
          message={message}
          messageType={messageType}
          totalPayout={spinResult?.total_payout_bytes ?? 0}
          winCount={spinResult?.wins.length ?? 0}
          busy={busy}
          isNB={isNB}
          bonus={bonusInfo}
          bonusAnnounce={bonusAnnounce}
          bonusComplete={bonusComplete}
        />
      </div>

      {/* Controls */}
      <div className="slots-controls">
        <div className="slots-bet-selector">
          {betOptions.map(mb => (
            <button
              key={mb}
              className={`slots-bet-btn ${selectedBet === mb ? "slots-bet-btn-active" : ""}`}
              onClick={() => !busy && !controlsLocked && setSelectedBet(mb)}
              disabled={busy || mb > availMB || controlsLocked}
            >{controlsLocked && selectedBet === mb ? `🔒${mb}` : mb}</button>
          ))}
          <span className="slots-bet-unit">{isNB ? "NB" : "MB"}</span>
        </div>
        <button
          className={`slots-spin-btn ${busy ? "slots-spin-btn-busy" : ""} ${bonusInfo ? "slots-spin-btn-bonus" : ""}`}
          onClick={!bonusInfo && autoSpin ? toggleAutoSpin : !bonusInfo ? handleSpin : undefined}
          disabled={!!bonusInfo || (!autoSpin && (busy || selectedBet > availMB))}
        >
          {spinButtonText}
        </button>
        <button
          className={`slots-auto-btn ${autoSpin ? "slots-auto-btn-active" : ""}`}
          onClick={toggleAutoSpin}
          disabled={isLocked || (!autoSpin && selectedBet > availMB)}
          title={isLocked ? "locked during bonus" : "auto-spin"}
        >
          {isLocked ? "🔒" : "AUTO"}
        </button>
      </div>

      {/* Bottom */}
      <div className="slots-bottom">
        <div className="slots-stats-row">
          <span>{sessionStats.spins} spins</span>
          <span className="slots-stat-won">+{fmt(sessionStats.won)}</span>
          <span className="slots-stat-lost">-{fmt(sessionStats.lost)}</span>
          <span className="slots-winrate">{sessionStats.spins > 0 ? Math.round((sessionStats.wins / sessionStats.spins) * 100) : 0}% wr</span>
        </div>

        <div className="slots-history">
          {history.slice(0, 5).map(h => {
              const hFmt = h.currency === "niggabytes" ? fmtNB : fmtMB;
              return (
                <div key={h.id} className={`slots-history-row ${h.result === "lose" ? "slots-h-loss" : h.result === "jackpot" ? "slots-h-jackpot" : "slots-h-win"}`}>
                  <span className="slots-h-result">{h.result.toUpperCase()}</span>
                  <span className="slots-h-amount">
                    {h.payout_bytes > 0 ? `+${hFmt(h.payout_bytes)}` : h.bet_bytes > 0 ? `-${hFmt(h.bet_bytes)}` : "free"}
                  </span>
                </div>
              );
          })}
        </div>

        <div className="slots-hint">{isLocked ? "🔒 bonus round in progress..." : "[space] spin | [esc] stop auto"}</div>
      </div>
    </div>
  );
}
