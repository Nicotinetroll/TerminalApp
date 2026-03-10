import type { AppModule } from "@/types/terminal";
import { TimesheetPanel } from "./timesheet/TimesheetPanel";

export const app: AppModule = {
  name: "timesheet",
  description: "generate timesheets like a responsible adult",
  run(_args, terminal) {
    if (terminal.user.role !== "admin") {
      return { text: "nice try. this is admin-only, wage slave.", isError: true };
    }
    terminal.openWindow({
      id: "timesheet-panel",
      title: "timesheet",
      component: TimesheetPanel,
      width: 650,
      height: 520,
      minWidth: 400,
      minHeight: 350,
      appName: "timesheet",
    });
    return { text: "generating your totally legit work hours..." };
  },
};
