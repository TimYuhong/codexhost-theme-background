# Theme Background 交付与验收

目标为 CodexHost 0.26.0 上的 `theme-background@1.0.0`。完整功能、同步和资源协议见 [技术规格](TECHNICAL_SPEC.md)。构建与隔离启动见 [开发文档](DEVELOPMENT.md)。

## 交付件

- `dist/` 和 `release/theme-background-1.0.0.zip` 的根目录均为十二个文件（八个核心文件 + `icon.png` 与三张 `preview-*.webp` 预览图）。`release/theme-background-1.0.0.zip.sha256` 校验正式 ZIP。
- 自动化门槛为 `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm test`、`pnpm run manifest`、`pnpm run build`、`pnpm run verify`、`pnpm run package`。
- Manifest 门槛使用 `v0.26.0` 官方构建的 `hostExtensionManifestV2Schema`，包括四种宿主反例及项目对 `settingsSchema: []` 的拒绝。verify 输出十二项准确字节数、校验 PNG/WebP 文件头签名，并测试动态导入、裸 specifier、经典入口 ESM、超预算和缺 CSS。
- 原始 Blob、Chrome 运行时和 CSS 真实作用域通过下面的实测验证。结果要注明宿主、浏览器、操作系统、独立目录、归档摘要与具体覆盖。

## 残留扫描

以下两条 `rg` 均预期零命中，退出码为 1。最后执行 `git diff --check`。

```sh
rg -n -i 'cordis|@deepseek-ai|dsh-any-background|dsh-better-sidebar|__ModuleLoader__|host-compat|third-party|react-dom' src manifest.json package.json
MSYS2_ARG_CONV_EXCL='--path-separator=' rg --files --hidden --path-separator=/ -g '!.git' -g '!node_modules' -g '!dist' -g '!release' | rg '(^|/)(host-compat/|third-party[.]ts$|lib/(index|client)[.]js([.]map)?$|cordis([.]patch)?[.]yml$|tsdown[.]config[.]ts$)'
git diff --check
```

## 双端验收矩阵

Desktop 在独立 OS 测试账户或 VM 中启动。Web 使用新 Chrome 用户目录，同一 Host 另开标签页验证事件同步，第二配置测缺失素材。每项记录实际覆盖，未运行不能计为通过。

| 编号 | 操作和通过判据 |
| --- | --- |
| M01 安装 | localDir 和正式 ZIP 分别安装一次。Web 与 Desktop 打开同一管理页，宿主显示双端支持与外观类别，`backendState` 为 `none`。 |
| M02 UI | 遍历五 Tab、两种语言、窄屏和键盘路径。色轮、HEX/RGB/HSL、吸管和预设能应用。八个页面令牌在真实宿主对应。Shadow 和普通 DOM 的弹层归入根，关闭还原焦点。 |
| M03 同步 | A Desktop 同窗保存走 BC。B Web 管理页关闭后仍应用 Host 事件。C Desktop 可见 5 秒内对账。D 后台不轮询，回焦补读。用修订号核对写入次数。 |
| M04 媒体 | 用真实选择器和拖放上传 JPEG/PNG/WebP/GIF/AVIF、MP4/WebM、WOFF/WOFF2/TTF/OTF，检查空 MIME 和别名文件仍保存规范 MIME。TTC/OTC 三种入口均提示选择单字体。核对 Blob 与文件 SHA-256。第二配置应能提前关联档案缺件，关联同一 UUID 时 Host 修订号不变。 |
| M05 引擎 | 测 HTTPS、Mesh、4 个 Shader、6 个 Pattern。视频和 GIF 验证五种构图、zoom/pan 极值、模糊 0/60、暂停和低动效。GIF 用边缘换色样片检查动态边角与预期留白。快速交替图片与视频 Tab，空库保留原背景。定时切档、打开 Page、focus 和 5 秒对账都不推进 `reload`。 |
| M06 壁纸仲裁 | Web 设内置壁纸，扩展首帧就绪才遮住内置层。内置预览暂时恢复，预览结束继续。禁用、0 不透明度或解码失败时保留内置状态。 |
| M07 冲突 | 两个管理页同时改变同一与不同字段。冲突保留草稿并提供两种处理。模拟延迟、断线、旧读和晚回调。 |
| M08 设置 | 未设置时不落盘，v1 读入不写回，未来版本只读。持久化 v2 后重启恢复。复制旧档保留继承，新档验证完整快照和显式关闭。确认暂停定时保留草稿，拒绝错误池引用。连续下载及下载后关闭 Page，解析文件。剪贴板不可用时验证文本框复制和粘贴导入。 |
| M09 故障 | 验证错误 MIME、损坏编码、配额、数据库不可用、WebGL 初始化失败与 context lost。Shader → 同种子 Mesh → 渐变。恢复后可以重试。 |
| M10 热启停 | 关闭管理页后渲染继续。切源、热禁用再启用、卸载后监听、图层、字体、URL 和帧被回收，晚结果不会复活 UI。 |
| M11 槽冲突 | 用独立合法 Desktop fixture 声明 `appearance.theme`。按两种启用顺序验证单槽位、清理及 Web/Page 可用。 |
| M12 删除范围 | 禁用、升级及卸载不会远程删除浏览器内媒体。用二次确认清空本端媒体后只剩共享引用，所有消费者立即释放对应素材。 |
| M13 宿主映射 | 纯净 0.26.0 查看六预设在黑、白、黑白分区的实际像素。正文、次文、主按钮至少 4.5:1。核对气泡、Diff、代码顶栏、Plan、配额浮层、Tooltip、输入卡单背板、侧栏 fixed 按钮、Desktop 双 Shadow 和窗口操作。用 Rendered Fonts 检查中英文字形与等宽代码。测试宿主与 OS 相反、0 不透明度、系统降低透明度和强制配色。 |

