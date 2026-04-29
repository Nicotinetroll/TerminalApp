import type { CommandDef } from "@/types/terminal";
import { THEMES } from "@/config";
import { ThemePickerPanel } from "@/components/ThemePickerPanel";

const THEME_QUIPS: Record<string, string[]> = {
  light: [
    "light mode? really? what are you, a daywalker?",
    "my eyes are burning already. you monster.",
    "welcome to light mode. your retinas will not be missed.",
    "light mode activated. hope you enjoy pain.",
  ],
  matrix: [
    "follow the white rabbit.",
    "there is no spoon. but there is this theme.",
    "you take the green pill.",
  ],
  blood: [
    "edgy. I respect it.",
    "who hurt you?",
    "this is fine. everything is fine.",
  ],
  synthwave: [
    "it's 1984 and you're in a lamborghini.",
    "retrowave intensifies.",
    "outrun your responsibilities in style.",
  ],
  cyberpunk: [
    "wake the fuck up, samurai.",
    "neon yellow. aggressive. I like it.",
  ],
  mono: [
    "no color. just vibes.",
    "minimalism is a personality trait now.",
    "50 shades of gray but make it terminal.",
  ],
  midnight: [
    "3am coding session aesthetic.",
    "deep into the void.",
  ],
  hacker: [
    "I'm in.",
    "mainframe accessed.",
  ],
  satan: [
    "hail santa... wait.",
    "666 shades of red.",
  ],
  toxic: [
    "radioactive drip.",
    "chernobyl-core.",
  ],
  void: [
    "staring into nothingness.",
    "embrace the void.",
  ],
  abyss: [
    "stare long enough and it stares back.",
    "deeper than your commitment issues.",
  ],
  neon: [
    "magenta is a lifestyle.",
    "visible from space.",
  ],
  forest: [
    "touch grass, but make it aesthetic.",
    "photosynthesis activated.",
  ],
  retro: [
    "CRT glow hits different.",
    "amber phosphor supremacy.",
  ],
  lavender: [
    "soft. gentle. still judging you.",
    "cozy mode activated.",
  ],
};

export const theme: CommandDef = {
  name: "theme",
  description: "Change accent color theme",
  usage: "theme [name]",
  category: "system",
  run(args, terminal) {
    const name = args[0];
    if (!name) {
      terminal.openWindow({
        id: "theme-picker",
        title: "themes",
        component: ThemePickerPanel,
        props: { setTheme: terminal.setTheme },
        width: 720,
        height: 560,
        minWidth: 500,
        minHeight: 400,
      });
      return { text: "" };
    }

    const selected = THEMES[name];
    if (!selected) {
      return { text: `theme: unknown theme '${name}'\nrun 'theme' to see all themes`, isError: true };
    }

    terminal.setTheme(selected);

    const quips = THEME_QUIPS[name];
    if (quips?.length) {
      const quip = quips[Math.floor(Math.random() * quips.length)]!;
      return { text: `theme set to ${name}\n${quip}` };
    }

    return { text: `theme set to ${name}` };
  },
};
