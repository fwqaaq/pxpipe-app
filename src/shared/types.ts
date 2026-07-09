export type PxpipeProvider = '' | 'cloudflare-ai-gateway'
export type LaunchKind = 'claude' | 'codex'
export type AppLanguage = 'en' | 'zh'
export type AppTheme = 'dark' | 'light' | 'system'
export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

export interface AppUpdateStatus {
  currentVersion: string
  state: AppUpdateState
  isSupported: boolean
  autoCheck: boolean
  availableVersion?: string
  releaseName?: string
  releaseDate?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  error?: string
  lastCheckedAt?: string
}

export interface AppSettings {
  host: string
  port: number
  anthropicUpstream: string
  openAIUpstream: string
  openAIApiKey: string
  provider: PxpipeProvider
  gatewayBaseUrl: string
  gatewayHeaders: string
  modelBases: string[]
  autoStart: boolean
  language: AppLanguage
  theme: AppTheme
}

export interface ProxyStatus {
  running: boolean
  host: string
  port: number
  url: string
  startedAt?: string
  error?: string
}

export interface PersistedEvent {
  id: number
  ts: string
  method: string
  path: string
  model?: string
  status: number
  durationMs: number
  firstByteMs?: number
  compressed?: boolean
  reason?: string
  origChars?: number
  compressedChars?: number
  imageCount?: number
  imageBytes?: number
  inputTokens?: number
  outputTokens?: number
  cacheCreateTokens?: number
  cacheReadTokens?: number
  baselineTokens?: number
  estimatedSavedTokens?: number
  sessionId?: string
  cwd?: string
  error?: string
  rawJson: string
}

export interface StatsPayload {
  total: number
  ok2xx: number
  err4xx: number
  err5xx: number
  compressed: number
  passthrough: number
  origCharsTotal: number
  imageBytesTotal: number
  inputTokensTotal: number
  outputTokensTotal: number
  cacheCreateTokensTotal: number
  cacheReadTokensTotal: number
  baselineTokensTotal: number
  estimatedSavedTokensTotal: number
  compressionRate: number
  savedPct: number
  avgDurationMs: number
}

export interface SessionSummary {
  id: string
  project?: string
  firstSeen: string
  lastSeen: string
  requestCount: number
  estimatedSavedTokens: number
  compressedCount: number
}

export interface ImportResult {
  imported: number
  skipped: number
}

export interface PathCount {
  path: string
  method: string
  count: number
  lastSeen?: string
}

export interface ProxyVerification {
  listening: boolean
  proxyUrl: string
  claudeBaseUrl: string
  codexBaseUrl: string
  claudeLastSeen?: string
  codexLastSeen?: string
  claudeRequests: number
  codexRequests: number
  pathCounts: PathCount[]
}

export interface LaunchResult {
  ok: boolean
  kind: LaunchKind
  command: string
  pid?: number
  error?: string
}

/** Mirror of pxpipe's /proxy-stats payload (src/dashboard/types.ts). */
export interface PricingAssumptions {
  input_per_mtok: number
  output_multiplier: number
  cache_write_5m_multiplier: number
  cache_write_1h_multiplier: number
  cache_read_multiplier: number
  source: string
}

export interface ProxyStatsPayload {
  requests: number
  compressed_requests: number
  baseline_input_weighted: number
  actual_input_weighted: number
  saved_input_tokens: number
  saved_pct: number
  saved_pct_input_only: number
  saved_pct_of_total_bill: number
  saved_pct_of_all_spend: number
  all_baseline_equivalent_weighted: number
  all_actual_input_weighted: number
  all_output_weighted: number
  all_usage_requests: number
  compressed_paid_requests: number
  passthrough_paid_requests: number
  compressed_actual_usd: number
  passthrough_actual_usd: number
  compressed_avg_usd_per_request: number
  passthrough_avg_usd_per_request: number
  compressed_minus_passthrough_avg_usd: number
  split_sufficient_sample: boolean
  split_min_sample_per_bucket: number
  saved_usd: number
  output_weighted: number
  baseline_token_equivalent: number
  actual_token_equivalent: number
  pricing_assumptions: PricingAssumptions
  measured_text_chars: number
  measured_thinking_chars: number
  measured_tool_use_chars: number
  measured_redacted_block_count: number
  events_with_measurement: number
  uptime_sec: number
  compression_enabled: boolean
}