可以在 Elements 查 `.tb-desktop-layer`、`.tb-web-layer`、`[data-cx-web-ext-mount="theme-background"]`。从实际绘制节点读取 `backgroundColor`、`backdropFilter`、`webkitTextStrokeWidth` 和 `fontFamily`。只读核对临时 Host 的 `settings.json`，分别观测关闭管理页、热禁用和卸载。切换语言时保留焦点，头像、窗口菜单和其他插件的交互维持正常。

## 1.0.0 实测（2026-11-25，CodexHost 0.26.0 / 0.26.1）

Windows 上使用已安装的 CH Web 0.26.x、无头 Chrome 158.0.8127.38、独立 Host 数据、浏览器上下文、会话库和工作区。仅启用了 `theme-background`。Node 24.22.1、pnpm 10.32.1、Python 3.12.7 下通过 48 项测试（含极限强调色染底对比度校验）。独立构建的官方 v0.26.0 清单校验及两项残留扫描通过。最终 ZIP（含 `icon.png` 与 3 张 WebP 预览图）为 **261,604 B**，SHA-256 为 `0eca32b95a441d2ae751ce5acad250ece5918761630fdd239a9ee6b265907c63`。

- CH Web 从正式 ZIP 全新安装。管理页实际 ShadowRoot 在 1280 px、390 px 均测试了布局，五个页签可操作。六套预设叠黑、白、黑白分区的正文和次文取屏幕底色计算，主按钮按实际颜色令牌计算，均达到 4.5:1。内置壁纸让位测试驱动了宿主预览标记，强制配色在 Chromium 模拟。
- 真实浏览器解码验证空 MIME GIF、别名 AVIF 和 WebM。检查 GIF 原生模糊、暂停及减少动效、空视频库保留图片、视频按构图取色与焦点归还、CORS 允许和拒绝及网络故障的不同反馈、TTC 提示和 SimHei 实际字形。重新关联、轮换和并发草稿的相关判据有 Node 回归断言。
- 实测新快照保存、复制、五页签定时提示及暂停、连续两个下载解析和文本导入。热禁用后 Web 图层和标记回收。Chromium 使用 0.26.0 的设置壳 CSS 运行 Desktop 经典入口与双 Shadow 夹具，覆盖宿主与 OS 明暗相反、输入底板、主按钮、宽窄布局、描边与样式表回收。
- WebView2 和原生 Desktop 验收需要独立账户或 VM。仍需复核真实窗口控件、槽位竞争、WebView2 文件选择与关闭页后的下载、跨分区重关联修订号。完整 Web 会话的 Diff、Plan、右栏、容器滚动和配额浮层，以及 M01–M13 尚未覆盖的流程，按矩阵继续核验。

