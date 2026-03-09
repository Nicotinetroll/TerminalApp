import type { AppModule } from "@/types/terminal";
import { PastePanel } from "./paste/PastePanel";

export const app: AppModule = {
  name: "paste",
  description: "code paste bin — share code snippets",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "paste requires an account. guests can only view shared pastes.", isError: true };
    }

    terminal.openWindow({
      id: "paste-app",
      title: "paste",
      component: PastePanel,
      width: 750,
      height: 550,
      minWidth: 500,
      minHeight: 400,
      appName: "paste",
    });

    return { text: "paste bin loaded. share code like a civilized person." };
  },
};
