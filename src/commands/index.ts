import { register } from "@/core/commandRegistry";

import { help } from "./help";
import { clear } from "./clear";
import { echo } from "./echo";
import { whoami } from "./whoami";
import { date } from "./date";
import { sysinfo } from "./sysinfo";
import { theme } from "./theme";
import { logout } from "./logout";
import { pwd } from "./pwd";
import { cd } from "./cd";
import { ls } from "./ls";
import { cat } from "./cat";
import { mkdir } from "./mkdir";
import { touch } from "./touch";
import { write } from "./write";
import { rm } from "./rm";
import { run } from "./run";
import { applist } from "./applist";
import { ai as chat } from "./ai";

export function registerAllCommands() {
  const cmds = [help, clear, echo, whoami, date, sysinfo, theme, logout, pwd, cd, ls, cat, mkdir, touch, write, rm, run, applist, chat];
  for (const cmd of cmds) register(cmd);
}
