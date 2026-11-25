# Theme Background 开发约定

运行协议见 [技术规格](docs/TECHNICAL_SPEC.md)，安装和验收见 [开发文档](docs/DEVELOPMENT.md) 与 [交付清单](docs/DELIVERY.md)。

| 改动 | 检查 |
| --- | --- |
| 配置、档案、导入与共享写入 | `src/shared/config.ts` 是归一化边界。只由 Page 写 Host。保留未知的 `values` 兄弟键、未来版本和未保存草稿。补 `config.test.ts` / `sync.test.ts`。 |
| 色板、底板或锚点 | 使用 Host 标记和清单 CSS。Desktop 设置壳采用可撤回的局部样式。处理清色、0 值、forced colors、内置层让位和底板单次合成。强制明暗时核对宿主按钮的文字与填充对比度。更新 `palette.test.ts`，跑 M02、M06、M13。 |
| 媒体、字体和动效 | 切源使旧代次失效，每个消费者只管理自己的 ObjectURL。IDB 事务完成后才广播。校验大小、格式和解码。补 `backdrop.test.ts`，跑 M04、M05、M09、M10、M12。 |
| 定时与事件 | Desktop 可见态 5 秒对账，Web 接收 Host 事件。单独 30 秒检查定时和时间档轮换。对账、focus 和 Page 挂载不推进 `reload`。回收观察器、定时器、监听和在途回调，跑 M03、M07、M10。 |
| 页面 | CSS 全部限定 `[data-tb-page]`，只使用八个页面令牌。弹层归属传入根。普通 DOM 和 Shadow DOM 核验中英文、键盘和焦点，复核异步吸管弹层关闭时归还焦点。 |
| 入口和交付 | Desktop 同步 `define`，Page/Web 各导出约定入口。构建三份单文件，`dist` 和 ZIP 根固定十二个文件（八核心文件 + 图标与三张预览图）。遵守 `scripts/verify.mjs` 字节、图片签名和语法限制。 |

在 Node 24、pnpm 10.32.1 和 Python 3 环境执行：

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run manifest
pnpm run build
pnpm run verify
pnpm run package
```

`CH_REFERENCE_DIR` 指向包含真实已构建 `shared-contracts` 的独立参考目录。执行交付清单中的双项残留扫描和 `git diff --check`，记录八文件大小、ZIP 摘要和验收环境。`dist/` 与 `release/` 可重建，不提交。

M01–M13 使用独立数据目录和浏览器配置。Desktop 需独立 OS 测试账户或 VM。禁止修改 `E:\tools\codex-host`、启动会替换用户 Desktop 的进程和执行全局停止命令。实际未跑的场景注明原因。修复新类型回归时同步更新自动断言和实测判据。
