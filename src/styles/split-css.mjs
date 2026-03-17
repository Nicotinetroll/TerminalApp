import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'terminal.css'), 'utf8');
const lines = src.split('\n');

// Extract lines [start, end] (1-indexed inclusive)
function extract(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function write(filename, header, start, end) {
  const content = `/* ${header} */\n\n${extract(start, end)}\n`;
  writeFileSync(join(__dirname, filename), content);
  const lineCount = content.split('\n').length;
  console.log(`  ${filename}: ${lineCount} lines (L${start}-L${end})`);
}

console.log('Splitting terminal.css into modules...\n');

// -- Base & Layout --
write('base.css', 'Base styles: CSS variables, resets, scrollbar', 1, 100);
write('layout.css', 'Terminal page layout, logo, frame, mobile elements, animations, utilities', 102, 504);
write('grid-box.css', 'Grid box pattern, logo entrance animation, autocomplete dropdown, backdrop', 505, 609);
write('windows.css', 'Window system: frames, titlebar, buttons, resize handles', 610, 727);

// -- Admin --
write('admin.css', 'Admin panel base, cloud upload progress, sidebar', 728, 855);
write('admin-content.css', 'Admin content area, tables, inputs, buttons, forms', 856, 1083);

// -- Whisper Chat --
write('whisper.css', 'Whisper chat system', 1084, 1783);

// -- Mail --
write('mail-base.css', 'Mail app base, loading, status, layout', 1784, 1841);
write('mail-setup.css', 'Mail setup (first-time)', 1842, 1915);
write('mail-sidebar.css', 'Mail sidebar, folders, addresses', 1916, 2116);
write('mail-list.css', 'Mail main content, list, toolbar, checkbox, email items, search', 2117, 2435);
write('mail-view.css', 'Mail view / reader', 2437, 2571);
write('mail-compose.css', 'Mail compose form and autocomplete', 2573, 2710);
write('mail-signatures.css', 'Mail signature editor and custom folder delete', 2712, 2822);
write('mail-settings.css', 'Mail setup guide / settings', 2824, 3022);
write('mail-attachments.css', 'Mail attachments (reader + compose)', 3023, 3156);

// -- Profile --
write('profile-nb.css', 'Profile NiggaBytes card', 3157, 3199);

// -- Timesheet --
write('timesheet.css', 'Timesheet app: panel, wizard, toolbar, settings, forms, table, footer, export, profiles', 3200, 3903);

// -- Responsive --
write('responsive.css', 'Responsive styles: all windows, whisper, admin, panel, profile, timesheet, mail mobile, games', 3904, 4562);

// -- Games --
write('games.css', 'Games arcade: selector, cards, leaderboards, container, HUD, overlays, buttons, difficulty', 4563, 5102);
write('games-grids.css', 'Game grids: snake, flappy, racing, invaders, breakout', 5103, 5350);
write('games-vfx.css', 'Games VFX: shake, score flash, snake VFX, minesweeper VFX, CRT overlay, death flash, rainbow, score popups, intensity, minesweeper grid', 5351, 5612);

// -- ASCII Art --
write('ascii-art.css', 'ASCII art app', 5613, 5869);

// -- Stats --
write('stats.css', 'Stats dashboard: panel, cards, tabs, VPS disk, charts, log viewer, responsive', 5870, 6409);

// -- Slots / Casino --
write('slots.css', 'Slots casino: top bar, payouts, main area, slot machine, free spin, bonus hunt, grid, paylines, particles', 6410, 7290);
write('slots-controls.css', 'Slots controls, bottom section, history, win rate, view toggle', 7291, 7517);
write('casino-admin.css', 'Casino admin panel, detail view, balance graph, history, currency toggle, responsive', 7518, 8260);

// -- Event Toasts --
write('toasts.css', 'Global event toasts', 8261, 8336);

// -- Coinflip --
write('coinflip.css', 'Coinflip game', 8337, 8603);

// -- Shortcut Bar --
write('shortcut-bar.css', 'App shortcut bar (desktop), locked apps, badges, more dropdown, auto-open', 8604, 8756);

// -- Nigdit --
write('nigdit.css', 'Nigdit: container, toolbar, feed, posts, voting, compose, attachments, admin stats, search, notifications, polls, awards, lightbox, profiles', 8757, 10044);

// -- Memes --
write('memes.css', 'Memes app: container, grid, cards, voting, upload modal, lightbox, drop overlay', 10045, 10410);

// -- Paste --
// Need to read more of the file for paste end point
write('paste.css', 'Paste app: container, toolbar, list, form, viewer, public viewer, analysis, diff, public create', 10411, 11373);

// -- Shop --
write('shop.css', 'Shop panel, tabs, table, crypto packs, toast', 11374, 11612);

// -- Subscriptions --
write('subscriptions.css', 'Subscriptions: active banner, controls, tier grid, cards, confirm modal, activation', 11613, 12234);

// -- Public Upload --
write('public-upload.css', 'Public upload page, card, dropzone, file list, upload, progress, transfer list', 12235, 12929);

// -- Shortlinks --
write('shortlinks.css', 'Shortlinks table, form, created state', 12930, 13045);

// -- Command Palette --
write('command-palette.css', 'Ctrl+K command palette', 13046, 13157);

// -- AI Block --
write('ai-block.css', 'AI response block — next-gen terminal style', 13158, 13376);

// -- Blackjack --
write('blackjack.css', 'Blackjack game', 13378, 13624);

// -- Audit Log --
write('audit-log.css', 'Audit log panel, filters, table', 13625, 13685);

// -- Generate index.css --
const modules = [
  'base.css',
  'layout.css',
  'grid-box.css',
  'windows.css',
  'admin.css',
  'admin-content.css',
  'whisper.css',
  'mail-base.css',
  'mail-setup.css',
  'mail-sidebar.css',
  'mail-list.css',
  'mail-view.css',
  'mail-compose.css',
  'mail-signatures.css',
  'mail-settings.css',
  'mail-attachments.css',
  'profile-nb.css',
  'timesheet.css',
  'responsive.css',
  'games.css',
  'games-grids.css',
  'games-vfx.css',
  'ascii-art.css',
  'stats.css',
  'slots.css',
  'slots-controls.css',
  'casino-admin.css',
  'toasts.css',
  'coinflip.css',
  'shortcut-bar.css',
  'nigdit.css',
  'memes.css',
  'paste.css',
  'shop.css',
  'subscriptions.css',
  'public-upload.css',
  'shortlinks.css',
  'command-palette.css',
  'ai-block.css',
  'blackjack.css',
  'audit-log.css',
];

const indexContent = `@import "tailwindcss";\n\n/* Terminal App — CSS Modules */\n/* Generated from terminal.css — do not edit this file directly */\n\n${modules.map(m => `@import "./${m}";`).join('\n')}\n`;
writeFileSync(join(__dirname, 'index.css'), indexContent);
console.log(`\n  index.css: ${modules.length} imports`);

console.log('\nDone! All modules created.');
