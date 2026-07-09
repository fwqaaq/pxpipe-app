# Implementation Plan: macOS Menu Bar Popover Monitor + Upstream Sync

> **Design doc:** `specs/2026-07-09-menubar-popover-monitor/design.md` (approved)
> **Audience:** an engineer with zero context for this codebase. Follow tasks in order; each task ends with verification and a commit.

## Goal

1. Finish syncing pxpipe-app with the 15 new upstream commits in `~/Project/pxpipe` (docs + version bump; dependency install and typecheck were already done).
2. Add a macOS menu-bar monitor: a **circular (ring) template icon** in the tray; **left-click opens a popover** (via the `menubar` library) showing proxy status, start/stop and compression toggles, today's savings stats, and a 24 h sparkline; **right-click keeps the existing context menu**.

## Global constraints

- Tray/popover is **darwin-only** (existing `createTray()` already guards on `process.platform === 'darwin'` — keep that).
- **No chart libraries.** Sparkline is hand-rolled SVG. The only new runtime dep is `menubar`; the only new dev dep is `vitest`.
- Package manager is **pnpm**. Run everything from `/Users/fwqaaq/Project/pxpipe-app`.
- Icons must be macOS **template images** (pure black + alpha) so they adapt to light/dark menu bars.
- Reuse existing IPC style (`pxpipe:*` channels in `src/main/index.ts` `registerIpc()`, api object in `src/preload/index.ts`, types in `src/shared/types.ts`) and the existing i18n system (`src/renderer/src/i18n/`).
- Verification commands: `pnpm typecheck`, `pnpm lint`, `pnpm test` (added in Task 2), `pnpm dev` for manual smoke.

---

## Task 1 — Upstream sync finalization: README notes + version bump

**Files to modify:** `README.md`, `README.zh-CN.md`, `package.json`

The code-level sync (pnpm install against `file:../pxpipe`, typecheck) is already done. What remains is documenting two upstream behavior changes and bumping the app version.

### Steps

1. `README.md` — in the **How it works** section, after the paragraph that explains clients pointing at the local proxy, append this paragraph:

   ```markdown
   The proxy now forwards any unrecognized API path directly to the upstream
   provider (pass-through routing), so non-chat endpoints keep working when a
   client is pointed at pxpipe.
   ```

2. `README.md` — in the **Model compatibility** section, append:

   ```markdown
   > Note: savings statistics on the GPT (Responses) path exclude image base64
   > payloads from outgoing text accounting, so displayed savings are accurate.
   ```

3. `README.zh-CN.md` — mirror both notes. Under `## 工作原理` (line ~23) append:

   ```markdown
   代理现在会把无法识别的 API 路径直接透传给上游（pass-through 路由），因此客户端指向
   pxpipe 时，非聊天类端点也能正常工作。
   ```

   Under `## 模型兼容性与图片效果` (line ~47) append:

   ```markdown
   > 注：GPT（Responses）路径的节省统计已排除图片 base64 内容，展示的节省数据是准确的。
   ```

4. `package.json` — change `"version": "0.8.1"` → `"version": "0.9.0"`.
5. If any of these edits already exist (partial earlier sync), skip the duplicates.

### Verify

```sh
pnpm typecheck && pnpm lint
```

### Commit

```
docs: document upstream pass-through routing and GPT savings accounting; bump to 0.9.0
```

---

## Task 2 — Pure stats module + vitest infrastructure (TDD)

**Files to create:** `src/main/popover-stats.ts`, `tests/popover-stats.test.ts`, `vitest.config.ts`
**Files to modify:** `package.json`, `src/shared/types.ts`

Design decision: the SQL stays trivial inside `AppDatabase` (Task 3); all bucketing/percent math lives in a **pure function over pre-queried rows** so it is testable under plain Node. (Do **not** import `better-sqlite3` in tests — it is rebuilt for Electron's ABI by the postinstall hook and will not load under Node's vitest.)

### Steps

1. Install vitest and add a script:

   ```sh
   pnpm add -D vitest
   ```

   In `package.json` scripts, add: `"test": "vitest run"`.

2. Create `vitest.config.ts`:

   ```ts
   import { defineConfig } from 'vitest/config'

   export default defineConfig({
     test: {
       include: ['tests/**/*.test.ts']
     }
   })
   ```

   (The `tests/` dir is intentionally outside both tsconfig `include` lists; vitest transpiles TS itself.)

