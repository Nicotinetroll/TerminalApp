import { useState, useEffect, useCallback } from "react";
import type { WindowContentProps } from "@/types/terminal";
import type { GameScore, GameScoreSubmitResult } from "@/lib/api";
import { getAllLeaderboards, submitScore, ApiError } from "@/lib/api";
import { SnakeGame } from "./SnakeGame";
import { FlappyBird } from "./FlappyBird";
import { MinesweeperGame } from "./MinesweeperGame";
import { RacingGame } from "./RacingGame";
import { InvadersGame } from "./InvadersGame";
import { BreakoutGame } from "./BreakoutGame";
import { Leaderboard } from "./Leaderboard";

type GameId = "snake" | "flappy" | "minesweeper" | "racing" | "invaders" | "breakout";
type View = "selector" | GameId;

interface GameCard {
  id: GameId;
  name: string;
  key: string;
  desc: string;
  icon: string;
}

const GAMES: GameCard[] = [
  { id: "snake", name: "SNAKE", key: "1", desc: "eat. grow. die. repeat.", icon: "~" },
  { id: "flappy", name: "FLAPPY", key: "2", desc: "flap or die. mostly die.", icon: ">" },
  { id: "minesweeper", name: "MINESWEEPER", key: "3", desc: "click wrong = die.", icon: "*" },
  { id: "racing", name: "RACING", key: "4", desc: "jarmok flashbacks. dodge or die.", icon: "▼" },
  { id: "invaders", name: "ALIEN PURGE", key: "5", desc: "they came in peace. you didn't.", icon: "▽" },
  { id: "breakout", name: "BREAK SHIT", key: "6", desc: "therapy but with bricks.", icon: "■" },
];

interface GameOverState {
  score: number;
  result: GameScoreSubmitResult | null;
  error: string | null;
  game: GameId;
}

export function GamesPanel({ user }: WindowContentProps) {
  const [view, setView] = useState<View>("selector");
  const [leaderboards, setLeaderboards] = useState<Record<string, GameScore[]>>({});
  const [gameOverState, setGameOverState] = useState<GameOverState | null>(null);

  const isGuest = user.role === "guest";

  const loadLeaderboards = useCallback(() => {
    getAllLeaderboards()
      .then(setLeaderboards)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadLeaderboards();
  }, [loadLeaderboards]);

  // Keyboard shortcuts for game selection
  useEffect(() => {
    if (view !== "selector" || gameOverState) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "1") setView("snake");
      else if (e.key === "2") setView("flappy");
      else if (e.key === "3") setView("minesweeper");
      else if (e.key === "4") setView("racing");
      else if (e.key === "5") setView("invaders");
      else if (e.key === "6") setView("breakout");
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view, gameOverState]);

  const handleGameOver = useCallback(async (game: GameId, score: number, metadata?: Record<string, unknown>) => {
    if (isGuest) {
      setGameOverState({ score, result: null, error: "log in to save scores, freeloader.", game });
      return;
    }

    try {
      const result = await submitScore(game, score, metadata);
      setGameOverState({ score, result, error: null, game });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "failed to submit score";
      setGameOverState({ score, result: null, error: msg, game });
    }
  }, [isGuest]);

  const handlePlayAgain = () => {
    const game = gameOverState?.game;
    setGameOverState(null);
    if (game) setView(game);
  };

  const handleBackToMenu = () => {
    setGameOverState(null);
    setView("selector");
    loadLeaderboards();
  };

  // Game over overlay
  if (gameOverState) {
    const { score, result, error, game } = gameOverState;
    return (
      <div className="games-panel">
        <div className="games-gameover-screen">
          <div className="games-gameover-card">
            <div className="games-gameover-header">GAME OVER</div>
            <div className="games-gameover-game">{game}</div>
            <div className="games-gameover-score-big">{score.toLocaleString()}</div>
            {result && (
              <>
                <div className="games-gameover-rank">rank #{result.rank}</div>
                {result.message && <div className="games-gameover-msg">{result.message}</div>}
                {result.easter_egg && <div className="games-gameover-egg">{result.easter_egg}</div>}
              </>
            )}
            {error && <div className="games-gameover-error">{error}</div>}
            <div className="games-gameover-actions">
              <button className="games-btn" onClick={handlePlayAgain}>play again</button>
              <button className="games-btn games-btn-secondary" onClick={handleBackToMenu}>back to menu</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Game views
  if (view === "snake") {
    return (
      <div className="games-panel">
        <SnakeGame
          onGameOver={(score, meta) => handleGameOver("snake", score, meta)}
          onBack={handleBackToMenu}
        />
      </div>
    );
  }

  if (view === "flappy") {
    return (
      <div className="games-panel">
        <FlappyBird
          onGameOver={(score, meta) => handleGameOver("flappy", score, meta)}
          onBack={handleBackToMenu}
        />
      </div>
    );
  }

  if (view === "minesweeper") {
    return (
      <div className="games-panel">
        <MinesweeperGame
          onGameOver={(score, meta) => handleGameOver("minesweeper", score, meta)}
          onBack={handleBackToMenu}
        />
      </div>
    );
  }

  if (view === "racing") {
    return (
      <div className="games-panel">
        <RacingGame
          onGameOver={(score, meta) => handleGameOver("racing", score, meta)}
          onBack={handleBackToMenu}
        />
      </div>
    );
  }

  if (view === "invaders") {
    return (
      <div className="games-panel">
        <InvadersGame
          onGameOver={(score, meta) => handleGameOver("invaders", score, meta)}
          onBack={handleBackToMenu}
        />
      </div>
    );
  }

  if (view === "breakout") {
    return (
      <div className="games-panel">
        <BreakoutGame
          onGameOver={(score, meta) => handleGameOver("breakout", score, meta)}
          onBack={handleBackToMenu}
        />
      </div>
    );
  }

  // Selector view
  return (
    <div className="games-panel">
      <div className="games-selector">
        <div className="games-selector-header">
          <div className="games-selector-title">ARCADE</div>
          <div className="games-selector-sub">pick a game. waste your life. no refunds.</div>
        </div>

        <div className="games-cards">
          {GAMES.map((g) => (
            <button
              key={g.id}
              className="games-card"
              onClick={() => setView(g.id)}
            >
              <div className="games-card-key">[{g.key}]</div>
              <div className="games-card-icon">{g.icon}</div>
              <div className="games-card-name">{g.name}</div>
              <div className="games-card-desc">{g.desc}</div>
              {leaderboards[g.id] && leaderboards[g.id]!.length > 0 && (
                <div className="games-card-top">
                  top: {leaderboards[g.id]![0]!.username} ({leaderboards[g.id]![0]!.score.toLocaleString()})
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="games-selector-leaderboards">
          <div className="games-selector-lb-title">LEADERBOARDS</div>
          <div className="games-lb-grid">
            {GAMES.map((g) => (
              <div key={g.id} className="games-lb-section">
                <div className="games-lb-section-title">{g.name}</div>
                <Leaderboard game={g.id} compact scores={leaderboards[g.id]} />
              </div>
            ))}
          </div>
        </div>

        {isGuest && (
          <div className="games-guest-notice">
            you can play but scores won't save. log in to flex on the leaderboard.
          </div>
        )}
      </div>
    </div>
  );
}
