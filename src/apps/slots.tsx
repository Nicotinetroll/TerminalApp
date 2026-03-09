import type { AppModule } from "@/types/terminal";
import { SlotsPanel } from "./slots/SlotsPanel";

export const app: AppModule = {
  name: "slots",
  description: "casino — gamble your storage like a degenerate",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "the casino doesn't accept broke bitches. log in first.", isError: true };
    }
    terminal.openWindow({
      id: "slots-casino",
      title: "slots",
      component: SlotsPanel,
      width: 480,
      height: 720,
      minWidth: 400,
      minHeight: 600,
      appName: "slots",
    });
    return { text: "welcome to the casino. the house always wins." };
  },
};
