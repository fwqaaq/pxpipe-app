import { app } from 'electron'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { ProxyEvent } from '../../../pxpipe/src/core/proxy.js'
import type {
  AppSettings,
  ImportResult,
  PathCount,
  PersistedEvent,
  PopoverStatsPayload,
  ProxyVerification,
  SessionSummary,
  StatsPayload
} from '../shared/types'
import { DEFAULT_MODEL_BASES } from '../shared/model-catalog'
import { computePopoverStats, type PopoverEventRow } from './popover-stats'

const BASE_DEFAULT_SETTINGS: AppSettings = {
  host: '127.0.0.1',
  port: 47821,
  anthropicUpstream: 'https://api.anthropic.com',
  openAIUpstream: 'https://api.openai.com',
  openAIApiKey: '',
  provider: '',
  gatewayBaseUrl: '',
  gatewayHeaders: '',
  modelBases: [...DEFAULT_MODEL_BASES],
  autoStart: false,
  language: 'en',
  theme: 'system'
}

type EventInsert = Omit<PersistedEvent, 'id'>

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function nullish<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

function expandHome(filePath: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2))
  return filePath
}

function falsey(value: string): boolean {
  return /^(0|false|no|off|none)$/i.test(value.trim())
}

function normalizeModelsConfig(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const models = value.map((v) => String(v).trim()).filter(Boolean)
    return models.length > 0 ? models : []
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || falsey(trimmed)) return []
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return undefined
}

function settingsFromEnvAndConfig(): AppSettings {
  const defaults = { ...BASE_DEFAULT_SETTINGS }
  const configPath =
    process.env.PXPIPE_CONFIG ?? join(homedir(), '.config', 'pxpipe', 'config.json')
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
      const models = normalizeModelsConfig(parsed.models)
      if (models !== undefined) defaults.modelBases = models
    } catch {
      // Ignore invalid legacy config, matching the CLI's best-effort behavior.
    }
  }

  const sharedUpstream = process.env.PXPIPE_UPSTREAM
  if (process.env.HOST?.trim()) defaults.host = process.env.HOST.trim()
  if (process.env.PORT && Number.isFinite(Number(process.env.PORT))) {
    defaults.port = Number(process.env.PORT)
  }
  defaults.anthropicUpstream =
    process.env.ANTHROPIC_UPSTREAM ?? sharedUpstream ?? defaults.anthropicUpstream
  defaults.openAIUpstream = process.env.OPENAI_UPSTREAM ?? sharedUpstream ?? defaults.openAIUpstream
  defaults.openAIApiKey = process.env.OPENAI_API_KEY ?? defaults.openAIApiKey
  if (process.env.PXPIPE_PROVIDER === 'cloudflare-ai-gateway')
    defaults.provider = 'cloudflare-ai-gateway'
  defaults.gatewayBaseUrl = process.env.PXPIPE_GATEWAY_BASE_URL ?? defaults.gatewayBaseUrl
  defaults.gatewayHeaders = process.env.PXPIPE_GATEWAY_HEADERS ?? defaults.gatewayHeaders
  if (process.env.PXPIPE_MODELS !== undefined) {
    defaults.modelBases = normalizeModelsConfig(process.env.PXPIPE_MODELS) ?? defaults.modelBases
  }
  return cleanSettings(defaults) as AppSettings
}

function cleanSettings(input: Partial<AppSettings>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  if (typeof input.host === 'string' && input.host.trim()) out.host = input.host.trim()
  if (typeof input.port === 'number' && Number.isFinite(input.port)) {
    out.port = Math.max(1, Math.min(65535, Math.trunc(input.port)))
  }
  if (typeof input.anthropicUpstream === 'string' && input.anthropicUpstream.trim()) {
    out.anthropicUpstream = input.anthropicUpstream.trim().replace(/\/+$/, '')
  }
  if (typeof input.openAIUpstream === 'string' && input.openAIUpstream.trim()) {
    out.openAIUpstream = input.openAIUpstream.trim().replace(/\/+$/, '')
  }
  if (typeof input.openAIApiKey === 'string') out.openAIApiKey = input.openAIApiKey.trim()
  if (input.provider === '' || input.provider === 'cloudflare-ai-gateway')
    out.provider = input.provider
  if (typeof input.gatewayBaseUrl === 'string') {
    out.gatewayBaseUrl = input.gatewayBaseUrl.trim().replace(/\/+$/, '')
  }
  if (typeof input.gatewayHeaders === 'string') out.gatewayHeaders = input.gatewayHeaders.trim()
  if (Array.isArray(input.modelBases)) {
    out.modelBases = input.modelBases.map((m) => String(m).trim()).filter(Boolean)
  }
  if (typeof input.autoStart === 'boolean') out.autoStart = input.autoStart
  if (input.language === 'en' || input.language === 'zh') out.language = input.language
  if (input.theme === 'dark' || input.theme === 'light' || input.theme === 'system') {
    out.theme = input.theme
  }
  return out
}

