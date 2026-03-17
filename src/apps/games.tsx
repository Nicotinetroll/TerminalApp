import type { AppModule } from "@/types/terminal";
import { GamesPanel } from "./games/GamesPanel";

export const app: AppModule = {
  name: "games",
  description: "retro arcade — snake, flappy, minesweeper, racing, invaders, breakout",
  run(_args, terminal) {
    terminal.openWindow({
      id: "games-arcade",
      title: "arcade",
      component: GamesPanel,
      width: 860,
      height: 700,
      minWidth: 600,
      minHeight: 500,
      appName: "games",
    });
    return { text: "loading the arcade... prepare to waste your life." };
  },
};
