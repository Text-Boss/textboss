#!/usr/bin/env node
// dev-only script — not deployed
// Reads pro_subscriber_prompts.html and extracts all prompt templates into prompts-data.json

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'pro_subscriber_prompts.html');
const OUTPUT = path.join(ROOT, 'prompts-data.json');

const html = fs.readFileSync(INPUT, 'utf8');

// ── 1. Determine category order from first appearance of data-category ───────
// We scan all data-category attributes in document order so categories are
// listed in the same order as the section headers.
const categories = [];
const categoryOrder = [];
const dataCatScanRe = /data-category="([^"]+)"/g;
let match;
while ((match = dataCatScanRe.exec(html)) !== null) {
  const name = match[1].trim();
  if (!categoryOrder.includes(name)) {
    categoryOrder.push(name);
  }
}

// ── 2. Extract all prompt cards ─────────────────────────────────────────────
// Each card:
//   <div class="prompt-card" data-category="CATEGORY">
//     <div class="card-head"><span><span class="card-num">#N</span><span class="card-title">TITLE</span></span>...</div>
//     <div class="card-body">BODY</div>
//   </div>

const prompts = {};

// Match the entire prompt-card div. Cards never nest, so a greedy match up to
// the next </div> that closes the card is safe; we match using a multi-step
// approach: capture from opening <div class="prompt-card" ...> through the
// card-body content.
const cardRe = /<div class="prompt-card" data-category="([^"]+)">([\s\S]*?)<\/div>\s*<\/div>/g;

// More precise: match card-head then card-body
// We'll parse card by card using a structured approach
const cardBlockRe = /<div class="prompt-card" data-category="([^"]+)">\s*<div class="card-head">.*?<span class="card-num">(#\d+)<\/span>\s*<span class="card-title">([^<]+)<\/span>.*?<\/div>\s*<div class="card-body">([\s\S]*?)<\/div>\s*<\/div>/g;

let cardMatch;
while ((cardMatch = cardBlockRe.exec(html)) !== null) {
  const category = cardMatch[1].replace(/&amp;/g, '&').trim();
  const num = cardMatch[2].trim();
  const title = cardMatch[3].replace(/&amp;/g, '&').trim();
  // Decode basic HTML entities in body
  const body = cardMatch[4]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

  if (!prompts[category]) {
    prompts[category] = [];
    if (!categoryOrder.includes(category)) {
      categoryOrder.push(category);
    }
  }
  prompts[category].push({ num, title, body });
}

// ── 3. Build final structure ────────────────────────────────────────────────
// categories array uses the order found in section headers;
// any category in prompts but not in headers appends at the end
const finalCategories = categoryOrder.filter(c => prompts[c]);

const output = {
  categories: finalCategories,
  prompts,
};

fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf8');

const totalPrompts = Object.values(prompts).reduce((sum, arr) => sum + arr.length, 0);
console.log(`Categories: ${finalCategories.length}`);
console.log(`Total prompts: ${totalPrompts}`);
console.log(`Output written to: ${OUTPUT}`);
