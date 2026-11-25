# Theme Background 技术规格

适用于 `theme-background@1.0.0`，目标宿主为 CodexHost 0.26.0。宿主契约取自 `v0.26.0` 的 `1139a2a89da5c702a2a48b9775f2023970eb31cf`。[Manifest v2 源码](https://github.com/BytePioneer-AI/codex-host/blob/v0.26.0/packages/shared-contracts/src/host-extensions.ts)

## 清单与入口

包根 `manifest.json` 声明 `manifestVersion: 2`、顶层 `slots: ["appearance.theme"]` 及 `apiVersion: 1` 的 `page`、`desktop`、`web`。交付采用纯前端八文件结构，`storage` 保存嵌套配置。

- `page.mjs` 导出 `mount(root, api)`。管理页可位于普通 DOM 或 Shadow DOM。所有样式限定 `[data-tb-page]`。对话框、下载按钮与 Toast 归入页面根，宿主事件更新语言、明暗和设置。
- `desktop.js` 在顶层同步执行一次 `define({ activate })`，使用原生 frame、backing、rail 与设置壳标记。读取 HTML 明暗属性、类、`color-scheme` 及系统偏好。可见窗口每 5 秒对账，focus 和恢复可见时补读。
- `web.mjs` 导出 `activate(api)`。宿主事件和同源通知触发对账。使用 App、会话、侧栏、顶栏、输入区和设置的锚点。只有扩展首帧就绪才遮住内置壁纸。内置壁纸预览期间扩展让出图层和底板，暂停动画及视频。
- 各入口使用幂等 disposer。它负责回收自身资源和异步代次，允许宿主另行回收登记节点与标记。

## 共享设置

Host 存储外层 `{ settingsRevision, values }`，扩展只读写 `values.theme`。共享文件预算 1 MiB。首次读取和迁移只发生在内存。配置保留其他 `values` 键。未来版本或非法结构进入只读，注入撤回样式，管理页保留草稿和错误提示。Page 防抖 200 ms，写前重读，按字段合并。察觉同字段冲突时保留草稿并由用户决定。`storage.set` 的替换与宿主同载荷重试仍可能产生最后写入胜出的竞争。

| 条目 | 数据形状和默认值 |
| --- | --- |
| 版本 | `schemaVersion: 2`。v1 的 `plate` 迁移到主界面、侧栏和设置。v1 缺省表面不透明度保留 75/75/100/100/75，现有 v2 有效数值原样读取。 |
| 调色 | `accent` 是小写 `#rrggbb` 或 `null`。`schemeOverride` 的 `auto` 读取实际壁纸首帧，采样不可用时跟随宿主。`light` 和 `dark` 为显式指定。`respectReducedTransparency` 默认 `false`。 |
| 五个表面 | `bg/sidebar/card/input/settings` 分别设置不透明度（0–100，步长 5）、模糊（0–40 px）、描边（0–4 px，步长 0.5，预设颜色或 HEX）。新安装不透明度为 85/90/85/85/90。 |
| 背景 | 来源为关闭、HTTPS 图片、本地图片、本地视频、轮换池、Mesh、Shader 或 Pattern。`opacity` 0–100，默认 85。`blur` 0–60 px，默认 0。媒体独立 `placement` 与 `videoPlacement` 使用 `fit/fill/stretch/tile/center`、0.25–4 倍缩放和 0–1 平移。 |
| 动效 | 原版 Mesh、Aurora/Nebula/Noise/Starfield 与 Dots/Waves/Poly/Rain/Contour/Meta，共 11 种。启用刷新重生成时，每个注入激活实例生成临时种子，避免写 Host。 |
| 字体 | `font` 包含 `enabled`、`mediaId`、`mime`。文件魔数校验，`FontFace.load()` 解码后注册。 |
| 轮换 | 一个池 UUID，最多 30 个去重图片引用，顺序或随机。`reload/hourly/daily/weekly`。 |
| 档案与定时 | 最多 20 个快照。`appearance` 保存色板、表面与壁纸效果。可选 `source`、`placement`、`videoPlacement`、`font` 保存来源、两套构图和字体。缺省字段继承基础配置，显式关闭可停用背景或字体。`activeProfile` 记录手动应用项，手动编辑快照字段后清除。定时按本地 `HH:MM` 或系统明暗选择日夜档案，同一时刻全天使用日间档案。 |

JSON 文件和文本共用 1 MiB UTF-8 校验、版本与媒体引用验证、确认和提交。档案内的轮换引用必须指向配置中唯一的池 UUID。导出按次持有下载 URL，60 秒后或 Page 销毁时回收。旧版 v2 编辑器保存时会丢弃新增的快照字段，降级前应保存新版 JSON。

运行时先接受基础配置，再读当前定时档案字段，随后解析本端轮换项或临时种子，最后渲染和加载字体。30 秒检查在可见时运行。恢复可见、回焦和系统明暗变化时补检查。定时只影响运行时。全部五个 Tab 显示当前已生效的定时档案，暂停操作通过基础草稿的保存流程。

## 媒体和回收

IndexedDB `codexhost.ext.theme-background.media` 为版本 2，沿用 v1 的 `media` 与 `byKind` 索引，新增 `rotationState`。单文件上限为 JPEG/PNG/WebP/GIF/AVIF 20 MiB、MP4/WebM 200 MiB、单字体 WOFF2/WOFF/TTF/OTF 50 MiB。魔数与真实解码通过后保存原始字节、规范 MIME、大小和显示名称。检测到 TTC/OTC 时提示选择单字体。

同一 Host 共享设置与 UUID。Blob 和游标按浏览器配置、存储分区和 origin 保存，同源同配置的 Web 标签可共用库。Chrome、WebView2 与 Electron 需分别关联缺件。重新关联保留原 UUID 与 Host 修订号。本端删除和清空保留共享引用。

轮换游标为 `{ poolId, current, lastRotate }`，`current` 是图片 UUID。时间档在一个读写事务内重判并推进。提交结果才发送同源通知。`reload` 仅在注入激活时推进，Page 管理操作可手动切换。对账、focus、定时检查和打开管理页均不会消耗 `reload` 次数。

每个消费者单独持有 ObjectURL，切源和销毁时回收。视频静音循环，平铺和模糊通过 Canvas 合成，其他场景使用原生视频。GIF 在普通构图下由原生图片播放，模糊时只延伸触及视口边界的边和角。平铺、减少动效或手动暂停时使用 GIF 的默认帧。Canvas 动效限 30 FPS。Shader 失败用新画布以同种子降级 Mesh，再降级为静态渐变。

## 样式与可访问性

六个十六进制位标记各有 16 档，重建 24 位颜色。六套预设按 sRGB 合成后的最差表面校准，黑、白和黑白分区壁纸下，普通正文、次文与主按钮均按 WCAG AA 4.5:1 校验。自定义低透明度会随壁纸改变对比度。

暗度采用 Rec.709，采样与成功首帧在同一绘制调用栈内，按代次接收。排除模糊外扩，计入壁纸 opacity、透明像素及留白的原生底色。取色优先使用同文档有效构图，否则读本端游标并标明预览。视频按裁剪后的当前帧取色，GIF 的 Canvas 快照使用浏览器默认帧。公开图像的显示由浏览器 CSP 决定，跨域像素读取得到独立提示。

全局样式由清单 CSS 控制。Desktop 在设置壳第一层 ShadowRoot 安装可撤回样式，Page 自己的 ShadowRoot 继承八个令牌。Web 通过稳定的语义令牌和节点标记应用底板。主按钮和 Tooltip 分别成对映射填充和文字。背景未就绪、关闭或让出预览时撤回清底、混色和磨砂，保留独立描边。跟随系统降低透明度时使用实色底板。`forced-colors` 恢复宿主样式。正文使用已解码的单 `FontFace` 并允许合成字重，代码沿用宿主等宽字体。

Page 样式只读取宿主令牌 `--cx-page-bg/surface/text/text-muted/border/accent/danger/radius`。五个 Tab 具备焦点与方向键切换，HSV 滑块提供色轮的键盘等价操作，取色器支持方向键选择像素及 Enter 应用。
