# 本机 CodeBurn 0.9.27 合并更新（2026-10-16）

## 来源与保留范围

- 在 `linux-capacity-dock` 分支合并上游发布标签 `desktop-v0.9.27`（与 `v0.9.27` 树相同），不是直接用上游二进制覆盖。
- 原提交 `1ce60d020a2b` 保留在历史中，包含托盘恢复隐藏悬浮球；同时保留 Linux 缩放、贴边、拖动、悬停离开、图形命中区域、临时错误不要求重连、供应商 Today 与周期统计等修改。
- 冲突按功能合并：保留上游 Claude 多配置支持及 Cursor 企业额度，同时保留自定义统计。带配置名称的行按新行高命中，新增 Rust 回归断言；配置行不显示供应商汇总的周期统计。

## 构建与安装约定

- 东芝 UUID：`69b29b18-69f8-4d32-9e37-d491c08d181d`，挂载点 `/run/media/roshan/TOSHIBA4T`；本次核对为 ext4、可写、约 865 GB 可用。
- 构建副本、前端产物、临时文件、日志：`/run/media/roshan/TOSHIBA4T/work/codeburn-build/0.9.27/`。
- Rust target：`/run/media/roshan/TOSHIBA4T/work/codeburn-build/target`。
- 构建由用户 systemd 单元 `codeburn-build-0927.service` 持有，执行日志 `build.log`，完整复现入口 `rebuild.sh`（`build.sh` 为本次失败后的续跑入口）。
- 最终程序和配套 CLI 运行文件安装回笔记本；不让日常运行依赖东芝盘在线。
- 原程序 `~/.local/lib/codeburn-menubar/1ce60d020a2b/codeburn-menubar` 与原仓库 `dist` 保留用于回退。

## 验收结果

- CLI 与统计网页构建通过；悬浮球前端 TypeScript / Vite 构建通过。
- 额度与聚合测试：首次 250 通过、1 项因新增周期起始字段的预期不一致失败；更新企业额度断言后，Cursor 18 项全部通过。
- 新增合并兼容测试 4 项通过；与额度、聚合测试合计 255 项。
- Rust release 测试：170 项首次通过，1 项上游设置锁时序测试在并行执行下失败，单独串行复测通过；新增带配置名称行高的命中断言通过。
- Tauri release 构建成功；笔记本安装文件 SHA256 与东芝构建文件相同：`cd6bf60b13ca8ae8b820b86839695fa6ab28f539968dcf9f42e74f9b9040f12d`。
- 安装目录：`~/.local/lib/codeburn-menubar/0.9.27-local-20261016/`，含程序和 `cli/`（配套 dist、package、生产依赖）。CLI `--version` 实测为 `0.9.27`。
- `~/.local/bin/codeburn-dock` 已指向新程序及新 CLI；菜单和自启动仍复用此入口。旧启动器保存在新安装目录的 `codeburn-dock.previous`。
- 实际隐藏验证：将 enabled 关闭并让运行实例重读设置后，X11 窗口列表中 Dock 消失；连续调用两次实际 SNI Activate 后 enabled 恢复 true，Dock 窗口重新创建。
- vmouse 原生输入验证：悬停展开供应商列表与卡片，移出后卡片收起；右侧贴边拖动后位置保存且球仍可见。验收后已恢复原位置。
- 窗口截图确认 Codex 的 Today、This cycle、Weekly 数值正常显示；Cursor 与 Grok Bot 正常显示额度。Claude / Grok 接口在部分刷新中出现临时失败，界面显示重试状态，未改账号或登录配置。
- 本次未遍历所有边和角、未测试所有 Claude 多配置账号；未更新另一个独立安装的 Electron 桌面应用。
- 截图及构建日志保留在东芝构建目录，不随源码提交。

## 回退

新旧程序不能同时运行。需要回退时先退出新版，再把 `codeburn-dock.previous` 复制回 `~/.local/bin/codeburn-dock` 并重新启动。旧脚本使用原 0.9.25 release 程序和保留的仓库 `dist/cli.js`。本次没有改写这些旧运行文件。

