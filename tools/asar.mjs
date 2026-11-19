// Minimal read-only ASAR reader for inspecting the DSH Desktop payload.
// Usage:
//   node asar.mjs index  <asar> <outTxt>
//   node asar.mjs get    <asar> <entryPath> [outFile]
//   node asar.mjs grep   <asar> <regexSource> [maxHits]
import fs from 'node:fs';
import path from 'node:path';

const [, , cmd, asarPath, ...rest] = process.argv;

function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  const outer = Buffer.alloc(8);
  fs.readSync(fd, outer, 0, 8, 0);
  const headerPickleSize = outer.readUInt32LE(4);
  const pickle = Buffer.alloc(headerPickleSize);
  fs.readSync(fd, pickle, 0, headerPickleSize, 8);
  const jsonSize = pickle.readUInt32LE(4);
  const tree = JSON.parse(pickle.subarray(8, 8 + jsonSize).toString('utf8'));
  return { fd, base: 8 + headerPickleSize, tree };
}

function walk(node, prefix, out) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const full = prefix + name;
    if (child.files) walk(child, full + '/', out);
    else out.push({ path: full, offset: child.offset ?? 0, size: child.size ?? 0 });
  }
}

function readEntry(h, entry) {
  const buf = Buffer.alloc(entry.size);
  fs.readSync(h.fd, buf, 0, entry.size, h.base + Number(entry.offset));
  return buf;
}

const handle = openAsar(asarPath);
const entries = [];
walk(handle.tree, '', entries);

if (cmd === 'index') {
  const out = rest[0];
  const lines = entries.map((e) => `${e.path}\t${e.size}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(`entries=${entries.length} -> ${out}`);
} else if (cmd === 'get') {
  const target = rest[0];
  const entry = entries.find((e) => e.path === target);
  if (!entry) {
    console.error(`not found: ${target}`);
    process.exit(2);
  }
  const buf = readEntry(handle, entry);
  if (rest[1]) {
    fs.mkdirSync(path.dirname(rest[1]), { recursive: true });
    fs.writeFileSync(rest[1], buf);
    console.log(`wrote ${rest[1]} (${entry.size} bytes)`);
  } else {
    process.stdout.write(buf);
  }
} else if (cmd === 'grep') {
  const re = new RegExp(rest[0], 'g');
  const limit = Number(rest[1] ?? 20);
  const pathFilter = rest[2] ? new RegExp(rest[2]) : null;
  let hits = 0;
  for (const e of entries) {
    if (!/\.(js|mjs|cjs|ts|tsx|jsx|css|json|md)$/.test(e.path)) continue;
    if (pathFilter && !pathFilter.test(e.path)) continue;
    const text = readEntry(handle, e).toString('utf8');
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    let m;
    let n = 0;
    while ((m = re.exec(text)) !== null && n < 5) {
      const start = Math.max(0, m.index - 200);
      const snip = text.slice(start, Math.min(text.length, m.index + 300));
      console.log(`==== ${e.path} @${m.index} ====`);
      console.log(snip.replace(/\r/g, ''));
      n += 1;
      hits += 1;
      if (hits >= limit) break;
    }
    if (hits >= limit) break;
  }
  console.log(`HITS=${hits}`);
} else {
  console.error('unknown command');
  process.exit(1);
}
