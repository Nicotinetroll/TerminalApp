import type { AppModule } from "@/types/terminal";
import { StatsPanel } from "./stats/StatsPanel";

export const app: AppModule = {
  name: "stats",
  description: "server stats dashboard",
  run(_args, terminal) {
    if (terminal.user.role !== "admin") {
      return { text: "nice try bitch — admin access only.", isError: true };
    }
    terminal.openWindow({
      id: "stats-panel",
      title: "server stats",
      component: StatsPanel,
      width: 900,
      height: 650,
    });
    return { text: "stats dashboard opened. knowledge is power or whatever." };
  },
};
