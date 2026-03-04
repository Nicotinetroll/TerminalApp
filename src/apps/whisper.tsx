import type { AppModule } from "@/types/terminal";
import { WhisperPanel } from "./whisper/WhisperPanel";

export const app: AppModule = {
  name: "whisper",
  description: "anonymous chat",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "guests can't whisper. register first, lurker.", isError: true };
    }
    terminal.openWindow({
      id: "whisper",
      title: "whisper",
      component: WhisperPanel,
      width: 800,
      height: 600,
    });
    return { text: "entering the void..." };
  },
};
