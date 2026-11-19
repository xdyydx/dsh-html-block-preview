// Headless verification for lib/client.js using linkedom as the DOM.
//
//   node tools/verify-client.mjs
//
// linkedom is a verification-only dependency and is not part of the plugin package.
// Set LINKEDOM_ENTRY to its entry file when it is not resolvable from this directory.
//
// What this checks (the parts that are hard to eyeball in the running app):
//   - a toggle appears only on html / svg / markdown blocks, including the case where
//     `svg` is not in the shipped language table and the banner shows a "code" label;
//   - re-applying the bundle (HMR) never leaves two toggles on one banner;
//   - the first toggle press creates the lazy sandboxed Blob iframe, and only then;
//   - per-block preview and expand state stay independent;
//   - a failed frame creation still offers 「新标签打开」;
//   - teardown removes every injected node and revokes every Blob URL.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bundle = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');

const LINKEDOM_ENTRY = process.env.LINKEDOM_ENTRY
  || path.join(root, '.tmp', 'domcheck', 'node_modules', 'linkedom', 'esm', 'index.js');
if (!fs.existsSync(LINKEDOM_ENTRY)) {
  process.stdout.write(`SKIP: linkedom not found at ${LINKEDOM_ENTRY}\n`);
  process.exit(0);
}
const { parseHTML } = await import(pathToFileURL(LINKEDOM_ENTRY).href);

// ── fixtures that mirror the shipped code-block markup ────────────────────────
const PLAIN = (lang, code) => `
  <div class="_block_7gxqk_4 md-code-block">
    <div class="_bannerWrap_7gxqk_24">
      <div class="_banner_7gxqk_24" data-code-block-banner>
        <div class="_infostring_7gxqk_45" data-text-interaction-exclude>${lang}</div>
        <div class="_action_7gxqk_56">
          <button type="button" class="_copyButton_7gxqk_62">\u590d\u5236</button>
        </div>
      </div>
    </div>
    <div class="_content_7gxqk_74" data-code-block-content>
      <pre class="shiki css-variables"><code><span class="line">${code}</span></code></pre>
    </div>
  </div>`;

const RICH = (label, code) => `
  <div class="_block_7gxqk_4 md-code-block">
    <div class="_bannerWrap_7gxqk_24">
      <div class="_header_1mqf1_10" data-code-block-banner>
        <div class="_heading_1mqf1_23">
          <span class="_language_1mqf1_30">${label}</span>
        </div>
        <div class="_actions_1mqf1_43">
          <button type="button" class="_action_1mqf1_43">wrap</button>
          <button type="button" class="_action_1mqf1_43">copy</button>
        </div>
      </div>
    </div>
    <div class="_content_7gxqk_74" data-code-block-content>
      <pre class="shiki css-variables"><code><span class="line">${code}</span></code></pre>
    </div>
  </div>`;

const HTML_CODE = '&lt;div class="card"&gt;hello&lt;/div&gt;';
const SVG_CODE = '&lt;svg xmlns="http://www.w3.org/2000/svg"&gt;&lt;circle r="4"/&gt;&lt;/svg&gt;';
const MD_CODE = '# \u6807\u9898&#10;&#10;\u6b63\u6587 **\u52a0\u7c97**';
const JS_CODE = 'const answer = 42;';

const parsed = parseHTML(`<!doctype html><html lang="zh-CN"><head></head><body><div id="root">
  <section class="chat">
    <div id="b-html">${PLAIN('html', HTML_CODE)}</div>
    <div id="b-svg-label">${PLAIN('svg', SVG_CODE)}</div>
    <div id="b-svg-sniff">${RICH('Code', SVG_CODE)}</div>
    <div id="b-md">${PLAIN('markdown', MD_CODE)}</div>
    <div id="b-js">${PLAIN('javascript', JS_CODE)}</div>
  </section>
</div></body></html>`);
const page = parsed.document;
const Event = parsed.window.Event;

const TOKENS = {
  '--dsw-alias-bg-base': 'rgb(24, 24, 27)',
  '--dsw-alias-label-primary': 'rgb(237, 237, 240)',
  '--dsw-alias-brand-primary': 'rgb(77, 141, 255)',
};

// ── one shared page "window", one fresh module realm per generation ──────────
const created = new Map();
const revoked = [];
const timers = new Map();
const observers = [];
let objectUrlSeq = 0;
let timerSeq = 0;
let failObjectUrls = false;

const windowObject = {
  setTimeout(callback) {
    timerSeq += 1;
    timers.set(timerSeq, callback);
    return timerSeq;
  },
  clearTimeout(id) {
    timers.delete(id);
  },
};

