# CLAUDE.md

Tempokiri — 节奏感知的音频/视频剪辑工作站，以单 HTML 文件交付的浏览器端应用。
原 CLI 版本（Python + librosa）已移除——工作站已完整覆盖其功能，产品唯一交付物即打包后的 `dist/tempokiri-workstation.html`。

## 界面文案系统

- **strings.json 是全部界面文案的唯一编辑源**（v1.5.0 起）：按钮/标题/提示/状态/弹窗/帮助气泡约 200 条，改文字只改这个文件，`python build.py` 后生效，不动代码
- 分层 key（`toolbar.openFile`、`status.playFrom` 带 `{name}` 插值）；`src/i18n.js` 提供 `T(key, params)`（缺 key 返回 key 名便于发现）
- 静态 HTML 元素用 `data-i18n="key"`（源码保留中文原文回退，运行时 `MC.i18n.applyStatic()` 填充）；动态文案直接 `T('key')`
- **build.py 校验**：扫描 `T('key')` 调用与 `data-i18n` 引用，与 strings.json 差集——代码引用但文档缺失 → 构建中止；文档冗余 → 警告
- 技术性 Error 消息（throw new Error）与 README.md/VERSION 不在此系统内
- ⚠️ UMD 模块引用 T 的写法：`(typeof module === 'object' && module.exports) ? require('./i18n.js').T : ((typeof MC !== 'undefined' && MC && MC.i18n) ? MC.i18n.T : (k) => k)`——**不要用 `global.MC`**（factory 无 global 形参，浏览器会 ReferenceError）
- ⚠️ i18n.js 的 `lookup` 支持含点键（如 presets 的 `0.75`）：每步先尝试剩余路径整体匹配再逐段切分；strings.json 数字档位 key 可含点
## 结构速查

```
index.html           主页面（开发期引用 src/*.js）
strings.json         界面文案唯一编辑源（改文案只改此文件）
src/*.js             浏览器模块，UMD 挂到 window.MC（MC.analyze、MC.buildGrid …）
dist/                build.py 打包产物（gitignore）
tests/               Node 单元测试（node --test）
VERSION              版本号单源（build.py 注入页脚）
```

## 常用命令

```bash
python -m http.server 8734            # 开发伺服（浏览器缓存 src/*.js 时用无痕/禁用缓存）
python build.py                       # 打包 → dist/tempokiri-workstation.html
node --test tests/test_*.js   # 单元测试（analysis/export/sequence/audio/render/ui/store/footer/settings/i18n/metadata/videoExport/autoCut）
```

## 关键约定

- **采样率**：`state.pcm` 恒为 22050（`DEFAULT_ANALYSIS_SR`）；`state.rawMono` + `state.sampleRate` 供导出；分析窗口必须用 22050 索引，否则 BPM 翻倍/减半
- **确认制**：自动识别只填充输入框，点「确认」才应用网格
- **段语义**：末段长度恒为"剩余所有"（modal 渲染 + 校验跳过）；段分辨率 `resolution`（每小节线数，默认=拍号分子）
- **offset 语义**：首条网格线（拍线）的绝对位置 = 第一个 onset；顶部快捷栏 ± 按钮即时生效
- **选区**：`snapRange` 区间交集——部分覆盖的小节即被选中
- **交互**：单击定位播放起点（不播放）、双击选小节、拖拽选区、卡片按住拖动排序（让位动画）、纯滚轮平移、Ctrl+滚轮缩放
- **git**：外层仓库 `个人/` 跟踪本仓库（历史），本仓库 `tempokiri/tempokiri/` 是独立仓库（推送 GitHub M1zukiri/tempokiri）；内层仓库**绝不被外层 gitlink 跟踪**（曾误加 3 次）
- **视频**：音轨提取优先 WebCodecs 直解（mp4box demux → AudioDecoder），降级 captureStream；导出仅 MP4/MOV（WebCodecs，Firefox 不支持）
- **视频音轨 PCM**：AudioDecoder 输出 f32-planar，`copyTo` 必须逐平面（`planeIndex`）拷贝到 `planar[ch*frames+i]`，汇总按平面索引混合（`mixPlanarChunks`）——交错读取会致立体声每 chunk 后半静音（锯齿音根因）
- **交叉淡化**：默认 30ms 等功率余弦；可经全局设置 `crossfadeMs` 调整（store.loadGlobalSettings），导出窗口预填
- **快捷键**：空格播放/暂停（输入框聚焦时忽略）、Esc 关闭弹窗、←/→ 平移视口
- **视图持久化**：`saveWorkspace` 存 view，切文件恢复（越界回退全览）
- **播放线**：`currentPlayTime()` 是 tickProgress 的关键依赖，编辑 tickProgress 时切勿误删（曾致播放线静默失效）
- **拼接进度条**：`seqProgressMeta`（sequence.progressMeta）给出总时长与各拼接点累计位置；拖动 seek 走 `seekMix`（暂停→设 mixPos→重播）；**pausePlay 停止前必须清空 src.onended**（stop() 的 ended 异步触发，会误杀 seek 后的新播放）；**序列内容不变的拼接结果由 `getMixBuffer` 缓存（key = parts/crossfade/sr 的 JSON 指纹），seek 复用 AudioBuffer 不重拼**（任何序列/淡化/设置修改都会使 key 失效自动重拼）
- **拼接点标记**：进度条上金黄竖线（`.seam`），位于每相邻两段的边界；播放头玫红圆点、已播放填充青色渐变
- **页脚**：`footer.js` 的 `README_SOURCE`/`VERSION` 由 build.py 注入（src 模式保持占位符，`resolveVersion()` 回退 `dev`、README 弹窗回退提示）；版本号**单源**于根级 `VERSION` 文件；`[data-version]` 徽标由 initFooter 填充
- **build.py 注入**：README/版本替换用**函数式 repl**（lambda）避免 `re.sub` 转义反斜杠；占位符判定用首字符 `'_'` 检查而非字面量比较（会被替换误伤）

## 版本历史

