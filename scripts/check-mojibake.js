#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TEXT_EXTS = new Set(['.html', '.js', '.css', '.md', '.sql', '.json', '.txt', '.yml', '.yaml', '.env', '.gitignore']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.copilot']);
const MOJIBAKE_RE = /\u00C3[\u0080-\u00BF]|\u00C2[\u00A0-\u00BF]|\u00E2(?:\u20AC|\u201A|\u201E|\u2122|\u2026|\u2020|\u2021|\u02C6|\u2030|\u0160|\u2039|\u0152|\u017D|\u2018|\u2019|\u201C|\u201D|\u2022|\u2013|\u2014|\u02DC)/g;
const REPLACEMENT = '\uFFFD';

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

function isTextFile(file) {
  return TEXT_EXTS.has(path.extname(file).toLowerCase()) || path.basename(file).startsWith('.env');
}

const files = [];
walk(ROOT, files);
const problems = [];

for (const file of files) {
  if (!isTextFile(file)) continue;
  const buf = fs.readFileSync(file);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    problems.push(`${path.relative(ROOT, file)}: invalid UTF-8 (${e.message})`);
    continue;
  }
  if (text.includes(REPLACEMENT)) {
    problems.push(`${path.relative(ROOT, file)}: contains U+FFFD replacement character`);
  }
  MOJIBAKE_RE.lastIndex = 0;
  const m = text.match(MOJIBAKE_RE);
  if (m) {
    const sample = [...new Set(m)].slice(0, 5).join(' ');
    problems.push(`${path.relative(ROOT, file)}: possible mojibake (${m.length} matches, samples: ${JSON.stringify(sample)})`);
  }
}

if (problems.length) {
  console.error('Mojibake/encoding check failed:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log(`Encoding check OK (${files.filter(isTextFile).length} text files scanned).`);
