import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  createProxy,
  parseGatewayHeaders,
  type ProxyConfig,
  type ProxyEvent
} from '../../../pxpipe/src/core/proxy.js'
import { setAllowedModelBases } from '../../../pxpipe/src/core/applicability.js'
import {
  toTrackEvent,
  TRACK_BODY_INLINE_MAX,
  type Tracker,
  type TrackEvent
} from '../../../pxpipe/src/core/tracker.js'
import {
  DashboardState,
  dashboardPath,
  type DashboardRoute
} from '../../../pxpipe/src/dashboard.js'
import type {
  AppSettings,
  CompressionToggleResult,
  CurrentSessionPayload,
  DashboardRecentPayload,
  ImageSourcePayload,
  ImageVsTextBreakdownPayload,
  PersistedEvent,
  ProxyStatsPayload,
  ProxyStatus,
  TokenImagePayload
} from '../shared/types'
import type { AppDatabase } from './database'

async function readRequestBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += b.byteLength
    if (bytes > maxBytes) throw new Error('request body too large')
    chunks.push(b)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function dispatchDashboard(
  dashboard: DashboardState,
  route: DashboardRoute,
  req: IncomingMessage,
  url: URL,
  port: number
): Promise<Response | undefined> {
  const method = req.method ?? 'GET'
  switch (route.kind) {
    case 'html':
      if (method !== 'GET') return undefined
      return dashboard.serveHtml(port)
    case 'stats':
      if (method !== 'GET') return undefined
      return dashboard.serveStats()
    case 'recent':
      if (method !== 'GET') return undefined
      return dashboard.serveRecent()
    case 'png': {
      if (method !== 'GET') return undefined
      const idRaw = url.searchParams.get('id')
      const idNum = idRaw != null ? Number(idRaw) : NaN
      return dashboard.servePng(Number.isFinite(idNum) ? idNum : undefined)
    }
    case 'api-image-source': {
      if (method !== 'GET') return undefined
      const idRaw = url.searchParams.get('id')
      const idNum = idRaw != null ? Number(idRaw) : NaN
      return dashboard.serveImageSource(Number.isFinite(idNum) ? idNum : undefined)
    }
    case 'api-image-vs-text-breakdown': {
      if (method !== 'GET') return undefined
      const idRaw = url.searchParams.get('id')
      const idNum = idRaw != null ? Number(idRaw) : NaN
      return dashboard.serveImageVsTextBreakdown(Number.isFinite(idNum) ? idNum : undefined)
    }
    case 'api-sessions':
      if (method !== 'GET') return undefined
      return dashboard.serveSessionsJson({
        project: url.searchParams.get('project') ?? undefined,
        since: url.searchParams.get('since') ?? undefined
      })
    case 'api-stats':
      if (method !== 'GET') return undefined
      return dashboard.serveApiStats()
    case 'current-session':
      if (method !== 'GET') return undefined
      return dashboard.serveCurrentSessionJson()
    case 'fragment': {
      if (route.name === 'toggle' && method === 'POST') {
        let enabled = false
        try {
          const raw = await readRequestBody(req)
          try {
            enabled = (JSON.parse(raw) as { enabled?: unknown }).enabled === true
          } catch {
            enabled = new URLSearchParams(raw).get('enabled') === 'true'
          }
        } catch {
          return new Response('bad request body', { status: 400 })
        }
        dashboard.handleCompressionToggle({ enabled })
        return dashboard.serveFragment('toggle', url, port)
      }
      if (route.name === 'models' && method === 'POST') {
        let model = ''
        let on = false
        try {
          const raw = await readRequestBody(req)
          try {
            const parsed = JSON.parse(raw) as { model?: unknown; on?: unknown }
            model = typeof parsed.model === 'string' ? parsed.model : ''
            on = parsed.on === true
          } catch {
            const params = new URLSearchParams(raw)
            model = params.get('model') ?? ''
            on = params.get('on') === 'true'
          }
        } catch {
          return new Response('bad request body', { status: 400 })
        }
        if (model) dashboard.handleModelsToggle(model, on)
        return dashboard.serveFragment('models', url, port)
      }
      if (method !== 'GET') return undefined
      return dashboard.serveFragment(route.name, url, port)
    }
    case 'api-compression': {
      if (method !== 'POST') {
        return new Response(JSON.stringify({ error: 'use POST' }), {
          status: 405,
          headers: { 'content-type': 'application/json' }
        })
      }
      let body: Record<string, unknown> = {}
      try {
        const raw = await readRequestBody(req)
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      } catch (error) {
        return new Response(
          JSON.stringify({ error: 'bad request body', detail: (error as Error).message }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
      }
      return dashboard.handleCompressionToggle({ enabled: body.enabled })
    }
  }
}

function toWebRequest(req: IncomingMessage): Request {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
  const host = req.headers.host ?? 'localhost'
  const url = `${proto}://${host}${req.url ?? '/'}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v))
    else headers.append(key, value)
  }

  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  let body: BodyInit | undefined
  if (hasBody) {
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        req.on('data', (chunk) => controller.enqueue(chunk))
        req.on('end', () => controller.close())
        req.on('error', (error) => controller.error(error))
      }
    })
  }

  return new Request(url, {
    method,
    headers,
    body,
    duplex: hasBody ? 'half' : undefined
  } as RequestInit & { duplex?: 'half' })
}

async function waitForDrain(out: ServerResponse): Promise<void> {
  const event = await Promise.race([
    once(out, 'drain').then(() => 'drain'),
    once(out, 'close').then(() => 'close')
  ])
  if (event === 'close') throw new Error('client response closed')
}

async function writeWebResponse(res: Response, out: ServerResponse): Promise<void> {
  out.statusCode = res.status
  res.headers.forEach((value, key) => out.setHeader(key, value))
  if (!res.body) {
    out.end()
    return
  }

  const reader = res.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && !out.write(Buffer.from(value))) await waitForDrain(out)
    }
    out.end()
  } finally {
    reader.releaseLock()
  }
}

class FileTracker implements Tracker {
  private fd: number | null = null
  private bytesWritten = 0
  private brokenLogged = false
  private static readonly MAX_FILE_BYTES = 100 * 1024 * 1024

  constructor(private readonly filePath: string) {}

  emit(ev: TrackEvent): void {
    if (!this.ensureOpen()) return
    try {
      const line = JSON.stringify(ev) + '\n'
      const buf = Buffer.from(line, 'utf8')
      fs.writeSync(this.fd!, buf)
      this.bytesWritten += buf.length
      if (this.bytesWritten > FileTracker.MAX_FILE_BYTES) this.rotate()
    } catch (error) {
      if (!this.brokenLogged) {
        console.error(`[pxpipe-app] FileTracker write failed: ${(error as Error).message}`)
        this.brokenLogged = true
      }
    }
  }

  flush(): void {
    if (this.fd != null) {
      try {
        fs.fsyncSync(this.fd)
      } catch {
        // ignore
      }
    }
  }

  close(): void {
    if (this.fd != null) {
      this.flush()
      try {
        fs.closeSync(this.fd)
      } catch {
        // ignore
      }
      this.fd = null
    }
  }

  private ensureOpen(): boolean {
    if (this.fd != null) return true
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const stat = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : undefined
      this.bytesWritten = stat?.size ?? 0
      this.fd = fs.openSync(this.filePath, 'a')
      return true
    } catch (error) {
      if (!this.brokenLogged) {
        console.error(
          `[pxpipe-app] FileTracker disabled — cannot open ${this.filePath}: ${(error as Error).message}`
        )
        this.brokenLogged = true
      }
      return false
    }
  }

  private rotate(): void {
    if (this.fd != null) {
      try {
        fs.closeSync(this.fd)
      } catch {
        // ignore
      }
      this.fd = null
    }
    try {
      fs.renameSync(this.filePath, this.filePath + '.1')
    } catch {
      // keep growing rather than dropping events
    }
    this.bytesWritten = 0
  }
}

async function maybeWriteBodySidecar(
  bytesGz: Uint8Array,
  sha8: string | undefined,
  dir: string
): Promise<string | undefined> {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    return undefined
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const tag = sha8 ?? 'nohash'
  const filePath = path.join(dir, `${ts}-${tag}.json.gz`)
  try {
    await fs.promises.writeFile(filePath, bytesGz)
    return filePath
  } catch {
    return undefined
  }
}

export class ProxyService {
  private server: Server | null = null
  private tracker: FileTracker | null = null
  private dashboard: DashboardState | null = null
  private status: ProxyStatus = {
    running: false,
    host: '127.0.0.1',
    port: 47821,
    url: 'http://127.0.0.1:47821'
  }

  constructor(
    private readonly db: AppDatabase,
    private readonly onEvent: (event: PersistedEvent) => void,
    private readonly onStatus: (status: ProxyStatus) => void
  ) {}

  getStatus(): ProxyStatus {
    return { ...this.status }
  }

  async getDashboardRecent(): Promise<DashboardRecentPayload> {
    if (!this.dashboard) {
      return { recent: [], has_preview: false, preview_meta: '', image_ids: [] }
    }
    return (await this.dashboard.serveRecent().json()) as DashboardRecentPayload
  }

  async getProxyStats(): Promise<ProxyStatsPayload | null> {
    if (!this.dashboard) return null
    return (await this.dashboard.serveStats().json()) as ProxyStatsPayload
  }

  async getCurrentSession(): Promise<CurrentSessionPayload> {
    if (!this.dashboard) return { sessionId: null, message: 'proxy dashboard is not running' }
    return (await this.dashboard.serveCurrentSessionJson().json()) as CurrentSessionPayload
  }

  async setCompressionEnabled(enabled: boolean): Promise<CompressionToggleResult> {
    if (!this.dashboard) return { compression_enabled: false }
    const res = this.dashboard.handleCompressionToggle({ enabled })
    return (await res.json()) as CompressionToggleResult
  }

  async getImageVsTextBreakdown(id?: number): Promise<ImageVsTextBreakdownPayload> {
    if (!this.dashboard) {
      return {
        error: 'no image-vs-text breakdown yet',
        hint: 'Start proxy and send a request that pxpipe compresses.'
      }
    }
    const res = this.dashboard.serveImageVsTextBreakdown(id)
    return (await res.json()) as ImageVsTextBreakdownPayload
  }

  async getTokenImage(id?: number): Promise<TokenImagePayload> {
    if (!this.dashboard) {
      return { id, meta: '', available: false, error: 'proxy dashboard is not running' }
    }
    const res = this.dashboard.servePng(id)
    if (!res.ok) {
      return { id, meta: id === undefined ? 'latest image' : `image #${id}`, available: false, error: await res.text() }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return {
      id,
      meta: id === undefined ? 'latest image' : `image #${id}`,
      available: true,
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`
    }
  }

  async getImageSource(id?: number): Promise<ImageSourcePayload> {
    if (!this.dashboard) {
      return { id, meta: '', available: false, error: 'proxy dashboard is not running' }
    }
    const res = this.dashboard.serveImageSource(id)
    if (!res.ok) {
      let error = 'no source text'
      try {
        const parsed = (await res.json()) as { error?: string }
        error = parsed.error ?? error
      } catch {
        // keep fallback
      }
      return { id, meta: id === undefined ? 'latest image' : `image #${id}`, available: false, error }
    }
    const parsed = (await res.json()) as { id?: number; meta?: string; source_text?: string }
    return {
      id: parsed.id ?? id,
      meta: parsed.meta ?? (id === undefined ? 'latest image' : `image #${id}`),
      available: true,
      sourceText: parsed.source_text ?? ''
    }
  }

  async start(settings: AppSettings): Promise<ProxyStatus> {
    if (this.server) return this.getStatus()

    setAllowedModelBases(settings.modelBases)

    const eventsFile = process.env.PXPIPE_LOG ?? path.join(os.homedir(), '.pxpipe', 'events.jsonl')
    const sidecarDir = path.join(path.dirname(eventsFile), '4xx-bodies')
    const tracker = new FileTracker(eventsFile)
    const dashboard = new DashboardState({ eventsFile, sidecarDir })
    await dashboard.replay(eventsFile).catch(() => undefined)
    this.dashboard = dashboard

    const config: ProxyConfig = {
      upstream: settings.anthropicUpstream,
      openAIUpstream: settings.openAIUpstream,
      openAIApiKey: settings.openAIApiKey || undefined,
      provider: settings.provider || undefined,
      gatewayBaseUrl: settings.gatewayBaseUrl || undefined,
      gatewayHeaders: parseGatewayHeaders(settings.gatewayHeaders || undefined),
      transform: () => (dashboard.getCompressionEnabled() ? {} : { compress: false }),
      onRequest: async (event: ProxyEvent) => {
        dashboard.update(event)

        if (event.reqBodyGz && event.reqBodyGz.byteLength * 4 > TRACK_BODY_INLINE_MAX * 3) {
          const writtenPath = await maybeWriteBodySidecar(
            event.reqBodyGz,
            event.reqBodySha8,
            sidecarDir
          )
          if (writtenPath) {
            event.reqBodySamplePath = writtenPath
            event.reqBodyGz = undefined
          }
        }

        tracker.emit(toTrackEvent(event))
        const persisted = this.db.insertProxyEvent(event)
        this.onEvent(persisted)
      }
    }

    const handler = createProxy(config)
    const server = createServer((req, res) => {
      Promise.resolve()
        .then(async () => {
          const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
          const route = dashboardPath(url.pathname)
          if (route) {
            const webResponse = await dispatchDashboard(dashboard, route, req, url, settings.port)
            if (webResponse) {
              await writeWebResponse(webResponse, res)
              return
            }
          }
          const webRequest = toWebRequest(req)
          const webResponse = await handler(webRequest)
          await writeWebResponse(webResponse, res)
        })
        .catch((error) => {
          console.error('[pxpipe-app] handler error:', error)
          if (!res.headersSent) res.statusCode = 500
          res.end()
        })
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(settings.port, settings.host)
    })

    this.server = server
    this.tracker = tracker
    this.status = {
      running: true,
      host: settings.host,
      port: settings.port,
      url: `http://${settings.host.includes(':') ? `[${settings.host}]` : settings.host}:${settings.port}`,
      startedAt: new Date().toISOString()
    }
    this.onStatus(this.getStatus())
    return this.getStatus()
  }

  async stop(): Promise<ProxyStatus> {
    if (!this.server) return this.getStatus()
    const server = this.server
    this.server = null
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    this.tracker?.close()
    this.tracker = null
    this.status = {
      ...this.status,
      running: false,
      startedAt: undefined
    }
    this.onStatus(this.getStatus())
    return this.getStatus()
  }
}
