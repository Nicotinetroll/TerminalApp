import type { AppModule } from "@/types/terminal";
import { CloudPanel } from "./cloud/CloudPanel";

export const app: AppModule = {
  name: "cloud",
  description: "browse & manage your cloud files",
  run(_args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "lmao you thought. guests don't get cloud storage. log in or fuck off.", isError: true };
    }
    terminal.openWindow({
      id: "cloud-browser",
      title: "cloud",
      component: CloudPanel,
      width: 850,
      height: 600,
      appName: "cloud",
      props: {
        fs: terminal.fs,
        cwd: terminal.cwd,
        saveFn: "saveFilesystem",
      },
    });
    return { text: "opening your digital junk drawer..." };
  },
};
