# dsh-code-block-preview

给 DSH Web 聊天的 ```` ```html ```` / ```` ```svg ```` / ```` ```markdown ```` 代码块右上角加一个「预览」切换按钮，点击后在
`sandbox="allow-scripts"` 的 Blob iframe 里渲染内容。

- **只对三种语言出现按钮**，其他语言（`js`、`py`、`bash`…）不受影响。
- **懒渲染**：首次点击才创建 iframe 和 Blob URL。
- **每块独立记忆**：预览/源码状态与展开/收起状态按代码块各自保存，互不影响。
- **默认最大高度 600px**，点「展开」后 iframe 升到 80vh，点「放大」可全屏查看。
- **失败兜底**：iframe 创建失败时提供「下载」（存成 HTML 文件）。
- **HMR 安全**：同一 banner 永远只有一个按钮；卸载时移除全部注入节点并 revoke 所有 Blob URL。

## 实现方式

DSH 没有为代码块 banner 提供 Slot，所以这个插件只做 DOM 装饰：

1. `MutationObserver` 监听 `document.body`，按帧合并扫描 `[data-code-block-banner]`。
2. 由 banner 的 info string（或 toolbar 变体的 language span）判断语言；从
   `[data-code-block-content] pre` 读取代码文本（与 DSH 自带的「复制」按钮取值方式一致）。
3. 在 banner 的按钮区插入「预览」文本按钮，在 `.md-code-block` 根节点末尾插入预览面板。
4. 点击后用 `URL.createObjectURL(new Blob([...], { type: 'text/html;charset=utf-8' }))`
   建出 iframe；再把 iframe 背景与 DSH 主题对齐。

聊天的 markdown 渲染器调用代码块组件时传了 `toolbarLabels`，所以 banner 是 toolbar 变体：
label 是 `Ly(lang) ? lang : 本地化「代码」`。

### svg 与流式竞态

`svg` 不在 DSH 的语言表里（`langs/svg-*.js` 不存在），所以 ```` ```svg ```` 的 banner 显示的是本地化的
「代码」标签，只能靠内容嗅探：去掉 `<?xml?>` / `DOCTYPE` / 注释后以 `<svg` 开头即按 SVG 处理。因此裸的
```` ``` ```` 块若以 `<svg` 开头也会被当成 SVG —— 这正好是想要的。

嗅探必须容忍流式渲染。早期版本在内容还是 `<s`（一个 token 都没收全）时就下了「不是 SVG」的结论并缓存，
导致整块永久没有按钮——真实聊天里 SVG 基本边生成边渲染，所以第一次实测 svg 全部没有按钮。现在的判定是三态：

| 前缀 | 判定 |
|---|---|
| `<svg ` / `<svg>` | SVG，注入按钮 |
| 空字符串，或 `<` / `<s` / `<sv`（`<svg` 的真前缀） | **待定**，不缓存，等下一次扫描 |
| 其他 | 不是 SVG，缓存判定 |

缓存的「不是 SVG」判定还会在该代码块自身发生 DOM 变更时作废，下一次扫描重新判断——这样即使某个中间态
被误判，内容变化后也能自愈。

### 为什么没有「新标签打开」

Desktop 主进程给聊天视图装了这条策略（`app.asar` 内 `lib/main.js`）：

```js
view.webContents.setWindowOpenHandler(({ url }) => {
  const destination = new URL(url);
  if (destination.protocol === 'https:' && !destination.username && !destination.password) shell.openExternal(url);
  return { action: 'deny' };
});
```

也就是说 `window.open` 和 `target="_blank"` 一律 `deny`：`blob:`、`data:` 不行，连普通 `http:` 也不行
（只有 `https:` 会交给系统浏览器）。`will-navigate` 又把 webContents 钉在应用源上，`location.href` 也走不通。
第一版的「新标签打开」因此点了没反应——问题不在链接，而在宿主策略。

现在全部留在页面内：

- **「放大」**：在 `document.body` 上挂一个全屏浮层，复用同一个 Blob URL 的沙箱 iframe（Esc / 点遮罩 /
  「关闭」退出）。这是「新标签页」在 Desktop 里唯一可行的等价物。
- **「下载」**：`<a download>` 指向同一个 Blob URL，Chromium 的下载流程不受上面两条策略限制，会存成
  `preview.html`。iframe 创建失败时改用 `data:text/html` URL 下载，仍然能拿到内容。

### 圆角处漏出的白角

DSH 的 banner 放在一个 `position: sticky` 的 wrapper 里，这个 wrapper 自己带
`border-top-*-radius` 和 `background-color: var(--dsw-alias-bg-base)`；聊天用的是 toolbar 变体，banner 本体靠
`border-top-*-radius: inherit` 取得圆角。

于是滚动会话时，预览内容会从 sticky 的 banner 底下穿过，而这个 wrapper 的两个圆角是**透明的**——白色 iframe
就从那里漏出来，变成两个白角。普通代码块看不出来，是因为穿过的是深色的 `<pre>`，和圆角后面的底色相近。

修法：给被我装饰的块打上 `data-dsh-cbp-wrap`，把 wrapper 的圆角归零（它就会铺满整个矩形，填的是页面底色，
正是圆角处原本露出的颜色），再把圆角显式还给 banner 本体：

```css
[data-dsh-cbp-wrap]{border-top-left-radius:0!important;border-top-right-radius:0!important}
[data-dsh-cbp-wrap]>[data-code-block-banner]{
  border-top-left-radius:var(--dsl-code-block-border-radius,var(--dsw-radius-lg,8px))!important;
  border-top-right-radius:var(--dsl-code-block-border-radius,var(--dsw-radius-lg,8px))!important}
