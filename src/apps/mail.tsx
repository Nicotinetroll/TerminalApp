import type { AppModule } from "@/types/terminal";

export const app: AppModule = {
  name: "mail",
  description: "email client — you@mynig.ga",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "guests don't get email. register first, freeloader.", isError: true };
    }
    return { text: "mail is right there in the left panel bro." };
  },
};
