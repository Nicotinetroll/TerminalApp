import type { AppModule } from "@/types/terminal";
import { BlackjackPanel } from "./blackjack/BlackjackPanel";

export const app: AppModule = {
  name: "blackjack",
  description: "multiplayer blackjack — bet NiggaBytes, play with friends",
  run(_args, terminal) {
    terminal.openWindow({
      id: "blackjack",
      title: "blackjack",
      component: BlackjackPanel,
      width: 700,
      height: 600,
      minWidth: 500,
      minHeight: 450,
      appName: "blackjack",
    });
    return { text: "shuffling the deck... don't count cards. (jk, we don't care)" };
  },
};
