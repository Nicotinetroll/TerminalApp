import type { ChessToast } from "./useChessToasts";

interface Props {
  toasts: ChessToast[];
}

export function ChessToasts({ toasts }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className="chess-toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`chess-toast chess-toast-${t.type}`}>
          <span className="chess-toast-text">{t.text}</span>
        </div>
      ))}
    </div>
  );
}
