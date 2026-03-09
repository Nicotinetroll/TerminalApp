import { useGlobalEvents } from "@/hooks/useGlobalEvents";
import type { GlobalEvent } from "@/hooks/useGlobalEvents";

interface Props {
  onEvent?: (event: GlobalEvent) => void;
}

export function GlobalEventToast({ onEvent }: Props) {
  const { events, dismiss } = useGlobalEvents(onEvent);

  if (events.length === 0) return null;

  return (
    <div className="global-toast-container">
      {events.map((event) => (
        <div
          key={event.id}
          className={`global-toast global-toast-${event.type}`}
          onClick={() => dismiss(event.id)}
        >
          <span className="global-toast-text">{event.message}</span>
        </div>
      ))}
    </div>
  );
}
