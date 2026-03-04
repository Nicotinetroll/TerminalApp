import type { CommandDef } from "@/types/terminal";
import { sendAiMessage, clearAiHistory, ApiError } from "@/lib/api";

export const ai: CommandDef = {
  name: "nigga",
  description: "talk to the AI overlord",
  usage: "nigga <message> | nigga --new <message> | nigga --clear",
  category: "system",
  async run(args, terminal) {
    if (terminal.user.role === "guest") {
      return { text: "guests don't get to talk to the AI. you haven't earned that privilege yet.", isError: true };
    }
    if (terminal.user.role === "code" && terminal.user.permissions && !terminal.user.permissions.includes("nigga")) {
      return { text: "access denied. your code doesn't unlock the AI, bitch.", isError: true };
    }

    // Handle --clear
    if (args[0] === "--clear") {
      try {
        const result = await clearAiHistory();
        if (result.deleted === 0) {
          return { text: "nothing to clear. your AI history is already as empty as your brain." };
        }
        return { text: `nuked ${result.deleted} conversation${result.deleted === 1 ? "" : "s"}. gone. reduced to atoms.` };
      } catch {
        return { text: "failed to clear history. the AI refuses to be forgotten.", isError: true };
      }
    }

    // Handle --new flag
    let newConversation = false;
    const filteredArgs = [...args];
    const newIdx = filteredArgs.indexOf("--new");
    const nIdx = filteredArgs.indexOf("-n");

    if (newIdx !== -1) {
      newConversation = true;
      filteredArgs.splice(newIdx, 1);
    }
    if (nIdx !== -1) {
      newConversation = true;
      filteredArgs.splice(nIdx, 1);
    }

    const message = filteredArgs.join(" ").trim();

    if (!message) {
      return {
        blocks: [{
          label: "nigga",
          content: "usage: nigga <message>\n       nigga --new <message>  (start fresh convo)\n       nigga --clear          (delete all your convos)\n\nyou gotta actually say something, genius.",
        }],
      };
    }

    try {
      const { reply } = await sendAiMessage(message, newConversation);
      return {
        blocks: [{ label: "nigga", content: reply, animated: true }],
      };
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          return { text: "you're sending messages faster than my neurons can fire. chill.", isError: true };
        }
        return { text: err.message, isError: true };
      }
      return { text: "the AI's brain just blue-screened. empty brain moment. try again.", isError: true };
    }
  },
};