- **1.17.4**：MP3 定源率修复（M2）＋ 采样率语义澄清（M9）——① **MP3 定源率**：新增 `audio.js readMp3SampleRate`（跳过 ID3v2（syncsafe 长度 + 可选 footer）→ 找首个 MPEG 帧同步 → 按版本取采样率表：MPEG1 44100/48000/32000、MPEG2 22050/24000/16000、MPEG2.5 11025/12000/8000，层/索引 reserved 跳过），`decodeAudioFile` 对 MP3 也走 `OfflineAudioContext(1,1,srcRate).decodeAudioData`——此前非 WAV 一律用 `ctx.decodeAudioData`，结果被重采样到**设备率**（实测 44100 Hz 的 MP3 解码后得到 48000），「跟随源」导出名不副实；② **`state.sampleRate` 初值 22050 → 0**（它语义上是文件源率，未加载文件时伪装成分析率会误导——已确认所有读取点都有 `rawMono` 空值保护）；③ 测试：`test_audio.js` +5（MPEG1 三档 / 跳过 ID3v2 / MPEG2 与 2.5 表 / reserved 与非 MP3 返回 null），全量 **219/219**。验证：`tools/diag_mp3_sr.mjs` 实测 4 首 44.1k MP3——修复后 decodeAudioFile 给 44100（修复前 AudioContext 会给 48000）；48000 源不受影响；**BPM 结果零变化**（117 / 97.9 / 159.1 / 159.5 修复前后完全一致，onset 数仅差 1）；build 零报错（963 KB）
- **1.17.3**：负数时间转换修复（用户 m4a 导入复现 + 用户报障"第一段无法输入小节/格数、怀疑负数时间处理"）——① **rangeInput commit 残留校验** `ts >= 0`（1.17.1 只修了 sequence.timeRangeToBars 层，组件层漏改）：负 offset 网格内合法负起点（如 -0.5s）被拒绝 → 输入回退 = "无法输入"；改为 `isFinite` + `te > ts`（负时间合法，与 timeToBarCell 同规约）；② **sequence.timeRangeToBars** 去掉 `startSec >= 0` 下限（负时间→小节/格派生可用）；③ **rangeInput commit bars 无网格放行**（`if (g && …)` 代替 `if (!g || …)`——无网格时允许先存小节/格语义，派生显示 '—'，网格恢复后再换算）；④ 测试：`test_range_convert.js` +2（负时间派生合法/网格外负时间 null），26/26。验证：单测通过、verify_unit_semantics 10/10、smoke/opts 回归全绿、diag_neg_time（负 offset 下 time 输入 -0.5→3.5：保存 + 派生 barsRef 1小节2格–3小节1格 正确）、build 零报错（961 KB）

- **1.17.2**：rangeInput 布局可读性修复（用户截图反馈"输入框太不直观"）——① **分组微标签**：小节/格行 `起 小节[ ] 格[ ] · 止 小节[ ] 格[ ]`（原 4 个无标签数字框并排）、时间行 `起点[ ] 终点[ ]`（秒）；② **派生显示去输入框化**：未选中语义由"禁用输入框并排"改为**只读文本**（bars → `1小节1格 – 1小节4格`；time → `fmtT 0:00.0 – 0:02.0`），整块半透明；③ 块结构 `.ri-block(.ri-active)`：选中=输入、未选中=文本(CSS 显隐)，主行随 mode 显示（`renderEdgeMain` 已有）已联动；④ 时间输入秒格式保持（精确编辑）。验证：截图双态核对（bars 选中/time 选中）、verify_unit_semantics 10/10 回归、build 零报错（960 KB）

- **1.17.1**：双语义转换边界加固（用户要求检查边界 + 完善测试）——① **修复缺陷**：`barToTime` 无 grid 防御（grid=null 抛 TypeError）；`syncItemTimes` bars 越界（bar 不在网格）时**保留陈旧派生缓存** → 改为显式置 null（下游 isEmptyItem 判 invalid，不悄悄回落旧位置）；缺省 cell（旧数据）**写回补全**（startCell=1/endCell=分辨率，不再仅参数级 fallback）；② **逻辑抽取**：bars↔time 范围换算抽纯函数 `barsRangeToTime`/`timeRangeToBars`/`rangeSpecSync`（sequence.js），rangeInput 组件复用（此前换算逻辑在组件闭包内不可单测）；③ **测试**：新增 `tests/test_range_convert.js` 24 用例——跨域覆盖（cell 越界 clamp/非 2 幂浮点往返恒等/负 offset 网格/多段异分辨率/网格末尾 1e-6 容差/时间量化语义/混合 resync/失效规则/spec 换算）；过程中确认的既有正确语义（End 端点含归本格、时间→格量化取格首/格末）已文档化。验证：单测 217/217（193+24）、verify_unit_semantics 10/10、build 零报错（957 KB）

- **1.17.0**：段落时长语义统一（用户确认规格：两种记录方式二选一、底层按所选语义、调用时换算、杜绝 time↔小节往返误差）——① **数据模型**：普通段 `mode('bars'|'time')` 定义底层（bars 模式存 startBar/startCell/endBar/endCell，time 模式存 startTime/endTime；另一侧为派生显示，`syncItemTimes` 单向换算维护）；`createItem` 默认 bars 模式（选区拖拽创建）；**迁移规则**：旧数据 startBar 非空 → bars、否则 time（restoreSequence）；saveWorkspace 白名单加 mode/startCell/endCell；② **UI 组件**：新 `src/rangeInput.js`（radio 双行常显：小节/格起点·终点 ↔ 时间起止点；选中行可编辑、另一行 disabled 只读派生；**切换选中时直接应用当前缓存值**），替换卡片起止（UnitInput×2 → 单组件，折叠区）与手动添加表单（含精确时间）；主行显示随 mode（`renderEdgeMain` 局部刷新）；卡片主行/编辑分离（不重建 DOM，保留输入焦点）；③ **网格段（节拍设置）**：段行长度改 radio 双行（【√】小节数 / 时长秒），`rowToSeg` mode 'bars' → `seg.bars`（随 BPM 动态展开，不再换算成秒落库）；④ **静音段**：表单 radio 化（小节/拍 ↔ 精确时长；派生单向——修复双向覆写毁值 bug：展开时 qty=1 被派生改写 0.5），卡片编辑秒 → 语义退化 unit='sec'；⑤ **随动规则**：`applyGridSettings`（含快捷栏 ± 走的同一路径）后 `resyncGridItems` —— 小节定义段时间随网格移动（内容平移，用户认可），精确时间段锚定不变只刷新派生显示；⑥ **遗留**：UnitInput 模块保留（无调用端）。验证：单测 193/193（+4 双语义：createItem 格级/sync 双向/随动）、verify_unit_semantics 10/10（段行 radio/卡片双行/模式切换底层记录/BPM 随动 119.99→4.00033/手动添加 time/静音 radio sec）、节拍器回归套件（smoke/opts/silent A+B）全绿、build 零报错（956 KB）

