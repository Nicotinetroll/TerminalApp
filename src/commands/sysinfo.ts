import type { CommandDef } from "@/types/terminal";
import { SYSTEM_NAME, SYSTEM_VERSION, HOSTNAME } from "@/config";
import { getAll } from "@/core/commandRegistry";
import { listAppNames } from "@/core/appLoader";
import { emailLocalPart } from "@/core/utils";

export const sysinfo: CommandDef = {
  name: "sysinfo",
  description: "Show system information",
  category: "system",
  run(_args, terminal) {
    const apps = listAppNames();

    return {
      blocks: [
        {
          label: "system",
          content: [
            `OS:        ${SYSTEM_NAME}`,
            `Version:   ${SYSTEM_VERSION}`,
            `Host:      ${HOSTNAME}`,
            `Shell:     nsh 1.0`,
          ].join("\n"),
        },
        {
          label: "session",
          content: [
            `User:      ${terminal.user.email}`,
            `Role:      ${terminal.user.role}`,
            `Home:      /home/${emailLocalPart(terminal.user.email)}`,
            `Commands:  ${getAll().length}`,
            `Apps:      ${apps.length || "none installed"}`,
          ].join("\n"),
        },
      ],
    };
  },
};
