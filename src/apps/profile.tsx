import type { AppModule } from "@/types/terminal";
import { ProfilePanel } from "./profile/ProfilePanel";

export const app: AppModule = {
  name: "profile",
  description: "view your profile & storage",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "log in first, freeloader. guests don't get profiles.", isError: true };
    }
    terminal.openWindow({
      id: "profile-panel",
      title: "profile",
      component: ProfilePanel,
      width: 650,
      height: 550,
      minWidth: 450,
      minHeight: 400,
      appName: "profile",
    });
    return { text: "opening your life story..." };
  },
};
