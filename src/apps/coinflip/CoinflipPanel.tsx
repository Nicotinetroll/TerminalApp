import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import type { CoinflipBalance, CoinflipHistoryEntry } from "@/lib/api";
import { getCoinflipBalance, flipCoin, getCoinflipHistory, ApiError } from "@/lib/api";
import { coinSfx } from "./sounds";

const ANIM_MS = 700;

interface BetPreset {
  label: string;
  fraction: number;
}

const BET_PRESETS: BetPreset[] = [
  { label: "50", fraction: 0 },
  { label: "⅓", fraction: 1 / 3 },
  { label: "½", fraction: 1 / 2 },
  { label: "ALL", fraction: 1 },
];

function fmtMB(bytes: number): string {
  if (bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function getBetMB(preset: BetPreset, availMB: number): number {
  if (preset.fraction === 0) return 50;
  return Math.max(1, Math.floor(availMB * preset.fraction));
}

// Inline icon components — skull (heads) and starburst (tails)
function SkullIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d="M20 38 C20 22, 16 12, 32 12 C48 12, 44 22, 44 38" fill="currentColor" opacity="0.15" />
      <path d="M20 38 C20 22, 16 12, 32 12 C48 12, 44 22, 44 38" />
      <path d="M20 38 L20 42 Q32 48, 44 42 L44 38" />
      <circle cx="26" cy="28" r="3.5" fill="currentColor" />
      <circle cx="38" cy="28" r="3.5" fill="currentColor" />
      <line x1="26" y1="42" x2="26" y2="38" /><line x1="32" y1="43" x2="32" y2="38" /><line x1="38" y1="42" x2="38" y2="38" />
    </svg>
  );
}

function StarIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d="M32 8 L36 22 L44 12 L38 24 L52 20 L40 28 L54 34 L38 32 L44 46 L34 34 L32 52 L30 34 L20 46 L26 32 L10 34 L24 28 L12 20 L26 24 L20 12 L28 22 Z" fill="currentColor" opacity="0.12" />
      <path d="M32 8 L36 22 L44 12 L38 24 L52 20 L40 28 L54 34 L38 32 L44 46 L34 34 L32 52 L30 34 L20 46 L26 32 L10 34 L24 28 L12 20 L26 24 L20 12 L28 22 Z" />
    </svg>
  );
}

function SideIcon({ side, size = 16 }: { side: string; size?: number }) {
  return side === "heads" ? <SkullIcon size={size} /> : <StarIcon size={size} />;
}

type CoinSide = "heads" | "tails";

