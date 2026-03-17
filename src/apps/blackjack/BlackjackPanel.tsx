import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import {
  getToken,
  getBlackjackState,
  blackjackDeal,
  blackjackHit,
  blackjackStand,
  blackjackDouble,
} from "@/lib/api";
import type { BlackjackCard, BlackjackState } from "@/lib/api";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";

// ── PVP types ──

interface PvpCardData {
  rank: string;
  suit: string;
  hidden: boolean;
  str: string;
}

interface PvpPlayerData {
  userId: number;
  username: string;
  hand: PvpCardData[];
  handValue: number;
  bet: number;
  status: string;
  result?: string;
  payout: number;
}

interface PvpTableData {
  id: string;
  phase: string;
  dealer: PvpCardData[];
  dealerValue: number;
  players: PvpPlayerData[];
  currentPlayerIdx: number;
  timer: number;
  minBet: number;
  maxBet: number;
}

interface PvpTableListItem {
  id: string;
  phase: string;
  playerCount: number;
  players: string[];
}

interface PvpResultMsg {
  userId: number;
  username: string;
  result: string;
  payout: number;
  bet: number;
  message: string;
  nb_balance: number;
}

const API_BASE = (import.meta.env["VITE_API_URL"] as string) || "";
const WS_URL = API_BASE || window.location.origin;

// ── Card Component ──

