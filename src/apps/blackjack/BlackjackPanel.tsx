import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import { getToken } from "@/lib/api";
import { io, Socket } from "socket.io-client";

interface CardData {
  rank: string;
  suit: string;
  hidden: boolean;
  str: string;
}

interface PlayerData {
  userId: number;
  username: string;
  hand: CardData[];
  handValue: number;
  bet: number;
  status: string;
  result?: string;
  payout: number;
}

interface TableData {
  id: string;
  phase: string;
  dealer: CardData[];
  dealerValue: number;
  players: PlayerData[];
  currentPlayerIdx: number;
  timer: number;
  minBet: number;
  maxBet: number;
}

interface TableListItem {
  id: string;
  phase: string;
  playerCount: number;
  players: string[];
}

interface ResultMsg {
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

export function BlackjackPanel({ user }: WindowContentProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [tables, setTables] = useState<TableListItem[]>([]);
  const [currentTable, setCurrentTable] = useState<TableData | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [betAmount, setBetAmount] = useState(10);
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState("");
  const [resultMsg, setResultMsg] = useState<ResultMsg | null>(null);
  const [nbBalance, setNbBalance] = useState<number | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout>>();

  // Connect socket
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const s = io(WS_URL, { auth: { token }, transports: ["websocket"] });
    setSocket(s);

    s.on("connect", () => {
      s.emit("blackjack:tables", (list: TableListItem[]) => {
        setTables(list);
      });
    });

    s.on("blackjack:tables", (list: TableListItem[]) => {
      setTables(list);
    });

    s.on("blackjack:state", (state: TableData) => {
      setCurrentTable(state);
    });

    s.on("blackjack:timer", (t: number) => {
      setTimer(t);
    });

    s.on("blackjack:result", (r: ResultMsg) => {
      setResultMsg(r);
      if (r.userId === (user as unknown as { id?: number }).id) {
        setNbBalance(r.nb_balance);
      }
      if (resultTimer.current) clearTimeout(resultTimer.current);
      resultTimer.current = setTimeout(() => setResultMsg(null), 5000);
    });

    return () => {
      s.disconnect();
    };
  }, [user]);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(""), 3000);
  }, []);

  const createTable = useCallback(() => {
    socket?.emit("blackjack:create", (r: { ok: boolean; tableId?: string; error?: string }) => {
      if (r.ok && r.tableId) {
        setTableId(r.tableId);
      } else {
        showError(r.error ?? "failed to create table");
      }
    });
  }, [socket, showError]);

  const joinTable = useCallback((id: string) => {
    socket?.emit("blackjack:join", { tableId: id }, (r: { ok: boolean; error?: string }) => {
      if (r.ok) {
        setTableId(id);
      } else {
        showError(r.error ?? "failed to join");
      }
    });
  }, [socket, showError]);

  const leaveTable = useCallback(() => {
    if (tableId) {
      socket?.emit("blackjack:leave", { tableId }, () => {});
    }
    setTableId(null);
    setCurrentTable(null);
    setResultMsg(null);
    // Refresh table list
    socket?.emit("blackjack:tables", (list: TableListItem[]) => {
      setTables(list);
    });
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

  // Find our player
  const myPlayer = currentTable?.players.find(p => p.username === user.username);
  const isMyTurn = currentTable
    ? currentTable.phase === "player_turns" &&
      currentTable.players[currentTable.currentPlayerIdx]?.username === user.username
    : false;

  // Lobby view
  if (!tableId) {
    return (
      <div className="bj-panel">
        <div className="bj-lobby">
          <div className="bj-lobby-header">
            <h3>blackjack tables</h3>
            <button className="btn btn-sm" onClick={createTable}>+ new table</button>
          </div>

          {error && <div style={{ color: "var(--error)", fontSize: 13, marginBottom: 8 }}>{error}</div>}

          <div className="bj-table-list">
            {tables.length === 0 && (
              <div className="bj-empty">
                no tables yet. create one and flex on the poors.
              </div>
            )}
            {tables.map(t => (
              <div key={t.id} className="bj-table-row" onClick={() => joinTable(t.id)}>
                <div className="bj-table-info">
                  <span className="bj-table-name">{t.id}</span>
                  <span className="bj-table-players">{t.playerCount}/4 players</span>
                  <span style={{ color: "var(--text-ghost)", fontSize: 12 }}>
                    {t.players.join(", ")}
                  </span>
                </div>
                <span className="bj-table-state">{t.phase}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Table view
  const t = currentTable;
  const timerDisplay = t ? (timer > 0 ? timer : t.timer) : 0;
  const showBetting = t?.phase === "betting" && myPlayer && myPlayer.bet === 0;
  const showActions = isMyTurn && myPlayer?.status === "playing";

  return (
    <div className="bj-panel">
      <div className="bj-game">
        <div className="bj-game-header">
          <h3>table {tableId?.slice(0, 8)}</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {nbBalance !== null && (
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{nbBalance} NB</span>
            )}
            <span className={`bj-timer${timerDisplay <= 5 && timerDisplay > 0 ? " bj-timer--urgent" : ""}`}>
              {timerDisplay > 0 ? `${timerDisplay}s` : ""}
            </span>
            <button className="btn btn-sm" onClick={leaveTable}>leave</button>
          </div>
        </div>

        {error && <div style={{ color: "var(--error)", fontSize: 13 }}>{error}</div>}

        {/* Dealer */}
        {t && t.dealer.length > 0 && (
          <div className="bj-dealer-area">
            <div className="bj-area-label">
              dealer {t.phase !== "betting" && t.phase !== "waiting" ? `(${t.dealerValue})` : ""}
            </div>
            <div className="bj-hand">
              {t.dealer.map((c, i) => (
                <span key={i} className={`bj-card${c.hidden ? " bj-card--hidden" : c.suit === "♥" || c.suit === "♦" ? " bj-card--red" : " bj-card--black"}`}>
                  {c.str}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Result */}
        {resultMsg && (
          <div className={`bj-result${resultMsg.result === "win" || resultMsg.result === "blackjack" ? " bj-result--win" : resultMsg.result === "push" ? " bj-result--push" : " bj-result--lose"}`}>
            {resultMsg.username}: {resultMsg.message}
          </div>
        )}

        {/* Waiting state */}
        {t?.phase === "waiting" && (
          <div className="bj-empty">
            waiting for players... share the table with friends.
          </div>
        )}

        {/* Players */}
        <div className="bj-players-grid">
          {t?.players.map((p, i) => {
            const isActive = t.phase === "player_turns" && i === t.currentPlayerIdx;
            const isYou = p.username === user.username;
            return (
              <div
                key={p.userId}
                className={`bj-player-row${isActive ? " bj-player-row--active" : ""}${isYou ? " bj-player-row--you" : ""}`}
              >
                <div className={`bj-player-name${isYou ? " bj-player-name--you" : ""}`}>
                  {p.username}{isYou ? " (you)" : ""}
                  {p.bet > 0 && <span className="bj-player-bet"> — bet: {p.bet} NB</span>}
                  {p.result && (
                    <span style={{
                      marginLeft: 8,
                      color: p.result === "win" || p.result === "blackjack" ? "var(--success)" : p.result === "push" ? "var(--text-muted)" : "var(--error)",
                      fontSize: 12,
                    }}>
                      {p.result.toUpperCase()}{p.payout > 0 ? ` +${p.payout}` : ""}
                    </span>
                  )}
                </div>
                {p.hand.length > 0 && (
                  <div className="bj-hand">
                    {p.hand.map((c, ci) => (
                      <span key={ci} className={`bj-card${c.suit === "♥" || c.suit === "♦" ? " bj-card--red" : " bj-card--black"}`}>
                        {c.str}
                      </span>
                    ))}
                    <span className="bj-hand-value">= {p.handValue}</span>
                  </div>
                )}
                {!p.hand.length && p.status === "betting" && p.bet > 0 && (
                  <span style={{ color: "var(--text-ghost)", fontSize: 12 }}>bet placed ✓</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Betting controls */}
        {showBetting && (
          <div className="bj-actions">
            <div className="bj-bet-wrap">
              <input
                type="number"
                className="bj-bet-input"
                value={betAmount}
                onChange={(e) => setBetAmount(Math.max(1, parseInt(e.target.value) || 0))}
                min={t?.minBet ?? 5}
                max={t?.maxBet ?? 500}
              />
              <span style={{ color: "var(--text-ghost)", fontSize: 12 }}>NB</span>
            </div>
            <button className="btn btn-sm" onClick={placeBet}>place bet</button>
            {[10, 25, 50, 100].map(v => (
              <button
                key={v}
                className="btn btn-sm"
                style={{ fontSize: 11, padding: "2px 6px" }}
                onClick={() => setBetAmount(v)}
              >
                {v}
              </button>
            ))}
          </div>
        )}

        {/* Action controls */}
        {showActions && (
          <div className="bj-actions">
            <button className="btn btn-sm" onClick={doHit}>hit</button>
            <button className="btn btn-sm" onClick={doStand}>stand</button>
            {myPlayer?.hand.length === 2 && (
              <button className="btn btn-sm" onClick={doDouble}>double</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
