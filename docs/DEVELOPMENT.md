# Theme Background 开发文档

扩展源码迁移自 `52ec5dc8`，CodexHost 0.26.0 的契约参考提交为 `1139a2a89da5c702a2a48b9775f2023970eb31cf`。Manifest 与安装包版本为 `1.0.0`。应用数据版本为 2，兼容读取版本 1。[运行协议](TECHNICAL_SPEC.md) · [交付验收](DELIVERY.md)

## 源码与构建

| 路径 | 职责 |
| --- | --- |
| `src/host-api.ts` | 三个入口用到的宿主公共类型 |
| `src/shared/config.ts` / `sync.ts` | 版本迁移、导入边界、草稿合并、唯一写入口、通知 |
| `src/shared/palette.ts` / `effects.ts` | 语义色、标记、昼夜调度、实例临时种子与轮换 |
| `src/shared/media-db.ts` / `rotation.ts` | 原始 Blob、素材索引、同源游标事务 |
| `src/shared/font-loader.ts` / `video.ts` | 本端字体注册、视频帧解码与释放 |
| `src/render/` | 五种构图、照片/视频/生成背景, 缩放、合成与回收 |
| `src/desktop/` / `src/web/` | 宿主锚点、样式映射、事件与热清理 |
| `src/page/` | 双语 DOM 管理页、色轮与吸管、素材库、档案交互 |
| `scripts/` / `tests/` | 构建门槛、回归、归档与摘要 |

使用 Node 24、pnpm 10.32.1 和 Python 3。将 `CH_REFERENCE_DIR` 设为独立参考目录，其中存在 v0.26.0 官方源码构建的 `packages/shared-contracts/dist/host-extensions.js`。可在该标签的独立副本内按宿主构建流程生成共享契约，也可只编译官方 `host-extensions.ts` 与其运行时依赖 `desktop-extensions.ts`、`harness-plugins.ts` 和 `ids.ts`。保留模块路径并使用 Zod 4.4.3。

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run manifest
pnpm run build
pnpm run verify
pnpm run package
```

esbuild 三次构建均关闭拆分和 source map。Desktop 是同步注册的经典脚本，Page 和 Web 是单文件 ESM。`build.mjs` 拼接 Host 标记规则，并对 Desktop 设置壳的局部 CSS 使用文本 loader。`verify.mjs` 校验实际 JS、清单、CSS、VM 注册及反例。JS 项目预算 512 KiB，宿主硬限 2 MiB。CSS 硬限 256 KiB。Python 标准库打包时检查根名集、大小、CRC、内容摘要和最终 SHA-256。

`dist/` 与 ZIP 固定八个文件，`manifest.json`、`LICENSE`、`page.mjs`、`page.css`、`desktop.js`、`desktop.css`、`web.mjs`、`web.css`。`dist/`、`release/` 和本地验收素材可重建。正式 ZIP 位于 `release/theme-background-1.0.0.zip`，摘要位于同名 `.zip.sha256`。

## 隔离实测

1. 记录实际 Host、Chromium、WebView2、Electron 版本和 ZIP 摘要。为 Host 建独立临时 `CODEXHOST_DATA_DIR`，清除测试子进程继承的 `CODEXHOST_RUNTIME_*` 和 `CODEXHOST_THREAD_ID`。选未占用的回环端口和全新 Chrome 用户目录。
2. 使用本机 npm 全局安装的版本执行 `codexhost.exe web`，向原生启动器传入打包的 `--node`、`--host-runtime` 与 `--web-runtime`。使用测试实例给出的本地登录链接和默认鉴权。可在子进程环境设置 `SSH_CONNECTION`，让启动器打印链接而不自动打开浏览器。
3. 在独立 Chrome 的插件中心上传正式 ZIP 并启用，仅启用 `theme-background`。用第二个浏览器配置或 origin 验证媒体缺件与同 UUID 关联。WebView2 和 Desktop 用独立 OS 测试账号或 VM，并连接同一测试 Host。只读检查测试实例的 `settings.json` 与进程树。
4. 按 [验收矩阵](DELIVERY.md) 记录通过、失败、未测项目和证据。用显式临时数据目录调用 `web-service stop` 与 `host stop`，核对测试 PID 退出、测试端口释放，再删除该临时目录。

项目测试期间保持 `E:\tools\codex-host` 只读，用户 4400 服务与当前 Desktop 不用于验收。`npm stop`、全局 `codexhost stop` 和会替换用户 Desktop 的启动方式不适用于这里。
