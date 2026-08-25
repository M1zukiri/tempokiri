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

## 深入文档

- 设计文档：`docs/superpowers/specs/`（工作站设计、优化计划、自动剪辑设计 2026-08-19-auto-cut-design.md）
- 产品文档（内嵌页脚弹窗）：`README.md`