3. Add the payload type to `src/shared/types.ts` (near the other `*Payload` interfaces):

   ```ts
   export interface PopoverStatsPayload {
     today: {
       requests: number
       savedTokens: number
       savedPct: number
     }
     series: Array<{
       hourStart: number
       requests: number
       savedTokens: number
     }>
   }
   ```

4. Write the failing test first — `tests/popover-stats.test.ts`:

   ```ts
   import { describe, expect, it } from 'vitest'
   import { computePopoverStats, type PopoverEventRow } from '../src/main/popover-stats'

   // Local-time construction keeps "midnight" deterministic across timezones.
   const now = new Date(2026, 6, 9, 12, 0, 0)

   function row(msAgo: number, saved: number | null, baseline: number | null): PopoverEventRow {
     return {
       ts: new Date(now.getTime() - msAgo).toISOString(),
       estimatedSavedTokens: saved,
       baselineTokens: baseline
     }
   }

   describe('computePopoverStats', () => {
     it('returns zeros and 24 empty buckets for no rows', () => {
       const stats = computePopoverStats([], now)
       expect(stats.today).toEqual({ requests: 0, savedTokens: 0, savedPct: 0 })
       expect(stats.series).toHaveLength(24)
       expect(stats.series.every((b) => b.requests === 0 && b.savedTokens === 0)).toBe(true)
     })

     it('aggregates today totals and the current hour bucket', () => {
       const rows = [row(30 * 60 * 1000, 100, 400), row(31 * 60 * 1000, 50, 100)]
       const stats = computePopoverStats(rows, now)
       expect(stats.today.requests).toBe(2)
       expect(stats.today.savedTokens).toBe(150)
       expect(stats.today.savedPct).toBeCloseTo(30) // 150 / 500 * 100
       const last = stats.series[23]
       expect(last.requests).toBe(2)
       expect(last.savedTokens).toBe(150)
     })

     it('buckets an event from 3 hours ago into series[20] but still counts it today', () => {
       const stats = computePopoverStats([row(3 * 3600 * 1000, 10, 100)], now)
       expect(stats.series[20].requests).toBe(1)
       expect(stats.today.requests).toBe(1) // now is local noon, 3h ago is same day
     })

     it('ignores rows older than 24h and rows with unparsable ts', () => {
       const rows = [row(30 * 3600 * 1000, 999, 999), { ts: 'nope', estimatedSavedTokens: 1, baselineTokens: 1 }]
       const stats = computePopoverStats(rows, now)
       expect(stats.today.requests).toBe(0)
       expect(stats.series.every((b) => b.requests === 0)).toBe(true)
     })

     it('treats null tokens as 0 and guards divide-by-zero', () => {
       const stats = computePopoverStats([row(60 * 1000, null, null)], now)
       expect(stats.today).toEqual({ requests: 1, savedTokens: 0, savedPct: 0 })
     })

     it('series hourStart values are consecutive hours ending at the current hour', () => {
       const stats = computePopoverStats([], now)
       const hour = 3_600_000
       const currentHourStart = Math.floor(now.getTime() / hour) * hour
       expect(stats.series[23].hourStart).toBe(currentHourStart)
       expect(stats.series[0].hourStart).toBe(currentHourStart - 23 * hour)
     })
   })
   ```

   Run `pnpm test` — it must fail (module missing).

5. Implement `src/main/popover-stats.ts`:

   ```ts
   import type { PopoverStatsPayload } from '../shared/types'

   export interface PopoverEventRow {
     ts: string
     estimatedSavedTokens: number | null
     baselineTokens: number | null
   }

   const HOUR_MS = 3_600_000

   export function computePopoverStats(
     rows: PopoverEventRow[],
     now: Date = new Date()
   ): PopoverStatsPayload {
     const currentHourStart = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS
     const firstHourStart = currentHourStart - 23 * HOUR_MS
     const series = Array.from({ length: 24 }, (_, i) => ({
       hourStart: firstHourStart + i * HOUR_MS,
       requests: 0,
       savedTokens: 0
     }))

     const midnight = new Date(now)
     midnight.setHours(0, 0, 0, 0)
     const midnightMs = midnight.getTime()

     let todayRequests = 0
     let todaySaved = 0
     let todayBaseline = 0

     for (const row of rows) {
       const t = Date.parse(row.ts)
       if (!Number.isFinite(t) || t > now.getTime()) continue
       const bucket = Math.floor((t - firstHourStart) / HOUR_MS)
       if (bucket >= 0 && bucket < 24) {
         series[bucket].requests += 1
         series[bucket].savedTokens += row.estimatedSavedTokens ?? 0
       }
       if (t >= midnightMs) {
         todayRequests += 1
         todaySaved += row.estimatedSavedTokens ?? 0
         todayBaseline += row.baselineTokens ?? 0
       }
     }

     return {
       today: {
         requests: todayRequests,
         savedTokens: todaySaved,
         savedPct: todayBaseline === 0 ? 0 : (todaySaved / todayBaseline) * 100
       },
       series
     }
   }
   ```

