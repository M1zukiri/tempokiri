# Tempokiri 批注修改计划（2026-10-12）

> 批注来源：`annotations.json`（6 条），页面 sha256 `c92bf421…` 与当前 `dist/tempokiri-workstation.html` 一致
> 基线版本：1.19.0 ｜ 规划目标版本：1.20.0
> 状态：**A6/A4/A3/A5/A2 已实施并验证（v1.20.0）；A1 待澄清**

---

## 0 批注与源码的对应关系

| 批注 | 意图 | 页面元素 | 源码落点 | 坐标来源 |
|---|---|---|---|---|
| a1 | change-data | `#qOffsetVal` 偏移数值 | `src/analysis.js:713-718`（另涉及快捷栏与 `buildGrid`） | `index.html:907` ✔ |
| a2 | add | 元数据弹窗 · 封面行 | `src/metaModal.js:54-58, 102-117`；`src/metadata.js:506-515` | 无（cssPath 定位） |
| a3 | change-style | 元数据弹窗 · `.meta-form` | `src/metaModal.js:49`（`modal-wide`）+ `index.html:481` | 无（class 定位） |
| a4 | remove | 元数据弹窗 · `p.modal-sub` | `src/metaModal.js:51` + `strings.json` | 无（cssPath 定位） |
| a5 | change-style | 页脚 `.footer-heart` ♥ | `index.html:968` | `index.html:968` ✔ |
| a6 | change-data | 静音段行内表单 | `src/main.js:1816-1834` | `index.html:949` ✔ |

批注里 3 条（a2/a3/a4）拿不到源码坐标——它们都在元数据弹窗内，而该弹窗由 `metaModal.js` 在运行时 `createElement` 生成，静态 `index.html` 中不存在。本次靠批注携带的 `cssPath` 与 `class` 名反向定位，3 条全部命中。

---

## 1 逐条方案

### A6 静音段默认时长改为 1 小节（最明确，最先做）

**批注**：「这里默认值好像是先定 1 秒、再转为当前 bpm 下的小节的，比如我这里 154bpm 的歌，默认值是 0.642 小节。我建议默认值就 1 小节就行。」

**现状**（`src/main.js:1819-1825`）

```js
silentMus.checked = true;      // 默认「音乐单位」
silentSec.checked = false;
silentQty.value = '1';
silentQtySec.value = '1';      // 精确时长 = 1 秒
setSilentModeSection('mus');   // → syncSilentFromSec()：qty = 1 / barDur
```

`setSilentModeSection('mus')` 内部走 `syncSilentFromSec()`，用**精确时长的 1 秒**反推音乐单位 → 154 BPM 下 `1 / 1.5585 = 0.642` 小节。**批注描述与代码行为完全一致。**

**改法**：默认基准由「1 秒」改为「1 小节」，派生方向反过来。

```js
silentMus.checked = true;
silentSec.checked = false;
// 默认「1 小节」：先落音乐单位值，再派生精确时长（此前是以 1 秒反推小节）
silentQty.value = '1';
silentQty.disabled = false;
silentUnit.disabled = false;
silentQtySec.disabled = true;
syncSilentFromMus();           // 1 小节 → 1.559 秒（154 BPM）
```

注意不能沿用 `setSilentModeSection('mus')`：它会先执行 `syncSilentFromSec()` 覆盖刚写入的 `silentQty`，方向正好相反。

**涉及文件**：`src/main.js`
**验收**：154 BPM 下展开静音段表单 → 音乐单位显示 `1`、精确时长显示 `1.559`；切到「精确时长」radio 再切回，值保持不跳变；确认添加后 `durationSec ≈ 1.559`。

---

### A4 删除元数据弹窗的说明段

**批注**：「删掉这个说明。」（元素含 `class="modal-sub"`，文案为「导入文件时自动读取元数据，导出音频时自动附加。修改即时保存，重新打开同一文件可恢复。」）

**现状**：`src/metaModal.js:51` 输出 `<p class="modal-sub">' + T('metadata.sub') + '</p>'`。