const results = [];
function check(name, condition, extra) {
  results.push({ name, ok: Boolean(condition), extra });
}

function fireClick(element) {
  element.dispatchEvent(new Event('click'));
}

function loadGeneration() {
  const sandbox = {
    window: windowObject,
    document: page,
    navigator: { language: 'zh-CN' },
    getComputedStyle: () => ({ getPropertyValue: (name) => TOKENS[name] || '' }),
    requestAnimationFrame: (callback) => {
      callback(0);
      return 0;
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.targets = [];
        observers.push(this);
      }
      observe(target) {
        this.targets.push(target);
      }
      disconnect() {
        this.targets.length = 0;
      }
    },
    URL: {
      createObjectURL(blob) {
        if (failObjectUrls) throw new Error('blob disabled');
        objectUrlSeq += 1;
        const url = `blob:test/${objectUrlSeq}`;
        created.set(url, blob.parts.join(''));
        return url;
      },
      revokeObjectURL(url) {
        revoked.push(url);
        created.delete(url);
      },
    },
    Blob: class {
      constructor(parts, options) {
        this.parts = parts;
        this.type = options && options.type;
      }
    },
    console,
  };

  let registration = null;
  windowObject.__ModuleLoader__ = {
    load(entry) {
      registration = entry;
    },
  };

  vm.runInContext(bundle, vm.createContext(sandbox), { filename: 'lib/client.js' });
  const plugin = registration.factory(() => {
    throw new Error('the bundle must not require modules');
  });

  // Only `preview` is served by the stub, to prove the locale service wins; every other
  // key falls through to the bundle's own dictionary, so the shipped strings are what
  // the assertions below check.
  const localeDict = { preview: 'PREVIEW-FROM-LOCALE' };

  const cleanups = [];
  const ctx = {
    get(name) {
      if (name !== 'locale') return undefined;
      return {
        register: () => () => {},
        bind: () => (key) => localeDict[key],
      };
    },
    effect(run) {
      const cleanup = run();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
      return () => {};
    },
  };

  plugin.apply(ctx);
  return {
    dispose() {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}

const toggles = () => page.querySelectorAll('[data-dsh-cbp="toggle"]');
const panels = () => page.querySelectorAll('[data-dsh-cbp="panel"]');
const blockOf = (id) => page.getElementById(id).querySelector('.md-code-block');
const frameOf = (id) => blockOf(id).querySelector('iframe');
const srcOf = (id) => {
  const frame = frameOf(id);
  return frame === null ? '' : String(frame.getAttribute('src'));
};

// ── 1. decoration ────────────────────────────────────────────────────────────
const gen1 = loadGeneration();
check('four toggles injected (html, svg by label, svg by content, markdown)',
  toggles().length === 4, toggles().length);
check('javascript block gets no toggle',
  blockOf('b-js').querySelector('[data-dsh-cbp="toggle"]') === null);
check('svg sniffed from content under a "Code" label',
  blockOf('b-svg-sniff').querySelector('[data-dsh-cbp="toggle"]') !== null);
check('banner keeps its copy button',
  blockOf('b-html').querySelector('[data-code-block-banner]').querySelectorAll('button').length === 2,
  blockOf('b-html').querySelector('[data-code-block-banner]').querySelectorAll('button').length);
const firstToggle = blockOf('b-html').querySelector('[data-dsh-cbp="toggle"]');
check('toggle is inserted before the copy button',
  (firstToggle.nextElementSibling || {}).textContent === '\u590d\u5236');
check('no iframe exists before the first click', page.querySelectorAll('iframe').length === 0);
check('the toggle label comes from the registered locale dictionary',
  firstToggle.textContent === 'PREVIEW-FROM-LOCALE', firstToggle.textContent);
// The sticky banner wrapper loses its own radius so it paints an opaque square: its two
// rounded corners used to leak the white document through while the chat scrolled.
const htmlWrap = blockOf('b-html').querySelector('[data-code-block-banner]').parentElement;
check('the sticky banner wrapper is marked for squaring',
  htmlWrap.hasAttribute('data-dsh-cbp-wrap'));
check('undecorated blocks do not get the wrapper marker',
  blockOf('b-js').querySelector('[data-code-block-banner]').parentElement
    .hasAttribute('data-dsh-cbp-wrap') === false);

// ── 2. HMR: a second generation must not duplicate anything ──────────────────
const gen2 = loadGeneration();
check('still exactly four toggles after re-applying', toggles().length === 4, toggles().length);
check('still exactly four panels after re-applying', panels().length === 4, panels().length);

// ── 3. first click creates the lazy sandboxed frame ──────────────────────────
const htmlToggle = blockOf('b-html').querySelector('[data-dsh-cbp="toggle"]');
fireClick(htmlToggle);
const htmlFrame = frameOf('b-html');
check('click creates an iframe', htmlFrame !== null);
check('iframe sandbox is allow-scripts only',
  htmlFrame !== null && htmlFrame.getAttribute('sandbox') === 'allow-scripts',
  htmlFrame === null ? null : htmlFrame.getAttribute('sandbox'));
const htmlSrc = srcOf('b-html');
check('iframe src is a blob URL', htmlSrc.startsWith('blob:'), htmlSrc);
check('code content is hidden while previewing',
  blockOf('b-html').querySelector('[data-code-block-content]').hasAttribute('data-dsh-cbp-hidden'));
check('panel is visible while previewing',
  blockOf('b-html').querySelector('[data-dsh-cbp="panel"]').hasAttribute('hidden') === false);
check('toggle label flips to 源码', htmlToggle.textContent === '\u6e90\u7801', htmlToggle.textContent);
check('aria-pressed is true', htmlToggle.getAttribute('aria-pressed') === 'true');
const htmlDoc = created.get(htmlSrc) || '';
check('blob carries the html source', htmlDoc.includes('<div class="card">hello</div>'), htmlDoc.slice(0, 160));
check('html document is a full document', /^<!doctype html>/i.test(htmlDoc.trim()));

// ── 4. per-block independence ────────────────────────────────────────────────
check('the svg block stayed in code mode', frameOf('b-svg-label') === null);
check('the svg block content is still visible',
  blockOf('b-svg-label').querySelector('[data-code-block-content]').hasAttribute('data-dsh-cbp-hidden') === false);

// ── 5. leaving preview releases the frame and its Blob URL ───────────────────
const htmlUrl = srcOf('b-html');
const revokedBefore = revoked.length;
fireClick(htmlToggle);
check('toggling back to code hides the panel',
  blockOf('b-html').querySelector('[data-dsh-cbp="panel"]').hasAttribute('hidden'));
check('toggling back to code restores the content',
  blockOf('b-html').querySelector('[data-code-block-content]').hasAttribute('data-dsh-cbp-hidden') === false);
check('toggling back to code drops the iframe', frameOf('b-html') === null);
check('toggling back to code hides the full screen action',
  blockOf('b-html').querySelector('[data-dsh-cbp="zoom"]').hasAttribute('hidden'));
check('toggling back to code hides the download action',
  blockOf('b-html').querySelector('[data-dsh-cbp="download"]').hasAttribute('hidden'));
check('toggling back to code revokes the Blob URL',
  revoked.length > revokedBefore && revoked.includes(htmlUrl) && !created.has(htmlUrl),
  { revoked: revoked.slice(revokedBefore), htmlUrl });
fireClick(htmlToggle);
check('re-opening preview rebuilds the iframe', frameOf('b-html') !== null);
check('re-opening preview creates a fresh Blob URL', srcOf('b-html') !== '' && srcOf('b-html') !== htmlUrl,
  srcOf('b-html'));

// ── 6. expand toggle ─────────────────────────────────────────────────────────
const expandButton = blockOf('b-html').querySelector('[data-dsh-cbp="expand"]');
fireClick(expandButton);
const htmlPanel = blockOf('b-html').querySelector('[data-dsh-cbp="panel"]');
check('expand sets data-expanded', htmlPanel.getAttribute('data-expanded') === 'true');
check('expand relabels to 收起', expandButton.textContent === '\u6536\u8d77', expandButton.textContent);

// ── 7. the footer never offers a new tab (the shell denies window.open) ──────
check('no new-tab link is rendered', page.querySelector('[data-dsh-cbp="newtab"]') === null);
const downloadLink = blockOf('b-html').querySelector('[data-dsh-cbp="download"]');
check('download link is revealed with the blob URL',
  downloadLink.hasAttribute('hidden') === false
    && String(downloadLink.getAttribute('href')).startsWith('blob:')
    && downloadLink.getAttribute('download') === 'preview.html',
  { hidden: downloadLink.hasAttribute('hidden'), href: downloadLink.getAttribute('href') });

// ── 8. full screen overlay ──────────────────────────────────────────────────
const zoomButton = blockOf('b-html').querySelector('[data-dsh-cbp="zoom"]');
check('zoom button is revealed once a frame exists', zoomButton.hasAttribute('hidden') === false);
fireClick(zoomButton);
const overlay = page.querySelector('[data-dsh-cbp="overlay"]');
check('zoom appends a full screen overlay to the body',
  overlay !== null && overlay.parentNode === page.body);
const overlayFrame = overlay === null ? null : overlay.querySelector('iframe');
check('the overlay frame keeps the sandbox and reuses the live blob URL',
  overlayFrame !== null
    && overlayFrame.getAttribute('sandbox') === 'allow-scripts'
    && overlayFrame.getAttribute('src') === srcOf('b-html'),
  overlayFrame === null ? null : overlayFrame.getAttribute('src'));
check('the overlay is modal-labelled',
  overlay !== null && overlay.getAttribute('aria-modal') === 'true');
const escape = new Event('keydown');
escape.key = 'Escape';
page.dispatchEvent(escape);
check('Escape closes the overlay', page.querySelector('[data-dsh-cbp="overlay"]') === null);
fireClick(zoomButton);
const overlayClose = page.querySelector('[data-dsh-cbp="overlay-close"]');
fireClick(overlayClose);
check('the close button closes the overlay', page.querySelector('[data-dsh-cbp="overlay"]') === null);

// ── 9. markdown path renders through marked with theme tokens ────────────────
fireClick(blockOf('b-md').querySelector('[data-dsh-cbp="toggle"]'));
const mdDoc = created.get(srcOf('b-md')) || '';
check('markdown rendered to html',
  mdDoc.includes('<h1>\u6807\u9898</h1>') && mdDoc.includes('<strong>\u52a0\u7c97</strong>'),
  mdDoc.slice(-240));
check('markdown document carries theme tokens',
  mdDoc.includes('--dsw-alias-bg-base:rgb(24, 24, 27)'), mdDoc.slice(0, 240));

// ── 10. svg document ────────────────────────────────────────────────────────
fireClick(blockOf('b-svg-label').querySelector('[data-dsh-cbp="toggle"]'));
const svgDoc = created.get(srcOf('b-svg-label')) || '';
check('svg document embeds the svg markup',
  svgDoc.includes('<svg xmlns="http://www.w3.org/2000/svg">'), svgDoc.slice(-180));

// ── 11. slow frame keeps the frame and reports a hint ───────────────────────
for (const callback of [...timers.values()]) callback();
check('slow load keeps the frame and reports a hint',
  frameOf('b-html') !== null
    && blockOf('b-html').querySelector('[data-dsh-cbp="status"]').textContent.includes('\u8f83\u6162'),
  blockOf('b-html').querySelector('[data-dsh-cbp="status"]').textContent);

// ── 9. a later-rendered block is picked up through the observer ──────────────
const laterHost = page.createElement('div');
laterHost.innerHTML = PLAIN('html', '&lt;p&gt;later&lt;/p&gt;');
page.getElementById('root').appendChild(laterHost);
const lastObserver = observers[observers.length - 1];
lastObserver.callback([{ addedNodes: [laterHost], type: 'childList' }]);
check('a block added later gets a toggle through the observer',
  laterHost.querySelector('[data-dsh-cbp="toggle"]') !== null);

// ── 10. a re-rendered banner is re-decorated, never doubled ──────────────────
const rerendered = blockOf('b-md');
const staleBanner = rerendered.querySelector('[data-code-block-banner]');
const replacement = page.createElement('div');
replacement.setAttribute('data-code-block-banner', '');
replacement.innerHTML = '<div class="_infostring_7gxqk_45">markdown</div>'
  + '<div class="_action_7gxqk_56"><button type="button">\u590d\u5236</button></div>';
staleBanner.parentNode.replaceChild(replacement, staleBanner);
lastObserver.callback([{ addedNodes: [replacement], type: 'childList' }]);
check('a replaced banner is re-decorated exactly once',
  rerendered.querySelectorAll('[data-dsh-cbp="toggle"]').length === 1,
  rerendered.querySelectorAll('[data-dsh-cbp="toggle"]').length);
check('the replaced banner keeps a single panel',
  rerendered.querySelectorAll('[data-dsh-cbp="panel"]').length === 1,
  rerendered.querySelectorAll('[data-dsh-cbp="panel"]').length);

// ── 14. streaming: a half-arrived `<sv` must not hide the toggle for good ────
const streamingHost = page.createElement('div');
streamingHost.innerHTML = PLAIN('Code', '&lt;s');
page.getElementById('root').appendChild(streamingHost);
const streamingBlock = streamingHost.querySelector('.md-code-block');
lastObserver.callback([{ addedNodes: [streamingHost], type: 'childList' }]);
check('an undecided prefix gets no toggle yet',
  streamingHost.querySelector('[data-dsh-cbp="toggle"]') === null);
streamingBlock.querySelector('pre code').textContent =
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';
lastObserver.callback([{ addedNodes: [streamingBlock] , type: 'childList' }]);
check('the finished svg content is then decorated',
  streamingHost.querySelector('[data-dsh-cbp="toggle"]') !== null);

// ── 14b. a cached "not supported" verdict is dropped when the block changes ──
const lateHost = page.createElement('div');
lateHost.innerHTML = PLAIN('Code', 'plain text for now');
page.getElementById('root').appendChild(lateHost);
const lateBlock = lateHost.querySelector('.md-code-block');
lastObserver.callback([{ addedNodes: [lateHost], type: 'childList' }]);
check('a block without an svg shape is skipped', lateHost.querySelector('[data-dsh-cbp="toggle"]') === null);
const lateContent = lateBlock.querySelector('[data-code-block-content]');
lateBlock.querySelector('pre code').textContent = '<svg xmlns="http://www.w3.org/2000/svg"/>';
lastObserver.callback([{ addedNodes: [], type: 'characterData', target: lateContent }]);
check('the same block is re-evaluated after its own content mutates',
  lateHost.querySelector('[data-dsh-cbp="toggle"]') !== null);

// ── 15. teardown revokes every blob URL and removes every node ───────────────
fireClick(blockOf('b-html').querySelector('[data-dsh-cbp="zoom"]'));
check('an overlay is open before teardown', page.querySelector('[data-dsh-cbp="overlay"]') !== null);
const beforeTeardown = [...created.keys()];
gen2.dispose();
check('teardown removes every injected toggle', toggles().length === 0, toggles().length);
check('teardown removes every panel', panels().length === 0, panels().length);
check('teardown removes a lingering overlay', page.querySelector('[data-dsh-cbp="overlay"]') === null);
check('teardown restores hidden content', page.querySelectorAll('[data-dsh-cbp-hidden]').length === 0);
check('teardown clears the sticky wrapper marker',
  page.querySelectorAll('[data-dsh-cbp-wrap]').length === 0,
  page.querySelectorAll('[data-dsh-cbp-wrap]').length);
check('teardown revokes every created blob URL',
  beforeTeardown.length > 0 && beforeTeardown.every((url) => revoked.includes(url)) && created.size === 0,
  { created: [...created.keys()], revoked });
check('teardown clears the page guard', windowObject.__dshCodeBlockPreview === undefined);
check('teardown disconnects the observer', observers.every((observer) => observer.targets.length === 0));

// ── 16. failure path still lets the document leave the app ──────────────────
failObjectUrls = true;
const gen3 = loadGeneration();
const failTarget = blockOf('b-md').querySelector('[data-dsh-cbp="toggle"]');
fireClick(failTarget);
check('failed frame creation leaves no iframe', frameOf('b-md') === null);
const blocked = blockOf('b-md').querySelector('[data-dsh-cbp="blocked"]');
check('failed frame creation shows a message', blocked !== null && blocked.textContent.length > 0,
  blocked === null ? null : blocked.textContent);
check('the failure message points at the download action',
  blocked !== null && blocked.textContent.includes('\u4e0b\u8f7d'),
  blocked === null ? null : blocked.textContent);
const failDownload = blockOf('b-md').querySelector('[data-dsh-cbp="download"]');
check('failed frame creation reveals a data-URL download',
  failDownload !== null
    && failDownload.hasAttribute('hidden') === false
    && String(failDownload.getAttribute('href')).startsWith('data:text/html;charset=utf-8,'),
  failDownload === null ? null : failDownload.getAttribute('href'));
check('failed frame creation hides the full screen action',
  blockOf('b-md').querySelector('[data-dsh-cbp="zoom"]').hasAttribute('hidden'));
check('the javascript block still has no toggle in the failure generation',
  blockOf('b-js').querySelector('[data-dsh-cbp="toggle"]') === null);
gen3.dispose();
failObjectUrls = false;
void gen1;

// ── report ───────────────────────────────────────────────────────────────────
let failed = 0;
for (const result of results) {
  if (!result.ok) failed += 1;
  const line = `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}`;
  process.stdout.write(result.ok ? `${line}\n` : `${line}  ${JSON.stringify(result.extra)}\n`);
}
process.stdout.write(`\n${results.length - failed}/${results.length} checks passed\n`);
process.exit(failed === 0 ? 0 : 1);
