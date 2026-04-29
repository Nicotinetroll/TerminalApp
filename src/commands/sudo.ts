import type { CommandDef } from "@/types/terminal";

const DENIALS = [
  "lmao nice try. you're not root and you never will be.",
  "sudo? in THIS economy? permission denied, peasant.",
  "bro thinks he's a sysadmin 💀",
  "access denied. try being born with more privilege.",
  "the audacity. the AUDACITY.",
  "sudo make me a sandwich. ...no.",
  "you have no power here, gandalf.",
  "Error 420: Not High Enough Privilege Level.",
  "I asked my supervisor and he said no. I am my supervisor.",
  "imagine thinking sudo works in a browser terminal lmfaooo",
  "permission denied. this incident will be reported. (it won't)",
  "you need mass privilege escalation? try therapy.",
  "bro typed sudo like it's gonna do something 😂",
  "nah fam, root access costs 500 NiggaBytes.",
  "the sudo daemon is currently on lunch break.",
];

export const sudo: CommandDef = {
  name: "sudo",
  description: "Execute with superuser privileges (lol)",
  usage: "sudo <command>",
  category: "system",
  run(args) {
    const denial = DENIALS[Math.floor(Math.random() * DENIALS.length)]!;

    if (args.join(" ").toLowerCase() === "rm -rf /") {
      return { text: "oh HELL no. sudo AND rm -rf /? you're on a watchlist now." };
    }

    return { text: denial };
  },
};