## 1.0.0 历史实测（CodexHost 0.25.1）

环境为 Windows、npm 全局安装的 CodexHost **0.25.1**、Chrome **158.0.8127.38**，独立 `CODEXHOST_DATA_DIR`、Chrome 用户目录和回环端口 `4413`。最终 ZIP 为 **90,122 B**，SHA-256 为 `bed13be1a31495ba09ec9891441015562150357214f436c8d95ff2c733bef6e4`。正式 ZIP 与 localDir 各自导入后均核对了八个安装文件的内容。Node 24.22.1、pnpm 10.32.1、Python 3.12.7 下自动检查全部通过，包括 29 项 Node 测试和真实 0.25.1 Manifest Schema 校验。两项残留扫描零命中，`git diff --check` 通过。

| 编号 | 实测结果 |
| --- | --- |
| M01 | Web 正式 ZIP 上传、目录导入与外观分类通过。经典入口同步注册由 VM 校验。本机原生 Desktop 导入待测。 |
| M02 | 普通 DOM 五 Tab、八个宿主令牌、切换中英文、410 px 窄屏、色轮、三种数值编辑和吸管焦点回归通过。Chrome Shadow DOM 夹具使用 0.25.1 设置壳 CSS，确认键盘、焦点、弹层与宿主语言和明暗回调。 |
| M03 | Web 双标签及不同 Chrome 用户目录的设置同步通过。在另一配置打开会话且管理页未打开时，单次保存约 610 ms 到达。Desktop 的 5 秒可见态规则有自动测试，原生联测待测。 |
| M04 | PNG/JPEG/WebP、MP4/WebM、WOFF2/WOFF/TTF/OTF 真实导入。核对 PNG、视频和四类字体的原文件与 IDB Blob SHA-256。第二 Chrome 配置显示缺件，同 UUID 关联保持 Host 修订号。 |
| M05 | Chrome 渲染 Mesh、四个 Shader、六个 Pattern 与公开 HTTPS 图片。视频播放、减少动效、构图平铺和吸管首帧通过。轮换池批量导入、手动选图及 focus 游标不变通过。五种布局几何和时间档、reload 语义由自动测试覆盖，原生 Desktop 图形路径待测。 |
| M06 | Chrome 真正操作内置壁纸透明度滑块，确认预览期间恢复内置层、扩展让位，结束时重新隐藏内置层。 |
| M07 | 自动测试覆盖并发写、冲突解决、失败保留草稿和迟到回执。真实断线及 Desktop 双端竞争待测。 |
| M08 | 0.25.1 隔离进程重启后，2619 B 的 UTF-8 配置逐字节一致。v1 读取、未来版本只读和设置格式由自动测试覆盖。 |
| M09 | Chrome 实际 `webglcontextlost` 降级 Mesh，错误格式拒绝写入。单测覆盖部分 GL 对象回收、无 2D 渐变、缺媒体和读取异常。没有通过填满磁盘验证真实配额错误。 |
| M10 | Chrome 热禁用后标记、图层和字体注册均为 0，恢复启用后为单层。Web 卸载后图层归零。经典入口夹具也确认局部样式和监听器清理。原生 Desktop 启停待测。 |
| M11 | 原生 Desktop 槽位竞争待测。 |
| M12 | Web 清空原始 Blob 时保留共享引用和修订号。Web 卸载保留设置和 IDB，重新导入 ZIP 后设置逐字节一致。Desktop 的删除宿主数据选项待测。 |
| M13 | Chrome 实际会话底板为 0 不透明度、9 px 模糊、0.5 px 自定义描边。默认透明度滑块、降低透明度选项、forced colors 和字体等宽代码通过。宿主深色下强制浅色时，主按钮对比度为 5.24:1。经典入口夹具确认 rail 和 Shadow 设置壳样式，原生窗口控件待测。 |

本机未提供可用于本次任务的隔离 Desktop 账户或 VM。Chrome 中的经典入口和 Shadow DOM 检验提供了 DOM 与样式验证，原生 Desktop 窗口相关判据仍待独立会话验收。0.25.1 曾拒绝直接覆盖已安装的同版本 ZIP，卸载保留数据后重新导入已复验。独立 Web 和 Host 进程已停止，端口、临时数据和 Schema 参考目录已清理。