### Verify

```sh
pnpm test && pnpm typecheck && pnpm lint
```

### Commit

```
feat(main): add pure popover stats aggregation with vitest coverage
```

---

## Task 3 — DB query + IPC + preload wiring

**Files to modify:** `src/main/database.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`

### Steps

1. `src/main/database.ts` — in `export class AppDatabase` (line ~246), add a read method next to the other query methods. Column names follow the existing `events` table schema (`ts`, `estimated_saved_tokens`, `baseline_tokens` — confirm with `rg "estimated_saved_tokens" src/main/database.ts` and adjust aliases if the schema differs):

   ```ts
   getPopoverStats(now: Date = new Date()): PopoverStatsPayload {
     const since = new Date(now.getTime() - 24 * 3_600_000).toISOString()
     const rows = this.db
       .prepare(
         `SELECT ts,
                 estimated_saved_tokens AS estimatedSavedTokens,
                 baseline_tokens AS baselineTokens
          FROM events
          WHERE ts >= ?
          ORDER BY ts ASC`
       )
       .all(since) as PopoverEventRow[]
     return computePopoverStats(rows, now)
   }
   ```

   Add imports at the top of the file:

   ```ts
   import { computePopoverStats, type PopoverEventRow } from './popover-stats'
   ```

   and add `PopoverStatsPayload` to the existing `../shared/types` type import.

2. `src/shared/types.ts` — extend `PxpipeDesktopApi` with:

   ```ts
   getPopoverStats: () => Promise<PopoverStatsPayload>
   showMainWindow: () => Promise<void>
   quitApp: () => Promise<void>
   onPopoverShow: (callback: () => void) => () => void
   ```

3. `src/main/index.ts` — inside `registerIpc()` add, following the existing `ipcMain.handle('pxpipe:...')` style:

   ```ts
   ipcMain.handle('pxpipe:getPopoverStats', () => db.getPopoverStats())
   ipcMain.handle('pxpipe:showMainWindow', () => {
     showMainWindow()
   })
   ipcMain.handle('pxpipe:quitApp', () => {
     app.quit()
   })
   ```

   (Task 5 will amend `pxpipe:showMainWindow` to also hide the popover.)

4. `src/preload/index.ts` — in the exposed `pxpipe` api object, add (mirroring the existing `onProxyStatus` unsubscribe pattern):

   ```ts
   getPopoverStats: () => ipcRenderer.invoke('pxpipe:getPopoverStats'),
   showMainWindow: () => ipcRenderer.invoke('pxpipe:showMainWindow'),
   quitApp: () => ipcRenderer.invoke('pxpipe:quitApp'),
   onPopoverShow: (callback: () => void) => {
     const listener = (): void => callback()
     ipcRenderer.on('pxpipe:popoverShow', listener)
     return () => {
       ipcRenderer.removeListener('pxpipe:popoverShow', listener)
     }
   }
   ```

   (`src/preload/index.d.ts` needs no change — it already types `window.pxpipe` as `PxpipeDesktopApi`.)

### Verify

```sh
pnpm test && pnpm typecheck && pnpm lint
```

### Commit

```
feat(ipc): expose popover stats, show-main-window and quit over pxpipe IPC
```

---

## Task 4 — Circular tray template icons (generated, zero-dep)

**Files to create:** `scripts/gen-tray-icons.mjs`, `resources/tray/ringTemplate.png`, `resources/tray/ringTemplate@2x.png`, `resources/tray/ringDotTemplate.png`, `resources/tray/ringDotTemplate@2x.png`

Ring = proxy stopped; ring + center dot = proxy running. Pure black + anti-aliased alpha → valid macOS template images. The generator is a one-off script with **no dependencies** (hand-rolled PNG encoder over `node:zlib`); the generated PNGs are committed.

### Steps

