// dsh-code-block-preview - Client half.
//
// Adds a preview toggle to ```html / ```svg / ```markdown code blocks in the DSH Web
// chat. Nothing is rendered until the toggle is first pressed; the content is then
// handed to a `sandbox="allow-scripts"` Blob iframe, which runs with an opaque origin.
//
// Hand-written __ModuleLoader__ bundle: no slot exists for a code-block banner, so the
// plugin only decorates the shipped banner element ([data-code-block-banner]) and the
// content element ([data-code-block-content]) that the markdown renderer already emits.
//
// The vendored markdown renderer below is `marked` (MIT, vendor/marked.LICENSE.md),
// inlined by tools/build-client.mjs: `marked` is not reachable from the client module
// table, because dsh.client.external resolves only the platform seed table and dynamic
// package rows.
window.__ModuleLoader__.load({
  id: 'dsh-code-block-preview',
  factory(require) {
    'use strict';

    var module = { exports: {} };
    var exports = module.exports;

    // ---- vendored markdown renderer -----------------------------------------
    var markedModule = (function () {
      var module = { exports: {} };
      var exports = module.exports;
/*__MARKED_UMD__*/
      return module.exports;
    })();

    // ---- identity, copy, and tuning -----------------------------------------
    var NS = 'code-block-preview';
    var GUARD = '__dshCodeBlockPreview';
    var ATTR = 'data-dsh-cbp';
    var HIDDEN_ATTR = 'data-dsh-cbp-hidden';
    var WRAP_ATTR = 'data-dsh-cbp-wrap';
    var STAGE_MAX_HEIGHT = '600px';
    var FRAME_TIMEOUT_MS = 4000;
    // A content-based verdict that streaming can still overturn; never cached.
    var KIND_PENDING = 'pending';

    var DICT = {
      zh: {
        preview: '预览',
        source: '源码',
        previewTitle: '在沙箱 iframe 中预览',
        sourceTitle: '返回代码',
        expand: '展开',
        collapse: '收起',
        expandTitle: '展开预览区域',
        collapseTitle: '收起预览区域',
        zoom: '放大',
        zoomTitle: '在应用内全屏查看',
        download: '下载',
        downloadTitle: '下载为 HTML 文件',
        overlayTitle: '代码预览',
        close: '关闭',
        closeTitle: '关闭全屏预览',
        frameTitle: '代码预览',
        frameFailed: '无法创建预览',
        frameSlow: '预览加载较慢',
        downloadHint: '可点「下载」保存为 HTML 文件查看。',
      },
      en: {
        preview: 'Preview',
        source: 'Code',
        previewTitle: 'Preview in a sandboxed frame',
        sourceTitle: 'Back to the code',
        expand: 'Expand',
        collapse: 'Collapse',
        expandTitle: 'Expand the preview area',
        collapseTitle: 'Collapse the preview area',
        zoom: 'Full screen',
        zoomTitle: 'View it full screen in the app',
        download: 'Download',
        downloadTitle: 'Download as an HTML file',
        overlayTitle: 'Code preview',
        close: 'Close',
        closeTitle: 'Close the full screen preview',
        frameTitle: 'Code preview',
        frameFailed: 'Preview could not be created',
        frameSlow: 'Preview is taking longer than expected',
        downloadHint: 'Use Download to save it as an HTML file.',
      },
    };

    var KIND_BY_LANG = {
      html: ['html', 'htm', 'xhtml', 'html5', 'text/html'],
      markdown: ['md', 'markdown', 'mdx', 'gfm', 'commonmark', 'text/markdown'],
      svg: ['svg', 'image/svg+xml'],
    };

    // Substituted into the preview document so its prose follows the live theme.
    var TOKEN_NAMES = [
      'bg-base', 'bg-layer-1', 'bg-layer-2', 'bg-overlay',
      'border-l1', 'border-l2',
      'label-primary', 'label-secondary',
      'brand-primary',
      'state-error-primary', 'state-success-primary', 'state-warn-primary', 'state-idle-primary',
    ];

    var CSS = [
      '[' + HIDDEN_ATTR + ']{display:none!important}',
      '.dsh-cbp__toggle{flex:none;margin:0 12px 0 0;padding:0;border:0;border-radius:var(--dsw-radius-xs,4px);',
      'background:transparent;color:inherit;font:11px/18px var(--dsw-font-family);cursor:pointer;white-space:nowrap}',
      '@media (hover:hover){.dsh-cbp__toggle:hover{color:var(--dsw-alias-label-secondary)}}',
      '.dsh-cbp__toggle:focus-visible{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));',
      'outline-offset:2px}',
      '.dsh-cbp__toggle[aria-pressed="true"]{color:var(--dsw-alias-brand-primary)}',
      '.dsh-cbp__panel{border-top:1px solid var(--dsw-alias-border-l1);overflow:hidden;',
      'border-bottom-left-radius:var(--dsl-code-block-border-radius,var(--dsw-radius-lg,8px));',
      'border-bottom-right-radius:var(--dsl-code-block-border-radius,var(--dsw-radius-lg,8px))}',
      '.dsh-cbp__panel[hidden]{display:none}',
      '.dsh-cbp__stage{max-height:' + STAGE_MAX_HEIGHT + ';overflow:auto;overscroll-behavior:contain}',
      '.dsh-cbp__panel[data-expanded="true"] .dsh-cbp__stage{max-height:none}',
      '.dsh-cbp__frame{display:block;width:100%;height:' + STAGE_MAX_HEIGHT + ';border:0;background:#fff}',
      '.dsh-cbp__panel[data-expanded="true"] .dsh-cbp__frame{height:80vh}',
      '.dsh-cbp__blocked{margin:0;padding:14px 16px;background:#fff;color:#b4232c;',
      'font:13px/20px var(--dsw-font-family)}',
      '.dsh-cbp__foot{display:flex;align-items:center;gap:12px;padding:6px 12px;',
      'border-top:1px solid var(--dsw-alias-border-l1);',
      'background:var(--dsl-code-block-banner-background-color,transparent);',
      'font:11px/18px var(--dsw-font-family);color:var(--dsw-alias-label-secondary)}',
      '.dsh-cbp__status{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      'color:var(--dsw-alias-state-error-primary)}',
      '.dsh-cbp__link{flex:none;padding:0;border:0;background:transparent;color:inherit;font:inherit;',
      'cursor:pointer;white-space:nowrap;text-decoration:none}',
      '@media (hover:hover){.dsh-cbp__link:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}}',
      '.dsh-cbp__link:focus-visible{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));',
      'outline-offset:2px}',
      // Full screen view. The desktop shell denies every window.open and every
      // non-origin navigation, so an in-app overlay is the only "bigger" surface.
      '.dsh-cbp__overlay{position:fixed;inset:0;z-index:2147483000;display:flex;',
      'align-items:stretch;justify-content:center;padding:28px;background:rgba(0,0,0,.55)}',
      '.dsh-cbp__card{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;max-width:1400px;',
      'overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;',
      'background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 18px 60px rgba(0,0,0,.4)}',
      '.dsh-cbp__cardHead{display:flex;align-items:center;gap:12px;padding:8px 10px 8px 14px;',
      'border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);',
      'font:12px/20px var(--dsw-font-family)}',
      '.dsh-cbp__cardTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-cbp__cardBody{flex:1 1 auto;min-height:0;background:#fff}',
      '.dsh-cbp__cardBody>.dsh-cbp__frame{height:100%}',
      // The shipped banner lives in a sticky wrapper that owns the top radius and fills
      // itself with the page background. While the conversation scrolls, the preview
      // passes behind that wrapper, and its two rounded top corners are transparent, so
      // the white document used to leak through as two white corners. Squaring the
      // wrapper makes it paint the full rectangle (page background, exactly what sat in
      // those corners before); the banner keeps its own rounding on top of it.
      '[data-dsh-cbp-wrap]{border-top-left-radius:0!important;border-top-right-radius:0!important}',
      '[data-dsh-cbp-wrap]>[data-code-block-banner]{',
      'border-top-left-radius:var(--dsl-code-block-border-radius,var(--dsw-radius-lg,8px))!important;',
      'border-top-right-radius:var(--dsl-code-block-border-radius,var(--dsw-radius-lg,8px))!important}',
    ].join('');

    // ---- module state -------------------------------------------------------
    var records = new WeakMap();
    var skipped = new WeakSet();
    var createdUrls = new Set();
    var observer = null;
    var styleEl = null;
    var scanScheduled = false;

    function fallbackTranslate(key) {
      var preferred = 'en';
      try {
        var lang = String(document.documentElement.getAttribute('lang') || navigator.language || 'en').toLowerCase();
        preferred = lang.indexOf('zh') === 0 ? 'zh' : 'en';
      } catch (error) {
        preferred = 'en';
      }
      var dict = DICT[preferred] || DICT.en;
      if (dict[key] !== undefined) return dict[key];
      return DICT.en[key] !== undefined ? DICT.en[key] : key;
    }

    var translate = fallbackTranslate;

    function t(key) {
      return translate(key);
    }

    // ---- DOM contract of the shipped code block -----------------------------
    // The markdown renderer emits:
    //   <div class="... md-code-block">
    //     <div class="...bannerWrap"><div data-code-block-banner>...</div></div>
    //     <div data-code-block-content>...</div>
    //   </div>
    function isBanner(node) {
      return node !== null && node !== undefined && node.nodeType === 1
        && node.hasAttribute('data-code-block-banner');
    }

    function contentOf(root) {
      if (root === null || root === undefined) return null;
      var children = root.children;
      for (var i = 0; i < children.length; i += 1) {
        if (children[i].hasAttribute('data-code-block-content')) return children[i];
      }
      return null;
    }

    function blockRootOf(banner) {
      var wrap = banner.parentElement;
      var root = wrap === null ? null : wrap.parentElement;
      if (root !== null && contentOf(root) !== null) return root;
      var closest = typeof banner.closest === 'function' ? banner.closest('.md-code-block') : null;
      if (closest !== null && contentOf(closest) !== null) return closest;
      return null;
    }

    // The plain banner shows the raw info string; the toolbar variant shows a language
    // span. Both hang off the banner's first child.
    function languageOf(banner) {
      var labelled = banner.querySelector('[class*="infostring"],[class*="language"]');
      if (labelled !== null) return (labelled.textContent || '').trim();
      var first = banner.firstElementChild;
      if (first === null) return '';
      var inner = first.firstElementChild;
      return ((inner === null ? first : inner).textContent || '').trim();
    }

    function stripProlog(source) {
      var text = String(source).replace(/^\uFEFF/, '');
      for (var guard = 0; guard < 8; guard += 1) {
        var before = text;
        text = text.trimStart()
          .replace(/^<\?xml[\s\S]*?\?>/i, '')
          .replace(/^<!DOCTYPE[^>]*>/i, '')
          .replace(/^<!--[\s\S]*?-->/, '')
          .trimStart();
        if (text === before) break;
      }
      return text;
    }

    // The banner can only name the language for blocks the shipped table knows, and
    // `svg` is not in it — a toolbar banner shows the localized "code" label there. So
    // an unrecognized label falls back to the content. Streaming makes that a moving
    // target: a half-arrived `<sv` must stay undecided instead of being written off, or
    // one early frame would hide the toggle for a whole SVG block.
    function sniffSvg(code) {
      var head = stripProlog(String(code).slice(0, 400));
      if (head === '') return KIND_PENDING;
      if (/^<svg[\s>]/i.test(head)) return 'svg';
      if (head.length < 4 && '<svg'.indexOf(head.toLowerCase()) === 0) return KIND_PENDING;
      return null;
    }

    function kindOf(banner, code) {
      var raw = languageOf(banner).toLowerCase().replace(/^language-/, '');
      var token = raw.split(/[\s;,{(]/)[0];
      var kinds = Object.keys(KIND_BY_LANG);
      for (var i = 0; i < kinds.length; i += 1) {
        if (KIND_BY_LANG[kinds[i]].indexOf(token) !== -1) return kinds[i];
      }
      return sniffSvg(code);
    }

    // Matches the shipped copy action, which reads the rendered <pre> text.
    function codeOf(content) {
      var pre = content.querySelector('pre');
      var node = pre === null ? content : pre;
      return node.textContent === null ? '' : node.textContent;
    }

    // ---- theme tokens -------------------------------------------------------
    function readTokens() {
      var tokens = {};
      var hosts = [document.documentElement, document.body, document.getElementById('root')];
      var styles = [];
      for (var i = 0; i < hosts.length; i += 1) {
        if (hosts[i] !== null && hosts[i] !== undefined) styles.push(getComputedStyle(hosts[i]));
      }
      for (var j = 0; j < TOKEN_NAMES.length; j += 1) {
        var name = '--dsw-alias-' + TOKEN_NAMES[j];
        for (var k = 0; k < styles.length; k += 1) {
          var value = String(styles[k].getPropertyValue(name) || '').trim();
          if (value !== '') {
            tokens[name] = value;
            break;
          }
        }
      }
      return tokens;
    }

    // ---- preview documents --------------------------------------------------
    var SHELL_HEAD = '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">';

    var HTML_SHELL_STYLE = '<style>html,body{margin:0;padding:16px;background:#fff;color:#111}'
      + 'img{max-width:100%;height:auto}</style>';

    var SVG_SHELL_STYLE = '<style>html,body{margin:0;padding:16px;background:#fff}'
      + 'body{display:flex;align-items:flex-start;justify-content:center}'
      + 'svg{max-width:100%;height:auto}</style>';

    var MARKDOWN_STYLE = [
      'html,body{margin:0}',
      'body{padding:16px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);',
      'font:14px/1.65 var(--dsw-font-family,system-ui),-apple-system,"Segoe UI",sans-serif;',
      'overflow-wrap:anywhere;-webkit-text-size-adjust:100%}',
      'h1,h2,h3,h4,h5,h6{margin:22px 0 10px;font-weight:600;line-height:1.3}',
      'h1{font-size:1.6em}h2{font-size:1.34em}h3{font-size:1.16em}h4,h5,h6{font-size:1em}',
      'body>:first-child{margin-top:0}',
      'p,ul,ol,blockquote,pre,table,dl{margin:0 0 12px}',
      'ul,ol{padding-left:22px}li+li{margin-top:4px}li>ul,li>ol{margin:4px 0 0}',
      'a{color:var(--dsw-alias-brand-primary,#2563eb);text-decoration:none}',
      'a:hover{text-decoration:underline}',
      'strong{font-weight:600}',
      'code,kbd,samp,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      ':not(pre)>code{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));border-radius:4px;',
      'padding:1px 5px;font-size:.9em}',
      'pre{background:var(--dsw-alias-bg-layer-1,#f6f7f8);',
      'border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:8px;',
      'padding:12px 14px;overflow:auto}',
      'pre code{background:none;border-radius:0;padding:0;font-size:.88em;line-height:1.55}',
      'blockquote{margin-left:0;padding:0 14px;',
      'border-left:3px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));',
      'color:var(--dsw-alias-label-secondary,#52565c)}',
      'hr{border:0;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));margin:20px 0}',
      'table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}',
      'th,td{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));padding:6px 10px;text-align:left}',
      'th{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));font-weight:600}',
      'img{max-width:100%;height:auto}',
      'input[type=checkbox]{margin:0 6px 0 0;accent-color:var(--dsw-alias-label-secondary,#52565c)}',
    ].join('');

    function htmlDocument(source) {
      var text = String(source).replace(/^\uFEFF/, '');
      if (/<html[\s>]/i.test(text)) return text;
      return SHELL_HEAD + HTML_SHELL_STYLE + '</head><body>' + text + '</body></html>';
    }

    function svgDocument(source) {
      return SHELL_HEAD + SVG_SHELL_STYLE + '</head><body>'
        + stripProlog(source) + '</body></html>';
    }

    function markdownDocument(source, tokens) {
      var html = markedModule.parse(String(source), { gfm: true, async: false, breaks: false });
      var declarations = '';
      var names = Object.keys(tokens);
      for (var i = 0; i < names.length; i += 1) {
        declarations += names[i] + ':' + tokens[names[i]] + ';';
      }
      return SHELL_HEAD
        + '<style>:root{' + declarations + '}' + MARKDOWN_STYLE + '</style></head><body>'
        + html + '</body></html>';
    }

    function buildDocument(kind, source, tokens) {
      if (kind === 'html') return htmlDocument(source);
      if (kind === 'svg') return svgDocument(source);
      return markdownDocument(source, tokens);
    }

    function dataUrlOf(markup) {
      return 'data:text/html;charset=utf-8,' + encodeURIComponent(markup);
    }

    // ---- preview lifecycle --------------------------------------------------
    function setStatus(record, key, detail) {
      var text = key === null ? '' : t(key);
      if (detail !== undefined && detail !== null && String(detail) !== '') {
        text = text === '' ? String(detail) : text + ' - ' + String(detail);
      }
      record.status.textContent = text;
    }

    // Replaces the stage with a message; used when no inline document can be shown.
    // `markup` is supplied when the document exists but the frame does not, so the
    // document can still leave through the download link.
    function blockStage(record, key, detail, markup) {
      releaseFrame(record);
      var reason = detail === undefined || detail === null || String(detail) === ''
        ? ''
        : ' ' + String(detail);
      var message = document.createElement('p');
      message.className = 'dsh-cbp__blocked';
      message.setAttribute(ATTR, 'blocked');
      if (markup !== undefined && markup !== null) {
        record.downloadLink.setAttribute('href', dataUrlOf(markup));
        record.downloadLink.removeAttribute('hidden');
        message.textContent = t(key) + reason + ' ' + t('downloadHint');
      } else {
        message.textContent = t(key) + reason;
      }
      record.stage.replaceChildren(message);
      setStatus(record, key, detail);
    }

    function releaseFrame(record) {
      closeOverlay(record);
      if (record.timer !== undefined) {
        window.clearTimeout(record.timer);
        record.timer = undefined;
      }
      if (record.frame !== null) {
        if (record.onLoad !== null) {
          record.frame.removeEventListener('load', record.onLoad);
          record.onLoad = null;
        }
        if (record.frame.parentNode !== null) record.frame.parentNode.removeChild(record.frame);
        record.frame = null;
      }
      if (record.zoomButton !== null) record.zoomButton.setAttribute('hidden', '');
      if (record.downloadLink !== null) {
        record.downloadLink.setAttribute('hidden', '');
        record.downloadLink.removeAttribute('href');
      }
      if (record.url !== null) {
        createdUrls.delete(record.url);
        try {
          URL.revokeObjectURL(record.url);
        } catch (error) {
          // An already-revoked URL is harmless.
        }
        record.url = null;
      }
      record.renderedCode = null;
    }

    function mountPreview(record) {
      var code = codeOf(record.content);
      if (record.frame !== null && record.renderedCode === code) return;

      releaseFrame(record);
      record.stage.replaceChildren();

      var markup;
      try {
        markup = buildDocument(record.kind, code, readTokens());
      } catch (error) {
        blockStage(record, 'frameFailed', error && error.message, null);
        return;
      }
      record.renderedCode = code;

      var url;
      var frame;
      try {
        url = URL.createObjectURL(new Blob([markup], { type: 'text/html;charset=utf-8' }));
        createdUrls.add(url);
        frame = document.createElement('iframe');
        frame.className = 'dsh-cbp__frame';
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.setAttribute('title', t('frameTitle'));
        frame.setAttribute('src', url);
      } catch (error) {
        if (url !== undefined && url !== null) {
          createdUrls.delete(url);
          try {
            URL.revokeObjectURL(url);
          } catch (ignored) {
            // Nothing to revoke.
          }
        }
        blockStage(record, 'frameFailed', error && error.message, markup);
        return;
      }

      record.url = url;
      record.frame = frame;
      record.downloadLink.setAttribute('href', url);
      record.downloadLink.removeAttribute('hidden');
      record.zoomButton.removeAttribute('hidden');
      setStatus(record, null);

      var settled = false;
      record.onLoad = function () {
        settled = true;
        if (record.timer !== undefined) {
          window.clearTimeout(record.timer);
          record.timer = undefined;
        }
        setStatus(record, null);
      };
      frame.addEventListener('load', record.onLoad);
      record.timer = window.setTimeout(function () {
        record.timer = undefined;
        if (!settled) setStatus(record, 'frameSlow');
      }, FRAME_TIMEOUT_MS);

      record.stage.replaceChildren(frame);
    }

    // ---- full screen view ---------------------------------------------------
    // The desktop shell's setWindowOpenHandler denies every window.open (only https:
    // is handed to shell.openExternal) and will-navigate keeps the webContents on the
    // app origin, so neither a new tab nor a blob: navigation can show this document.
    // An in-app overlay is therefore the "bigger surface" action.
    var activeOverlay = null;

    function closeOverlay(record) {
      var overlay = record === undefined || record === null ? null : record.overlay;
      if (record !== undefined && record !== null) record.overlay = null;
      if (overlay === null || overlay === undefined) {
        if (activeOverlay === record) activeOverlay = null;
        return;
      }
      if (overlay.parentNode !== null) overlay.parentNode.removeChild(overlay);
      if (activeOverlay === record) activeOverlay = null;
    }

    function openOverlay(record) {
      if (record.url === null || record.url === undefined) return;
      if (activeOverlay !== null && activeOverlay !== record) closeOverlay(activeOverlay);
      closeOverlay(record);

      var overlay = document.createElement('div');
      overlay.className = 'dsh-cbp__overlay';
      overlay.setAttribute(ATTR, 'overlay');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', t('overlayTitle'));

      var card = document.createElement('div');
      card.className = 'dsh-cbp__card';

      var head = document.createElement('div');
      head.className = 'dsh-cbp__cardHead';

      var title = document.createElement('span');
      title.className = 'dsh-cbp__cardTitle';
      title.textContent = t('overlayTitle') + ' - ' + record.kind;

      var close = document.createElement('button');
      close.setAttribute('type', 'button');
      close.className = 'dsh-cbp__link';
      close.setAttribute(ATTR, 'overlay-close');
      close.setAttribute('title', t('closeTitle'));
      close.textContent = t('close');
      close.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        closeOverlay(record);
      });

      var body = document.createElement('div');
      body.className = 'dsh-cbp__cardBody';

      var frame = document.createElement('iframe');
      frame.className = 'dsh-cbp__frame';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('title', t('frameTitle'));
      frame.setAttribute('src', record.url);

      head.appendChild(title);
      head.appendChild(close);
      body.appendChild(frame);
      card.appendChild(head);
      card.appendChild(body);
      overlay.appendChild(card);
      overlay.addEventListener('mousedown', function (event) {
        if (event.target === overlay) closeOverlay(record);
      });

      document.body.appendChild(overlay);
      record.overlay = overlay;
      activeOverlay = record;
      if (typeof close.focus === 'function') close.focus();
    }

    function setExpanded(record, expanded) {
      record.expanded = expanded;
      record.panel.setAttribute('data-expanded', expanded ? 'true' : 'false');
      record.expandButton.textContent = t(expanded ? 'collapse' : 'expand');
      record.expandButton.setAttribute('title', t(expanded ? 'collapseTitle' : 'expandTitle'));
      record.expandButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    function setMode(record, mode) {
      record.mode = mode;
      var previewing = mode === 'preview';
      if (previewing) {
        record.content.setAttribute(HIDDEN_ATTR, '');
        record.panel.removeAttribute('hidden');
      } else {
        record.content.removeAttribute(HIDDEN_ATTR);
        record.panel.setAttribute('hidden', '');
        // Drop the document on the way out: re-opening then rebuilds it from the
        // current code and the current theme tokens, and idle blocks hold no iframe.
        releaseFrame(record);
        record.stage.replaceChildren();
        setStatus(record, null);
      }
      record.button.textContent = t(previewing ? 'source' : 'preview');
      record.button.setAttribute('title', t(previewing ? 'sourceTitle' : 'previewTitle'));
      record.button.setAttribute('aria-pressed', previewing ? 'true' : 'false');
      if (previewing) mountPreview(record);
    }

    // ---- decoration ---------------------------------------------------------
    function createRecord(root, banner, content, kind) {
      var record;

      var button = document.createElement('button');
      button.setAttribute('type', 'button');
      button.className = 'dsh-cbp__toggle';
      button.setAttribute(ATTR, 'toggle');
      button.setAttribute('data-text-interaction-exclude', '');
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        setMode(record, record.mode === 'preview' ? 'code' : 'preview');
      });

      var panel = document.createElement('div');
      panel.className = 'dsh-cbp__panel';
      panel.setAttribute(ATTR, 'panel');
      panel.setAttribute('data-expanded', 'false');
      panel.setAttribute('hidden', '');

      var stage = document.createElement('div');
      stage.className = 'dsh-cbp__stage';
      stage.setAttribute(ATTR, 'stage');

      var foot = document.createElement('div');
      foot.className = 'dsh-cbp__foot';
      foot.setAttribute(ATTR, 'foot');

      var status = document.createElement('span');
      status.className = 'dsh-cbp__status';
      status.setAttribute(ATTR, 'status');
      status.setAttribute('role', 'status');

      var expand = document.createElement('button');
      expand.setAttribute('type', 'button');
      expand.className = 'dsh-cbp__link';
      expand.setAttribute(ATTR, 'expand');
      expand.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(record, !record.expanded);
      });

      var zoom = document.createElement('button');
      zoom.setAttribute('type', 'button');
      zoom.className = 'dsh-cbp__link';
      zoom.setAttribute(ATTR, 'zoom');
      zoom.setAttribute('title', t('zoomTitle'));
      zoom.textContent = t('zoom');
      zoom.setAttribute('hidden', '');
      zoom.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openOverlay(record);
      });

      // The desktop shell denies window.open for every non-https URL and blocks
      // navigation away from the app origin, so a blob: URL can never open as a tab.
      // Saving the document is the only escape hatch that works there.
      var download = document.createElement('a');
      download.className = 'dsh-cbp__link';
      download.setAttribute(ATTR, 'download');
      download.setAttribute('download', 'preview.html');
      download.setAttribute('title', t('downloadTitle'));
      download.textContent = t('download');
      download.setAttribute('hidden', '');

      foot.appendChild(status);
      foot.appendChild(expand);
      foot.appendChild(zoom);
      foot.appendChild(download);
      panel.appendChild(stage);
      panel.appendChild(foot);

      record = {
        root: root,
        banner: banner,
        wrap: banner.parentElement,
        content: content,
        kind: kind,
        button: button,
        panel: panel,
        stage: stage,
        status: status,
        expandButton: expand,
        zoomButton: zoom,
        downloadLink: download,
        overlay: null,
        mode: 'code',
        expanded: false,
        frame: null,
        url: null,
        timer: undefined,
        onLoad: null,
        renderedCode: null,
      };
      return record;
    }

    function insertButton(banner, button) {
      var sibling = banner.querySelector('button');
      if (sibling !== null && sibling.parentNode !== null) {
        sibling.parentNode.insertBefore(button, sibling);
        return;
      }
      var actions = banner.lastElementChild;
      if (actions !== null) actions.appendChild(button);
      else banner.appendChild(button);
    }

    function disposeRecord(root, record) {
      releaseFrame(record);
      if (record.button.parentNode !== null) record.button.parentNode.removeChild(record.button);
      if (record.panel.parentNode !== null) record.panel.parentNode.removeChild(record.panel);
      if (record.wrap !== null) record.wrap.removeAttribute(WRAP_ATTR);
      record.content.removeAttribute(HIDDEN_ATTR);
      records.delete(root);
    }

    function decorate(banner) {
      if (!isBanner(banner)) return;
      var root = blockRootOf(banner);
      if (root === null) return;
      var content = contentOf(root);
      if (content === null) return;

      var existing = records.get(root);
      // Steady state: the banner is unchanged and still carries the live toggle. This
      // is the hot path while a message streams, so it reads no code text.
      if (existing !== undefined && existing.banner === banner && existing.button.isConnected) return;
      // An unsupported block stays unsupported; re-reading a growing code block on
      // every frame would be quadratic, so the verdict is cached once content exists.
      if (skipped.has(banner)) return;

      var code = codeOf(content);
      var kind = kindOf(banner, code);
      if (kind === KIND_PENDING) {
        // Still streaming: leave the block alone and let the next scan decide. Nothing
        // is cached, so the verdict can still become `svg`.
        if (existing !== undefined) disposeRecord(root, existing);
        return;
      }
      if (kind === null) {
        if (existing !== undefined) disposeRecord(root, existing);
        if (code.length > 0) skipped.add(banner);
        return;
      }

      var remembered = existing === undefined ? null : { mode: existing.mode, expanded: existing.expanded };
      if (existing !== undefined) disposeRecord(root, existing);

      var record = createRecord(root, banner, content, kind);
      records.set(root, record);
      insertButton(banner, record.button);
      if (record.wrap !== null) record.wrap.setAttribute(WRAP_ATTR, '');
      root.appendChild(record.panel);
      if (remembered !== null && remembered.expanded) setExpanded(record, true);
      setMode(record, remembered === null ? 'code' : remembered.mode);
    }

    function scan(scope) {
      if (scope === null || scope === undefined || scope.nodeType !== 1) return;
      if (scope.hasAttribute('data-code-block-banner')) decorate(scope);
      var banners = scope.querySelectorAll('[data-code-block-banner]');
      for (var i = 0; i < banners.length; i += 1) decorate(banners[i]);
    }

    // One coalesced pass per animation frame: the chat re-renders whole subtrees while a
    // message streams, and decorating on every mutation batch would thrash.
    function scheduleScan() {
      if (scanScheduled || observer === null) return;
      scanScheduled = true;
      var run = function () {
        scanScheduled = false;
        if (observer === null) return;
        scan(document.body === null ? document.documentElement : document.body);
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else window.setTimeout(run, 16);
    }

    function onMutations(mutations) {
      // A cached "not supported" verdict is only sound while the block itself is
      // unchanged: streaming can turn a bare label + partial text into real SVG. Any
      // mutation inside a skipped block drops its verdict so the next scan re-reads it,
      // while unrelated blocks keep their verdict (and their cost).
      for (var i = 0; i < mutations.length; i += 1) {
        var target = mutations[i].target;
        if (target === null || target === undefined) continue;
        var element = target.nodeType === 1 ? target : target.parentElement;
        if (element === null || element === undefined || typeof element.closest !== 'function') continue;
        var block = element.closest('.md-code-block');
        if (block === null) continue;
        var banner = block.querySelector('[data-code-block-banner]');
        if (banner !== null) skipped.delete(banner);
      }
      scheduleScan();
    }

    // ---- install / uninstall ------------------------------------------------
    var keydownBound = false;

    function onKeydown(event) {
      if (event.key !== 'Escape' || activeOverlay === null) return;
      event.preventDefault();
      event.stopPropagation();
      closeOverlay(activeOverlay);
    }

    function install() {
      if (styleEl === null) {
        styleEl = document.createElement('style');
        styleEl.setAttribute(ATTR, 'style');
        styleEl.textContent = CSS;
        document.head.appendChild(styleEl);
      }
      if (!keydownBound) {
        document.addEventListener('keydown', onKeydown, true);
        keydownBound = true;
      }
      var scope = document.body === null ? document.documentElement : document.body;
      if (observer === null && typeof MutationObserver === 'function') {
        observer = new MutationObserver(onMutations);
        observer.observe(scope, { childList: true, subtree: true });
      }
      scan(scope);
    }

    function uninstall() {
      if (observer !== null) {
        observer.disconnect();
        observer = null;
      }
      if (activeOverlay !== null) closeOverlay(activeOverlay);
      if (keydownBound) {
        document.removeEventListener('keydown', onKeydown, true);
        keydownBound = false;
      }
      var owned = document.querySelectorAll('[' + ATTR + ']');
      for (var i = 0; i < owned.length; i += 1) {
        if (owned[i].parentNode !== null) owned[i].parentNode.removeChild(owned[i]);
      }
      var hidden = document.querySelectorAll('[' + HIDDEN_ATTR + ']');
      for (var j = 0; j < hidden.length; j += 1) hidden[j].removeAttribute(HIDDEN_ATTR);
      var wraps = document.querySelectorAll('[' + WRAP_ATTR + ']');
      for (var k = 0; k < wraps.length; k += 1) wraps[k].removeAttribute(WRAP_ATTR);
      createdUrls.forEach(function (url) {
        try {
          URL.revokeObjectURL(url);
        } catch (error) {
          // Already revoked.
        }
      });
      createdUrls.clear();
      records = new WeakMap();
      skipped = new WeakSet();
      scanScheduled = false;
      styleEl = null;
    }

    function makeTranslator(ctx) {
      var locale = ctx !== undefined && ctx !== null && typeof ctx.get === 'function'
        ? ctx.get('locale')
        : undefined;
      if (locale === undefined || locale === null || typeof locale.bind !== 'function') {
        return fallbackTranslate;
      }
      try {
        var unregister = locale.register(NS, { zh: DICT.zh, en: DICT.en });
        if (typeof ctx.effect === 'function') {
          ctx.effect(function () {
            return unregister;
          }, 'code-block-preview: dictionaries');
        }
        var bound = locale.bind(NS);
        return function (key) {
          var value = bound(key);
          if (typeof value === 'string' && value !== '') return value;
          return fallbackTranslate(key);
        };
      } catch (error) {
        return fallbackTranslate;
      }
    }

    function apply(ctx) {
      // A reloaded bundle can apply while the previous generation is still mounted.
      // Take it down first so no banner ever carries two toggles.
      var previous = window[GUARD];
      if (typeof previous === 'function') {
        try {
          previous();
        } catch (error) {
          // The stale generation's cleanup is best-effort.
        }
      }

      var disposed = false;
      function release() {
        if (disposed) return;
        disposed = true;
        uninstall();
        if (window[GUARD] === release) window[GUARD] = undefined;
      }

      translate = makeTranslator(ctx);

      try {
        ctx.effect(function () {
          install();
          return release;
        }, 'code-block-preview: code block toggles');
      } catch (error) {
        release();
        throw error;
      }

      window[GUARD] = release;
    }

    exports.apply = apply;
    return module.exports;
  },
});
