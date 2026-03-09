import type { AppModule } from "@/types/terminal";
import { NigditPanel } from "./nigdit/NigditPanel";

export const app: AppModule = {
  name: "nigdit",
  description: "terminal reddit — posts, votes, comments, aura",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "nigdit requires an account. guests can lurk irl.", isError: true };
    }

    terminal.openWindow({
      id: "nigdit-app",
      title: "nigdit",
      component: NigditPanel,
      width: 800,
      height: 600,
      minWidth: 600,
      minHeight: 450,
      appName: "nigdit",
    });

    return { text: "welcome to nigdit. your aura depends on it." };
  },
};