function flattenProxyEvent(ev: ProxyEvent): EventInsert {
  const info = ev.info
  const usage = ev.usage
  const inputTokens = asNumber(usage?.input_tokens)
  const outputTokens = asNumber(usage?.output_tokens)
  const cacheCreateTokens = asNumber(usage?.cache_creation_input_tokens)
  const cacheReadTokens = asNumber(usage?.cache_read_input_tokens ?? usage?.cached_tokens)
  const baselineTokens = asNumber(info?.baselineTokens)
  const actualInput = (inputTokens ?? 0) + (cacheCreateTokens ?? 0) + (cacheReadTokens ?? 0)
  const estimatedSavedTokens =
    baselineTokens === undefined ? undefined : Math.round(baselineTokens - actualInput)

  const rawJson = JSON.stringify({
    ts: new Date().toISOString(),
    method: ev.method,
    path: ev.path,
    model: ev.model,
    status: ev.status,
    duration_ms: ev.durationMs,
    first_byte_ms: ev.firstByteMs,
    compressed: info?.compressed,
    reason: info?.reason,
    orig_chars: info?.origChars,
    compressed_chars: info?.compressedChars,
    image_count: info?.imageCount,
    image_bytes: info?.imageBytes,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_create_tokens: cacheCreateTokens,
    cache_read_tokens: cacheReadTokens,
    baseline_tokens: baselineTokens,
    first_user_sha8: info?.firstUserSha8,
    cwd: info?.env?.cwd,
    error: ev.error
  })

  return {
    ts: new Date().toISOString(),
    method: ev.method,
    path: ev.path,
    model: ev.model,
    status: ev.status,
    durationMs: ev.durationMs,
    firstByteMs: ev.firstByteMs,
    compressed: normalizeBool(info?.compressed),
    reason: optionalString(info?.reason),
    origChars: asNumber(info?.origChars),
    compressedChars: asNumber(info?.compressedChars),
    imageCount: asNumber(info?.imageCount),
    imageBytes: asNumber(info?.imageBytes),
    inputTokens,
    outputTokens,
    cacheCreateTokens,
    cacheReadTokens,
    baselineTokens,
    estimatedSavedTokens,
    sessionId: optionalString(info?.firstUserSha8),
    cwd: optionalString(info?.env?.cwd),
    error: optionalString(ev.error),
    rawJson
  }
}

function flattenTrackEvent(ev: Record<string, unknown>): EventInsert | null {
  const ts = optionalString(ev.ts) ?? new Date().toISOString()
  const method = optionalString(ev.method) ?? 'GET'
  const path = optionalString(ev.path) ?? '/'
  const status = asNumber(ev.status) ?? 0
  const inputTokens = asNumber(ev.input_tokens)
  const outputTokens = asNumber(ev.output_tokens)
  const cacheCreateTokens = asNumber(ev.cache_create_tokens ?? ev.cache_creation_input_tokens)
  const cacheReadTokens = asNumber(
    ev.cache_read_tokens ?? ev.cache_read_input_tokens ?? ev.cached_tokens
  )
  const baselineTokens = asNumber(ev.baseline_tokens)
  const actualInput = (inputTokens ?? 0) + (cacheCreateTokens ?? 0) + (cacheReadTokens ?? 0)
  const estimatedSavedTokens =
    baselineTokens === undefined ? undefined : Math.round(baselineTokens - actualInput)

  return {
    ts,
    method,
    path,
    model: optionalString(ev.model),
    status,
    durationMs: asNumber(ev.duration_ms) ?? 0,
    firstByteMs: asNumber(ev.first_byte_ms),
    compressed: normalizeBool(ev.compressed),
    reason: optionalString(ev.reason),
    origChars: asNumber(ev.orig_chars),
    compressedChars: asNumber(ev.compressed_chars),
    imageCount: asNumber(ev.image_count),
    imageBytes: asNumber(ev.image_bytes),
    inputTokens,
    outputTokens,
    cacheCreateTokens,
    cacheReadTokens,
    baselineTokens,
    estimatedSavedTokens,
    sessionId: optionalString(ev.first_user_sha8),
    cwd: optionalString(ev.cwd),
    error: optionalString(ev.error),
    rawJson: JSON.stringify(ev)
  }
}

export class AppDatabase {
  private readonly db: Database.Database

