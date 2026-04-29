import type { ChessGameState } from "./types";

interface GameOverlayProps {
  game: ChessGameState;
  myColor: "white" | "black";
  onNewGame: () => void;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function getResultText(game: ChessGameState, myColor: "white" | "black") {
  const reason = game.resultReason;
  const result = game.result;
  const iWon = (result === "1-0" && myColor === "white") || (result === "0-1" && myColor === "black");
  const isDraw = result === "1/2-1/2";
  const moveCount = game.moveCount;

  let title = "";
  let subtitle = "";

  if (reason === "checkmate") {
    title = "CHECKMATE";
    if (iWon) {
      if (moveCount <= 4) subtitle = pick(["speedrun any%", "scholar's mate? in 2024? bro.", "that was embarrassingly fast"]);
      else if (moveCount <= 6) subtitle = pick(["bro really fell for that??", "tactical genius or lucky idiot? who cares, you won"]);
      else if (game.isBot && game.botLevel === 0) subtitle = pick([
        "you beat a drunk intern. proud of yourself?",
        "congrats, you outsmarted a random number generator",
        "the bot literally doesn't know what a fork is",
      ]);
      else if (game.isBot && game.botLevel === 5) subtitle = pick([
        "WAIT WHAT. you beat stockfish daddy??",
        "are you cheating? you're cheating.",
        "this shouldn't be possible. report this.",
      ]);
      else subtitle = pick([
        "gg, absolute destruction.",
        "they never had a chance.",
        "flawless victory. fatality.",
        "get bodied, nerd.",
        "that was surgical. respect.",
      ]);
    } else {
      if (moveCount <= 4) subtitle = pick(["...did you even try?", "that has to be intentional right??", "you lost faster than a speedrun"]);
      else subtitle = pick([
        "skill issue.",
        "get good or get gone.",
        "L + ratio + checkmated",
        "maybe try checkers instead?",
        "the pieces aren't decorations, you know",
      ]);
    }
  } else if (reason === "resign") {
    title = "RESIGNED";
    if (iWon) {
      subtitle = moveCount <= 2
        ? pick(["rage quit speedrun world record", "they left faster than my dad"])
        : pick([
          "they couldn't handle the heat.",
          "gg ez, they surrendered like the French",
          "mental damage: critical",
          "you broke their spirit. beautiful.",
        ]);
    } else {
      subtitle = pick([
        "you gave up. understandable.",
        "at least you knew when to stop.",
        "strategic surrender. copium.",
        "the white flag was always an option.",
      ]);
    }
  } else if (reason === "stalemate") {
    title = "STALEMATE";
    subtitle = pick([
      "you're both losers. congratulations.",
      "nobody wins. how poetic.",
      "a draw by incompetence.",
      "the most unsatisfying ending in chess history.",
    ]);
  } else if (reason === "timeout") {
    title = "TIME'S UP";
    subtitle = iWon
      ? pick(["speed kills. you survived.", "they ran out of time and excuses.", "the clock doesn't lie"])
      : pick(["too slow. the clock doesn't lie.", "maybe play bullet less?", "time waits for no one. especially not you."]);
  } else if (reason === "draw_agreement") {
    title = "DRAW";
    subtitle = pick([
      "peace was chosen. boring, but respectable.",
      "you both agreed to be mediocre.",
      "the chess equivalent of a handshake and walking away.",
    ]);
  } else if (isDraw) {
    title = "DRAW";
    subtitle = reason === "repetition" ? pick(["groundhog day.", "same position 3 times. y'all stuck in a loop."])
      : reason === "insufficient" ? pick(["neither of you has enough firepower.", "a king and a dream isn't enough."])
      : pick(["50 moves of nothing. impressive commitment to mediocrity.", "the draw of boredom."]);
  } else {
    title = "GAME OVER";
    subtitle = "how did we get here?";
  }

  return { title, subtitle, iWon, isDraw };
}

export function GameOverlay({ game, myColor, onNewGame }: GameOverlayProps) {
  const { title, subtitle, iWon, isDraw } = getResultText(game, myColor);

  return (
    <div className="chess-overlay">
      <div className="chess-overlay-content">
        <div className={`chess-overlay-title ${iWon ? "won" : isDraw ? "draw" : "lost"}`}>
          {title}
        </div>
        <div className="chess-overlay-result">
          {game.result}
        </div>
        {subtitle && (
          <div className="chess-overlay-subtitle">{subtitle}</div>
        )}
        <div className="chess-overlay-actions">
          <button className="chess-btn primary" onClick={onNewGame}>
            {iWon ? "Run It Back" : isDraw ? "Try Again" : "Rematch (Cope)"}
          </button>
        </div>
      </div>
    </div>
  );
}
