import type { AppModule } from "@/types/terminal";

export const app: AppModule = {
  name: "cloud",
  description: "browse & manage your cloud files",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "lmao you thought. guests don't get cloud storage. log in or fuck off.", isError: true };
    }
    return { text: "cloud's already open on the right. you're welcome." };
  },
};
