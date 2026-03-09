import type { AppModule } from "@/types/terminal";
import { MemesPanel } from "./memes/MemesPanel";

export const app: AppModule = {
  name: "memes",
  description: "image meme gallery — upload, vote, vibe",
  run(_args, terminal) {
    terminal.openWindow({
      id: "memes-app",
      title: "memes",
      component: MemesPanel,
      width: 800,
      height: 600,
      minWidth: 600,
      minHeight: 450,
      appName: "memes",
    });

    return { text: "no memes? what is this, linkedin?" };
  },
};