**改法**：
1. 删除 `src/metaModal.js:51` 整行。
2. 删除 `strings.json` 的 `metadata.sub` 键（代码不再引用，留着只会在 `build.py` 报冗余警告）。

**涉及文件**：`src/metaModal.js`、`strings.json`
**验收**：元数据弹窗不再出现该说明行；`python build.py` 零报错且无 `metadata.sub` 冗余警告。

---

### A3 元数据弹窗改窄

**批注**：「这一块布局感觉太宽了，要不然改窄一点？」（元素 `.meta-form`，实测 rect 宽 674px）

**现状**：`src/metaModal.js:49` 使用 `class="modal modal-wide"`，而 `.modal-wide` 在 `index.html:481` 定义为 `width: 720px`（减去内边距后内容区 674px，与批注 rect 吻合）。

`.modal-wide` 还被另外 5 处复用（`autoCutModal.js:56`、`exportModal.js:51`、`footer.js:99`、`modal.js:33`、`settings.js:220`），**不能直接改这个类**，否则会连带改窄节拍设置、导出、自动剪辑等所有弹窗。

**改法**：给元数据弹窗单独的宽度类，只影响它自己。

1. `src/metaModal.js:49`：`'modal modal-wide'` → `'modal meta-modal'`
2. 在同文件 `style.textContent` 中追加：`.meta-modal{width:560px;max-width:calc(100vw - 40px)}`

560px 是建议值（内容区约 514px，输入框 `max-width:340px` 仍有余量）。**若你有具体想要的值，实施前告知即可。**

**涉及文件**：`src/metaModal.js`
**验收**：元数据弹窗宽度 560px；其余 5 个弹窗宽度不变（回归检查节拍设置与导出弹窗）；窄屏 360px 下无横向溢出。

---

### A5 页脚 ♥ 换成 logo

**批注**：「改成 logo 吧，如果没有合适的 logo 就先放个占位图片。」

**现状**（`index.html:966-970`）

```html
<div class="footer-sign">
  <span class="footer-heart">♥</span>
  <span class="footer-name" data-i18n="footer.signature">M1zukiri</span>
</div>
```

`♥` 是署名「M1zukiri」前的装饰符号，`index.html:696` 有 `.footer-heart` 样式。

**与交付约束的冲突**：工作站是**单文件、零外部请求**（`file://` 离线可用）。因此 logo 不能引用外部图片文件，只能是内联 SVG 或 data URI。

**待你确认**：这个 logo 指 **M1zukiri 的个人标识**，还是 **Tempokiri 产品标**？两者语义不同（当前位置在作者署名旁，倾向后者应是个人标识）。

**默认方案**（无回复时按此实施）：内联一个中性占位 SVG（圆角方形 + 字母标），尺寸与 `.footer-heart` 现状一致（约 18px），并保留原 `♥` 于注释中便于回退。你给出正式 logo 后替换 `<svg>` 内容即可。

**涉及文件**：`index.html`（结构 + `.footer-heart` 样式，或新增 `.footer-logo`）
**验收**：页脚显示 logo 占位图，与署名基线对齐；打包产物仍为单文件、无外部请求；360px 无溢出。

---

### A2 封面编辑功能（工作量最大，含一处需你决策的取舍）

**批注**：「把封面编辑功能加上。现在只能编辑下面的元数据。」

**现状链路**（三处都要动，缺一不可）

| 环节 | 现状 | 位置 |
|---|---|---|
| UI | 封面只读展示（`img` + 无封面文案），无上传入口 | `src/metaModal.js:54-58`、`102-117` |
| 保存 | **`mergeMeta` 里 `out.cover = p.cover`——封面恒取解析值，编辑值被丢弃** | `src/metadata.js:506-515` |
| 持久化 | `saveMetadata` → `saveSettings(file,{metadata})` → `JSON.stringify` 进 localStorage | `src/store.js:89-91` |

**导出链路已就绪**：`metadata.js:447-449` 已能把 `m.cover`（`{data, mime}`）写进 MP3 的 APIC 帧，UI 改完的封面会随导出带上，这部分不用改。

