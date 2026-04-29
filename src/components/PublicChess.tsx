import { useState, useEffect, useCallback } from "react";
import { chessGet, chessJoin } from "@/lib/api";
import type { ChessGameState } from "@/apps/chess/types";
import { ChessGame } from "@/apps/chess/ChessGame";
import { ChessBoard } from "@/apps/chess/ChessBoard";
import { LogoHeader } from "./LogoHeader";

interface Props {
  gameId: string;
  onClose: () => void;
}

type Phase = "loading" | "join" | "spectate" | "playing";

export function PublicChess({ gameId, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [game, setGame] = useState<ChessGameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [session, setSession] = useState<{
    token: string;
    myColor: "white" | "black";
  } | null>(null);

  // Check if we already have a token for this game
  useEffect(() => {
    const storedToken = localStorage.getItem(`chess_token_${gameId}`);
    const storedColor = localStorage.getItem(`chess_color_${gameId}`) as "white" | "black" | null;

    (async () => {
      try {
        const data = await chessGet(gameId);
        const g = data.game as ChessGameState;
        setGame(g);

        if (storedToken && storedColor) {
          if (g.status === "finished") {
            // Game over — clean up stale tokens
            localStorage.removeItem(`chess_token_${gameId}`);
            localStorage.removeItem(`chess_color_${gameId}`);
            setPhase("spectate");
          } else {
            // Resuming
            setSession({ token: storedToken, myColor: storedColor });
            setPhase("playing");
          }
        } else if (g.status === "waiting") {
          setPhase("join");
        } else {
          // Game already active/finished — spectate
          setPhase("spectate");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "failed to load game");
      }
    })();
  }, [gameId]);

  // Poll for spectator updates (stop when game finishes)
  useEffect(() => {
    if (phase !== "spectate") return;
    if (game?.status === "finished") return;
    const interval = setInterval(async () => {
      try {
        const data = await chessGet(gameId);
        setGame(data.game as ChessGameState);
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [phase, gameId, game?.status]);

  const handleJoin = useCallback(async () => {
    setJoining(true);
    try {
      const data = await chessJoin(gameId, name || undefined);
      localStorage.setItem(`chess_token_${gameId}`, data.token);
      localStorage.setItem(`chess_color_${gameId}`, data.color);
      setSession({ token: data.token, myColor: data.color });
      setPhase("playing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to join");
    }
    setJoining(false);
  }, [gameId, name]);

  if (phase === "playing" && session) {
    return (
      <div className="public-chess-page">
        <ChessGame
          gameId={gameId}
          token={session.token}
          myColor={session.myColor}
          onBack={onClose}
        />
      </div>
    );
  }

  return (
    <div className="public-chess-page">
      <div className="public-chess-container">
        <LogoHeader />

        {error && <div className="public-chess-error">{error}</div>}

        {phase === "loading" && (
          <div className="public-chess-loading">loading game...</div>
        )}

        {phase === "join" && game && (
          <div className="public-chess-join">
            <h2>You've been challenged!</h2>
            <p className="public-chess-host">
              <strong>{game.whiteName || game.blackName}</strong> is waiting for an opponent
            </p>
            {game.timeControl && (
              <p className="public-chess-tc">
                Time control: {Math.floor(game.timeControl / 60)} min
              </p>
            )}
            <div className="public-chess-name-input">
              <input
                type="text"
                placeholder="Your name (optional)"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={20}
                onKeyDown={e => { if (e.key === "Enter") handleJoin(); }}
              />
            </div>
            <button
              className="chess-btn primary full"
              onClick={handleJoin}
              disabled={joining}
            >
              {joining ? "Joining..." : "Join Game"}
            </button>
          </div>
        )}

        {phase === "spectate" && game && (
          <div className="public-chess-spectate">
            <h2>{game.whiteName} vs {game.blackName}</h2>
            <p className="public-chess-status">
              {game.status === "finished" ? `Result: ${game.result}` : "game is live — spectating"}
            </p>
            <div className="public-chess-board-spectate">
              <ChessBoard
                fen={game.fen}
                orientation="white"
                disabled={true}
                lastMove={game.moves.length > 0 ? { from: game.moves[game.moves.length - 1]!.from, to: game.moves[game.moves.length - 1]!.to } : null}
              />
            </div>
            <p className="public-chess-move-count">{game.moveCount} moves</p>
          </div>
        )}

        <button className="public-chess-back" onClick={onClose}>
          &larr; back to terminal
        </button>
      </div>
    </div>
  );
}