1. Create `scripts/gen-tray-icons.mjs`:

   ```js
   import { deflateSync } from 'node:zlib'
   import { mkdirSync, writeFileSync } from 'node:fs'
   import { dirname, join } from 'node:path'
   import { fileURLToPath } from 'node:url'

   const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'tray')

   let crcTable
   function crc32(buf) {
     if (!crcTable) {
       crcTable = new Int32Array(256)
       for (let n = 0; n < 256; n++) {
         let c = n
         for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
         crcTable[n] = c
       }
     }
     let crc = -1
     for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff]
     return (crc ^ -1) >>> 0
   }

   function chunk(type, data) {
     const out = Buffer.alloc(8 + data.length + 4)
     out.writeUInt32BE(data.length, 0)
     out.write(type, 4, 'ascii')
     data.copy(out, 8)
     out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
     return out
   }

   function encodePng(size, rgba) {
     const ihdr = Buffer.alloc(13)
     ihdr.writeUInt32BE(size, 0)
     ihdr.writeUInt32BE(size, 4)
     ihdr[8] = 8 // bit depth
     ihdr[9] = 6 // color type: RGBA
     const stride = size * 4 + 1
     const raw = Buffer.alloc(size * stride)
     for (let y = 0; y < size; y++) {
       raw[y * stride] = 0 // filter: none
       rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
     }
     return Buffer.concat([
       Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
       chunk('IHDR', ihdr),
       chunk('IDAT', deflateSync(raw)),
       chunk('IEND', Buffer.alloc(0))
     ])
   }

   /** 4x4 supersampled coverage → anti-aliased ring (and optional center dot). */
   function drawIcon(size, withDot) {
     const rgba = Buffer.alloc(size * size * 4)
     const c = (size - 1) / 2
     const outer = size * 0.44
     const inner = size * 0.3
     const dot = size * 0.16
     const S = 4
     for (let y = 0; y < size; y++) {
       for (let x = 0; x < size; x++) {
         let hits = 0
         for (let sy = 0; sy < S; sy++) {
           for (let sx = 0; sx < S; sx++) {
             const d = Math.hypot(x + (sx + 0.5) / S - 0.5 - c, y + (sy + 0.5) / S - 0.5 - c)
             if ((d <= outer && d >= inner) || (withDot && d <= dot)) hits++
           }
         }
         const i = (y * size + x) * 4
         rgba[i + 3] = Math.round((hits / (S * S)) * 255) // black stays 0,0,0
       }
     }
     return rgba
   }

   mkdirSync(outDir, { recursive: true })
   for (const [name, withDot] of [
     ['ringTemplate', false],
     ['ringDotTemplate', true]
   ]) {
     for (const [suffix, size] of [
       ['', 18],
       ['@2x', 36]
     ]) {
       const file = join(outDir, `${name}${suffix}.png`)
       writeFileSync(file, encodePng(size, drawIcon(size, withDot)))
       console.log('wrote', file)
     }
   }
   ```

2. Run it and commit the outputs:

   ```sh
   node scripts/gen-tray-icons.mjs
   ```

### Verify

```sh
file resources/tray/*.png
```

Expected: four PNGs — `ringTemplate.png` / `ringDotTemplate.png` at `18 x 18`, the `@2x` variants at `36 x 36`, all `8-bit/color RGBA`. Optionally `open resources/tray` and eyeball the ring/dot shapes.

### Commit

```
feat(assets): add circular template tray icons + zero-dep generator script
```

---

## Task 5 — menubar integration in the main process

**Files to modify:** `package.json` (dep), `src/main/index.ts`

Left-click on the tray now toggles a popover window (managed by `menubar`); right-click shows the old context menu via `popUpContextMenu`. The icon becomes the ring (stopped) / ring-dot (running) template image.

### Steps

1. ```sh
   pnpm add menubar
   ```

2. `src/main/index.ts` — add imports:

   ```ts
   import { menubar, type Menubar } from 'menubar'
   import ringIcon from '../../resources/tray/ringTemplate.png?asset'
   import ringIcon2x from '../../resources/tray/ringTemplate@2x.png?asset'
   import ringDotIcon from '../../resources/tray/ringDotTemplate.png?asset'
   import ringDotIcon2x from '../../resources/tray/ringDotTemplate@2x.png?asset'
   ```

   Ensure `nativeImage` and the `NativeImage` type are imported from `'electron'`.

