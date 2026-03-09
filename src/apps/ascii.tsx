import type { AppModule } from "@/types/terminal";
import { AsciiPanel } from "./ascii/AsciiPanel";

export const app: AppModule = {
  name: "ascii",
  description: "turn images into ascii art",
  run(_args, terminal) {
    terminal.openWindow({
      id: "ascii-art",
      title: "ascii art",
      component: AsciiPanel,
      width: 750,
      height: 600,
      minWidth: 500,
      minHeight: 400,
      appName: "ascii",
    });
    return { text: "loading the pixel shredder..." };
  },
};
