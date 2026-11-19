// Print a character range of a file (for reading minified bundles).
// usage: node slice.mjs <file> <start> <end>
import fs from 'node:fs';
const [, , file, start, end] = process.argv;
const text = fs.readFileSync(file, 'utf8');
const s = Math.max(0, Number(start));
const e = Math.min(text.length, Number(end ?? text.length));
process.stdout.write(text.slice(s, e));
