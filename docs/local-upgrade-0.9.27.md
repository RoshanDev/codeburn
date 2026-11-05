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



## 2026-11-05：同步上游 main

用户要求保留自己的定制，保存并同步上游变动后重新编译出包。

- 上游正式发布仍为 `v0.9.27`；本次采用 `origin/main` 的 `9c4eda25`，比该标签多 89 个提交，不标称新的正式发布版。
- 此前本地 `5c159802`（悬浮球避免持续挤成 1 像素）未推送；新增 agy 本地认证修复已提交为 `594925aa`。
- 合并提交 `e644fef1` 已推送到 `fork/linux-capacity-dock`。保留既有 Linux 托盘、缩放、贴边、拖动、悬停、Today / 周期统计及 agy 认证修改。
- 唯一文本冲突是 `windows/src-tauri/Cargo.lock`：采用上游锁文件并由 Cargo 补入当前 Linux 配置需要的 gtk-layer-shell 依赖；未删除本地平台依赖。
- 构建主机仍为 Ubuntu 26.04.1 amd64。东芝挂载 UUID 核对为 `69b29b18-69f8-4d32-9e37-d491c08d181d`，构建根目录为 `/run/media/roshan/TOSHIBA4T/work/codeburn-build/20261105-upstream-9c4eda25/`。
- 构建单元 `codeburn-build-20261105.service`；复现脚本 `build.sh`、固定源码副本 `source/`、日志 `build.log`、源码身份 `build-info.json` 均在该构建目录。
- 目标交付：Linux deb、AppImage、menubar 原始程序、配套 CLI 运行包与 SHA256 校验和；本地产物不生成上游签名的自动更新文件。
- 初次测试临时目录也放在东芝盘时，Antigravity SQLite 样例的同步写等待机械盘日志提交，测试进程长期阻塞。终止该轮测试后，从测试步骤续跑，Node 测试的 `TMPDIR` 改为 `/run/user/1000/codeburn-build-tests-20261105`；源码、编译缓存和安装包仍在东芝盘，已成功的 CLI / 前端构建复用。
- 续跑入口 `resume.sh`、日志 `resume.log`，复用同名 systemd 单元。相关测试 26 个文件、349 项全部通过（7.67 秒）；Rust release 测试 174 项全部通过（串行执行，14.00 秒）。
- 构建单元最终 `Result=success`、`ExecMainStatus=0`。CLI、统计网页、悬浮球前端和原生 release 程序构建均通过。
- 最终产物在构建目录的 `artifacts/`：`CodeBurn-Menubar-0.9.27-main-9c4eda25-linux-amd64.deb`（9.19 MiB）、同名 `.AppImage`（90.28 MiB）、`codeburn-cli-0.9.27-main-9c4eda25-linux-x64.tar.gz`（9.75 MiB）、原始程序、agy hook 脚本、README、build-info 与 SHA256SUMS。
- deb 元数据确认包名 `code-burn-menubar`、版本 `0.9.27`、架构 `amd64`；CLI 运行包通过 gzip 完整性检查，启动后 `--version` 为 `0.9.27`，7 个交付文件的 SHA256 校验通过。
- 使用当前悬浮球的原环境执行新 CLI 的 `quota --format json`，退出码 0；Antigravity 返回 `available: true`、Google AI Pro 和四个额度窗口。
- 本次交付为 Linux Tauri 悬浮球包与配套 CLI，不是 `/opt/CodeBurn` 独立 Electron 桌面应用包。deb / AppImage 不内嵌 CLI，需搭配同目录 CLI 运行包并沿用现有启动器的代理保护与 `CODEBURN_BIN` 方式。
- 本轮没有安装这些包、没有替换当前运行程序，也没有进行新二进制的界面操作验收；旧安装与启动器保留。版本仍为 0.9.27，通过产物文件名、build-info 中的源码提交区分本地 main 构建与上游正式包。


### 重启核对（2026-11-05）

用户要求重启 CodeBurn 并检查 0.9.27 更新提示。本次只重启现有安装，未安装上面的新构建包。

