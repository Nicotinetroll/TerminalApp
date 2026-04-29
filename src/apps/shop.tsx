import type { AppModule } from "@/types/terminal";
import { ShopPanel } from "./shop/ShopPanel";

export const app: AppModule = {
  name: "shop",
  description: "spend your niggabytes on useful shit",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "the shop doesn't accept window shoppers. log in first.", isError: true };
    }
    terminal.openWindow({
      id: "shop-panel",
      title: "shop",
      component: ShopPanel,
      width: 680,
      height: 580,
      minWidth: 500,
      minHeight: 400,
      appName: "shop",
    });
    return { text: "welcome to the shop. your wallet is crying already." };
  },
};
