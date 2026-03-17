import type { AppModule } from "@/types/terminal";
import { DownloadPanel } from "./download/DownloadPanel";

export const app: AppModule = {
  name: "downloader",
  description: "alias for downloader — download media from any site",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "guests can't download shit. log in first.", isError: true };
    }
    terminal.openWindow({
      id: "download-panel",
      title: "downloader",
      component: DownloadPanel,
      width: 520,
      height: 520,
      minWidth: 400,
      minHeight: 400,
      appName: "downloader",
    });
    return { text: "it's 'run downloader' now, but i got you." };
  },
};
