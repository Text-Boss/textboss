#!/usr/bin/env node
'use strict';

const pkg = require('../package.json');

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const RST  = '\x1b[0m';
const DIM  = '\x1b[2m';
const f    = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
const bg   = (r, g, b) => `\x1b[48;2;${r};${g};${b}m`;

// ── Brand palette ─────────────────────────────────────────────────────────────
const C = {
  amber:  [245, 158,  11],
  cyan:   [ 34, 211, 238],
  purple: [167, 139, 250],
  green:  [ 34, 197,  94],
  danger: [239,  68,  68],
  muted:  [ 82,  96, 109],
  text:   [228, 236, 242],
  dim:    [ 40,  48,  56],
};

// ── Pixel grids — 10 pixel-rows each, rendered as 5 half-block char-rows ─────
//   (▀ = upper half filled, ▄ = lower half filled, █ = both, ' ' = neither)
//
//   T — 7 cols wide, amber
const T_GRID = [
  [1,1,1,1,1,1,1],  // pixel row 0 ─┐ char row 0
  [1,1,1,1,1,1,1],  // pixel row 1 ─┘
  [0,0,0,1,0,0,0],  // pixel row 2 ─┐ char row 1
  [0,0,0,1,0,0,0],  // pixel row 3 ─┘
  [0,0,0,1,0,0,0],  // pixel row 4 ─┐ char row 2
  [0,0,0,1,0,0,0],  // pixel row 5 ─┘
  [0,0,0,1,0,0,0],  // pixel row 6 ─┐ char row 3
  [0,0,0,1,0,0,0],  // pixel row 7 ─┘
  [0,0,0,1,0,0,0],  // pixel row 8 ─┐ char row 4
  [0,0,0,1,0,0,0],  // pixel row 9 ─┘
];

//   B — 6 cols wide, cyan
const B_GRID = [
  [1,1,1,1,1,0],   // pixel row 0 ─┐ char row 0
  [1,1,1,1,1,0],   // pixel row 1 ─┘
  [1,0,0,0,0,1],   // pixel row 2 ─┐ char row 1
  [1,0,0,0,0,1],   // pixel row 3 ─┘
  [1,1,1,1,1,0],   // pixel row 4 ─┐ char row 2
  [1,1,1,1,1,0],   // pixel row 5 ─┘
  [1,0,0,0,0,1],   // pixel row 6 ─┐ char row 3
  [1,0,0,0,0,1],   // pixel row 7 ─┘
  [1,1,1,1,1,0],   // pixel row 8 ─┐ char row 4
  [1,1,1,1,1,0],   // pixel row 9 ─┘
];

// ── Half-block renderer ───────────────────────────────────────────────────────
function pixelRows(grid, color) {
  const charRows = Math.ceil(grid.length / 2);
  const cols     = grid[0].length;
  const lines    = [];

  for (let r = 0; r < charRows; r++) {
    const top = grid[2 * r];
    const bot = grid[2 * r + 1] || Array(cols).fill(0);
    let row = '';

    for (let c = 0; c < cols; c++) {
      const u = top[c], l = bot[c];
      if      (u && l)  row += `${f(...color)}█${RST}`;
      else if (u)       row += `${f(...color)}▀${RST}`;
      else if (l)       row += `${f(...color)}▄${RST}`;
      else              row += ' ';
    }
    lines.push(row);
  }
  return lines;
}

// ── Platform string ───────────────────────────────────────────────────────────
function platform() {
  return (
    { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform]
    || process.platform
  );
}

// ── Color swatch ──────────────────────────────────────────────────────────────
function swatch() {
  return [C.amber, C.green, C.cyan, C.purple, C.danger, C.dim]
    .map(c => `${f(...c)}${bg(...c)}██${RST}`)
    .join('');
}

// ── Info key/value ────────────────────────────────────────────────────────────
function kv(key, val) {
  return `${DIM}${f(...C.muted)}${key.padEnd(9)}${RST}${f(...C.text)}${val}${RST}`;
}

// ── Non-TTY plain fallback ────────────────────────────────────────────────────
function plainSplash() {
  process.stdout.write(`\nText Boss  v${pkg.version}  ${platform()}\n`);
  process.stdout.write('Tiers: Core  Pro  Black\n');
  process.stdout.write('// say less. control more. protect everything.\n\n');
}

// ── Main splash ───────────────────────────────────────────────────────────────
function splash() {
  if (!process.stdout.isTTY) { plainSplash(); return; }

  const tRows = pixelRows(T_GRID, C.amber);   // 5 char-rows
  const bRows = pixelRows(B_GRID, C.cyan);    // 5 char-rows

  const tiers = [
    `${f(...C.amber)}Core${RST}`,
    `${f(...C.cyan)}Pro${RST}`,
    `${f(...C.purple)}Black${RST}`,
  ].join('  ');

  // 5 info lines — one per char-row
  const info = [
    kv('Product', 'Text Boss'),
    kv('Version', `v${pkg.version}`),
    kv('Platform', platform()),
    kv('Tiers', tiers),
    swatch(),
  ];

  process.stdout.write('\n');

  for (let i = 0; i < tRows.length; i++) {
    // Logo: 1 space + T (7) + 3 gap + B (6) + 4 pad = 21 visual chars
    const logo     = ` ${tRows[i]}   ${bRows[i]}    `;
    const infoLine = info[i] || '';
    process.stdout.write(logo + infoLine + '\n');
  }

  process.stdout.write('\n');
  process.stdout.write(
    `  ${DIM}${f(...C.muted)}// say less. control more. protect everything.${RST}\n`
  );
  process.stdout.write('\n');
}

// ── Flags ─────────────────────────────────────────────────────────────────────
const arg = process.argv[2];

if (arg === '--version' || arg === '-v') {
  process.stdout.write(`v${pkg.version}\n`);
  process.exit(0);
}

if (arg === '--help' || arg === '-h') {
  splash();
  process.stdout.write(
    [
      `  ${f(...C.cyan)}Usage${RST}`,
      `    ${f(...C.muted)}textboss${RST}              Show this splash screen`,
      `    ${f(...C.muted)}textboss --version${RST}    Print version`,
      `    ${f(...C.muted)}textboss --help${RST}       Show usage`,
      '',
      `  ${f(...C.cyan)}Access your tier${RST}`,
      `    ${f(...C.amber)}Core${RST}   ${f(...C.muted)}https://textboss.co/access.html${RST}`,
      `    ${f(...C.cyan)}Pro${RST}    ${f(...C.muted)}https://textboss.co/access.html${RST}`,
      `    ${f(...C.purple)}Black${RST}  ${f(...C.muted)}https://textboss.co/access.html${RST}`,
      '',
    ].join('\n')
  );
  process.exit(0);
}

splash();
