# pxpipe-app：菜单栏 Popover 监控 + 上游 v0.8.0→HEAD 同步

- **日期**：2026-07-09
- **状态**：已获用户批准（brainstorming 会话）
- **版本目标**：`0.8.1` → `0.9.0`

## 1. 背景与目标

上游 `../pxpipe` 自 `7dd54d3`（release: v0.8.0）之后新增 15 个提交（`3f61348..b1f5a01`）。
pxpipe-app 通过 `"pxpipe-proxy": "file:../pxpipe"` 直接引用其 `src/`，typecheck 已验证无破坏。

两个目标：

1. **上游同步**：让 app 的文档与行为口径跟上上游修复；
2. **菜单栏监控**：macOS 菜单栏右上角圆形图标，点击弹出监控 Popover。

## 2. 上游 15 个提交对 app 的影响

| 提交 | 影响 |
| --- | --- |
| `0e4a616` fix(applicability): match all proxy Anthropic message routes | 自动生效。`/anthropic/messages` 与 `/anthropic/v1/messages` 现在与代理路由一致；新导出 `isAnthropicMessagesPath`。README 需补路由说明 |
| `4c4b77c` / `6c14465` fix(openai): outgoingTextChars for Responses | 自动生效。GPT（Responses）路径的节省统计口径修正——app 展示的节省数字变准确。README 需补说明 |
| `27e60d0` / `6a5656f` fix(export): --git untracked filtering | app 未使用 export-collect，无影响 |
| `69c9f2e` fix(cli): --version | app 不调 CLI，无影响 |
| 其余（docs / eval / ci / tsconfig） | 无影响 |

**代码改动：无。** 工作量在文档 + 新功能。

## 3. 菜单栏监控设计

### 3.1 需求（用户确认）

- 呈现形式：**原生风格 Popover 面板**（挂在菜单栏图标下方，失焦自动收起）
- 图标：**单色模板圆环，状态区分**（运行中 = 圆环内实心点 ●；停止 = 空心圆环 ○）
- 面板内容：**代理状态 + 启停控制**、**实时节省概览**、**迷你趋势图**（不含最近请求列表）
- 实现路线：**`menubar` 库**（用户在 A/B/C 中选定 B）

### 3.2 Tray 与图标

- 仍由我们创建 `Tray`，作为 `menubar({ tray })` 传入，图标与右键行为完全自控
- 模板图像（`isTemplateImage = true`，自动适配深浅菜单栏）：
  - `resources/tray/ringTemplate.png` + `ringTemplate@2x.png`（18×18 / 36×36，空心圆环）
  - `resources/tray/ringDotTemplate.png` + `ringDotTemplate@2x.png`（圆环 + 实心点）
- 状态经现有 `pxpipe:status` 广播驱动 `tray.setImage()` 切换；`setToolTip` 保留现状
- **左键** → menubar 弹出 Popover；**右键** → 保留现有原生上下文菜单（启停 / Show pxpipe / Quit）：
  `showOnRightClick: false` + `tray.on('right-click', () => tray.popUpContextMenu(menu))`
- ⚠️ **必须移除现有 `tray.setContextMenu(...)` 调用**：macOS 上设置了 context menu 的 Tray
  左键也会弹菜单，会吞掉 menubar 的左键 Popover。改为 `updateTray()` 只重建 `Menu` 对象持有，
  仅在 `right-click` 时 `popUpContextMenu`
- 仅 `darwin` 启用（沿用现有 `createTray` 判断）

### 3.3 Popover 窗口（menubar）

- 新依赖：`menubar`（内部 electron-positioner 负责定位与失焦隐藏）
- `browserWindow` 选项：`width: 360, height: 440`、`frame: false`、`resizable: false`、
  menubar 默认 `alwaysOnTop` 与 blur 隐藏
- `index`：现有 renderer URL + `#/popover` hash；App.tsx 顶层按 `location.hash` 分流
  主窗口视图 / Popover 视图，**复用全部 preload、IPC、i18n（en/zh）**，不新建入口
- 关键配置：`showDockIcon: true`（主窗口仍需 Dock 存在，避免 menubar 默认 `app.dock.hide()`）

### 3.4 面板布局（自上而下）

1. **状态头**：状态圆点 + `运行中 · http://127.0.0.1:47821` / `已停止`；「启动/停止」按钮；
   「图片压缩」开关 —— 复用现有 start/stop/toggle IPC，与主窗口经广播保持同步
2. **节省概览**：三张数字卡片 —— 今日节省 tokens、节省百分比、估算节省费用（按现有 pricing 逻辑）
3. **迷你趋势图**：最近 24 小时逐小时「请求数 + 节省 tokens」双 sparkline，内联 SVG 手绘组件
   （约 40 行），零图表库依赖
4. **底部**：「打开主窗口」（复用 `showMainWindow`）+ 退出

### 3.5 数据链路

- 新 IPC `pxpipe:popoverStats`（main → SQLite 一次聚合）：

  ```ts
  {
    today: { savedTokens: number; savedPct: number; savedCost: number }
    series: Array<{ hourStart: number; requests: number; savedTokens: number }> // 24 桶
  }
  ```

- 边界：今日无请求时 `savedPct` 返回 `0`（避免除零 NaN）；空 `series` 时 sparkline 渲染占位基线

- 刷新策略：menubar `show` 事件 → 通知 renderer 重新拉取；展开期间跟随现有事件广播增量刷新；
  收起后零开销

## 4. 文档与版本

- README.md / README.zh-CN.md：
  - 补充支持的 Anthropic 路由（`/v1/messages`、`/anthropic/v1/messages`、`/anthropic/messages`；
    `/v1/messages/count_tokens` 不做变换）
  - 补充 GPT（Responses）路径节省统计口径修正说明
  - 新增「菜单栏监控」功能介绍（Highlights + 使用说明）
- `package.json`：`0.8.1` → `0.9.0`

## 5. 验证

- `pnpm run typecheck` + `pnpm run lint`
- `pnpm dev` 冒烟：图标随启停切换 ●/○、深浅菜单栏适配、左键弹出/失焦收起、
  右键菜单保留、三卡片与 sparkline 数据正确、主窗口与 Popover 状态互通、i18n 双语

## 6. 明确不做

- 最近请求列表（用户未选）
- Windows / Linux tray 改造
- 原生 NSPopover（方案 C）、自绘定位窗口（方案 A）
- 图表库依赖