- **1.16.0**：静音段音乐参数化（节拍器与其他段一致）——① **数据模型**：静音段新增 `unit('sec'|'bar'|'beat')`/`qty`/`bpm`/`beatsPerBar`/`beatUnit`，`durationSec` 按**自身参数**换算（跟随链：显式输入 > 前段参数（静音段取自身、普通段取所在网格段）> 网格首段 > 120/4-4）；表单加 BPM/拍号输入（placeholder 提示跟随）；saveWorkspace 白名单扩展；ui.js 卡片显示「2 小节 @ 120 BPM 4/4」；旧数据（无 unit）视为时间单位；② **节拍器行为**：mtrTick 引入拍点时间轴模式 `mtrAxis('orig'|'mix'|'silent')`——音乐单位静音段在 mix 轴合成拍点（`metronome.js nextClickInSilent`：段起点恒重音、段内小节边界重音、起点偏移 mixItemAt 累计），时间单位静音段静默（无节拍语义），段间切换自动重同步；③ **死循环根因修复**：`nextClickInSilent` 的 k 计算缺 `+EPS` 容差——拍点步长非 2 幂（如 @150 BPM 的 0.4s）时 `(t−start)/ci` 浮点略小于整数，floor 拉回上一个拍点 → 拍点永不前进 → mtrTick 死循环（页面卡死、Edge 崩溃）；修复加 EPS + 两个调度循环「拍点严格前进」防御；诊断：二分定位（beat@150 挂、beat@120 不挂）→ Debugger 抓栈失败（渲染进程忙死）→ 循环防御证伪（`MTR-MIX-LOOP` 未现但防御终止）→ 数学复盘确认。验证：单测 185/185（+5：nextClickInSilent 3 组/mixItemAt/浮点严格递增回归）、verify_metronome_silent A+B 全 PASS（2 小节@120 打点/150BPM 0.4s 间隔/秒静音静默/卡片参数）、verify_metronome_opts 与 smoke_metronome 回归全绿、build 零报错（937 KB）

