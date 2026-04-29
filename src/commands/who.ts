import type { CommandDef } from "@/types/terminal";
import { getOnlineUsers } from "@/lib/api";

export const who: CommandDef = {
  name: "who",
  description: "Show who's online right now",
  usage: "who",
  category: "system",
  async run() {
    try {
      const users = await getOnlineUsers();

      if (users.length === 0) {
        return { text: "nobody's online. it's just you. alone. in the terminal." };
      }

      const lines = users.map((u) => {
        const badge = u.role === "admin" ? " [admin]" : u.role === "premium" ? " [premium]" : u.role === "basic" ? " [basic]" : "";
        return `  ${u.username}${badge}`;
      });

      const easter = users.length === 1
        ? "just you. lonely ass terminal."
        : users.length >= 10
        ? `${users.length} degenerates online. server's poppin.`
        : `${users.length} user${users.length > 1 ? "s" : ""} online`;

      return {
        blocks: [{
          label: easter,
          content: lines.join("\n"),
        }],
      };
    } catch {
      return { text: "failed to check who's online", isError: true };
    }
  },
};
