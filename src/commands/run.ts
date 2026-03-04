import type { CommandDef } from "@/types/terminal";
import { loadApp, listAppNames } from "@/core/appLoader";

export const run: CommandDef = {
  name: "run",
  description: "Run an app from the apps/ directory",
  usage: "run <appname> [args...]",
  category: "apps",
  async run(args, terminal) {
    const appName = args[0];

    if (!appName) {
      const names = listAppNames();
      if (names.length === 0) {
        return { text: "No apps installed." };
      }
      return {
        blocks: [{
          label: "installed apps",
          content: names.map((n) => `  ${n}`).join("\n"),
        }],
      };
    }

    const app = await loadApp(appName);
    if (!app) {
      return { text: `run: app '${appName}' not found`, isError: true };
    }

    try {
      const result = await Promise.race([
        Promise.resolve(app.run(args.slice(1), terminal)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("App execution timed out")), 5000)
        ),
      ]);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { text: `run: ${appName}: ${msg}`, isError: true };
    }
  },
};
