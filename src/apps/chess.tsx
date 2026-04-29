import type { AppModule } from "@/types/terminal";
import { ChessPanel } from "./chess/ChessPanel";

export const app: AppModule = {
  name: "chess",
  description: "play chess vs bots or friends",
  run(_args, terminal) {
    terminal.openFullscreen({ component: ChessPanel });
    return { text: "" };
  },
};
