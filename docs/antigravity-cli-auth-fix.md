# 本机 agy 额度认证修复（2026-11-05）

## 原因与现状

本机悬浮球为 `~/.local/lib/codeburn-menubar/0.9.27-local-20261016/codeburn-menubar`，配套 CLI 由 `~/.local/bin/codeburn-dock` 的 `CODEBURN_BIN` 指定。独立 Electron 应用 `/opt/CodeBurn` 不是这次悬浮球的运行入口。

运行中的 agy 为 CLI 1.4.12。CodeBurn 已能发现其进程与监听端口，但仍按旧版 CLI 无需令牌的方式调用接口。`RetrieveUserQuotaSummary` 和 `GetUserStatus` 实测均返回 `401 unauthenticated: missing CSRF token`。使用其工具子进程环境中的本地令牌后，两接口均返回 200，得到 Google AI Pro 和四个额度窗口。

Clash 当前规则正常：Google、googleapis、Antigravity 等域名属于 `🤖 Gemini`，组候选为固定台湾 02 与 REJECT，当前选择台湾 02；实际 cloudcode/aicode 连接也命中该组。本次未改代理规则、出口、OAuth 登录或 Google 账户。

## 修改与安装

- CLI 与 Electron 源码增加 Linux 本地 RPC 认证发现。只读取目标 agy 的后代进程环境，验证回环地址、目标进程监听端口及进程启动时间。
- 本地令牌存放在 `/run/user/<uid>/codeburn-antigravity/<pid>.json`，目录 0700、文件 0600；PID 被复用时失效，注销或重启后清除。没有保存 OAuth 令牌或聊天内容。
- `scripts/record-agy-local-auth.mjs` 复用已有 Antigravity 生命周期 hook，在 SessionStart / PreInvocation 保存本地令牌，避免依赖额度轮询恰好撞上短时工具子进程。hook 不读取聊天 stdin，只输出空 JSON；异常不影响 agy。
- 本机 `~/.gemini/config/hooks.json` 追加 `codeburn-local-quota`；原 `herdr`、`orca-status` 保留。备份为同目录 `hooks.json.before-codeburn-agy-20261105`。脚本安装到上述 menubar 安装目录。
- 悬浮球配套 CLI 的 `dist/main.js` 与 source map 已替换。原文件在 `cli/backup-agy-auth-20261105/`。悬浮球每次刷新都会启动 CLI，无需重启悬浮球。独立 Electron 安装未替换。

## 验证结果

- 认证发现、双份额度解析共 30 项测试通过；覆盖其他进程凭据、非回环地址、错误端口、子进程退出后复用缓存、PID 复用和权限。
- CLI 构建通过，hook 语法检查与空环境执行通过，`git diff --check` 通过。
- 实际启动 hook 子进程、写入临时运行态缓存、子进程退出、发起真实回环 HTTP RPC 的集成验证通过，解析出四个窗口；使用测试令牌，已删除测试运行态文件。
- Electron 整体构建因本地缺少 electron / electron-updater 依赖失败；未为此次悬浮球修复安装整套依赖。
- 当前 agy 后续产生了新的工具子进程，真实本地令牌已自动发现并缓存。源码读取器实测 `connected`；进一步使用正在运行的悬浮球进程的原环境执行其已安装 CLI，退出码 0，Antigravity 返回 `available: true`、`Google AI Pro` 和四个窗口。Gemini 周额度已用 12.4%、五小时 16.1%；Claude/GPT 周额度已用 51.7%、五小时 0%。
- 当前 agy、悬浮球、Clash 均未重启。悬浮球会在下一轮额度刷新采用结果；未进行屏幕截图验收。

回退只需恢复安装目录的两份 CLI 备份，并从全局 hooks.json 移除 `codeburn-local-quota` 条目；其他 hook 不动。