/** Mirror of pxpipe's /api/current-session.json payload. */
export interface CurrentSessionPayload {
  sessionId: string | null
  message?: string
  baselineInputWeighted?: number
  actualInputWeighted?: number
  baselineMeasuredCount?: number
  allActualInputWeighted?: number
  allOutputWeighted?: number
  rawActualTokens?: number
  rawBaselineTokens?: number
  rawOutputTokens?: number
}

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

export interface CompressionToggleResult {
  compression_enabled: boolean
}

export interface DashboardRecentRow {
  ts: number
  method: string
  path: string
  model?: string
  status: number
  compressed: boolean
  cc_added?: number
  input_tokens?: number
  output_tokens?: number
  cache_create?: number
  cache_read?: number
  actual_input?: number
  baseline_input?: number
  session_saved_so_far_delta?: number
  img_id?: number
  img_ids?: number[]
}

export interface DashboardRecentPayload {
  recent: DashboardRecentRow[]
  has_preview: boolean
  preview_meta: string
  image_ids?: number[]
}

export interface ImageVsTextBreakdownPayload {
  id?: number
  latest?: boolean
  provider?: string
  path?: string | null
  model?: string | null
  compressed?: boolean
  restored?: boolean
  error?: string
  hint?: string
  comparison?: {
    have_baseline: boolean
    baseline_input_weighted: number | null
    actual_input_weighted: number
    saved_input_weighted: number | null
    saved_pct: number | null
    baseline_tokens_raw: number
    actual_tokens_raw: number
    cache_read_tokens: number
    text_cache_warm: boolean
    output_tokens_untouched: number
  }
  became_images?: {
    image_count: number
    bucket_chars: Record<string, number>
    images: Array<{
      id: number
      available: boolean
      png_url: string
      source_url: string
    }>
  }
  stayed_text?: {
    latest_messages: string
    output: string
    note: string
  }
}

export interface TokenImagePayload {
  id?: number
  meta: string
  available: boolean
  dataUrl?: string
  error?: string
}

export interface ImageSourcePayload {
  id?: number
  meta: string
  available: boolean
  sourceText?: string
  error?: string
}

export interface PxpipeDesktopApi {
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  startProxy(patch?: Partial<AppSettings>): Promise<ProxyStatus>
  stopProxy(): Promise<ProxyStatus>
  getProxyStatus(): Promise<ProxyStatus>
  listEvents(limit?: number): Promise<PersistedEvent[]>
  getStats(): Promise<StatsPayload>
  listSessions(limit?: number): Promise<SessionSummary[]>
  getProxyVerification(): Promise<ProxyVerification>
  getDashboardRecent(): Promise<DashboardRecentPayload>
  getProxyStats(): Promise<ProxyStatsPayload | null>
  getCurrentSession(): Promise<CurrentSessionPayload>
  setCompressionEnabled(enabled: boolean): Promise<CompressionToggleResult>
  getImageVsTextBreakdown(id?: number): Promise<ImageVsTextBreakdownPayload>
  getTokenImage(id?: number): Promise<TokenImagePayload>
  getImageSource(id?: number): Promise<ImageSourcePayload>
  launchClaude(cwd?: string): Promise<LaunchResult>
  launchCodex(cwd?: string): Promise<LaunchResult>
  importJsonl(path: string): Promise<ImportResult>
  getUpdateStatus(): Promise<AppUpdateStatus>
  checkForUpdates(): Promise<AppUpdateStatus>
  installUpdate(): Promise<AppUpdateStatus>
  onProxyEvent(callback: (event: PersistedEvent) => void): () => void
  onProxyStatus(callback: (status: ProxyStatus) => void): () => void
  onUpdateStatus(callback: (status: AppUpdateStatus) => void): () => void
}