```

静止状态下观感完全不变（圆角处本来就是页面底色）；滚动时圆角处填页面底色，白角消失。这个标记随
`disposeRecord` / `uninstall` 一起清除。

### markdown 渲染器

DSH 的 markdown 渲染器打包在 `@deepseek-ai/dsh-web-frontend` 的 shell chunk 里，没有作为客户端模块暴露；
`dsh.client.external` 只能解析平台种子表和动态包行，`require("marked")` 也不可用。所以插件把
**marked（MIT）** 的 UMD 构建内联进 `lib/client.js`（`vendor/marked.umd.js` 原样保存，见
`lib/NOTICE.md`）。这仍然是「用现成的 markdown 渲染器」，只是随插件一起分发。

markdown 预览会把当前主题的 `--dsw-alias-*` 取值快照写进 iframe 的 `:root`，正文排版因此跟随 DSH 主题。
主题切换后重新点一次「预览」即可拿到新色值。

### 安全边界

- iframe 只有 `sandbox="allow-scripts"`，没有 `allow-same-origin`，因此是不透明源：脚本能跑，
  但拿不到宿主的 DOM、cookie 或 `localStorage`。全屏浮层里的 iframe 用同样的 sandbox。
- 「下载」出去的文件**不带 sandbox**，等于在普通页面里执行这段内容；内容来自当前会话生成的代码，
  且需要用户主动点。
- 文档里显式写了 `<meta charset="utf-8">`，中文内容不会乱码。

## 目录

| 路径 | 说明 |
|---|---|
| `lib/index.js` | Host 半端：空 `apply()`，只为了让客户端 bundle 有一个 Loader 行 |
| `lib/client.js` | 构建产物：`src/client.js` + 内联的 marked |
| `src/client.js` | 手写的 `__ModuleLoader__` bundle 源码 |
| `vendor/marked.umd.js` | marked 16.4.2 的 UMD 构建（未修改） |
| `tools/build-client.mjs` | 把 marked 内联进 `lib/client.js` |
| `tools/verify-client.mjs` | linkedom 无头验证（66 项断言） |
| `locale/*.json` | 插件标题与描述 |
| `cordis.patch.yml` | 插入 `code-block-preview` 行 |

## 开发

```bash
node tools/build-client.mjs      # src/client.js + vendor/marked.umd.js -> lib/client.js
```

无头验证需要一个 DOM 实现（linkedom 只是验证依赖，不属于插件本体）：

```bash
mkdir -p .tmp/domcheck && cd .tmp/domcheck
echo '{"name":"domcheck","private":true,"type":"module"}' > package.json
pnpm add linkedom --node-linker=hoisted
cd ../..
node tools/verify-client.mjs
```

覆盖范围：语言识别（含 svg 内容嗅探、流式待定态与判定失效重算）、HMR 重复注入、懒加载、沙箱属性、每块独立状态、
切回源码时的资源回收、全屏浮层的开关、下载动作、超时提示、后续渲染的代码块、banner 被重建后的重新装饰、
失败兜底与 `data:` URL、sticky wrapper 标记的添加/清除、卸载时节点清理与 Blob URL revoke。

`tools/asar.mjs` 是排查用的辅助脚本，可以只读地列出/读取 DSH Desktop 的 `app.asar`，用来核对
代码块的 DOM 契约：

```bash
node tools/asar.mjs grep "D:/App Gallary/dsh/resources/app.asar" "data-code-block-banner" 5 "dsh-web-frontend"
```

## 已知边界

- 依赖 DSH 代码块的 DOM 契约（`[data-code-block-banner]`、`[data-code-block-content]`、`.md-code-block`）。
  DSH 改这些属性时按钮会消失，不会报错。
- `svg` 只能靠内容嗅探（DSH 语言表里没有它），所以 `<svg` 不在开头的 SVG（例如外面套了 `<html>`）
  不会出现按钮；反过来，未标注语言但以 `<svg` 开头的块会被当作 SVG。
- Desktop 不允许新开标签页（见上），「放大」是应用内浮层而不是真正的独立窗口。
- 主题色在每次点开预览时快照；切换主题后需要重新点一次。
- `html` / `svg` 预览用白色画布，保证片段按浏览器默认样式呈现；只有 markdown 预览跟随主题。
- 「预览」按钮是文本按钮，和 DSH 自带的「复制」一致；toolbar 变体里两侧是 24×24 图标，按钮会略高一点。
