import type { AppModule } from "@/types/terminal";
import { CoinflipPanel } from "./coinflip/CoinflipPanel";

export const app: AppModule = {
  name: "coinflip",
  description: "50/50 double or nothing — flip a coin, risk your storage",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "the coin doesn't flip for broke bitches. log in first.", isError: true };
    }
    terminal.openWindow({
      id: "coinflip-game",
      title: "coinflip",
      component: CoinflipPanel,
      width: 400,
      height: 560,
      minWidth: 360,
      minHeight: 480,
      appName: "coinflip",
    });
    return { text: "pick a side. 50/50. no excuses." };
  },
};