3. Add module-level state next to the existing `tray` variable:

   ```ts
   let mb: Menubar | null = null
   let trayMenu: Menu | null = null
   let trayIconRunning: NativeImage | null = null
   let trayIconStopped: NativeImage | null = null

   function trayImage(basePath: string, retinaPath: string): NativeImage {
     const img = nativeImage.createFromPath(basePath)
     img.addRepresentation({
       scaleFactor: 2,
       dataURL: nativeImage.createFromPath(retinaPath).toDataURL()
     })
     img.setTemplateImage(true)
     return img
   }
   ```

   (Explicit `addRepresentation` is required because electron-vite's `?asset` pipeline renames files, which breaks automatic `@2x` sibling detection.)

4. Rewrite `updateTray()`:
   - Replace the old title/square-icon logic with `tray.setImage(status.running ? trayIconRunning! : trayIconStopped!)`.
   - Keep building the same `Menu.buildFromTemplate([...])` items as today, but assign the result to `trayMenu` instead of calling `tray.setContextMenu(...)`.
   - Keep/set the tooltip: running → `` `pxpipe — ${status.url}` ``, stopped → `'pxpipe — stopped'`.

5. Rewrite `createTray()` (keep the darwin guard and idempotence):

   ```ts
   function createTray(): void {
     if (process.platform !== 'darwin' || tray) return
     trayIconRunning = trayImage(ringDotIcon, ringDotIcon2x)
     trayIconStopped = trayImage(ringIcon, ringIcon2x)
     tray = new Tray(trayIconStopped)
     tray.on('right-click', () => {
       if (trayMenu) tray?.popUpContextMenu(trayMenu)
     })
     updateTray()

     const popoverIndex =
       is.dev && process.env['ELECTRON_RENDERER_URL']
         ? `${process.env['ELECTRON_RENDERER_URL']}#/popover`
         : `file://${join(__dirname, '../renderer/index.html')}#/popover`

     mb = menubar({
       tray,
       index: popoverIndex,
       showDockIcon: true,
       showOnRightClick: false,
       preloadWindow: true,
       browserWindow: {
         width: 360,
         height: 440,
         resizable: false,
         movable: false,
         fullscreenable: false,
         backgroundColor: '#171717',
         webPreferences: {
           preload: join(__dirname, '../preload/index.js'),
           sandbox: false
         }
       }
     })
     mb.on('show', () => {
       mb?.window?.webContents.send('pxpipe:popoverShow')
     })
   }
   ```

   Remove any previous `tray.on('click', ...)` and `tray.setContextMenu(...)` calls — `menubar` owns left-click, we own right-click.

6. Amend the Task-3 handler so opening the main window closes the popover:

   ```ts
   ipcMain.handle('pxpipe:showMainWindow', () => {
     mb?.hideWindow()
     showMainWindow()
   })
   ```

7. Confirm the existing status-broadcast helper iterates `BrowserWindow.getAllWindows()` (it does), so the popover window receives `pxpipe:proxyStatus` / proxy event broadcasts with no extra wiring. Also confirm `window-all-closed` keeps the darwin no-quit branch.

### Verify

```sh
pnpm typecheck && pnpm lint && pnpm dev
```

Manual smoke (dev app): ring icon appears in the menu bar; left-click opens a small dark window (blank/`App` for now — renderer arrives in Task 6); click outside hides it; right-click shows the old context menu; starting the proxy from the main window switches the icon to ring-dot.

### Commit

```
feat(tray): circular template icon + menubar popover window, context menu on right-click
```

---

## Task 6 — Renderer popover view (TDD for sparkline math)

**Files to create:** `src/renderer/src/components/sparkline.ts`, `tests/sparkline.test.ts`, `src/renderer/src/components/Sparkline.tsx`, `src/renderer/src/PopoverApp.tsx`
**Files to modify:** `src/renderer/src/main.tsx`, `src/renderer/src/i18n/en.ts`, `src/renderer/src/i18n/zh.ts`

### Steps

1. Failing test first — `tests/sparkline.test.ts`:

   ```ts
   import { describe, expect, it } from 'vitest'
   import { sparklinePoints } from '../src/renderer/src/components/sparkline'

   describe('sparklinePoints', () => {
     it('returns empty string for no values', () => {
       expect(sparklinePoints([], 100, 40)).toBe('')
     })

     it('maps a flat zero series to the baseline', () => {
       const points = sparklinePoints([0, 0, 0], 100, 40)
       expect(points.split(' ')).toHaveLength(3)
       for (const p of points.split(' ')) expect(p.endsWith(',38')).toBe(true) // height - pad
     })

     it('maps max value to top pad and first/last x to the edges', () => {
       const points = sparklinePoints([0, 10], 100, 40).split(' ')
       expect(points[0]).toBe('2,38')
       expect(points[1]).toBe('98,2')
     })

     it('clamps negative values to the baseline', () => {
       const points = sparklinePoints([-5, 5], 100, 40).split(' ')
       expect(points[0]).toBe('2,38')
     })
   })
   ```

   `pnpm test` → the new file fails.

2. Implement `src/renderer/src/components/sparkline.ts`:

   ```ts
   export function sparklinePoints(
     values: number[],
     width: number,
     height: number,
     pad = 2
   ): string {
     if (values.length === 0) return ''
     const max = Math.max(...values, 1)
     const innerW = width - pad * 2
     const innerH = height - pad * 2
     const step = values.length > 1 ? innerW / (values.length - 1) : 0
     return values
       .map((v, i) => {
         const x = pad + i * step
         const y = pad + innerH - (Math.max(0, v) / max) * innerH
         return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
       })
       .join(' ')
   }
   ```

3. Create `src/renderer/src/components/Sparkline.tsx`:

   ```tsx
   import { sparklinePoints } from './sparkline'

   export function Sparkline({
     values,
     width = 312,
     height = 40,
     className
   }: {
     values: number[]
     width?: number
     height?: number
     className?: string
   }): React.JSX.Element {
     const points = sparklinePoints(values, width, height)
     return (
       <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className}>
         {points ? (
           <polyline
             points={points}
             fill="none"
             stroke="currentColor"
             strokeWidth="1.5"
             strokeLinejoin="round"
             strokeLinecap="round"
           />
         ) : (
           <line
             x1="2"
             y1={height - 2}
             x2={width - 2}
             y2={height - 2}
             stroke="currentColor"
             strokeWidth="1"
             opacity="0.4"
           />
         )}
       </svg>
     )
   }
   ```

4. i18n keys. In `src/renderer/src/i18n/en.ts`, insert after the existing `status.*` group:

   ```ts
   'popover.todaySaved': 'Saved today',
   'popover.savedPct': 'Saved %',
   'popover.savedCost': 'Est. saved',
   'popover.requests': 'Requests today',
   'popover.trend': 'Last 24 hours',
   'popover.trendRequests': 'Requests',
   'popover.trendSaved': 'Saved tokens',
   'popover.openMain': 'Open pxpipe',
   'popover.quit': 'Quit',
   ```

   In `src/renderer/src/i18n/zh.ts`, insert the same keys in the same spot:

   ```ts
   'popover.todaySaved': '今日节省',
   'popover.savedPct': '节省比例',
   'popover.savedCost': '估算省费',
   'popover.requests': '今日请求',
   'popover.trend': '最近 24 小时',
   'popover.trendRequests': '请求数',
   'popover.trendSaved': '节省 tokens',
   'popover.openMain': '打开主窗口',
   'popover.quit': '退出',
   ```

   (`zh` is typed `Messages = Record<MessageKey, string>`, so a missing zh key fails `pnpm typecheck` — that is the safety net.)

   Reused existing keys — do not duplicate: `status.running`, `status.stopped`, `status.start`, `status.stop`, `status.compression`.

5. Create `src/renderer/src/PopoverApp.tsx`:

   ```tsx
   import { useCallback, useEffect, useState } from 'react'
   import type { PopoverStatsPayload, ProxyStatsPayload, ProxyStatus } from '../../shared/types'
   import { I18nProvider, useI18n, type Lang } from './i18n'
   import { Sparkline } from './components/Sparkline'

   const EMPTY_STATS: PopoverStatsPayload = {
     today: { requests: 0, savedTokens: 0, savedPct: 0 },
     series: []
   }

   function fmtCompact(value: number, locale: string): string {
     return new Intl.NumberFormat(locale, {
       notation: 'compact',
       maximumFractionDigits: 1
     }).format(value)
   }

   function StatCard({ label, value }: { label: string; value: string }): React.JSX.Element {
     return (
       <div className="rounded-lg bg-neutral-800/80 px-2.5 py-2">
         <div className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</div>
         <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
       </div>
     )
   }

   function PopoverContent(): React.JSX.Element {
     const { t, locale } = useI18n()
     const [status, setStatus] = useState<ProxyStatus | null>(null)
     const [stats, setStats] = useState<PopoverStatsPayload>(EMPTY_STATS)
     const [proxyStats, setProxyStats] = useState<ProxyStatsPayload | null>(null)
     const [busy, setBusy] = useState(false)

     const refresh = useCallback(async (): Promise<void> => {
       const [nextStatus, nextStats, nextProxyStats] = await Promise.all([
         window.pxpipe.getProxyStatus(),
         window.pxpipe.getPopoverStats(),
         window.pxpipe.getProxyStats().catch(() => null)
       ])
       setStatus(nextStatus)
       setStats(nextStats)
       setProxyStats(nextProxyStats)
     }, [])

     useEffect(() => {
       void refresh()
       const offShow = window.pxpipe.onPopoverShow(() => void refresh())
       const offStatus = window.pxpipe.onProxyStatus(() => void refresh())
       const offEvent = window.pxpipe.onProxyEvent(() => void refresh())
       return () => {
         offShow()
         offStatus()
         offEvent()
       }
     }, [refresh])

     const running = status?.running ?? false
     const compressionOn = proxyStats?.compression_enabled ?? false
     const inputPerMtok = proxyStats?.pricing_assumptions?.input_per_mtok ?? 3
     const savedCost = (stats.today.savedTokens / 1_000_000) * inputPerMtok

     async function toggleProxy(): Promise<void> {
       setBusy(true)
       try {
         if (running) await window.pxpipe.stopProxy()
         else await window.pxpipe.startProxy()
         await refresh()
       } finally {
         setBusy(false)
       }
     }

     async function toggleCompression(): Promise<void> {
       if (!running) return
       setBusy(true)
       try {
         await window.pxpipe.setCompressionEnabled(!compressionOn)
         await refresh()
       } finally {
         setBusy(false)
       }
     }

     return (
       <div className="flex h-screen w-screen flex-col gap-3 overflow-hidden bg-neutral-900 p-3 text-sm text-neutral-100">
         <div className="flex items-center justify-between">
           <div className="flex items-center gap-2">
             <span
               className={`h-2.5 w-2.5 rounded-full ${running ? 'bg-emerald-400' : 'bg-neutral-500'}`}
             />
             <div>
               <div className="font-medium leading-tight">
                 {running ? t('status.running') : t('status.stopped')}
               </div>
               {running && status?.url ? (
                 <div className="text-[11px] leading-tight text-neutral-400">{status.url}</div>
               ) : null}
             </div>
           </div>
           <button
             type="button"
             disabled={busy}
             onClick={() => void toggleProxy()}
             className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
               running
                 ? 'bg-neutral-700 hover:bg-neutral-600'
                 : 'bg-emerald-600 hover:bg-emerald-500'
             }`}
           >
             {running ? t('status.stop') : t('status.start')}
           </button>
         </div>

         <button
           type="button"
           disabled={busy || !running}
           onClick={() => void toggleCompression()}
           className="flex items-center justify-between rounded-lg bg-neutral-800/80 px-2.5 py-2 disabled:opacity-50"
         >
           <span className="text-xs text-neutral-300">{t('status.compression')}</span>
           <span
             className={`relative h-4 w-7 rounded-full transition-colors ${
               compressionOn && running ? 'bg-emerald-500' : 'bg-neutral-600'
             }`}
           >
             <span
               className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                 compressionOn && running ? 'translate-x-3.5' : 'translate-x-0.5'
               }`}
             />
           </span>
         </button>

         <div className="grid grid-cols-3 gap-2">
           <StatCard label={t('popover.todaySaved')} value={fmtCompact(stats.today.savedTokens, locale)} />
           <StatCard label={t('popover.savedPct')} value={`${stats.today.savedPct.toFixed(1)}%`} />
           <StatCard label={t('popover.savedCost')} value={`$${savedCost.toFixed(2)}`} />
         </div>

         <div className="flex-1 rounded-lg bg-neutral-800/80 px-2.5 py-2">
           <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-neutral-400">
             <span>{t('popover.trend')}</span>
             <span>
               {t('popover.requests')}: {fmtCompact(stats.today.requests, locale)}
             </span>
           </div>
           <div className="mt-1 text-[10px] text-sky-400">{t('popover.trendRequests')}</div>
           <Sparkline values={stats.series.map((b) => b.requests)} className="text-sky-400" />
           <div className="mt-1 text-[10px] text-emerald-400">{t('popover.trendSaved')}</div>
           <Sparkline values={stats.series.map((b) => b.savedTokens)} className="text-emerald-400" />
         </div>

         <div className="flex items-center justify-between border-t border-neutral-800 pt-2">
           <button
             type="button"
             onClick={() => void window.pxpipe.showMainWindow()}
             className="rounded-md px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
           >
             {t('popover.openMain')}
           </button>
           <button
             type="button"
             onClick={() => void window.pxpipe.quitApp()}
             className="rounded-md px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-red-400"
           >
             {t('popover.quit')}
           </button>
         </div>
       </div>
     )
   }

   export default function PopoverApp(): React.JSX.Element {
     const [lang, setLang] = useState<Lang>('en')

     useEffect(() => {
       const syncLang = (): void => {
         void window.pxpipe.getSettings().then((s) => setLang(s.language))
       }
       syncLang()
       return window.pxpipe.onPopoverShow(syncLang)
     }, [])

     return (
       <I18nProvider lang={lang}>
         <PopoverContent />
       </I18nProvider>
     )
   }
   ```

   > Adjust the exact method names against `src/shared/types.ts` (`getProxyStatus`, `getProxyStats`, `startProxy`, `stopProxy`, `setCompressionEnabled`, `getSettings`, `onProxyStatus`, `onProxyEvent`) — if a signature differs (e.g. `onProxyStatus` passes the status payload), keep the `refresh()`-based handler which ignores arguments. If `ProxyStatsPayload` lacks `pricing_assumptions.input_per_mtok`, check what field `App.tsx` uses for the saved-cost card and reuse it; keep the `?? 3` fallback.

6. `src/renderer/src/main.tsx` — hash routing:

   ```tsx
   import './assets/main.css'

   import { StrictMode } from 'react'
   import { createRoot } from 'react-dom/client'
   import App from './App'
   import PopoverApp from './PopoverApp'

   const isPopover = window.location.hash.startsWith('#/popover')

   createRoot(document.getElementById('root')!).render(
     <StrictMode>{isPopover ? <PopoverApp /> : <App />}</StrictMode>
   )
   ```

### Verify

```sh
pnpm test && pnpm typecheck && pnpm lint && pnpm dev
```

Manual smoke: left-click tray → popover shows status + three stat cards + two sparklines; Start/Stop works and flips the tray icon; compression toggle works while running and is disabled while stopped; sending a request through the proxy updates the numbers on next popover open; “打开主窗口” hides the popover and focuses the main window; 切换主窗口语言为中文后重新打开 popover 显示中文; Quit exits the app.

### Commit

```
feat(renderer): menu bar popover view with today stats and 24h sparklines
```

---

## Task 7 — Feature docs + final verification

**Files to modify:** `README.md`, `README.zh-CN.md`

### Steps

1. `README.md` Highlights — add bullet:

   ```markdown
   - **Menu bar monitor (macOS)** — a circular menu-bar icon opens a popover with proxy status, start/stop and compression toggles, today's savings, and a 24 h trend; right-click for the quick menu.
   ```

2. `README.zh-CN.md` `## 功能概览` — add bullet:

   ```markdown
   - **菜单栏监控（macOS）**：圆形菜单栏图标，左键打开 popover 查看代理状态、启停与压缩开关、今日节省和最近 24 小时趋势；右键弹出快捷菜单。
   ```

3. Full verification:

   ```sh
   pnpm test && pnpm typecheck && pnpm lint && pnpm build
   ```

   Then run the manual smoke checklist from Task 6 once more via `pnpm dev`. Optionally `pnpm build:mac` and verify the packaged app shows the template icon correctly in both light and dark menu bars.

### Commit

```
docs: document macOS menu bar popover monitor
```

---

## Risks / notes for the executor

- **`menubar` + existing `Tray`:** we pass our own `tray` instance so `menubar` never creates a second icon. Do not call `tray.setContextMenu` anywhere — it would break left-click toggling.
- **Template icons:** never add color to the tray PNGs; macOS recolors pure-black+alpha automatically.
- **vitest vs better-sqlite3:** never import `src/main/database.ts` (or anything touching `electron`/`better-sqlite3`) from `tests/` — Node cannot load the Electron-ABI native module.
- **Prod popover URL:** `file://.../renderer/index.html#/popover` must match the actual renderer output path used elsewhere in `src/main/index.ts` (`../renderer/index.html`). If the main window uses a different relative path, mirror it.
- **Version:** current `package.json` version is `0.8.1`; Task 1 sets `0.9.0`.