**要改的三处**

1. **UI 入口**（`metaModal.js`）：封面行加「选择图片」按钮 + 隐藏 `<input type="file" accept="image/*">`；选中后读为 `Uint8Array`，写入 `data.meta.cover = { data, mime }` 并调 `onEdit` 触发现有防抖保存；随即刷新缩略图。
2. **合并语义**（`metadata.js:mergeMeta`）：改为「编辑值显式带 `cover` 时覆盖，未带时保持解析值」：

   ```js
   if ('cover' in e) out.cover = e.cover || null;
   else out.cover = p.cover || null;
   ```

   这样保持向后兼容（老调用方不传 `cover` 时行为不变）。
3. **持久化策略**——**这一项需要你定**：

   | 方案 | 做法 | 代价 |
   |---|---|---|
   | **① base64 + 体积上限**（建议） | 存 `dataURL` 字符串，上限 1 MB，超限提示「封面过大，仅本次会话有效」 | localStorage 单域约 5 MB，多文件多封面可能触顶；需处理 `QuotaExceededError` |
   | ② 不持久化 | 封面改动只在本次会话有效 | 重开同一文件即丢失，与「编辑」预期不符 |
   | ③ 存 IndexedDB | 容量宽松 | 新增一套存储层，改动面显著变大，与现有 localStorage 体系并存 |

   说明：现状若直接把 `Uint8Array` 交给 `JSON.stringify`，会序列化成 `{"0":137,"1":80,…}` 的逐字节对象，体积膨胀数倍——**这是必须处理的，不能沿用现状**。

   我倾向方案 ①：改动局部、行为可预期，且超限有明确提示而非静默失败。

**涉及文件**：`src/metaModal.js`、`src/metadata.js`、`src/store.js`、`strings.json`（新增按钮/提示文案 key）、`tests/test_metadata.js`（mergeMeta 新语义）
**验收**：选中图片后缩略图立即更新；导出 MP3 后 APIC 帧为所选图片；重开同一文件封面恢复（方案 ① 且未超限）；`mergeMeta` 新语义有单测覆盖（带 cover / 不带 cover / 显式 null 三种）。

---

### A1 offset 语义 —— **需你一句话澄清，我不猜**

**批注**：「我们对 Offset 的要求是：在音乐开始前，必须保留一整个全音符的空白（即波形起点到音乐节奏起点应该有 60/bpm 秒）。」

**现状**（`src/analysis.js:713-718`）

```js
// offset = 首条网格线位置 = 第一个 onset（开头第一个可听见的瞬态）。
let offset = 0;
if (onsets.length) offset = Math.round(onsets[0] * 1000) / 1000;
```

即 offset ≡ 第一个 onset 的时间（批注页面上显示 2.740，说明该曲首个瞬态在 2.74 s）。offset 语义在 `CLAUDE.md` 中已固化，并驱动快捷栏 ± 微调、`buildGrid` 生成与导出。

**歧义所在**：批注同时说了「音乐开始前留一个全音符」和「波形起点到音乐节奏起点 = 60/bpm」。若把「音乐节奏起点」读作 offset，则要求 offset ≡ 60/bpm——但那会让拍线不再对齐首个 onset（154 BPM 下 beat=0.3896 s，2.740 落在第 7.03 拍，网格与音乐错位），与现有语义冲突。至少三种读法：

| 选项 | 含义 | 对现有行为的影响 |
|---|---|---|
| **A. offset 设下界** | 识别时取 `offset = max(首个 onset, 60/bpm)` | 首个瞬态早于一个全音符时才生效；此时网格不对齐音乐 |
| **B. offset 整体后移** | `offset = 首个 onset + 60/bpm` | 每条拍线都晚一个全音符，编辑时拍线不再压在 onset 上 |
| **C. 仅导出时补白** | offset 语义不变；导出/谱面环节在开头插入使音乐落在 60/bpm 处的静音 | 编辑期网格不受影响，只改产出的音频 |

