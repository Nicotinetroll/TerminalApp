import type { AppModule } from "@/types/terminal";
import { MailPanel } from "./mail/MailPanel";

export const app: AppModule = {
  name: "mail",
  description: "email client — you@mynig.ga",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "guests don't get email. register first, freeloader.", isError: true };
    }
    terminal.openWindow({
      id: "mail-panel",
      title: "mail",
      component: MailPanel,
      width: 900,
      height: 650,
      minWidth: 600,
      minHeight: 400,
      appName: "mail",
    });
    return { text: "opening your mailbox..." };
  },
};