- **1.15.0**：节拍器体验优化（用户验收后三连）——① **按钮变色**：`.btn.on` 规则（accent 背景/边框 + glow，与 `.btn.playing` 同族），开关状态一目了然；② **音量上限 200%**：设置滑块 max 100→200（默认 80 不变，总线增益 = vol/100×0.5，200% 时封顶 1.0 不削波）；③ **拼接序列播放跟随**（修"播放拼接序列没有节拍器"）——根因：重复段/静音段后 `mixToOriginalTime` 原曲时间大幅回退，拍点游标 mtrNextT 已推进远超当前 → 节拍器永久静默；修复：metronome.js 新增 `shouldResync(lastGrid, nowGrid, 0.05)`（回退阈值判定，纯函数 + 单测），mtrTick 回退时重同步拍点游标；新增设置项「拼接序列播放时跟随」`metronomeSeqOn`（**默认开**，store 持久化，弹窗 checkbox `metronome.seqLabel`/`seqDesc`），playSequence 按开关启动。验证：单测 180/180（+1 shouldResync）、verify_metronome_opts 8/8（按钮变色样式/200% 持久化/重复段第 2 段恢复 4 事件/seqOn 关闭静默且原曲照常）、build 零报错（930 KB）
- **1.14.0**：① **节拍器**（控制栏「🎵 节拍器」开关 + ⚙ 设置弹窗）：跟随播放、拍点与小节线对齐、独立声源不写入音频/导出——新模块 `src/metronome.js`（纯逻辑：音符单位换算 `clickInterval = beatDur×unitBeat/noteUnit`（默认=拍号分母 4/4→4、6/8→8）、`nextClick` 拍点/重音/段切换、`segmentAt` 段边界归属）、`src/metronomeModal.js`（音符单位 2/4/8/16/自动、音量 0-100、音色 click/beep/wood，持久化 store.metronome*）；`main.js` lookahead 调度器（提前 120ms→200ms，播放/暂停/停止钩子）、无网格提示；② **律动条闪烁改进**：瞬时峰值 → RMS + 快攻慢放包络（render.js `envelopeTrack`，attack 0.55/decay 0.12），VU 表观感不再逐帧闪。③ **节拍器可听性修复**（用户实测"4 分音符间隔像一小节"）：调度逻辑经 diag（真实 AudioContext 事件时间戳，间隔精确 0.500s）证实正确，根因是普通拍可闻性——click 音色重音/普通频率写反（1900/1500 → 1500/1900）、普通拍 amp 0.55→0.8（重音靠音高区分）、时长 35→50ms、总线增益 0.35→0.5、调度时间 clamp（积压/seek 时避免 setValueAtTime(过去) 瞬时静音）。验证：单测 179/179、smoke_metronome SMOKE OK、build 零报错（929 KB）
- **1.13.1**：Majdata 导出「补充空小节」选项（可勾选，默认关闭）——**功能**：勾选后导出在**开头**为音/视频补充一小节静音——① `export.js` 新增 `padSilenceStart(mix, durSec, sr)`（开头插零，≤0 返原引用）；② `sequence.js` 新增 `padBarDuration(segments, fallback=2)`（取网格首段 barDur，无网格回退 120BPM·4/4=2s）；③ `videoExport.js` `exportVideo` 新增 `padStartSec`——输出时间轴后移 + 开头冻结首帧（`padFrameCount` 按输出帧间隔取整），与 track.mp3 音画同步；④ `exportModal.js` Majdata 面板加 `mPadBar` 复选框 + 注释（`export.majPadBar`/`majPadBarDesc`）；⑤ `main.js` Majdata 分支接 `opts.padBar`（视频源同步传 `padStartSec`）。**文案精简紧跟**：用户改 strings.json（title/tagline/提示/状态精简，editHint/autoCut.sub 有意置空隐藏提示），`test_i18n` 空值检查改白名单（`quick.editHint`/`autoCut.sub`）、selectedRange 断言、`test_ui` 空列表提示断言同步新文案。验证：单测 171/171（+3：padSilenceStart/padBarDuration/padFrameCount）、build 零报错
- **1.13.0**：新增两套配色主题——**Seigaiha**（青海波·蓝绿深海）与 **Kurenai**（绯暮·红黄暖光），基于《配色设计速查手册》印刷色号检索取色（绿松石蓝·三色第1组 #00A7DF/#C9E4E3/#FFF574 + 孔雀石绿 #009974；金麦色·三色第1组 #F0B200/#B44751/#37245B + 石榴红 #E60012/#F3981C），全链路扩展：① `index.html` 2 个 `data-theme` 块；② `render.js` CANVAS_THEMES 2 套波形色；③ `footer.js` 主题循环 5 主题（aurora→nebula→paper→seigaiha→kurenai）；④ `settings.js` 预设 + EXTRACT_SET 枚举；⑤ `strings.json` 预设文案（helpRange 改五选一）；⑥ 修复 `main.js` applyTheme 白名单硬编码——新主题名被强制回退 aurora（用户实测无法切换，根因）；⑦ README/VERSION（1.13.0）；⑧ verify_ui S8 扩展为 5 主题循环断言。验证：单测 168/168、verify_ui 79 PASS/0 FAIL（S8 五主题切换+截图）、build 零报错（910 KB）
- **1.12.6**：导出以拼接片段为准（绝对区间语义 + 空段落约束 + 静音段功能）——① **渲染**：`renderMix` 改为按 parts 绝对区间创建输出（越界区补零，替代 `subarray` 截断）；`itemToPart` 移除 `Math.max(0,…)` clamp（负起点/超长终点保留，渲染补静音）——首小节负 offset 导出等长小节（前段静音）、末小节超出音频长度补齐；拼接播放（getMixBuffer 同源）与导出一致；② **约束**：`buildGrid` offset 下界 `offset > −首段 barDur`（全空小节拒绝，modal 校验 + 快捷栏 ± 拦截 + buildGrid throw）；bars 截断到最后一个与音频相交的小节（末小节可部分越界，其后不可索引）；空段落判定 `isEmptyItem`（无时长/完全无重叠；**部分重叠允许**，如 [15.5,100]）——`anyInvalid`/`setRange` 从"端点须在网格内"改为空段落判定；手动添加拦截（manualAddEmpty）；③ **静音段**：`＋ 添加静音段`（行内表单：时长 + 拍/小节/秒，无网格时禁用拍/小节），序列项 `{silent:true, durationSec}`，卡片（🔇 静音 + 折叠区淡入淡出/时长秒编辑），播放线冻结（mixToOriginalTime 静音段映射为静音前原曲时间）、tick 段高亮改按拼接时间轴累计（原按原曲时间无法命中静音段）、进度条/总时长/seam 走 itemDuration、store 白名单加 silent/durationSec、parts 含 silent 使 mix 缓存指纹自动失效。验证：单测 168/168（+7：renderMix 补零/静音/回归、buildGrid 下界/截断、itemDuration/isEmptyItem）、verify_ui 77 PASS/0 FAIL（S13 静音段导出 4s 全零、S14 负 offset 首小节导出样本级 0.5s 静音+1.5s 原曲、S15 空段落拦截含 [15.5,100] 允许）、e2e_user/smoke_autoCut 回归、build 零报错（906 KB）
- **1.12.5**：节拍设置弹窗可读性修复（用户截图评审）——① `.btn-mini` 通用规则改 `width:auto;min-width:26px;padding:0 6px;white-space:nowrap`：修复「识别」「👆Tap」双字按钮竖排、候选 BPM `72.5（½×）` 长文本截断（与 1.12.4 的 `.ac-reset` 同一根因，这次落通用规则）；② `modal.js renderCands` 候选按 BPM 值去重（多峰同值重复显示 3 次）。验证：verify_ui S6 新增按钮横排/去重断言（识别≥32px、Tap≥44px、候选≥40px 且高度≤30px）、单测/回归全绿、build 零报错（897 KB）
- **1.12.4**：UI 改进批次（基于交付文件截图评审，21 项，`tools/verify_ui.mjs` before/after 对照验证：before 24 FAIL→after 53 PASS/0 FAIL）——① **色彩修正**：`.ac-summary`/`.ac-score.high` 误用 `--accent-fg`（三主题摘要行对比度 1.04–1.13 不可读）改 `--text-primary`/`--accent`；nebula/paper 波形渐变末停硬编码 aurora 青改 `THEME.waveDim`；`.btn:hover`/`.footer-gh` 硬编码色收编（paper 可读）；`.ac-score.mid` 黄字改 `--warning`。② **核心路径**：空态 3 步引导卡 `#hintCard` + 主按钮（初始 waveHint 隐藏、showHint 联动隐藏引导卡）；未设网格点击波形直接打开设置弹窗；**H5 修复**——`applyGridSettings` 误用 `showHint(hintInline)` 致网格应用后提示残留覆盖波形中央（截图证实），改 `hideHint()`。③ **撤销**：轻量栈（上限 20：序列增删/排序/淡化/端点/手动添加/自动剪辑导入/网格应用入栈；快捷栏微调不入栈防刷屏），Ctrl/Cmd+Z 恢复 + 删除后状态栏「已删除（Ctrl+Z 撤销）」；跨文件清栈。④ **控制栏**：BPM/偏移数值点击直改（Enter/blur 提交、Esc 还原，0.01/0.001 精度同 ± 路径）；操作提示移入「?」popover；播放按钮态（当前播放源 `.playing` 高亮、另一入口 `.dimmed`）；状态栏分级着色（`status(msg,'error'/'warn')`：导出/解码/网格失败标红、seqInvalid/手动添加失败标黄）。⑤ **序列面板**：波形颜色图例（网格时显示，剪切点追加项）；序列卡片淡入/淡出默认折叠（▾ 展开，aria-expanded）；进度条拖动时间气泡。⑥ **弹窗**：导出三面板按「编码/选项/文件名」分组；节拍设置表头简化（th-sub 堆叠 → `seg-note` 说明行）；候选 BPM 前缀「（点击采用）」；exp-tab active 加背景。⑦ **入口/响应式**：页脚主题快捷循环按钮（aurora→nebula→paper，复用 `tempokiri:settings-changed`）；≤480px 视频/波形上下堆叠、补 ≤400px 微调（360px 无横向溢出）。⑧ **代码卫生/顺带修复**：删除重复 `.modal-overlay` 规则；空态 controlbar/quickbar 的 `hidden` 被 `.controlbar`/`.quickbar` 的 `display:flex` 覆盖致空态泄漏显示（before 截图证实），补 `[hidden]{display:none}`；自动剪辑「恢复默认方案」按钮被 `.btn-mini` 26px 宽度挤成竖排，补 `.ac-reset{width:auto;...}`（84x15 横排验证）。⚠️ **modal.js 首次引入 T**（此前全字面量；N5/M9 文案化后必须加 UMD T 引用——缺失 T 会在模块 init 时 ReferenceError，MC.open 静默未定义，表现为打开设置弹窗即 TypeError，本次踩坑已修）。验证：单测 161/161（+1 卡片折叠渲染）、verify_ui before 24 FAIL→after 53 PASS/0 FAIL、e2e_user/smoke_autoCut 回归、build 零报错（897 KB）
- **1.12.3**：P2 候选/主峰细化升级（层内精度）——根因：主峰中心偏差可达 3–4%（194 vs 200）而细化窗口固定 ±3 BPM，拉不回来；`analysis.js scanBpm` 细化窗口改为**按比例 ±max(3, bpm×4%)**（200→±8，覆盖 3–4% 中心偏差，gridCost 连续距离平方有分辨力）+ **候选峰同样细化**（±max(3, b×4%)）。效果（batch1 同 seed 100 首 ±12% 窗 & ≤0.1 判定）：**79.0% → 81.0%**；**四档窗口（±10/12/15/20%）全部打平且差异样本表为空**——窗口宽度敏感性被消除（竞争层被细化正确值压制，tap 容错增强）；probe17 B 场景 242.0 精确命中（此前 249.3/246.5）；probe18（±0.6 口径）tap 模拟 **86.8% → 94.3%**（未命中 2.1%）。验证：单测 160/160、probe17 14/14、build 零报错（879 KB）
- **1.12.2**：tap 搜索窗口定档 ±20% → **±12%**（用户建议收窄；窗口扫描 probe20：batch1 同 seed 100 首 × {±10,±12,±15,±20}% 四档，tap±5% 随机偏离，0.1 判定）——±12%：**79.0%**（严重错误>2 仅 4）；±20%（旧）：75.0%（严重错误 10）；±10%：77.0%（tap 偏差 -4.9% 时真值出窗，235/719 类失误）；±15%：75.0%。实现：modal.js `TAP_LO/TAP_HI = 0.88/1.12` 常量 + 锁定提示文案同步"±12%"。验证：probe17 14/14（B 场景 246.5 vs 真值 242，误差 ±12% 窗下收窄至 1.9%）、单测 160/160、build 零报错（879 KB）
- **1.12.1**：Tap 双击阈值优化 + batch1 抽验——① `tapTempo.js` 双击阈值 150ms → **100ms**（可拍 600 BPM 拍距；人体双击极限 ~80ms 仍防抖；tapTempo 单测 10 例含 300/500 BPM 快拍用例）；② batch1 随机抽样 100 首（seed=20260824）验收"算法+tap（真值 ±5% 均匀随机偏离）"：**|误差|≤0.1 判定下准确率 76.0%**（≤0.1 76 / (0.1,0.6] 9 / (0.6,2] 5 / >2 10；Tap 偏离中位 2.7%）；Top 误差归因两类已知瓶颈：窗口边缘竞争层（180.7 vs 147 类 3-4 首）与层内 2–4% 峰值偏移（P2 候选细化目标域）。验证：单测 158（tapTempo 10）、build 零报错（879 KB）
- **1.12.0**：BPM Tap（人耳锚定）+ ×2/÷2 倍频修正（基于 handmaid 训练集 140 首评估：基线精确命中 22.9%，半频误判 42.9%、范围外（真值>200）15%——用户决策采用"人机协同"而非强制算法归一）——① 新模块 `src/tapTempo.js`（UMD 纯函数：`bpmFromIntervals` 中位数 ±15% 一致性滤波→均值、`createTapper` 状态机：双击忽略、>2s 停顿重置、8 拍锁定）；② modal.js 段落行「👆Tap」按钮 + 行内进度（n/8 拍 · 当前值），锁定自动填行内 BPM，识别时以 `[tap×0.8, tap×1.2]` 作为本段搜索范围（40–300 校验域内），**一次性**（识别完成即清，重拍/改值覆盖）；③ 识别结果 BPM 输入框右侧 `[×2][÷2]` 按钮（40–300 超限拒绝并提示；2 位规范化）；④ main.js `autoDetect/analyzeWindow` 新增可选 `range` 透传（不改全局设置、不落盘）。验证：单测 158/158（tapTempo 8 例）、probe17 14/14（11622 无 tap 60 → tap 120 命中 / 11809 无 tap 164.1 → tap 240.4 → 249.3 层正确；×2/÷2 修正与确认制）、probe18 批量收益（140 首 × 2 档 tap±2%/±5% 抖动：**精确命中 22.9% → 86.8%**（+64pt，层正确合计 91.1%，未命中 8.9%——真值>300 类与边缘竞争）、e2e 回归、build 零报错（879 KB）
- **1.11.0**：BPM 识别竞争层候选（用户评审：识别出主 BPM 后以注释/提示展示「其他可能 BPM」，算法级更新）——① 算法：`estimateBpm` 重构为内部 `scanBpm`（主峰选择逻辑逐字一致，旧接口兼容），单次扫描收集自相关谱局部峰作为候选（分数 ≥ 主峰 25%、与主峰距离 >2 BPM、每峰 ±0.04s 加权中心、按分数降序 Top 5），`harm` 标注整数倍关系（'2x'/'0.5x'/'3x'/'0.33x'）；新增导出 `estimateBpmCands`，`analyze` 返回 `bpmCandidates`；② UI：识别完成后弹窗状态区下方显示候选按钮（如 `72.8`、`217.0（2×）`），点击即采用（填入 BPM + 状态"已切换为…确认后生效"）；③ 目标音频验证（二重身 m4a，实际 108.5）：默认识别 108.5 ✓，候选展示 194.6/72.8/62.6/62/86.2（含用户遇到的 74.9 层），点击采用即刻回填。验证：单测 150/150（+3：候选含半值 harm、与 estimateBpm 主选一致、onset 不足空）、probe15 9/9、全链路 e2e 95/95、build 零报错（872 KB）
- **1.10.1**：BPM 精度上限统一——所有显示与存储最多 2 位小数（用户评审）：手动输入 change 时规范化 `Math.round(v*100)/100` 并回写输入框（`modal.js`，原 parseFloat 直通会保留任意位数如 120.123）；`rowToSeg` 确认路径兜底 round；识别（estimateBpm 0.1 步长）与快捷栏（0.01 步进/2 位显示）均已 ≤2 位无需改动。验证：probe11 9/9（120.123→120.12 回写/快捷栏/重开弹窗、±0.01 微调、120.999→121、识别回填 120.0→快捷栏 120）、单测 147/147、core e2e 45/45、build 零报错（867 KB）
- **1.10.0**：自动剪辑体验改进（用户评审 1-3；明确不做段间剪辑——默认段间存在变速/变拍行为）——① 评分体系重配：节奏对齐 40（第一优先级，未对齐 0 分）+ 能量 40 + 连续 20（降权理由：locateCutPoint 硬约束 + 30ms 交叉淡化双重兜底，样本级连续分与用户听感冗余）；② 方案展示改为「段为中心」：段主行 起点–终点/时长（秒+小节）/试听，终点候选子行（→ 终点时间/时长/试听/采用，数据源为 buildPlan 新增 candidates 池——含被默认方案合并掉的显著切点，顺带消除"高分点被静默删除"的不透明），采用走 `anchor` 锚定重算（该段起止固定豁免最短段长删除，其后重新生成，保持连续分割不变式、无跳跃组合），「恢复默认方案」按钮清锚定；③ 剪切点试听窗口改为前后各 1.5 小节（可确认节奏对齐；无网格回退 ±2s，span 文案插值 `autoCut.listenCut`）。验证：单测 147/147（scoreCut 四档重算 + candidates/anchor 新用例）、build 零报错（866 KB）、smoke_autoCut/e2e autocut/probe10 全过（60/100 上限、候选采用 3→2 段、试听 6s=±1.5 小节）
- **1.9.1**：用户体验修复（评估报告 USER_EVAL_v190，外层工作区）——① 空格键与拼接序列语义对齐：暂停拼接时状态栏显示「序列已暂停」而非单曲暂停文案；再按空格恢复拼接播放（断点续），仅非序列来源回落原曲（`lastSeqPlay` 跟踪播放来源；由 `playOriginal`/`playSequence`/`stopPlay` 三处维护）；② 快捷栏 BPM 微调修复：步进原被 `Math.round(x*10)/10` 硬舍入到 0.1（±0.01 按钮恒无效），现按 0.01 精度（`*100/100`）并同步显示 2 位小数；③ 拼接序列播完提示改用「播放结束」、试听区间播完改用「试听结束」（原两处文案错位）；④ 自动剪辑初次无方案时也打开方案弹窗（showEmpty 提示 + 参数行保留可调参重试，无方案时「一键导入」禁用；open 对无段 plan 走 showEmpty）；⑤ 单小节选区提示不再显示「第 2–2 小节」冗余（新增 `status.selectedRangeOne`，双击与「延伸到末尾」两路径统一）。验证：单测 145/145 全绿、build.py 零报错、无头 Edge e2e 全链路回归（core/video/ui/perf/autocut + smoke_autoCut）通过
- **1.9.0**：自动剪辑增强（改进 Goal）——① 方案参数化：弹窗参数行「最少段长 2/3/5s」+「对齐网格」开关，变更即时重分析（`onAnalyze` 回调，后端 `minSegSec`/grid 透传）；② 质量分重做：`scoreCut(depth, maxDepth, cost, reason)` 三因子加权 = 谷深 50 + 信号连续度 30（定位成本 1/(1+cost·8)）+ 网格对齐 20，0-100（此前仅谷深归一化，无法区分同深点）；③ 试听：剪切点行（前后 2s）与段行（整段）「▶」按钮 → `previewAutoCutRange` 播放原曲区间（音频/视频路径复用，先停旧播放，状态栏「试听中」）；④ 摘要行：拼接总时长与保留原音频比例；无方案时弹窗显示提示（`showEmpty`）而非空表。验证：新增 4 单测（评分域/分档/对齐开关），全量 145/145；无头 Edge 冒烟（smoke_autoCut.mjs）覆盖参数切换重分析（3 段→2 段）、试听、摘要、对齐开关可见性，SMOKE OK
- **1.8.0**：自动剪辑——工具栏新增「✂ 自动剪辑」（`src/autoCut.js` 纯算法 + `src/autoCutModal.js` 方案弹窗）：积分图 RMS 能量包络（O(n)）→ 谷检测（平台 span + 两侧峰谷深，5% 显著性阈值滤伪谷）→ 谷内最小差分定位（信号连续/过零，无痕）→ 可选吸附网格线（小节线 > 拍线，半径 120ms）→ 分段方案（相邻剪切点间隔默认 = 最小段长 3s，过短段循环合并；无保留剪切点返回空方案）；方案弹窗展示剪切点（时间/小节/依据/质量分）与分段表，一键导入拼接序列（现有序列非空先确认替换），剪切点以橙色实线 + 顶部菱形标记在波形（三主题 cutLine 色）；分析范围 = 网格覆盖范围（有网格时）或全曲；视频未提取音轨时先采集。验证：新增 10 单测（包络/谷/定位/对齐/方案/碎切合并/范围），全量 142/142 通过；无头 Edge 冒烟（`tools/smoke_autoCut.mjs`）：无网格/有网格两场景弹窗、导入、替换确认、波形标记、拼接播放全链路 OK
- **1.7.0**：元数据菜单——页脚新增「元数据」入口（`src/metaModal.js`），导入文件自动解析元数据（MP3 ID3v2.2-2.4/ID3v1、FLAC/OGG Vorbis Comment、MP4 moov/udta/meta/ilst、WAV LIST/INFO，`src/metadata.js` 纯函数模块），6 文本字段可编辑并持久化到 per-file 缓存（store 合并语义保留 metadata 键）、封面只读展示；导出音频自动附加（WAV LIST/INFO UTF-8、MP3 ID3v2.3 含 APIC），空元数据零开销返回原 buffer。验证：新增 14 单测全绿（手写字节 fixture 往返回读），全量 132/132 通过
- **1.6.4**：选区「延伸到末尾」浮标——选中区间后波形容器右上角出现 `selToEnd` chip（`wave.toEnd` 文案），点击将选区右端延伸到网格最后一个小节（`grid.bars` 末尾，保证可入列语义）；复用 `status.selectedRange` 与 `renderWave`，无新增逻辑文案；入列/切文件自动隐藏
- **1.6.3**：视频音轨提取修复交错格式崩溃（Blocker B1）——AudioDecoder 对部分 AAC 源（test_video.mp4）输出 `f32` 交错布局，原代码无条件按 `f32-planar` 逐平面 `copyTo(planeIndex)` 导致 `Invalid planeIndex`、该视频工作流完全不可用；现按 `audioData.format` 分支：`f32-planar` 逐平面拷贝、`f32` 单次拷贝后经新增导出纯函数 `interleavedToPlanar` 重排为平面布局（补 3 个单测），其余格式抛可读错误；顺带修复停止后状态栏残留（N1，`stopPlay` 补 `status.stopped`「已停止」文案）
- **1.6.2**：修复滚轮平移波形反向/消失（P0 增量渲染 blit 方向错误）——纯平移时旧帧离屏缓存 blit 偏移符号写反（`+dxPhys` → `-dxPhys`），波形与时间轴刻度/播放线逐帧错位累积直至消失；补 T3 断言（mockCtx 记录 `drawImage` 偏移，增量路径必须向左 blit），防止回归
- **1.6.1**：运行时性能优化（optimization-plan-4）——P0 波形平移增量渲染（draw 拆出 drawRange 按 x 区间裁剪 + 离屏缓存 blit，纯平移只重绘露出条带；波形循环累加器化、渐变按 waveH 缓存；顺带修复 v1.6.0 透明背景下全量绘制无 clearRect 导致的重影残留）；P1 tickProgress rAF 生命周期（停止后链终止不再空转）+ analyser→destination 连接释放；P2 spectralFlux 幅度计算（Math.hypot→sqrt + 双缓冲消除每帧 Float64Array.from 分配）；P3 estimateBpm scoreAt 双指针单调扫描（抽 scoreNear 导出可测）；P5 切文件释放旧视频 Blob URL + 清空 mixCache；P4a 序列输入局部更新（setRange 合法路径不再整列表重建）+ saveWorkspace 防抖。验证：115/115 单测全绿、analyze 全链路 639→414ms（<450ms 达标）
- **1.6.0**：UI 现代化重构（Gemini UI_Improvement 方案落地，纯 CSS/视觉零逻辑侵入）——设计令牌体系（结构/色彩/阴影令牌，三主题全部迁入：aurora 用方案给定值，nebula/paper 沿现有色调翻译；旧变量 --bg/--panel/--border 等全部删除）；表面海拔（toolbar/seq-panel/seq-card 圆角+阴影分层）；空间呼吸感（stage 20px 边距、controlbar/statusBar 重排）；控件现代化（.btn 状态机重写、Segmented Control 微调群组、输入框统一 3.3 套件、焦点环）；音频工作区（#waveWrap 280px 微网格 + canvas bg/gridBg 透明化露出 CSS 网格、进度条 pill 化、seam/knob 令牌化）；页脚视觉降噪（移除心跳动画与渐变签名、数字排版 tnum 等宽）；窄屏 480px 媒体查询补 toolbar/stage/statusBar/footer 压缩。验证：111/111 单测全绿、浏览器断言套件 12 项全 true、三主题像素级校验、360px 无横向溢出、WAV 44100Hz/MP3 192kbps 导出回归通过
- **1.5.4**：评估修复（P1-P7）——视频导出 AAC 试编码自检（自检失败/Flushing error 映射为可读中文提示）、视频导出「包含音轨」开关（纯视频逃生通道，透传已有 mute）；AAC 码率按采样率动态约束（22050 Hz 仅 96-192k，256k 不可选）；WAV 解码用 OfflineAudioContext 固定源率（「跟随源」不再被设备率 48k 静默改写）+ 导出弹窗「跟随源」标注实际采样率；Esc 统一关闭 README/彩蛋弹窗（页脚自建 overlay）；网格应用后波形提示更新为选段指引；无声源识别秒级返回（RMS 能量预检）+ 识别状态栏反馈；窄屏 360px 媒体查询（按钮不换行压缩）
- **1.5.3**：README 内容修订——主题名同步（Aoi Aurora / Meltyland's Nightmare / Kamikiri）、高级设置 9 项参数描述、导出补 Majdata
- **1.5.2**：高级设置弹窗主题化——`.as-desc`/`.help-pop` 从硬编码色（#999/#1e1e24/#ddd）改为 CSS 变量，Kamikiri 浅色主题下可读；帮助气泡合并去重——effect 段并入常驻 desc（desc 吸收独有信息），气泡只显示「范围 + 推荐」，strings.json 删除 10 个 helpEffect key
- **1.5.1**：文案修订（strings.json）——主题名改英文（Aoi Aurora / Meltyland's Nightmare / Kamikiri）、彩蛋与提示文案精简；测试断言改为与 strings.json 同源（改文案不再破坏测试）；README 补文案系统/主题说明
- **1.5.0**：界面文案系统——strings.json 唯一编辑源（约 200 条文案），build.py 注入 + key 完整性校验（缺失中止/冗余警告）；src/i18n.js 提供 T(key, params) 插值与 data-i18n 静态填充；全模块（index.html/main/settings/exportModal/ui/footer）硬编码文案迁移完毕
- **1.4.3**：修复检查更新逻辑——原 else 分支无条件提示「发现新版本」（GitHub 版本低于本地时误报）；新增 `compareVersions` 语义化三段比较（footer.js 导出，纯函数可单测），分支改为：GitHub > 本地 → 正常提示更新；相等 → 已是最新；GitHub < 本地 → 彩蛋弹窗「领先一步」（测试者超前版场景）
- **1.4.2**：页脚重排——产品身份（标语 + 版本徽标）上移至顶部 brand 区（Tempokiri 渐变字 + tagline + 版本 pill + 律动条），页脚只留作者署名（♥ M1zukiri + 社交/工具按钮）
- **1.4.1**：高级设置「界面主题」移至第一栏（FIELD_DEFS 首项）；品牌字改用 Georgia 衬线栈（.brand 的 Tempokiri 与页脚 M1zukiri，中文「工作站」保持无衬线）
- **1.4.0**：三套配色主题（暗夜青蓝默认 / 幽夜霓紫 / 纸墨贝色，`data-theme` 属性 + CSS 变量，高级设置「界面主题」切换并持久化到 `tempokiri.remix.global.v1.theme`）；render.js 新增 `setTheme`/`CANVAS_THEMES` 同步波形 canvas 色；全局精致化（brand 渐变字、focus-visible 轮廓、数字等宽、按钮圆角）；签名元素「律动品牌标」（顶部 brand 旁 8 柱律动条，播放时 AnalyserNode 时域数据驱动，静止正弦包络）；主题相关硬编码色全部收编为 9 个语义变量（--accent-fg/--wave-bg/--input-bg/--chip-bg/--scroll-thumb…）
- **1.1.2**：移除 CLI 交付物（Python+librosa 仅作算法验证，工作站功能已完全覆盖）；仓库结构扁平化（remix/ 上移仓库根，两个 README 合并为单一文档）；版本号单源迁移至根级 VERSION 文件
- **1.1.1**：拼接操作性能优化——seekMix 缓存拼接 AudioBuffer（`getMixBuffer`，key 指纹自动失效，seek 全路径 240ms→0.3ms）；播放段切换只切卡片高亮（`ui.setPlayingCard` 替代整列表重建，35.8ms→0.1ms）
- **1.1.0**：波形/视频性能优化（去光晕 shadowBlur、网格二分裁剪、逐像素步长、播放线亚像素阈值）；修复视频暂停/停止不生效（pausePlay 补 videoEl.pause、移除原生 controls）
- **1.0.0**：页脚签名与工具（渐变霓虹签名、Bilibili/GitHub 链接、README 内嵌弹窗、检查更新）；拼接序列进度条（seam 标记/拖动 seek）；视频导出修复（关键帧边界 flush、mux decoderConfig、零丢帧）
- **0.2.0**：性能（帧合并/批量 path/seek 节流）、设计（渐变波形/播放态卡片）、高级设置（交叉淡化/快捷键/视图持久化）
- **0.1.0**：初始版本

