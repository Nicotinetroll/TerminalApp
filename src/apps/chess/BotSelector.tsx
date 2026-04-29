import { BOT_LEVELS } from "./types";

interface BotSelectorProps {
  onSelect: (level: number) => void;
}

const LEVEL_PIECES = ["\u265F", "\u265E", "\u265D", "\u265C", "\u265B", "\u265A"];

export function BotSelector({ onSelect }: BotSelectorProps) {
  return (
    <div className="chess-bot-grid">
      {BOT_LEVELS.map((bot) => (
        <button
          key={bot.level}
          className="chess-bot-card"
          onClick={() => onSelect(bot.level)}
        >
          <div className="chess-bot-piece">{LEVEL_PIECES[bot.level]}</div>
          <div className="chess-bot-name">{bot.name}</div>
          <div className="chess-bot-elo">{bot.elo}</div>
          <div className="chess-bot-desc">{bot.desc}</div>
        </button>
      ))}
    </div>
  );
}
