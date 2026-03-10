import type { AppModule } from "@/types/terminal";
import { JoinClubPanel } from "./joinclub/JoinClubPanel";

export const app: AppModule = {
  name: "joinclub",
  description: "join the club \u2014 unlock premium features",
  run(_args, terminal) {
    terminal.openWindow({
      id: "joinclub-app",
      title: "join club",
      component: JoinClubPanel,
      width: 500,
      height: 400,
      minWidth: 380,
      minHeight: 300,
      appName: "joinclub",
    });

    return { text: "" };
  },
};
