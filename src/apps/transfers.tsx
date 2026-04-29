import type { AppModule } from "@/types/terminal";
import { TransfersPanel } from "./transfers/TransfersPanel";

export const app: AppModule = {
  name: "transfers",
  description: "generate & manage file upload links",
  run(_args, terminal) {
    if (terminal.user.role === "user") {
      return { text: "you need a subscription to send files. try the shop.", isError: true };
    }
    terminal.openWindow({
      id: "transfers-panel",
      title: "transfers",
      component: TransfersPanel,
      width: 780,
      height: 520,
      minWidth: 680,
      minHeight: 400,
      appName: "transfers",
    });
    return { text: "opening the goods..." };
  },
};
