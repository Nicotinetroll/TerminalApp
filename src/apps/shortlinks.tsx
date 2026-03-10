import type { AppModule } from "@/types/terminal";
import { ShortlinksPanel } from "./shortlinks/ShortlinksPanel";

export const app: AppModule = {
  name: "shortlinks",
  description: "url shortener — mynig.ga/s/xxx",
  run(_args, terminal) {
    if (terminal.user.role === "guest" || terminal.user.role === "code") {
      return { text: "shortlinks require a real account. nice try though.", isError: true };
    }

    terminal.openWindow({
      id: "shortlinks-app",
      title: "shortlinks",
      component: ShortlinksPanel,
      width: 700,
      height: 500,
      minWidth: 450,
      minHeight: 350,
      appName: "shortlinks",
    });

    return { text: "url shortener loaded. make urls short like your attention span." };
  },
};