## 负结果实验记录（已验证，勿重复尝试）

改动前先看这里 —— 以下方案都有真实语料对照数据支撑的**负收益**结论。

| 实验 | 做法 | 结果（140 首 batch_review+batch_test，配对同曲同解码） | 结论 |
|---|---|---|---|
| **抗混叠低通** | `resample` 降采样前加多相 Hann-sinc 低通（截止 = 目标 Nyquist） | hit0.1 **25.7% → 21.4%**；层正确 79.3% → 78.6%；落半频层 69 → **76 首**；35/140 结果变化且多数变坏（真值 160→线性 160.1 命中 / AA 81.4 掉半频） | ❌ 回滚。根因：降采样到 22050 会丢掉 >11.025 kHz 的 hi-hat/镲片 onset，而它们正是支撑"较高 BPM 层"的证据；线性降采样虽混叠，却把高频能量的**时间结构**折回低频，歪打正着。补丁留档：`eval/handmaid/m1_antialias_neg_result.patch` |
| **onset 亚帧插值（M4）** | `detectOnsets` 峰值加抛物线亚帧定位（δ = 0.5(y0−y2)/(y0−2y1+y2)，\|δ\|≤0.5 clamp） | adx 300 首 × 2 窗：默认窗 ≤0.1 +1.0pp / 层正确 +2.0pp，但宽窗 ≤0.6 **−0.6pp**，两窗**半频错误均增加**（126→136、101→107）、中位误差均变差 | ❌ 不落地。差异全在 ±2.6pp 噪声内——收益小到测不出来，却实测让主要错误模式变差。**主战场是半频层（42%）不是时间精度**（层正确已达 81.7%） |
| **放宽 BPM 上限（M6）** | 默认窗 60–200 → 40–320 | ≤0.6 29.0%→**26.3%**，层正确 81.7%→**67.7%** | ❌ 一刀切放宽有害（新竞争峰把原本层正确的曲子带偏）。只剩**条件式**自适应（主峰触顶才重扫，原 P3）未证伪 |

> 教训：**分析前端（22050 + 朴素线性降采样）是经验最优，别用"教科书正确"去改它。** 合成音轨上的结论（§"改采样率零收益"、亚帧插值收益不稳定）都不可作为判据，只有真实语料能判定。

## 深入文档

- 设计文档：`docs/superpowers/specs/`（工作站设计、优化计划、自动剪辑设计 2026-08-19-auto-cut-design.md）
- 产品文档（内嵌页脚弹窗）：`README.md`
- 改进计划与实验记录：`PLAN.md`
- 评估资产：`tools/generate_adx_db.mjs` + `tools/eval_adx.mjs`（**当前主用**：E:/Sync/adx-charts 1901 首，配对变体评估）、`tools/diag_mp3_sr.mjs`（解码采样率诊断）；旧 handmaid 系列（`evaluate_handmaid` / `eval_aa_ab` / `eval_sr_ab`）留档。数据库与结果留在 `个人/tempokiri/eval/`（不入库）
- 新基线（adx 300 首 / seed 42 / 默认窗 60–200）：≤0.1 **28.0%**、≤0.6 **29.0%**、层正确 **81.7%**、落半频 126/300；宽窗 40–320 反而更差（26.3% / 67.7%）
