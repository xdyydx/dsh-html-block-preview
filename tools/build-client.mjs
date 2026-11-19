// Builds lib/client.js from src/client.js by inlining the vendored marked UMD build,
// so the browser bundle needs no module resolution beyond the page's own React-free
// platform table.
//
//   node tools/build-client.mjs
//
// `marked` is not reachable from the DSH client module table (dsh.client.external only
// resolves the platform seed table and dynamic package rows), so the renderer ships
// inside this bundle. Keep vendor/marked.umd.js and vendor/marked.LICENSE.md in sync.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sourcePath = path.join(root, 'src', 'client.js');
const markedPath = path.join(root, 'vendor', 'marked.umd.js');
const outPath = path.join(root, 'lib', 'client.js');
const PLACEHOLDER = '/*__MARKED_UMD__*/';

const source = fs.readFileSync(sourcePath, 'utf8');
const marked = fs.readFileSync(markedPath, 'utf8');

if (!source.includes(PLACEHOLDER)) {
  throw new Error(`src/client.js must contain the placeholder ${PLACEHOLDER}`);
}
if (marked.includes(PLACEHOLDER)) {
  throw new Error('vendor/marked.umd.js unexpectedly contains the placeholder');
}

// A function replacer keeps `$&`-style sequences in the vendored text literal.
const output = source.replace(PLACEHOLDER, () => marked.trimEnd());

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, output, 'utf8');
process.stdout.write(`lib/client.js written: ${output.length} bytes\n`);