**我的倾向是 C**：它同时满足「音乐开始前有一个全音符空白」与「编辑时网格对齐音乐」，且与你已实现的 Majdata「补充空小节」（`padSilenceStart`）是同一族能力，可复用既有落点。但批注挂在 offset 数值控件上（intent 为 `change-data`），也可能你就是要改 offset 本身。

**请回一句选哪个（A/B/C，或你的原意）**。在此之前 A1 不动手，其余 5 条先做。

---

## 2 实施顺序

| 批次 | 内容 | 前置 |
|---|---|---|
| 1 | A6（静音段默认值）、A4（删说明） | 无 |
| 2 | A3（弹窗改窄）、A5（页脚 logo 占位） | 无 |
| 3 | A2（封面编辑，含持久化方案确认） | 方案 ① 确认 |
| 4 | A1（offset） | **待澄清** |

按 `CLAUDE.md` 强制流程执行：改代码 → 补单测 → 全量单测 → `python build.py` → 版本历史条目。

---

## 3 全局验收

1. `node --test tests/test_*.js` 全绿（当前基线 **228/228**）
2. `python build.py` 零报错，`strings.json` 无冗余 key 警告
3. 对 6 条批注逐条回读实现，确认批注意图被满足
4. 窄屏 360px 无横向溢出（A3/A5 都动布局）
5. 单文件交付约束不被破坏：无外部请求、`file://` 离线可用

---

## 4 风险

| 风险 | 说明 | 处置 |
|---|---|---|
| A3 波及面 | `.modal-wide` 被 6 处复用 | 已改为独立类，不动公共类；回归另 5 个弹窗 |
| A2 存储超限 | 封面进 localStorage 可能触发 `QuotaExceededError` | 设上限 + 捕获异常 + 明确提示，不静默失败 |
| A5 logo 缺失 | 无正式 logo 素材 | 先放内联 SVG 占位，保留替换点 |
| A1 误判 | 三种读法实现差异大 | 澄清后再做，不猜 |

---

## 5 实施结果（v1.20.0）

| 批注 | 状态 | 落地位置 |
|---|---|---|
| A6 静音段默认 1 小节 | ✅ | `src/main.js`：`setSilentModeSection` 加派生方向参数 + 表单初始化改向 |
| A4 删说明段 | ✅ | `src/metaModal.js` + `strings.json` 删 `metadata.sub` |
| A3 弹窗改窄 | ✅ | `src/metaModal.js`：独立 `.meta-modal`（560px），不动 `.modal-wide` |
| A5 页脚 logo | ✅ 占位 | `index.html`：`.footer-logo` 内联 SVG（3 根律动条） |
| A2 封面编辑 | ✅ 方案① | `metaModal.js` + `metadata.js` + `store.js` + `main.js` |
| A1 offset 语义 | ⏸ 待澄清 | 未动 |

**无头 Edge 实测**（零 JS 错误）：

- 弹窗宽 **560**、class `modal meta-modal`、说明段已无、封面行含「选择图片」
- 封面选中后缩略图走 blob URL，localStorage 落 **base64**（96 字符 / image/png）
- 静音段默认 `qty=1` / `qtySec=2.000`（120 BPM 基准）；未加载文件时「选择图片」禁用
- 页脚 logo 15×15、3 个 rect
- 单测 **233/233**（+5），build 零报错（972 KB）

**A2 采纳方案①**（base64 + 1 MB 上限）：超限时不写 `cover` 键、重开文件回落解析值——`store.js` 的 `writeAll` 会静默吞掉 `QuotaExceededError`，不设限会连带文本字段一起写不进去。若你更希望封面完全不持久化（方案②）或走 IndexedDB（方案③），改动集中在 `store.js` 的 `saveMetadata` / `loadMetadata` 两个函数。

**批注副本已重建**：`review/tempokiri-workstation.annotate.html` 已按 1.20.0 产物重新生成（sha256 `6ce5d077…`，反查覆盖 161 个元素）。旧批注的 `page.sha256` 与它不一致，属预期。
