import type { AppModule } from "@/types/terminal";
import { AdminPanel } from "./admin/AdminPanel";

export const app: AppModule = {
  name: "admin",
  description: "user management panel",
  run(_args, terminal) {
    if (terminal.user.role !== "admin") {
      return { text: "nice try bitch — admin access only.", isError: true };
    }
    terminal.openWindow({
      id: "admin-panel",
      title: "admin panel",
      component: AdminPanel,
      width: 800,
      height: 550,
      appName: "admin",
    });
    return { text: "admin panel opened. don't break shit." };
  },
};