function CardView({
  card,
  index,
  animate,
  bust,
  blackjack,
  win,
}: {
  card: BlackjackCard;
  index: number;
  animate: boolean;
  bust?: boolean;
  blackjack?: boolean;
  win?: boolean;
}) {
  const isRed = card.suit === "\u2665" || card.suit === "\u2666";
  const isHidden = card.hidden;

  const cls = [
    "bj-card",
    isHidden ? "bj-card--hidden" : isRed ? "bj-card--red" : "bj-card--white",
    animate ? "bj-card--deal" : "",
    bust ? "bj-card--bust" : "",
    blackjack ? "bj-card--blackjack" : "",
    win ? "bj-card--win" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style = animate ? { animationDelay: `${index * 150}ms` } : undefined;

  if (isHidden) {
    return (
      <div className={cls} style={style}>
        <div className="bj-card-inner bj-card-back">
          <span className="bj-card-back-pattern">?</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cls} style={style}>
      <div className="bj-card-inner">
        <span className="bj-card-rank">{card.rank}</span>
        <span className="bj-card-suit-lg">{card.suit}</span>
        <span className="bj-card-rank bj-card-rank-bottom">{card.rank}</span>
      </div>
    </div>
  );
}

// ── Hand Value Badge ──

function ValueBadge({
  value,
  status,
}: {
  value: number;
  status?: string;
}) {
  const cls = [
    "bj-value-badge",
    status === "bust" ? "bj-value--bust" : "",
    status === "blackjack" ? "bj-value--blackjack" : "",
    status === "win" ? "bj-value--win" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={cls}>{value}</span>;
}

// ── Chip Button ──

function ChipBtn({
  value,
  selected,
  onClick,
}: {
  value: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`bj-chip${selected ? " bj-chip--selected" : ""}`}
      onClick={onClick}
    >
      {value}
    </button>
  );
}

// ── Solo Mode ──

function SoloMode() {
  const [phase, setPhase] = useState<"betting" | "playing" | "result">("betting");
  const [game, setGame] = useState<BlackjackState | null>(null);
  const [nb, setNb] = useState<number>(0);
  const [selectedBet, setSelectedBet] = useState(5);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [resultBanner, setResultBanner] = useState("");
  const [dealerRevealing, setDealerRevealing] = useState(false);
  const resultTimeout = useRef<ReturnType<typeof setTimeout>>();
  const dealTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Load initial state
  useEffect(() => {
    getBlackjackState()
      .then((s) => {
        setNb(s.nb_balance);
        if (s.active) {
          setGame(s);
          setPhase("playing");
        }
      })
      .catch(() => {});
    return () => {
      if (resultTimeout.current) clearTimeout(resultTimeout.current);
      if (dealTimeout.current) clearTimeout(dealTimeout.current);
    };
  }, []);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(""), 3000);
  }, []);

  const handleResult = useCallback((state: BlackjackState) => {
    if (state.status !== "playing") {
      // Show dealer reveal animation first
      setDealerRevealing(true);
      const revealTime = state.dealerHand.length > 2 ? 400 + (state.dealerHand.length - 2) * 600 : 400;
      dealTimeout.current = setTimeout(() => {
        setDealerRevealing(false);
        setGame(state);
        setNb(state.nb_balance);
        setPhase("result");
        setResultBanner(state.message);
        resultTimeout.current = setTimeout(() => {
          setResultBanner("");
          setPhase("betting");
          setGame(null);
        }, 3000);
      }, revealTime);
      // Show dealer cards immediately for the animation
      setGame(state);
      setNb(state.nb_balance);
    } else {
      setGame(state);
      setNb(state.nb_balance);
    }
  }, []);

  const doDeal = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const state = await blackjackDeal(selectedBet);
      setDealing(true);
      setGame(state);
      setNb(state.nb_balance);

      // After deal animation, check for instant results
      dealTimeout.current = setTimeout(() => {
        setDealing(false);
        if (state.status !== "playing") {
          // Instant blackjack or dealer blackjack
          setPhase("result");
          setResultBanner(state.message);
          setNb(state.nb_balance);
          resultTimeout.current = setTimeout(() => {
            setResultBanner("");
            setPhase("betting");
            setGame(null);
          }, 3000);
        } else {
          setPhase("playing");
        }
      }, 700);
    } catch (e) {
      showError(e instanceof Error ? e.message : "deal failed");
    }
    setLoading(false);
  }, [selectedBet, showError]);

  const doHit = useCallback(async () => {
    setLoading(true);
    try {
      const state = await blackjackHit();
      handleResult(state);
    } catch (e) {
      showError(e instanceof Error ? e.message : "hit failed");
    }
    setLoading(false);
  }, [handleResult, showError]);

  const doStand = useCallback(async () => {
    setLoading(true);
    try {
      const state = await blackjackStand();
      handleResult(state);
    } catch (e) {
      showError(e instanceof Error ? e.message : "stand failed");
    }
    setLoading(false);
  }, [handleResult, showError]);

  const doDouble = useCallback(async () => {
    setLoading(true);
    try {
      const state = await blackjackDouble();
      handleResult(state);
    } catch (e) {
      showError(e instanceof Error ? e.message : "double failed");
    }
    setLoading(false);
  }, [handleResult, showError]);

  const isBust = game?.status === "bust";
  const isBJ = game?.status === "blackjack";
  const isWin = game?.status === "win";
  const isLose = game?.status === "lose";
  const isPush = game?.status === "push";
  const isFinished = isBust || isBJ || isWin || isLose || isPush;

  const chips = [1, 2, 5, 10, 20];

  return (
    <div className="bj-solo">
      {/* Balance bar */}
      <div className="bj-balance-bar">
        <span className="bj-balance-nb">{nb} NB</span>
        {game && <span className="bj-balance-bet">bet: {game.bet} NB</span>}
      </div>

      {/* Result banner */}
      {resultBanner && (
        <div
          className={`bj-banner${
            isBJ || isWin ? " bj-banner--win" : isPush ? " bj-banner--push" : " bj-banner--lose"
          }`}
        >
          {resultBanner}
        </div>
      )}

      {error && <div className="bj-error">{error}</div>}

      {/* Dealer section */}
      <div className="bj-section">
        <div className="bj-section-label">DEALER</div>
        <div className="bj-hand-row">
          <div className="bj-cards">
            {game?.dealerHand.map((c, i) => (
              <CardView
                key={`d-${i}`}
                card={c}
                index={i}
                animate={dealing}
                bust={false}
                blackjack={isBJ && !c.hidden}
                win={isLose && !c.hidden}
              />
            ))}
            {!game && (
              <div className="bj-placeholder-cards">
                <div className="bj-card bj-card--placeholder" />
                <div className="bj-card bj-card--placeholder" />
              </div>
            )}
          </div>
          {game && game.dealerHand.some((c) => !c.hidden) && (
            <ValueBadge
              value={game.dealerValue}
              status={isFinished && !isBust ? (isLose ? "win" : "") : ""}
            />
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="bj-divider">
        <span className="bj-divider-text">vs</span>
      </div>

      {/* Player section */}
      <div className="bj-section">
        <div className="bj-section-label">YOU</div>
        <div className="bj-hand-row">
          <div className="bj-cards">
            {game?.playerHand.map((c, i) => (
              <CardView
                key={`p-${i}`}
                card={c}
                index={i}
                animate={dealing}
                bust={isBust}
                blackjack={isBJ}
                win={isWin}
              />
            ))}
            {!game && (
              <div className="bj-placeholder-cards">
                <div className="bj-card bj-card--placeholder" />
                <div className="bj-card bj-card--placeholder" />
              </div>
            )}
          </div>
          {game && (
            <ValueBadge
              value={game.playerValue}
              status={isBust ? "bust" : isBJ ? "blackjack" : isWin ? "win" : ""}
            />
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="bj-controls">
        {phase === "betting" && !dealing && (
          <div className="bj-bet-area">
            <div className="bj-chips-row">
              {chips.map((v) => (
                <ChipBtn
                  key={v}
                  value={v}
                  selected={selectedBet === v}
                  onClick={() => setSelectedBet(v)}
                />
              ))}
            </div>
            <button
              className="bj-deal-btn"
              onClick={doDeal}
              disabled={loading || nb < selectedBet}
            >
              {nb < selectedBet ? "BROKE" : "DEAL"}
            </button>
          </div>
        )}

        {phase === "playing" && !dealing && !dealerRevealing && (
          <div className="bj-action-btns">
            <button className="bj-action-btn bj-action--hit" onClick={doHit} disabled={loading}>
              HIT
            </button>
            <button className="bj-action-btn bj-action--stand" onClick={doStand} disabled={loading}>
              STAND
            </button>
            {game?.playerHand.length === 2 && (
              <button className="bj-action-btn bj-action--double" onClick={doDouble} disabled={loading}>
                DOUBLE
              </button>
            )}
          </div>
        )}

        {dealing && (
          <div className="bj-dealing-text">dealing...</div>
        )}

        {dealerRevealing && (
          <div className="bj-dealing-text">dealer plays...</div>
        )}
      </div>
    </div>
  );
}

// ── PVP Mode (existing socket logic, new card rendering) ──

function PvpMode({ user }: { user: WindowContentProps["user"] }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [tables, setTables] = useState<PvpTableListItem[]>([]);
  const [currentTable, setCurrentTable] = useState<PvpTableData | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [betAmount, setBetAmount] = useState(10);
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState("");
  const [resultMsg, setResultMsg] = useState<PvpResultMsg | null>(null);
  const [nbBalance, setNbBalance] = useState<number | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const s = io(WS_URL, { auth: { token }, transports: ["websocket"] });
    setSocket(s);

    s.on("connect", () => {
      s.emit("blackjack:tables", (list: PvpTableListItem[]) => setTables(list));
    });
    s.on("blackjack:tables", (list: PvpTableListItem[]) => setTables(list));
    s.on("blackjack:state", (state: PvpTableData) => setCurrentTable(state));
    s.on("blackjack:timer", (t: number) => setTimer(t));
    s.on("blackjack:result", (r: PvpResultMsg) => {
      setResultMsg(r);
      if (r.userId === (user as unknown as { id?: number }).id) {
        setNbBalance(r.nb_balance);
      }
      if (resultTimer.current) clearTimeout(resultTimer.current);
      resultTimer.current = setTimeout(() => setResultMsg(null), 5000);
    });

    return () => { s.disconnect(); };
  }, [user]);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(""), 3000);
  }, []);

  const createTable = useCallback(() => {
    socket?.emit("blackjack:create", (r: { ok: boolean; tableId?: string; error?: string }) => {
      if (r.ok && r.tableId) setTableId(r.tableId);
      else showError(r.error ?? "failed to create table");
    });
  }, [socket, showError]);

  const joinTable = useCallback((id: string) => {
    socket?.emit("blackjack:join", { tableId: id }, (r: { ok: boolean; error?: string }) => {
      if (r.ok) setTableId(id);
      else showError(r.error ?? "failed to join");
    });
  }, [socket, showError]);

  const leaveTable = useCallback(() => {
    if (tableId) socket?.emit("blackjack:leave", { tableId }, () => {});
    setTableId(null);
    setCurrentTable(null);
    setResultMsg(null);
    socket?.emit("blackjack:tables", (list: PvpTableListItem[]) => setTables(list));
  }, [socket, tableId]);

  const placeBet = useCallback(() => {
    if (!tableId) return;
    socket?.emit("blackjack:bet", { tableId, amount: betAmount }, (r: { ok: boolean; error?: string }) => {
      if (!r.ok) showError(r.error ?? "bet failed");
    });
  }, [socket, tableId, betAmount, showError]);

  const doHit = useCallback(() => {
    if (!tableId) return;
    socket?.emit("blackjack:hit", { tableId }, (r: { ok: boolean; error?: string }) => {
      if (!r.ok) showError(r.error ?? "hit failed");
    });
  }, [socket, tableId, showError]);

  const doStand = useCallback(() => {
    if (!tableId) return;
    socket?.emit("blackjack:stand", { tableId }, (r: { ok: boolean; error?: string }) => {
      if (!r.ok) showError(r.error ?? "stand failed");
    });
  }, [socket, tableId, showError]);

  const doDouble = useCallback(() => {
    if (!tableId) return;
    socket?.emit("blackjack:double", { tableId }, (r: { ok: boolean; error?: string }) => {
      if (!r.ok) showError(r.error ?? "double failed");
    });
  }, [socket, tableId, showError]);

  const myPlayer = currentTable?.players.find((p) => p.username === user.username);
  const isMyTurn = currentTable
    ? currentTable.phase === "player_turns" &&
      currentTable.players[currentTable.currentPlayerIdx]?.username === user.username
    : false;

  // Lobby
  if (!tableId) {
    return (
      <div className="bj-pvp">
        <div className="bj-pvp-header">
          <h3>tables</h3>
          <button className="btn btn-sm" onClick={createTable}>+ new table</button>
        </div>
        {error && <div className="bj-error">{error}</div>}
        <div className="bj-table-list">
          {tables.length === 0 && (
            <div className="bj-empty">no tables. create one and flex on the poors.</div>
          )}
          {tables.map((t) => (
            <div key={t.id} className="bj-table-row" onClick={() => joinTable(t.id)}>
              <div className="bj-table-info">
                <span className="bj-table-name">{t.id.slice(0, 8)}</span>
                <span className="bj-table-players">{t.playerCount}/4</span>
                <span className="bj-table-players-list">{t.players.join(", ")}</span>
              </div>
              <span className="bj-table-state">{t.phase}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Table
  const t = currentTable;
  const timerDisplay = t ? (timer > 0 ? timer : t.timer) : 0;
  const showBetting = t?.phase === "betting" && myPlayer && myPlayer.bet === 0;
  const showActions = isMyTurn && myPlayer?.status === "playing";

  return (
    <div className="bj-pvp">
      <div className="bj-pvp-header">
        <h3>table {tableId?.slice(0, 8)}</h3>
        <div className="bj-pvp-header-right">
          {nbBalance !== null && <span className="bj-pvp-nb">{nbBalance} NB</span>}
          {timerDisplay > 0 && (
            <span className={`bj-timer${timerDisplay <= 5 ? " bj-timer--urgent" : ""}`}>
              {timerDisplay}s
            </span>
          )}
          <button className="btn btn-sm" onClick={leaveTable}>leave</button>
        </div>
      </div>

      {error && <div className="bj-error">{error}</div>}

      {/* Dealer */}
      {t && t.dealer.length > 0 && (
        <div className="bj-section">
          <div className="bj-section-label">DEALER ({t.dealerValue})</div>
          <div className="bj-hand-row">
            <div className="bj-cards">
              {t.dealer.map((c, i) => (
                <CardView
                  key={i}
                  card={{ rank: c.rank, suit: c.suit, hidden: c.hidden }}
                  index={i}
                  animate={false}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {resultMsg && (
        <div className={`bj-banner${
          resultMsg.result === "win" || resultMsg.result === "blackjack"
            ? " bj-banner--win"
            : resultMsg.result === "push"
            ? " bj-banner--push"
            : " bj-banner--lose"
        }`}>
          {resultMsg.username}: {resultMsg.message}
        </div>
      )}

      {t?.phase === "waiting" && (
        <div className="bj-empty">waiting for players...</div>
      )}

      {/* Players */}
      <div className="bj-pvp-players">
        {t?.players.map((p, i) => {
          const isActive = t.phase === "player_turns" && i === t.currentPlayerIdx;
          const isYou = p.username === user.username;
          return (
            <div key={p.userId} className={`bj-pvp-player${isActive ? " bj-pvp-player--active" : ""}${isYou ? " bj-pvp-player--you" : ""}`}>
              <div className="bj-pvp-player-info">
                <span className={isYou ? "bj-accent" : ""}>{p.username}{isYou ? " (you)" : ""}</span>
                {p.bet > 0 && <span className="bj-pvp-bet">{p.bet} NB</span>}
                {p.result && (
                  <span className={`bj-pvp-result bj-pvp-result--${p.result}`}>
                    {p.result.toUpperCase()}{p.payout > 0 ? ` +${p.payout}` : ""}
                  </span>
                )}
              </div>
              {p.hand.length > 0 && (
                <div className="bj-hand-row">
                  <div className="bj-cards bj-cards--sm">
                    {p.hand.map((c, ci) => (
                      <CardView
                        key={ci}
                        card={{ rank: c.rank, suit: c.suit, hidden: false }}
                        index={ci}
                        animate={false}
                      />
                    ))}
                  </div>
                  <ValueBadge value={p.handValue} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Betting */}
      {showBetting && (
        <div className="bj-bet-area">
          <div className="bj-chips-row">
            {[5, 10, 25, 50, 100].map((v) => (
              <ChipBtn key={v} value={v} selected={betAmount === v} onClick={() => setBetAmount(v)} />
            ))}
          </div>
          <button className="bj-deal-btn" onClick={placeBet}>PLACE BET</button>
        </div>
      )}

      {/* Actions */}
      {showActions && (
        <div className="bj-action-btns">
          <button className="bj-action-btn bj-action--hit" onClick={doHit}>HIT</button>
          <button className="bj-action-btn bj-action--stand" onClick={doStand}>STAND</button>
          {myPlayer?.hand.length === 2 && (
            <button className="bj-action-btn bj-action--double" onClick={doDouble}>DOUBLE</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Panel with Tabs ──

export function BlackjackPanel({ user }: WindowContentProps) {
  const [tab, setTab] = useState<"solo" | "pvp">("solo");

  return (
    <div className="bj-panel">
      <div className="bj-tabs">
        <button
          className={`bj-tab${tab === "solo" ? " bj-tab--active" : ""}`}
          onClick={() => setTab("solo")}
        >
          SOLO
        </button>
        <button
          className={`bj-tab${tab === "pvp" ? " bj-tab--active" : ""}`}
          onClick={() => setTab("pvp")}
        >
          TABLES
        </button>
      </div>
      <div className="bj-content">
        {tab === "solo" ? <SoloMode /> : <PvpMode user={user} />}
      </div>
    </div>
  );
}
