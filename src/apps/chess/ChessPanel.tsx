import { useState, useCallback, useEffect } from "react";
import { chessCreate, chessMyGames } from "@/lib/api";
import type { User } from "@/types/terminal";
import type { CreateGameResponse, MyGameEntry } from "./types";
import { BotSelector } from "./BotSelector";
import { ChessGame } from "./ChessGame";

type View = "lobby" | "bot-select" | "create-room" | "game";

interface GameSession {
  gameId: string;
  token: string;
  botToken?: string;
  myColor: "white" | "black";
}

interface Props {
  user: User;
  onClose: () => void;
}

export function ChessPanel({ user, onClose }: Props) {
  const [view, setView] = useState<View>("lobby");
  const [session, setSession] = useState<GameSession | null>(null);
  const [myGames, setMyGames] = useState<MyGameEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [roomColor, setRoomColor] = useState<"white" | "black" | "random">("random");
  const [roomTime, setRoomTime] = useState<number>(0);

  const isLoggedIn = !!user;

  // Load my games
  useEffect(() => {
    if (!isLoggedIn) return;
    chessMyGames().then(data => setMyGames(data.games as MyGameEntry[])).catch(() => {});
  }, [isLoggedIn, view]);

  const handleBotSelect = useCallback(async (level: number) => {
    setCreating(true);
    try {
      const data = await chessCreate({ botLevel: level, color: "random" }) as CreateGameResponse;
      setSession({
        gameId: data.gameId,
        token: data.token,
        botToken: data.botToken,
        myColor: data.color,
      });
      setView("game");
    } catch { /* */ }
    setCreating(false);
  }, []);

  const handleCreateRoom = useCallback(async () => {
    setCreating(true);
    try {
      const data = await chessCreate({
        color: roomColor,
        timeControl: roomTime > 0 ? roomTime : undefined,
      }) as CreateGameResponse;
      setSession({
        gameId: data.gameId,
        token: data.token,
        myColor: data.color,
      });
      setView("game");
    } catch { /* */ }
    setCreating(false);
  }, [roomColor, roomTime]);

  const handleResumeGame = useCallback((game: MyGameEntry) => {
    setSession({
      gameId: game.id,
      token: game.myToken,
      myColor: game.myColor,
    });
    setView("game");
  }, []);

  const handleBack = useCallback(() => {
    setSession(null);
    setView("lobby");
  }, []);

  if (view === "game" && session) {
    return (
      <ChessGame
        gameId={session.gameId}
        token={session.token}
        botToken={session.botToken}
        myColor={session.myColor}
        onBack={handleBack}
        isAdmin={user?.role === "admin"}
      />
    );
  }

  if (view === "bot-select") {
    return (
      <div className="chess-panel">
        <div className="chess-panel-header">
          <button className="chess-btn-back" onClick={() => setView("lobby")}>&larr; back</button>
          <h2>Pick your victim</h2>
        </div>
        {creating ? (
          <div className="chess-loading">creating game...</div>
        ) : (
          <BotSelector onSelect={handleBotSelect} />
        )}
      </div>
    );
  }

  if (view === "create-room") {
    return (
      <div className="chess-panel">
        <div className="chess-panel-header">
          <button className="chess-btn-back" onClick={() => setView("lobby")}>&larr; back</button>
          <h2>Create Room</h2>
        </div>
        <div className="chess-create-form">
          <div className="chess-form-group">
            <label>Play as</label>
            <div className="chess-color-picker">
              {(["white", "black", "random"] as const).map(c => (
                <button
                  key={c}
                  className={`chess-color-btn ${roomColor === c ? "active" : ""}`}
                  onClick={() => setRoomColor(c)}
                >
                  {c === "white" ? "White" : c === "black" ? "Black" : "Random"}
                </button>
              ))}
            </div>
          </div>
          <div className="chess-form-group">
            <label>Time Control</label>
            <div className="chess-time-picker">
              {[
                { label: "No limit", value: 0 },
                { label: "1 min", value: 60 },
                { label: "3 min", value: 180 },
                { label: "5 min", value: 300 },
                { label: "10 min", value: 600 },
              ].map(t => (
                <button
                  key={t.value}
                  className={`chess-time-btn ${roomTime === t.value ? "active" : ""}`}
                  onClick={() => setRoomTime(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <button
            className="chess-btn primary full"
            onClick={handleCreateRoom}
            disabled={creating}
          >
            {creating ? "Creating..." : "Create & Get Link"}
          </button>
        </div>
      </div>
    );
  }

  // Lobby
  return (
    <div className="chess-panel chess-lobby">
      <button className="chess-close-btn" onClick={onClose}>&times;</button>
      <div className="chess-lobby-inner">
        <div className="chess-lobby-header">
          <div className="chess-lobby-title">chess</div>
          <div className="chess-lobby-subtitle">choose your violence</div>
        </div>

        <div className="chess-lobby-actions">
          <button className="chess-lobby-card" onClick={() => setView("bot-select")}>
            <div className="chess-lobby-card-piece">&#9822;</div>
            <div className="chess-lobby-card-title">Play vs Bot</div>
            <div className="chess-lobby-card-desc">6 levels of AI abuse, from potato to god</div>
          </button>
          <button className="chess-lobby-card" onClick={() => setView("create-room")}>
            <div className="chess-lobby-card-piece">&#9812;</div>
            <div className="chess-lobby-card-title">Create Room</div>
            <div className="chess-lobby-card-desc">send a link, destroy a friendship</div>
          </button>
        </div>

        {myGames.length > 0 && (
          <div className="chess-active-games">
            <h3>Your Games</h3>
            {myGames.map(g => (
              <div key={g.id} className="chess-game-card" onClick={() => handleResumeGame(g)}>
                <div className="chess-game-card-info">
                  <span className="chess-game-card-players">
                    {g.whiteName} vs {g.blackName || "..."}
                  </span>
                  <span className={`chess-game-card-status ${g.status}`}>
                    {g.status}
                  </span>
                </div>
                <div className="chess-game-card-meta">
                  {g.moveCount} moves &middot; playing as {g.myColor}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