export function CoinflipPanel({ user }: WindowContentProps) {
  const [balance, setBalance] = useState<CoinflipBalance | null>(null);
  const [history, setHistory] = useState<CoinflipHistoryEntry[]>([]);
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<"storage" | "niggabytes">("storage");

  const [flipping, setFlipping] = useState(false);
  const [landSide, setLandSide] = useState<CoinSide | null>(null);
  const [message, setMessage] = useState("\u00A0");
  const [messageType, setMessageType] = useState<"win" | "lose" | "idle">("idle");
  const [payout, setPayout] = useState("\u00A0");
  const [payoutType, setPayoutType] = useState<"win" | "lose" | "idle">("idle");

  const isGuest = user.role === "guest";
  const isNB = currency === "niggabytes";

  const mountedRef = useRef(true);
  const flipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const currencyRef = useRef(currency);
  currencyRef.current = currency;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
    };
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [bal, hist] = await Promise.all([getCoinflipBalance(), getCoinflipHistory()]);
      if (!mountedRef.current) return;
      setBalance(bal);
      setHistory(hist.slice(0, 5));
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof ApiError ? err.message : "failed to load coinflip data");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isGuest) void loadData();
    else setLoading(false);
  }, [loadData, isGuest]);

  const doFlip = useCallback(async (betMB: number, choice: CoinSide) => {
    if (flipping) return;

    coinSfx.flip();
    setFlipping(true);
    setLandSide(null);
    setMessage("\u00A0");
    setMessageType("idle");
    setPayout("\u00A0");
    setPayoutType("idle");

    try {
      const res = await flipCoin(betMB, choice, currencyRef.current);
      if (!mountedRef.current) return;

      flipTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;

        setLandSide(res.outcome as CoinSide);
        setFlipping(false);

        if (res.won) coinSfx.win();
        else coinSfx.lose();

        setMessage(res.message);
        setMessageType(res.won ? "win" : "lose");

        if (currencyRef.current === "niggabytes") {
          setPayout(res.won ? `+${betMB} NB` : `-${betMB} NB`);
        } else {
          setPayout(res.won ? `+${fmtMB(res.bet_bytes)}` : `-${fmtMB(res.bet_bytes)}`);
        }
        setPayoutType(res.won ? "win" : "lose");

        setBalance(prev => prev ? {
          ...prev,
          bonus_bytes: res.balance.bonus_bytes,
          effective_limit: res.balance.effective_limit,
          used: res.balance.used,
          available_to_bet: res.balance.available_to_bet,
          niggabytes: res.nb_balance,
          streak: res.streak,
        } : prev);

        setHistory(prev => [{
          id: Date.now(),
          bet_bytes: res.bet_bytes,
          choice: res.choice,
          outcome: res.outcome,
          payout_bytes: res.payout_bytes,
          created_at: new Date().toISOString(),
        }, ...prev].slice(0, 5));
      }, ANIM_MS);
    } catch (err) {
      if (!mountedRef.current) return;
      setMessage(err instanceof ApiError ? err.message : "flip failed.");
      setMessageType("lose");
      setFlipping(false);
    }
  }, [flipping]);

  const nbBal = balance?.niggabytes ?? 0;
  const availMB = isNB ? nbBal : (balance ? balance.available_to_bet / (1024 * 1024) : 0);
  const currentPreset = BET_PRESETS[selectedPreset]!;
  const currentBetMB = getBetMB(currentPreset, availMB);
  const canBet = currentBetMB >= 1 && currentBetMB <= availMB;

  // Auto-fallback to highest affordable preset when current becomes unaffordable
  useEffect(() => {
    if (!balance || flipping) return;
    const mb = getBetMB(BET_PRESETS[selectedPreset]!, availMB);
    if (mb <= availMB && availMB >= 1) return;
    for (let i = BET_PRESETS.length - 1; i >= 0; i--) {
      const tryMB = getBetMB(BET_PRESETS[i]!, availMB);
      if (tryMB <= availMB && availMB >= 1) {
        setSelectedPreset(i);
        return;
      }
    }
    setSelectedPreset(0);
  }, [balance, availMB, selectedPreset, flipping]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (flipping || isGuest || !balance) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const panel = panelRef.current;
      if (!panel) return;
      const win = panel.closest('.window-frame');
      if (!win) return;
      const active = document.activeElement;
      if (active && active !== document.body && !win.contains(active)) return;

      const k = e.key.toLowerCase();
      if ((k === "h" || k === "t") && canBet) {
        e.preventDefault();
        void doFlip(currentBetMB, k === "h" ? "heads" : "tails");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [doFlip, flipping, isGuest, balance, currentBetMB, canBet]);

  if (isGuest) {
    return (
      <div className="cf-panel" ref={panelRef}>
        <div className="cf-center-msg">
          <div className="cf-center-title">COINFLIP</div>
          <div className="cf-center-sub">log in to flip coins, freeloader.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="cf-panel" ref={panelRef}>
        <div className="cf-center-msg"><span className="spinner" /> loading...</div>
      </div>
    );
  }

  if (error || !balance) {
    return (
      <div className="cf-panel" ref={panelRef}>
        <div className="cf-center-msg cf-err">{error ?? "couldn't load."}</div>
      </div>
    );
  }

  const bonusMB = balance.bonus_bytes / (1024 * 1024);

  let coinClass = "cf-coin";
  if (flipping) coinClass += " cf-coin-flipping";
  else if (landSide === "tails") coinClass += " cf-coin-landed-tails";

  return (
    <div className="cf-panel" ref={panelRef}>
      {/* Currency toggle */}
      <div className="slots-currency-toggle">
        <button
          className={`slots-curr-btn ${!isNB ? "slots-curr-btn-active" : ""}`}
          onClick={() => !flipping && setCurrency("storage")}
          disabled={flipping}
        >storage</button>
        <button
          className={`slots-curr-btn ${isNB ? "slots-curr-btn-active" : ""}`}
          onClick={() => !flipping && nbBal > 0 && setCurrency("niggabytes")}
          disabled={flipping || nbBal === 0}
          title={nbBal === 0 ? "no NiggaBytes" : undefined}
        >NiggaByte</button>
      </div>

      {/* Balance */}
      <div className="cf-bal">
        {isNB ? (
          <span className="cf-bal-avail" style={{ color: "#fbbf24" }}>{nbBal} NB available</span>
        ) : (
          <>
            <span className={balance.bonus_bytes >= 0 ? "cf-bal-pos" : "cf-bal-neg"}>
              {balance.bonus_bytes >= 0 ? "+" : ""}{bonusMB.toFixed(1)} MB
            </span>
            <span className="cf-bal-sep">&middot;</span>
            <span className="cf-bal-avail">{Math.floor(availMB)} MB available</span>
          </>
        )}
      </div>

      {/* Coin */}
      <div className="cf-stage">
        <div className={coinClass}>
          <div className="cf-face cf-face-h"><SkullIcon size={56} /></div>
          <div className="cf-face cf-face-t"><StarIcon size={56} /></div>
        </div>
        <div className={`cf-shadow ${flipping ? "cf-shadow-flip" : ""}`} />
      </div>

      {/* Result */}
      <div className="cf-result">
        <div className={`cf-msg cf-msg-${messageType}`}>{message}</div>
        <div className={`cf-pay cf-pay-${payoutType}`}>{payout}</div>
      </div>

      {/* Bets */}
      <div className="cf-bets">
        {BET_PRESETS.map((p, i) => {
          const mb = getBetMB(p, availMB);
          const tooRich = mb > availMB || availMB < 1;
          return (
            <button
              key={p.label}
              className={`cf-bet ${selectedPreset === i ? "cf-bet-on" : ""}`}
              onClick={() => !flipping && setSelectedPreset(i)}
              disabled={flipping || tooRich}
            >
              <span className="cf-bet-label">{p.label}</span>
              <span className="cf-bet-mb">{mb} {isNB ? "NB" : "MB"}</span>
            </button>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="cf-actions">
        <button className="cf-go cf-go-h" onClick={() => doFlip(currentBetMB, "heads")} disabled={flipping || !canBet}>
          <SkullIcon size={26} />
        </button>
        <button className="cf-go cf-go-t" onClick={() => doFlip(currentBetMB, "tails")} disabled={flipping || !canBet}>
          <StarIcon size={26} />
        </button>
      </div>

      {/* History — icons instead of text */}
      <div className="cf-hist">
        {Array.from({ length: 5 }).map((_, i) => {
          const h = history[i];
          if (!h) return <div key={i} className="cf-hist-row cf-hist-empty">&nbsp;</div>;
          const won = h.payout_bytes > 0;
          return (
            <div key={h.id} className={`cf-hist-row ${won ? "cf-hist-w" : "cf-hist-l"}`}>
              <SideIcon side={h.choice} size={12} />
              <span className="cf-hist-arrow">{won ? "=" : "≠"}</span>
              <SideIcon side={h.outcome} size={12} />
              <span className="cf-hist-amt">
                {won ? `+${fmtMB(h.bet_bytes)}` : `-${fmtMB(h.bet_bytes)}`}
              </span>
            </div>
          );
        })}
      </div>

      <div className="cf-keys">
        <span className="cf-key-item">[H] <SkullIcon size={10} /></span>
        <span className="cf-key-sep">&middot;</span>
        <span className="cf-key-item">[T] <StarIcon size={10} /></span>
      </div>
    </div>
  );
}