  constructor() {
    const dbPath = join(app.getPath('userData'), 'pxpipe.sqlite3')
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  getSettings(): AppSettings {
    const defaults = settingsFromEnvAndConfig()
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('app') as
      { value: string } | undefined
    if (!row) return defaults
    try {
      return {
        ...defaults,
        ...cleanSettings(JSON.parse(row.value) as Partial<AppSettings>)
      }
    } catch {
      return defaults
    }
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...cleanSettings(patch) }
    this.db
      .prepare(
        'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run('app', JSON.stringify(next))
    return next
  }

  insertProxyEvent(ev: ProxyEvent): PersistedEvent {
    return this.insertEvent(flattenProxyEvent(ev))
  }

  listEvents(limit = 100): PersistedEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, Math.min(500, Math.trunc(limit)))) as Record<string, unknown>[]
    return rows.map(rowToEvent)
  }

  getStats(): StatsPayload {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) AS ok2xx,
          SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) AS err4xx,
          SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS err5xx,
          SUM(CASE WHEN compressed = 1 THEN 1 ELSE 0 END) AS compressed,
          SUM(CASE WHEN compressed = 0 THEN 1 ELSE 0 END) AS passthrough,
          SUM(COALESCE(orig_chars, 0)) AS origCharsTotal,
          SUM(COALESCE(image_bytes, 0)) AS imageBytesTotal,
          SUM(COALESCE(input_tokens, 0)) AS inputTokensTotal,
          SUM(COALESCE(output_tokens, 0)) AS outputTokensTotal,
          SUM(COALESCE(cache_create_tokens, 0)) AS cacheCreateTokensTotal,
          SUM(COALESCE(cache_read_tokens, 0)) AS cacheReadTokensTotal,
          SUM(COALESCE(baseline_tokens, 0)) AS baselineTokensTotal,
          SUM(COALESCE(estimated_saved_tokens, 0)) AS estimatedSavedTokensTotal,
          AVG(duration_ms) AS avgDurationMs
        FROM events`
      )
      .get() as Record<string, number | null>

    const total = row.total ?? 0
    const compressed = row.compressed ?? 0
    const baselineTokensTotal = row.baselineTokensTotal ?? 0
    const estimatedSavedTokensTotal = row.estimatedSavedTokensTotal ?? 0

    return {
      total,
      ok2xx: row.ok2xx ?? 0,
      err4xx: row.err4xx ?? 0,
      err5xx: row.err5xx ?? 0,
      compressed,
      passthrough: row.passthrough ?? 0,
      origCharsTotal: row.origCharsTotal ?? 0,
      imageBytesTotal: row.imageBytesTotal ?? 0,
      inputTokensTotal: row.inputTokensTotal ?? 0,
      outputTokensTotal: row.outputTokensTotal ?? 0,
      cacheCreateTokensTotal: row.cacheCreateTokensTotal ?? 0,
      cacheReadTokensTotal: row.cacheReadTokensTotal ?? 0,
      baselineTokensTotal,
      estimatedSavedTokensTotal,
      compressionRate: total === 0 ? 0 : (compressed / total) * 100,
      savedPct:
        baselineTokensTotal === 0 ? 0 : (estimatedSavedTokensTotal / baselineTokensTotal) * 100,
      avgDurationMs: Math.round(row.avgDurationMs ?? 0)
    }
  }

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

  listSessions(limit = 50): SessionSummary[] {
    return this.db
      .prepare(
        `SELECT
          COALESCE(session_id, '<unknown>') AS id,
          MIN(cwd) AS project,
          MIN(ts) AS firstSeen,
          MAX(ts) AS lastSeen,
          COUNT(*) AS requestCount,
          SUM(COALESCE(estimated_saved_tokens, 0)) AS estimatedSavedTokens,
          SUM(CASE WHEN compressed = 1 THEN 1 ELSE 0 END) AS compressedCount
        FROM events
        GROUP BY COALESCE(session_id, '<unknown>')
        ORDER BY lastSeen DESC
        LIMIT ?`
      )
      .all(Math.max(1, Math.min(200, Math.trunc(limit)))) as SessionSummary[]
  }

  getProxyVerification(listening: boolean, proxyUrl: string): ProxyVerification {
    const claudeRow = this.db
      .prepare(
        `SELECT MAX(ts) AS lastSeen, COUNT(*) AS requests
         FROM events
         WHERE path IN ('/v1/messages', '/anthropic/v1/messages', '/anthropic/messages')`
      )
      .get() as { lastSeen: string | null; requests: number }
    const codexRow = this.db
      .prepare(
        `SELECT MAX(ts) AS lastSeen, COUNT(*) AS requests
         FROM events
         WHERE path IN ('/v1/responses', '/v1/chat/completions', '/openai/v1/responses', '/openai/responses', '/openai/v1/chat/completions')
            OR path LIKE '/v1/responses/%'`
      )
      .get() as { lastSeen: string | null; requests: number }
    const pathCounts = this.db
      .prepare(
        `SELECT path, method, COUNT(*) AS count, MAX(ts) AS lastSeen
         FROM events
         GROUP BY path, method
         ORDER BY count DESC, lastSeen DESC
         LIMIT 12`
      )
      .all() as PathCount[]

    return {
      listening,
      proxyUrl,
      claudeBaseUrl: proxyUrl,
      codexBaseUrl: `${proxyUrl}/v1`,
      claudeLastSeen: claudeRow.lastSeen ?? undefined,
      codexLastSeen: codexRow.lastSeen ?? undefined,
      claudeRequests: claudeRow.requests ?? 0,
      codexRequests: codexRow.requests ?? 0,
      pathCounts
    }
  }

  importJsonl(filePath: string): ImportResult {
    const resolved = expandHome(filePath)
    const text = readFileSync(resolved, 'utf8')
    let imported = 0
    let skipped = 0
    const insertMany = this.db.transaction((rows: EventInsert[]) => {
      for (const row of rows) this.insertEvent(row)
    })
    const rows: EventInsert[] = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        const row = flattenTrackEvent(parsed)
        if (row) {
          rows.push(row)
          imported++
        } else {
          skipped++
        }
      } catch {
        skipped++
      }
    }
    insertMany(rows)
    return { imported, skipped }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        model TEXT,
        status INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        first_byte_ms INTEGER,
        compressed INTEGER,
        reason TEXT,
        orig_chars INTEGER,
        compressed_chars INTEGER,
        image_count INTEGER,
        image_bytes INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_create_tokens INTEGER,
        cache_read_tokens INTEGER,
        baseline_tokens INTEGER,
        estimated_saved_tokens INTEGER,
        session_id TEXT,
        cwd TEXT,
        error TEXT,
        raw_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_events_path ON events(path);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    `)
  }

  private insertEvent(row: EventInsert): PersistedEvent {
    const result = this.db
      .prepare(
        `INSERT INTO events (
          ts, method, path, model, status, duration_ms, first_byte_ms, compressed, reason,
          orig_chars, compressed_chars, image_count, image_bytes, input_tokens, output_tokens,
          cache_create_tokens, cache_read_tokens, baseline_tokens, estimated_saved_tokens,
          session_id, cwd, error, raw_json
        ) VALUES (
          @ts, @method, @path, @model, @status, @durationMs, @firstByteMs, @compressed, @reason,
          @origChars, @compressedChars, @imageCount, @imageBytes, @inputTokens, @outputTokens,
          @cacheCreateTokens, @cacheReadTokens, @baselineTokens, @estimatedSavedTokens,
          @sessionId, @cwd, @error, @rawJson
        )`
      )
      .run({
        ts: row.ts,
        method: row.method,
        path: row.path,
        model: nullish(row.model),
        status: row.status,
        durationMs: row.durationMs,
        firstByteMs: nullish(row.firstByteMs),
        compressed: row.compressed === undefined ? null : row.compressed ? 1 : 0,
        reason: nullish(row.reason),
        origChars: nullish(row.origChars),
        compressedChars: nullish(row.compressedChars),
        imageCount: nullish(row.imageCount),
        imageBytes: nullish(row.imageBytes),
        inputTokens: nullish(row.inputTokens),
        outputTokens: nullish(row.outputTokens),
        cacheCreateTokens: nullish(row.cacheCreateTokens),
        cacheReadTokens: nullish(row.cacheReadTokens),
        baselineTokens: nullish(row.baselineTokens),
        estimatedSavedTokens: nullish(row.estimatedSavedTokens),
        sessionId: nullish(row.sessionId),
        cwd: nullish(row.cwd),
        error: nullish(row.error),
        rawJson: row.rawJson
      })
    return { id: Number(result.lastInsertRowid), ...row }
  }
}

function rowToEvent(row: Record<string, unknown>): PersistedEvent {
  return {
    id: Number(row.id),
    ts: String(row.ts),
    method: String(row.method),
    path: String(row.path),
    model: optionalString(row.model),
    status: Number(row.status),
    durationMs: Number(row.duration_ms ?? 0),
    firstByteMs: asNumber(row.first_byte_ms),
    compressed: row.compressed === null ? undefined : Boolean(row.compressed),
    reason: optionalString(row.reason),
    origChars: asNumber(row.orig_chars),
    compressedChars: asNumber(row.compressed_chars),
    imageCount: asNumber(row.image_count),
    imageBytes: asNumber(row.image_bytes),
    inputTokens: asNumber(row.input_tokens),
    outputTokens: asNumber(row.output_tokens),
    cacheCreateTokens: asNumber(row.cache_create_tokens),
    cacheReadTokens: asNumber(row.cache_read_tokens),
    baselineTokens: asNumber(row.baseline_tokens),
    estimatedSavedTokens: asNumber(row.estimated_saved_tokens),
    sessionId: optionalString(row.session_id),
    cwd: optionalString(row.cwd),
    error: optionalString(row.error),
    rawJson: String(row.raw_json)
  }
}
