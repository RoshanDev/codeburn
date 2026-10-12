# Linux 托盘恢复悬浮球（2026-10-12）

- 环境：本机 Ubuntu / GNOME，`windows` 下运行中的 Tauri dev 实例。
- 原因：隐藏 Capacity Dock 会持久化 `enabled: false`；Linux 托盘 Activate 只切换统计面板，没有恢复 Dock。
- 修改：Linux 主激活事件在 Dock 关闭时调用既有 `set_dock_enabled(true)`，保留统计面板的点击行为。连续激活不会关闭 Dock。
- 验证：已有 Tauri dev 进程自动编译成功并加载修改。初始配置为 `enabled: false`，通过运行实例的 `/StatusNotifierItem` 连续调用两次 `org.kde.StatusNotifierItem.Activate`，配置变为 `true`，日志记录 `codeburn dock: window created and shown`。`git diff --check` 通过。
- 验证范围：实际托盘 D-Bus 激活链路与窗口创建日志；未用物理鼠标复测 GNOME 顶栏双击，也未进行截图确认。Windows/macOS 路径未修改。