- 定制悬浮球继续使用 `~/.local/lib/codeburn-menubar/0.9.27-local-20261016/`；重启后存活。
- 独立 Electron 桌面版 `/opt/CodeBurn/resources/app.asar` 的 package.json 实际为 **0.9.25**，此前没有随悬浮球升级。
- 第一次重启桌面版因复用的进程环境缺少 DISPLAY / 图形会话参数而启动失败；随后补齐 HOME、DISPLAY、Wayland、XDG_RUNTIME_DIR 和会话总线，使用 `--ozone-platform=wayland` 恢复启动。不是新构建包崩溃。
- 应用自身 `getUpdateStatus()` 返回 `currentVersion=0.9.25`、`latestVersion=0.9.27`、`updateAvailable=true`；实际界面显示 `Update available: CodeBurn 0.9.27 · Download`。这是独立桌面版的有效更新提示。
- 临时回环调试端口仅用于读取应用状态，核对后再次按无调试参数方式启动；未安装桌面更新、未隐藏更新提示。
- 本机证据：`~/.cache/codeburn/restart-check-20261105/` 内的状态、日志和更新提示截图。


### 独立桌面版升级（2026-11-05）

用户随后明确要求升级独立桌面版，已使用相同的 `e644fef1` 源码构建并安装。

- 构建与工件目录：`/run/media/roshan/TOSHIBA4T/work/codeburn-build/20261105-upstream-9c4eda25/desktop/`；入口 `build.sh`，日志 `build.log`，systemd 单元 `codeburn-desktop-build-20261105.service` 最终退出码 0。
- Electron 主进程、渲染界面、内置 CLI 均构建成功；桌面相关测试 19 个文件、473 项全部通过。内置 CLI staging 也通过 Electron-as-Node 的普通命令和 resident serve 两条路径验证。
- deb：`artifacts/CodeBurn-Desktop-0.9.27-main-9c4eda25-linux-amd64.deb`，109.72 MiB；包名 `codeburn-desktop`、版本 `0.9.27`、架构 amd64；SHA256 `b28b5f32cbdc86dda30e88951be6d60b50b8750b1bb693c9ab880b456430d4c1`。
- `apt-get install --simulate --no-install-recommends` 确认仅升级 CodeBurn，无新增、无卸载，再执行安装成功。没有安装与 ayatana 冲突的 libappindicator3-1 推荐包。
- `dpkg-query` 确认 `codeburn-desktop 0.9.27 install ok installed`；`/opt/CodeBurn/resources/app.asar` 的版本和内置 `resources/cli/package.json` 版本均为 0.9.27。
- 已重新加载 `/etc/apparmor.d/codeburn`；内核 aa-status 确认 `codeburn` profile 为 unconfined，带既有 userns 许可。没有修改全局 userns 策略。
- 启动命令 `/opt/CodeBurn/codeburn --ozone-platform=wayland`，补齐真实 HOME、DISPLAY、Wayland、XDG_RUNTIME_DIR、XAUTHORITY 与会话总线；保留代理环境，不继承悬浮球的 CODEBURN_BIN 覆盖值，让桌面使用自己的新内置 CLI。
- 菜单入口仍为 `/usr/share/applications/codeburn.desktop` 与既有用户入口 `~/.local/share/applications/codeburn.desktop`，两者 desktop-file-validate 通过。
- 运行中的新版应用实际返回 `currentVersion=0.9.27`、`latestVersion=0.9.27`、`updateAvailable=false`，界面 `.update-banner` 为空；内置 agy 读取返回 connected、Google AI Pro 和四个窗口。
- 临时回环调试端口核对后关闭；已按无调试参数方式启动并观察正常存活。原用户配置、账号和定制悬浮球进程保留，未安装或替换此前的 Tauri 构建包。
- 安装过程中发现旧 Electron 主进程会改写 argv，将命令行压成一个参数；只按 argv[0] 精确匹配会漏掉旧 GUI 主进程。以后退出 / 升级此应用时应按 `/proc/<pid>/exe` 身份核对，允许其显示 `(deleted)`，不要只停止 resident CLI。旧主进程已退出，单实例锁由新版接管。
- 本机运行证据：`~/.cache/codeburn/desktop-upgrade-20261105/verification.json`、`state.json` 与启动日志。
