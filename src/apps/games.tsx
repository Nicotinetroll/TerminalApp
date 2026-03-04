import type { AppModule } from "@/types/terminal";
import { GamesPanel } from "./games/GamesPanel";

export const app: AppModule = {
  name: "games",
  description: "retro arcade — snake, 2048, minesweeper",
  run(_args, terminal) {
    terminal.openWindow({
      id: "games-arcade",
      title: "arcade",
      component: GamesPanel,
      width: 700,
      height: 600,
      minWidth: 500,
      minHeight: 450,
    });
    return { text: "loading the arcade... prepare to waste your life." };
  },
};
