import { useEffect, useMemo, useState } from 'react'
import type {
  AppSettings,
  AppTheme,
  AppUpdateStatus,
  CurrentSessionPayload,
  DashboardRecentPayload,
  DashboardRecentRow,
  ImageSourcePayload,
  ImageVsTextBreakdownPayload,
  ImportResult,
  LaunchResult,
  PersistedEvent,
  ProxyStatsPayload,
  ProxyStatus,
  ProxyVerification,
  SessionSummary,
  StatsPayload,
  TokenImagePayload
} from '../../shared/types'
import { MODEL_CATALOG, type ModelFamily } from '../../shared/model-catalog'

/** macOS uses a hidden-inset native title bar, so the layout leaves room for traffic lights. */
const isMac = navigator.userAgent.includes('Macintosh')
import {
  I18nProvider,
  localeFor,
  tFor,
  useI18n,
  type Lang,
  type MessageKey,
  type MessageParams
} from './i18n'

const emptyVerification: ProxyVerification = {
  listening: false,
  proxyUrl: 'http://127.0.0.1:47821',
  claudeBaseUrl: 'http://127.0.0.1:47821',
  codexBaseUrl: 'http://127.0.0.1:47821/v1',
  claudeRequests: 0,
  codexRequests: 0,
  pathCounts: []
}

const emptyStats: StatsPayload = {
  total: 0,
  ok2xx: 0,
  err4xx: 0,
  err5xx: 0,
  compressed: 0,
  passthrough: 0,
  origCharsTotal: 0,
  imageBytesTotal: 0,
  inputTokensTotal: 0,
  outputTokensTotal: 0,
  cacheCreateTokensTotal: 0,
  cacheReadTokensTotal: 0,
  baselineTokensTotal: 0,
  estimatedSavedTokensTotal: 0,
  compressionRate: 0,
  savedPct: 0,
  avgDurationMs: 0
}

const emptyDashboardRecent: DashboardRecentPayload = {
  recent: [],
  has_preview: false,
  preview_meta: '',
  image_ids: []
}

function compactNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1000) return `${(value / 1000).toFixed(abs >= 100_000 ? 0 : 1)}k`
  return String(Math.round(value))
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs > 0 && abs < 0.01) return `${sign}$${abs.toFixed(4)}`
  return `${sign}$${abs.toFixed(2)}`
}

function fmtBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = Math.max(0, value)
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function rowImageIds(row: DashboardRecentRow): number[] {
  return row.img_ids ?? (row.img_id == null ? [] : [row.img_id])
}

function firstImageId(rows: DashboardRecentRow[]): number | undefined {
  for (const row of [...rows].reverse()) {
    const id = rowImageIds(row)[0]
    if (id != null) return id
  }
  return undefined
}

function shortPath(value: string): string {
  const parts = value.split('/')
  return parts[parts.length - 1] || value
}

function parseModelBasesText(value: string): string[] {
  const seen = new Set<string>()
  const models: string[] = []
  for (const part of value.split(',')) {
    const model = part.trim()
    if (model && !seen.has(model)) {
      seen.add(model)
      models.push(model)
    }
  }
  return models
}

function ModelChip({
  id,
  label,
  selected,
  onToggle
}: {
  id: string
  label: string
  selected: boolean
  onToggle: (id: string) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        selected
          ? 'border-circuit/70 bg-circuit/15 text-circuit shadow-glow'
          : 'border-line bg-surface text-white/55 hover:border-white/25 hover:text-white/80'
      }`}
    >
      {label}
      {selected ? ' ✓' : ''}
    </button>
  )
}

function fmtNumber(value: number | undefined, locale = 'en-US'): string {
  return value === undefined ? '—' : new Intl.NumberFormat(locale).format(Math.round(value))
}

function fmtPct(value: number): string {
  return `${value.toFixed(1)}%`
}

function shortDate(value: string | undefined, locale = 'en-US'): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(locale)
}

function StatCard({
  label,
  value,
  tone = 'neutral'
}: {
  label: string
  value: string
  tone?: 'neutral' | 'good' | 'warn'
}): React.JSX.Element {
  const toneClass =
    tone === 'good' ? 'text-circuit' : tone === 'warn' ? 'text-danger' : 'text-paper'
  return (
    <div className="panel p-5">
      <div className="text-xs uppercase tracking-[0.1em] text-white/50">{label}</div>
      <div className={`mt-3 font-display text-3xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  )
}

function BreakdownMetric({
  label,
  value,
  tone = 'neutral'
}: {
  label: string
  value: string
  tone?: 'neutral' | 'good' | 'warn'
}): React.JSX.Element {
  const toneClass =
    tone === 'good' ? 'text-circuit' : tone === 'warn' ? 'text-danger' : 'text-paper'
  return (
    <div className="inset min-w-0 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/45">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold ${toneClass}`}>{value}</div>
    </div>
  )
}

function PricingRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-2 text-sm">
      <span className="text-white/55">{label}</span>
      <span className="font-mono text-paper">{value}</span>
    </div>
  )
}

function PricingPanel({ proxyStats }: { proxyStats: ProxyStatsPayload | null }): React.JSX.Element {
  const { t } = useI18n()
  const pricing = proxyStats?.pricing_assumptions
  const savedTone = (proxyStats?.saved_usd ?? 0) >= 0
  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] font-black uppercase tracking-[0.12em] text-brass">
            {t('pricing.api')}
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-[-0.03em]">
            {t('pricing.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-white/50">
            {t('pricing.description')}
          </p>
        </div>
        {proxyStats && (
          <div
            className={`rounded-2xl border px-4 py-3 text-right ${
              savedTone ? 'border-circuit/25 bg-circuit/10' : 'border-danger/25 bg-danger/10'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">
              {t('pricing.savedSoFar')}
            </div>
            <div
              className={`font-display text-3xl font-black ${savedTone ? 'text-circuit' : 'text-danger'}`}
            >
              {fmtUsd(proxyStats.saved_usd)}
            </div>
            <div className="mt-0.5 font-mono text-xs text-white/45">
              {t('pricing.weightedInputTok', {
                tokens: compactNumber(proxyStats.saved_input_tokens)
              })}
            </div>
          </div>
        )}
      </div>

      {!proxyStats ? (
        <div className="mt-5 rounded-card border border-dashed border-line-strong bg-surface-sunken p-8 text-center text-sm text-white/40">
          {t('pricing.empty')}
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-3 gap-4">
          <div className="inset p-4">
            <div className="text-xs font-black uppercase tracking-[0.1em] text-white/40">
              {t('pricing.savingsShare')}
            </div>
            <div className="mt-3 grid gap-2">
              <PricingRow
                label={t('pricing.inputOnlySaved')}
                value={`${proxyStats.saved_pct_input_only.toFixed(1)}%`}
              />
              <PricingRow
                label={t('pricing.ofAllSpend')}
                value={`${proxyStats.saved_pct_of_all_spend.toFixed(1)}%`}
              />
              <PricingRow
                label={t('pricing.baselineInput')}
                value={compactNumber(proxyStats.baseline_input_weighted)}
              />
              <PricingRow
                label={t('pricing.actualInput')}
                value={compactNumber(proxyStats.actual_input_weighted)}
              />
              <p className="pt-1 text-xs leading-5 text-white/40">
                {t('pricing.outputNote', { tokens: compactNumber(proxyStats.output_weighted) })}
              </p>
            </div>
          </div>

          <div className="inset p-4">
            <div className="text-xs font-black uppercase tracking-[0.1em] text-white/40">
              {t('pricing.observedSplit')}
            </div>
            <div className="mt-3 grid gap-2">
              <PricingRow
                label={t('pricing.compressedAvg', { count: proxyStats.compressed_paid_requests })}
                value={fmtUsd(proxyStats.compressed_avg_usd_per_request)}
              />
              <PricingRow
                label={t('pricing.passthroughAvg', { count: proxyStats.passthrough_paid_requests })}
                value={fmtUsd(proxyStats.passthrough_avg_usd_per_request)}
              />
              {proxyStats.split_sufficient_sample ? (
                <PricingRow
                  label={t('pricing.deltaPerRequest')}
                  value={fmtUsd(proxyStats.compressed_minus_passthrough_avg_usd)}
                />
              ) : (
                <p className="pt-1 text-xs leading-5 text-brass">
                  {t('pricing.smallSample', { count: proxyStats.split_min_sample_per_bucket })}
                </p>
              )}
              <PricingRow
                label={t('pricing.compressedTotal')}
                value={fmtUsd(proxyStats.compressed_actual_usd)}
              />
              <PricingRow
                label={t('pricing.passthroughTotal')}
                value={fmtUsd(proxyStats.passthrough_actual_usd)}
              />
            </div>
          </div>

          <div className="rounded-3xl border border-brass/20 bg-brass/[0.07] p-4">
            <div className="text-xs font-black uppercase tracking-[0.1em] text-brass">
              {t('pricing.assumptions')}
            </div>
            <div className="mt-3 grid gap-2">
              <PricingRow
                label={t('pricing.input')}
                value={`$${pricing?.input_per_mtok ?? '—'}/MTok`}
              />
              <PricingRow
                label={t('pricing.output')}
                value={`× ${pricing?.output_multiplier ?? '—'}`}
              />
              <PricingRow
                label={t('pricing.cacheWrite5m')}
                value={`× ${pricing?.cache_write_5m_multiplier ?? '—'}`}
              />
              <PricingRow
                label={t('pricing.cacheWrite1h')}
                value={`× ${pricing?.cache_write_1h_multiplier ?? '—'}`}
              />
              <PricingRow
                label={t('pricing.cacheRead')}
                value={`× ${pricing?.cache_read_multiplier ?? '—'}`}
              />
              <p className="pt-1 text-xs leading-5 text-white/40">{pricing?.source}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UpdatePanel({
  status,
  onCheck,
  onInstall
}: {
  status: AppUpdateStatus | null
  onCheck: () => void
  onInstall: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const state = status?.state ?? 'idle'
  const checking = state === 'checking' || state === 'available' || state === 'downloading'
  const ready = state === 'downloaded'
  const progress = Math.max(0, Math.min(100, status?.percent ?? 0))
  const tone =
    state === 'error'
      ? 'text-danger'
      : ready || state === 'available'
        ? 'text-circuit'
        : 'text-paper'

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] font-black uppercase tracking-[0.12em] text-circuit">
            {t('updates.eyebrow')}
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-[-0.03em]">
            {t('updates.title')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-white/45">{t('updates.description')}</p>
        </div>
        <div className="shrink-0 rounded-full border border-line px-3 py-1 font-mono text-xs text-white/55">
          v{status?.currentVersion ?? '—'}
        </div>
      </div>

      <div className="mt-4 inset p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.08em] text-white/40">
            {t('updates.status')}
          </span>
          <span className={`font-mono text-xs font-bold ${tone}`}>
            {t(`updates.state.${state}` as MessageKey)}
          </span>
        </div>
        {status?.availableVersion ? (
          <div className="mt-2 flex items-center justify-between gap-3 text-sm">
            <span className="text-white/45">{t('updates.availableVersion')}</span>
            <span className="font-mono text-paper">v{status.availableVersion}</span>
          </div>
        ) : null}
        {state === 'downloading' ? (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-circuit transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between gap-3 font-mono text-[11px] text-white/45">
              <span>{progress.toFixed(0)}%</span>
              <span>
                {fmtBytes(status?.transferred)} / {fmtBytes(status?.total)}
              </span>
            </div>
          </div>
        ) : null}
        {status?.error ? (
          <p className="mt-3 break-words text-xs leading-5 text-danger">{status.error}</p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-ghost px-4 py-2 text-xs"
          disabled={checking || status?.isSupported === false}
          onClick={onCheck}
        >
          {checking ? t('updates.checking') : t('updates.check')}
        </button>
        {ready ? (
          <button type="button" className="btn-primary px-4 py-2 text-xs" onClick={onInstall}>
            {t('updates.install')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ImageVsTextPanel({
  breakdown,
  tokenImage,
  imageSource,
  galleryImageDataUrls,
  selectedTokenImageId,
  onSelectImage
}: {
  breakdown: ImageVsTextBreakdownPayload | null
  tokenImage: TokenImagePayload | null
  imageSource: ImageSourcePayload | null
  galleryImageDataUrls: Record<number, string>
  selectedTokenImageId: number | undefined
  onSelectImage: (id: number) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const comparison = breakdown?.comparison
  const images = breakdown?.became_images?.images ?? []
  const saved = comparison?.saved_input_weighted ?? undefined
  const savedTone = saved == null || saved >= 0 ? 'good' : 'warn'
  const endpoint = breakdown?.id
    ? `/api/image-vs-text-breakdown.json?id=${breakdown.id}`
    : '/api/image-vs-text-breakdown.json'

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] font-black uppercase tracking-[0.12em] text-circuit">
            {t('inspector.api')}
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-[-0.03em]">
            {t('inspector.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-white/50">
            {t('inspector.description')}
          </p>
        </div>
        <div className="rounded-2xl border border-circuit/20 bg-circuit/10 px-3 py-2 font-mono text-xs text-circuit">
          GET {endpoint}
        </div>
      </div>

      {breakdown?.error ? (
        <div className="mt-5 rounded-card border border-dashed border-line-strong bg-surface-sunken p-8 text-center">
          <div className="font-display text-2xl font-bold text-paper">
            {t('inspector.emptyTitle')}
          </div>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-white/50">
            {t('inspector.emptyDescription')}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-3">
            <BreakdownMetric
              label={t('inspector.asText')}
              value={compactNumber(comparison?.baseline_input_weighted)}
            />
            <div className="grid place-items-center text-xl font-black text-circuit">→</div>
            <BreakdownMetric
              label={t('inspector.tokenImage')}
              value={`${breakdown?.became_images?.image_count ?? 0} PNG`}
              tone="good"
            />
            <div className="grid place-items-center text-xl font-black text-circuit">→</div>
            <BreakdownMetric
              label={t('inspector.sent')}
              value={compactNumber(comparison?.actual_input_weighted)}
            />
          </div>

          <div className="mt-3 inset px-4 py-3 text-sm text-white/55">
            <span
              className={savedTone === 'good' ? 'font-bold text-circuit' : 'font-bold text-danger'}
            >
              {saved == null
                ? t('inspector.baselinePending')
                : t(saved >= 0 ? 'inspector.saved' : 'inspector.lost', {
                    tokens: compactNumber(Math.abs(saved))
                  })}
            </span>{' '}
            <span>
              {t('inspector.afterCache', {
                tokens: compactNumber(comparison?.output_tokens_untouched)
              })}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div className="rounded-3xl border border-brass/20 bg-brass/10 p-4">
              <div className="text-xs font-black uppercase tracking-[0.1em] text-brass">
                {t('inspector.becameImages')}
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                {Object.entries(breakdown?.became_images?.bucket_chars ?? {}).map(
                  ([key, value]) => (
                    <div
                      key={key}
                      className="flex justify-between gap-3 border-b border-line pb-2"
                    >
                      <span className="text-white/55">{key.replace(/_/g, ' ')}</span>
                      <span className="font-mono text-paper">
                        {t('inspector.chars', { count: compactNumber(value) })}
                      </span>
                    </div>
                  )
                )}
                {Object.keys(breakdown?.became_images?.bucket_chars ?? {}).length === 0 && (
                  <div className="text-white/40">{t('inspector.noBuckets')}</div>
                )}
              </div>
            </div>
            <div className="rounded-3xl border border-circuit/20 bg-circuit/10 p-4">
              <div className="text-xs font-black uppercase tracking-[0.1em] text-circuit">
                {t('inspector.stayedText')}
              </div>
              <div className="mt-3 grid gap-2 text-sm text-white/55">
                <div className="flex justify-between border-b border-line pb-2">
                  <span>{t('inspector.latestMessages')}</span>
                  <span className="text-paper">{t('inspector.verbatim')}</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span>{t('inspector.modelOutput')}</span>
                  <span className="text-paper">{t('inspector.verbatim')}</span>
                </div>
                <p className="text-xs leading-5 text-white/40">{t('inspector.exactNote')}</p>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs font-black uppercase tracking-[0.1em] text-white/40">
                {t('inspector.gallery')}
              </div>
              <div className="text-xs text-white/35">{t('inspector.galleryHint')}</div>
            </div>
            {images.length === 0 ? (
              <div className="rounded-card border border-dashed border-line p-8 text-center text-white/35">
                {t('inspector.noPages')}
              </div>
            ) : (
              <div className="grid max-h-60 grid-cols-3 gap-3 overflow-auto inset p-3">
                {images.map((image) => {
                  const dataUrl =
                    selectedTokenImageId === image.id && tokenImage?.dataUrl
                      ? tokenImage.dataUrl
                      : galleryImageDataUrls[image.id]

                  return (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => onSelectImage(image.id)}
                      className={`min-h-28 rounded-2xl border p-2 text-left transition ${
                        selectedTokenImageId === image.id
                          ? 'border-circuit bg-circuit/10'
                          : 'border-line bg-surface hover:border-white/25'
                      }`}
                    >
                      {image.available && dataUrl ? (
                        <img
                          src={dataUrl}
                          alt={t('inspector.imageAlt', { id: image.id })}
                          className="h-24 w-full rounded-xl bg-[#fff] object-cover object-top [image-rendering:pixelated]"
                        />
                      ) : (
                        <div className="grid h-24 place-items-center rounded-xl border border-dashed border-white/15 bg-surface-sunken text-center text-xs text-white/35">
                          {image.available ? 'PNG' : t('inspector.imageExpired')}
                        </div>
                      )}
                      <div className="mt-2 font-mono text-xs text-white/50">
                        {t('inspector.imageLabel', { id: image.id })}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div className="inset p-3">
              <div className="mb-2 text-xs font-black uppercase tracking-[0.1em] text-white/40">
                {t('inspector.preview')}
              </div>
              {tokenImage?.available && tokenImage.dataUrl ? (
                <img
                  src={tokenImage.dataUrl}
                  alt={t('inspector.selectedImageAlt', { id: selectedTokenImageId ?? '' })}
                  className="max-h-72 w-full rounded-2xl bg-[#fff] object-contain object-top [image-rendering:pixelated]"
                />
              ) : (
                <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-line text-center text-sm text-white/35">
                  {selectedTokenImageId == null
                    ? t('inspector.selectPage')
                    : t('inspector.imageExpired')}
                </div>
              )}
            </div>
            <div className="inset p-3">
              <div className="mb-2 text-xs font-black uppercase tracking-[0.1em] text-white/40">
                {t('inspector.source')}
              </div>
              {imageSource?.available ? (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-surface-raised p-3 font-mono text-[11px] leading-5 text-paper/75">
                  {imageSource.sourceText}
                </pre>
              ) : (
                <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-line text-center text-sm text-white/35">
                  {imageSource?.error ?? t('inspector.sourcePlaceholder')}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

type MessageDescriptor = { key: MessageKey; params?: MessageParams } | { raw: string }

function App(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [modelBasesText, setModelBasesText] = useState('')
  const [status, setStatus] = useState<ProxyStatus | null>(null)
  const [stats, setStats] = useState<StatsPayload>(emptyStats)
  const [events, setEvents] = useState<PersistedEvent[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [verification, setVerification] = useState<ProxyVerification>(emptyVerification)
  const [launchCwd, setLaunchCwd] = useState('')
  const [lastLaunch, setLastLaunch] = useState<LaunchResult | null>(null)
  const [importPath, setImportPath] = useState('~/.pxpipe/events.jsonl')
  const [message, setMessage] = useState<MessageDescriptor | null>(null)
  const [dashboardRecent, setDashboardRecent] =
    useState<DashboardRecentPayload>(emptyDashboardRecent)
  const [selectedBreakdownId, setSelectedBreakdownId] = useState<number | undefined>()
  const [breakdown, setBreakdown] = useState<ImageVsTextBreakdownPayload | null>(null)
  const [selectedTokenImageId, setSelectedTokenImageId] = useState<number | undefined>()
  const [tokenImage, setTokenImage] = useState<TokenImagePayload | null>(null)
  const [imageSource, setImageSource] = useState<ImageSourcePayload | null>(null)
  const [galleryImageDataUrls, setGalleryImageDataUrls] = useState<Record<number, string>>({})
  const [proxyStats, setProxyStats] = useState<ProxyStatsPayload | null>(null)
  const [currentSession, setCurrentSession] = useState<CurrentSessionPayload | null>(null)
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)

  const proxyUrl = status?.url ?? 'http://127.0.0.1:47821'
  const lang: Lang = settings?.language ?? 'en'
  const locale = localeFor(lang)
  const t = useMemo(() => tFor(lang), [lang])
  const galleryImageIdsKey = useMemo(
    () =>
      breakdown?.became_images?.images
        .filter((image) => image.available)
        .map((image) => image.id)
        .join(',') ?? '',
    [breakdown]
  )

  useEffect(() => {
    if (!galleryImageIdsKey) return

    const missingIds = galleryImageIdsKey
      .split(',')
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && galleryImageDataUrls[id] == null)

    if (missingIds.length === 0) return

    let cancelled = false

    void Promise.all(
      missingIds.map(async (id) => {
        try {
          const image = await window.pxpipe.getTokenImage(id)
          return [id, image.available && image.dataUrl ? image.dataUrl : null] as const
        } catch {
          return [id, null] as const
        }
      })
    ).then((entries) => {
      if (cancelled) return
      setGalleryImageDataUrls((previous) => {
        let changed = false
        const next = { ...previous }
        for (const [id, dataUrl] of entries) {
          if (dataUrl && next[id] !== dataUrl) {
            next[id] = dataUrl
            changed = true
          }
        }
        return changed ? next : previous
      })
    })

    return () => {
      cancelled = true
    }
  }, [galleryImageIdsKey, galleryImageDataUrls])

  async function loadTokenImage(id: number | undefined): Promise<void> {
    if (id == null) {
      setSelectedTokenImageId(undefined)
      setTokenImage(null)
      setImageSource(null)
      return
    }
    setSelectedTokenImageId(id)
    const [image, source] = await Promise.all([
      window.pxpipe.getTokenImage(id),
      window.pxpipe.getImageSource(id)
    ])
    setTokenImage(image)
    if (image.available && image.dataUrl) {
      const dataUrl = image.dataUrl
      setGalleryImageDataUrls((previous) =>
        previous[id] === dataUrl ? previous : { ...previous, [id]: dataUrl }
      )
    }
    setImageSource(source)
  }

  async function refreshInspector(nextId = selectedBreakdownId): Promise<void> {
    const recent = await window.pxpipe.getDashboardRecent()
    setDashboardRecent(recent)
    const id = nextId ?? firstImageId(recent.recent)
    if (id == null) {
      setSelectedBreakdownId(undefined)
      setBreakdown(await window.pxpipe.getImageVsTextBreakdown())
      await loadTokenImage(undefined)
      return
    }
    setSelectedBreakdownId(id)
    const nextBreakdown = await window.pxpipe.getImageVsTextBreakdown(id)
    setBreakdown(nextBreakdown)
    const nextImages = nextBreakdown.became_images?.images ?? []
    const selectedStillPresent =
      selectedTokenImageId != null && nextImages.some((image) => image.id === selectedTokenImageId)
    const firstAvailable = nextImages.find((image) => image.available)?.id
    const firstAny = nextImages[0]?.id
    await loadTokenImage(selectedStillPresent ? selectedTokenImageId : (firstAvailable ?? firstAny))
  }

  async function selectBreakdown(id: number): Promise<void> {
    setSelectedBreakdownId(id)
    setSelectedTokenImageId(undefined)
    const nextBreakdown = await window.pxpipe.getImageVsTextBreakdown(id)
    setBreakdown(nextBreakdown)
    const first = nextBreakdown.became_images?.images.find((image) => image.available)?.id
    await loadTokenImage(first ?? nextBreakdown.became_images?.images[0]?.id)
  }

  async function refresh(): Promise<void> {
    const [
      nextSettings,
      nextStatus,
      nextStats,
      nextEvents,
      nextSessions,
      nextVerification,
      nextProxyStats,
      nextCurrentSession,
      nextUpdateStatus
    ] = await Promise.all([
      window.pxpipe.getSettings(),
      window.pxpipe.getProxyStatus(),
      window.pxpipe.getStats(),
      window.pxpipe.listEvents(80),
      window.pxpipe.listSessions(20),
      window.pxpipe.getProxyVerification(),
      window.pxpipe.getProxyStats(),
      window.pxpipe.getCurrentSession(),
      window.pxpipe.getUpdateStatus()
    ])
    setSettings(nextSettings)
    setModelBasesText(nextSettings.modelBases.join(', '))
    setStatus(nextStatus)
    setStats(nextStats)
    setEvents(nextEvents)
    setSessions(nextSessions)
    setVerification(nextVerification)
    setProxyStats(nextProxyStats)
    setCurrentSession(nextCurrentSession)
    setUpdateStatus(nextUpdateStatus)
    await refreshInspector()
  }

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refresh()
    }, 0)
    const offEvent = window.pxpipe.onProxyEvent((event) => {
      setEvents((current) => [event, ...current].slice(0, 80))
      window.pxpipe.getStats().then(setStats)
      window.pxpipe.listSessions(20).then(setSessions)
      window.pxpipe.getProxyVerification().then(setVerification)
      window.pxpipe.getProxyStats().then(setProxyStats)
      window.pxpipe.getCurrentSession().then(setCurrentSession)
      void refreshInspector()
    })
    const offStatus = window.pxpipe.onProxyStatus(setStatus)
    const offUpdateStatus = window.pxpipe.onUpdateStatus(setUpdateStatus)
    return () => {
      window.clearTimeout(refreshTimer)
      offEvent()
      offStatus()
      offUpdateStatus()
    }
  }, [])

  interface RequestRowView {
    key: string
    index: number
    time: string
    status: number
    path: string
    model?: string
    imageCount: number
    imgId?: number
    input?: number
    output?: number
    cacheRead?: number
    saved?: number
  }

  const requestRows = useMemo<RequestRowView[]>(() => {
    if (dashboardRecent.recent.length > 0) {
      return dashboardRecent.recent
        .map((row, index) => {
          const ids = rowImageIds(row)
          const saved =
            row.baseline_input != null && row.actual_input != null
              ? row.baseline_input - row.actual_input
              : row.session_saved_so_far_delta
          return {
            key: `d-${row.ts}-${index}`,
            index: index + 1,
            // row.ts is a Unix timestamp in SECONDS (dashboard stamps Date.now()/1000);
            // Date() expects milliseconds, so scale up or every row shows the same time.
            time: new Date(row.ts * 1000).toLocaleTimeString(locale),
            status: row.status,
            path: shortPath(row.path),
            model: row.model,
            imageCount: ids.length,
            imgId: ids[0],
            input: row.input_tokens,
            output: row.output_tokens,
            cacheRead: row.cache_read,
            saved
          }
        })
        .reverse()
    }
    // DB fallback so history stays visible when the proxy is stopped.
    return events.map((event, index) => ({
      key: `e-${event.id}`,
      index: events.length - index,
      time: new Date(event.ts).toLocaleTimeString(locale),
      status: event.status,
      path: shortPath(event.path),
      model: event.model,
      imageCount: event.imageCount ?? 0,
      imgId: undefined,
      input: event.inputTokens,
      output: event.outputTokens,
      cacheRead: event.cacheReadTokens,
      saved: event.estimatedSavedTokens
    }))
  }, [dashboardRecent, events, locale])

  const sessionSaved =
    currentSession?.baselineInputWeighted != null && currentSession.actualInputWeighted != null
      ? currentSession.baselineInputWeighted - currentSession.actualInputWeighted
      : undefined
  const inputRatePerMtok = proxyStats?.pricing_assumptions.input_per_mtok ?? 10
  const sessionSavedUsd = sessionSaved == null ? undefined : (sessionSaved * inputRatePerMtok) / 1e6

  const settingsPatch = useMemo(() => {
    if (!settings) return null
    return {
      ...settings,
      modelBases: parseModelBasesText(modelBasesText)
    }
  }, [settings, modelBasesText])

  const selectedModelBases = useMemo(
    () => new Set(parseModelBasesText(modelBasesText)),
    [modelBasesText]
  )

  function toggleModelBase(model: string): void {
    const models = parseModelBasesText(modelBasesText)
    const next = models.includes(model) ? models.filter((m) => m !== model) : [...models, model]
    setModelBasesText(next.join(', '))
  }

  function modelChips(family: ModelFamily): React.JSX.Element[] {
    return MODEL_CATALOG.filter((model) => model.family === family).map((model) => (
      <ModelChip
        key={model.id}
        id={model.id}
        label={model.label}
        selected={selectedModelBases.has(model.id)}
        onToggle={toggleModelBase}
      />
    ))
  }

  async function saveSettings(): Promise<AppSettings | null> {
    if (!settingsPatch) return null
    const next = await window.pxpipe.updateSettings(settingsPatch)
    setSettings(next)
    setModelBasesText(next.modelBases.join(', '))
    setMessage({ key: 'msg.settingsSaved' })
    return next
  }

  async function startProxy(): Promise<void> {
    if (!settingsPatch) return
    const next = await window.pxpipe.startProxy(settingsPatch)
    setStatus(next)
    setMessage(
      next.error
        ? { key: 'msg.startFailed', params: { error: next.error } }
        : { key: 'msg.proxyListening', params: { url: next.url } }
    )
  }

  async function stopProxy(): Promise<void> {
    const next = await window.pxpipe.stopProxy()
    setStatus(next)
    setMessage({ key: 'msg.proxyStopped' })
  }

  async function toggleCompression(): Promise<void> {
    if (!proxyStats) return
    const next = await window.pxpipe.setCompressionEnabled(!proxyStats.compression_enabled)
    setProxyStats({ ...proxyStats, compression_enabled: next.compression_enabled })
    setMessage({
      key: next.compression_enabled ? 'msg.compressionEnabled' : 'msg.compressionDisabled'
    })
  }

  async function launch(kind: 'claude' | 'codex'): Promise<void> {
    const result =
      kind === 'claude'
        ? await window.pxpipe.launchClaude(launchCwd || undefined)
        : await window.pxpipe.launchCodex(launchCwd || undefined)
    setLastLaunch(result)
    setMessage(
      result.ok
        ? { key: 'msg.launched', params: { kind } }
        : { key: 'msg.launchFailed', params: { error: result.error ?? '' } }
    )
  }

  async function copyCommand(kind: 'claude' | 'codex'): Promise<void> {
    const base = proxyUrl
    const command =
      kind === 'claude' ? `ANTHROPIC_BASE_URL=${base} claude` : `OPENAI_BASE_URL=${base}/v1 codex`
    await navigator.clipboard.writeText(command)
    setMessage({ key: 'msg.copiedLaunch', params: { kind } })
  }

  async function setLanguage(language: Lang): Promise<void> {
    if (!settings || settings.language === language) return
    const optimistic = { ...settings, language }
    setSettings(optimistic)
    const next = await window.pxpipe.updateSettings({ language })
    setSettings(next)
    setModelBasesText(next.modelBases.join(', '))
  }

  async function setTheme(theme: AppTheme): Promise<void> {
    if (!settings || settings.theme === theme) return
    const optimistic = { ...settings, theme }
    setSettings(optimistic)
    const next = await window.pxpipe.updateSettings({ theme })
    setSettings(next)
  }

  async function importJsonl(): Promise<void> {
    try {
      const result: ImportResult = await window.pxpipe.importJsonl(importPath)
      await refresh()
      setMessage({
        key: 'msg.imported',
        params: { imported: result.imported, skipped: result.skipped }
      })
    } catch (error) {
      setMessage({ raw: error instanceof Error ? error.message : String(error) })
    }
  }

  async function checkForUpdates(): Promise<void> {
    const next = await window.pxpipe.checkForUpdates()
    setUpdateStatus(next)
  }

  async function installUpdate(): Promise<void> {
    const next = await window.pxpipe.installUpdate()
    setUpdateStatus(next)
  }

  if (!settings || !status) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink text-paper">
        {t('msg.loading')}
      </div>
    )
  }

  return (
    <I18nProvider lang={lang}>
      <main className="min-h-screen overflow-x-hidden bg-ink text-paper">
        <div className="app-glow pointer-events-none fixed inset-0" />

        {isMac && <div className="drag fixed inset-x-0 top-0 z-50 h-9" />}

        <section
          className={`relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-8 pb-12 ${
            isMac ? 'pt-11' : 'pt-7'
          }`}
        >
          <header className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="mb-3 inline-flex items-center rounded-full border border-circuit/30 bg-circuit/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-circuit">
                  {t('header.badge')}
                </div>
                <h1 className="font-display text-4xl font-black tracking-[-0.04em] sm:text-5xl">
                  {t('header.title')}
                </h1>
                <p className="mt-2.5 max-w-2xl text-sm leading-6 text-white/60">
                  {t('header.description')}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                <div
                  className="inline-flex rounded-full border border-line bg-surface p-1"
                  role="group"
                  aria-label={t('header.theme')}
                >
                  {(['light', 'system', 'dark'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => void setTheme(option)}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                        settings.theme === option
                          ? 'bg-circuit/15 text-circuit'
                          : 'text-white/50 hover:text-white/85'
                      }`}
                    >
                      {option === 'light'
                        ? t('header.themeLight')
                        : option === 'dark'
                          ? t('header.themeDark')
                          : t('header.themeSystem')}
                    </button>
                  ))}
                </div>

                <div
                  className="inline-flex rounded-full border border-line bg-surface p-1"
                  role="group"
                  aria-label="Language"
                >
                  {(['en', 'zh'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => void setLanguage(option)}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                        lang === option
                          ? 'bg-circuit/15 text-circuit'
                          : 'text-white/50 hover:text-white/85'
                      }`}
                    >
                      {option === 'en' ? t('header.langEn') : t('header.langZh')}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Connection control bar — status, proxy URL, compression, start/stop laid out horizontally. */}
            <div className="panel flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5">
              <div className="flex items-center gap-2.5 pr-1">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    status.running ? 'bg-circuit animate-pulse' : 'bg-danger'
                  }`}
                />
                <span
                  className={`text-sm font-semibold ${status.running ? 'text-circuit' : 'text-danger'}`}
                >
                  {status.running ? t('status.running') : t('status.stopped')}
                </span>
              </div>

              <div className="inset flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2">
                <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-white/35">
                  URL
                </span>
                <span className="truncate font-mono text-xs text-white/75" title={proxyUrl}>
                  {proxyUrl}
                </span>
              </div>

              <div className="inset flex items-center gap-3 px-3 py-1.5">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/45">
                    {t('status.compression')}
                  </div>
                  <div
                    className={`text-xs font-semibold ${proxyStats?.compression_enabled ? 'text-circuit' : 'text-white/55'}`}
                  >
                    {proxyStats == null
                      ? t('status.compressionUnavailable')
                      : proxyStats.compression_enabled
                        ? t('status.compressionOn')
                        : t('status.compressionOff')}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label={t('status.compressionSwitch')}
                  aria-checked={Boolean(proxyStats?.compression_enabled)}
                  className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    proxyStats?.compression_enabled
                      ? 'border-circuit/60 bg-circuit/70'
                      : 'border-line-strong bg-white/10'
                  }`}
                  disabled={!status.running || proxyStats == null}
                  onClick={toggleCompression}
                >
                  <span
                    className={`h-4 w-4 rounded-full bg-paper shadow transition ${
                      proxyStats?.compression_enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="btn-primary px-5"
                  disabled={status.running}
                  onClick={startProxy}
                >
                  {t('status.start')}
                </button>
                <button className="btn-ghost px-5" disabled={!status.running} onClick={stopProxy}>
                  {t('status.stop')}
                </button>
              </div>
            </div>
          </header>

          {message && (
            <div className="rounded-2xl border border-brass/30 bg-brass/10 px-4 py-3 text-sm text-brass">
              {'raw' in message ? message.raw : t(message.key, message.params)}
            </div>
          )}

          <section className="grid grid-cols-[1.1fr_0.9fr] gap-5">
            <div className="rounded-[2rem] border border-circuit/20 bg-circuit/[0.07] p-5 shadow-panel backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-2xl font-bold tracking-[-0.03em]">
                    {t('launch.title')}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-white/55">{t('launch.description')}</p>
                </div>
                <div className="max-w-full shrink-0 whitespace-nowrap rounded-full border border-line px-3 py-1 text-xs uppercase tracking-[0.12em] text-white/45">
                  {t('launch.verifiedEnv')}
                </div>
              </div>
              <label className="mt-4 grid gap-1 text-xs uppercase tracking-[0.08em] text-white/40">
                {t('launch.cwd')}
                <input
                  className="field"
                  placeholder="~/Project/pxpipe"
                  value={launchCwd}
                  onChange={(event) => setLaunchCwd(event.target.value)}
                />
              </label>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  className="btn-primary w-full"
                  disabled={!status.running}
                  onClick={() => launch('claude')}
                >
                  {t('launch.claude')}
                </button>
                <button
                  className="btn-accent w-full"
                  disabled={!status.running}
                  onClick={() => launch('codex')}
                >
                  {t('launch.codex')}
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => copyCommand('claude')}
                >
                  {t('launch.copyClaude')}
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => copyCommand('codex')}
                >
                  {t('launch.copyCodex')}
                </button>
              </div>
              {lastLaunch && (
                <div className="mt-4 inset p-3 font-mono text-xs text-white/55">
                  {lastLaunch.command}
                </div>
              )}
            </div>

            <div className="panel p-5">
              <h2 className="font-display text-2xl font-bold tracking-[-0.03em]">
                {t('verify.title')}
              </h2>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="flex items-center justify-between inset px-3 py-2">
                  <span className="text-white/45">{t('verify.listening')}</span>
                  <span className={verification.listening ? 'text-circuit' : 'text-danger'}>
                    {verification.listening ? t('verify.yes') : t('verify.no')}
                  </span>
                </div>
                <div className="flex items-center justify-between inset px-3 py-2">
                  <span className="text-white/45">{t('verify.claudeLastSeen')}</span>
                  <span className="text-circuit">
                    {shortDate(verification.claudeLastSeen, locale)}
                  </span>
                </div>
                <div className="flex items-center justify-between inset px-3 py-2">
                  <span className="text-white/45">{t('verify.codexLastSeen')}</span>
                  <span className={verification.codexLastSeen ? 'text-circuit' : 'text-danger'}>
                    {shortDate(verification.codexLastSeen, locale)}
                  </span>
                </div>
                <div className="inset px-3 py-2 font-mono text-xs text-white/45">
                  Claude: ANTHROPIC_BASE_URL={verification.claudeBaseUrl}
                  <br />
                  Codex: OPENAI_BASE_URL={verification.codexBaseUrl}
                </div>
                <div className="inset px-3 py-3">
                  <div className="mb-2 text-xs uppercase tracking-[0.08em] text-white/35">
                    {t('verify.recentPaths')}
                  </div>
                  <div className="grid max-h-28 gap-1 overflow-auto font-mono text-xs text-white/50">
                    {verification.pathCounts.slice(0, 6).map((row) => (
                      <div key={`${row.method}:${row.path}`} className="flex justify-between gap-3">
                        <span className="truncate">
                          {row.method} {row.path}
                        </span>
                        <span className="text-brass">{row.count}</span>
                      </div>
                    ))}
                    {verification.pathCounts.length === 0 && <span>{t('verify.noTraffic')}</span>}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-[1.15fr_2.2fr] gap-4">
            <div className="rounded-[2rem] border border-circuit/25 bg-circuit/[0.08] p-5 shadow-panel backdrop-blur">
              <div className="text-xs uppercase tracking-[0.28em] text-circuit/80">
                {t('stats.sessionSaved')}
              </div>
              <div className="mt-3 font-display text-6xl font-black tracking-[-0.04em] text-circuit">
                {compactNumber(sessionSaved)}
              </div>
              <div className="mt-2 font-mono text-sm text-white/60">
                {sessionSavedUsd == null
                  ? t('stats.waiting')
                  : t('stats.usdAtRate', { usd: fmtUsd(sessionSavedUsd), rate: inputRatePerMtok })}
              </div>
              <p className="mt-3 text-xs leading-5 text-white/45">
                {t('stats.sessionSummary')}
                {currentSession?.sessionId ? (
                  <span className="ml-1 font-mono text-white/35">
                    {t('stats.sessionId', { id: currentSession.sessionId.slice(0, 8) })}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <StatCard label={t('stats.requests')} value={fmtNumber(stats.total, locale)} />
              <StatCard
                label={t('stats.compressed')}
                value={fmtPct(stats.compressionRate)}
                tone="good"
              />
              <StatCard
                label={t('stats.savedTokens')}
                value={fmtNumber(stats.estimatedSavedTokensTotal, locale)}
                tone="good"
              />
              <StatCard
                label={t('stats.avgLatency')}
                value={`${fmtNumber(stats.avgDurationMs, locale)} ${t('stats.ms')}`}
                tone={stats.avgDurationMs > 2000 ? 'warn' : 'neutral'}
              />
            </div>
          </section>

          <PricingPanel proxyStats={proxyStats} />

          <section className="grid grid-cols-[0.95fr_1.45fr] gap-5">
            <div className="min-w-0 space-y-5">
              <div className="panel p-5">
                <h2 className="font-display text-2xl font-bold tracking-[-0.03em]">
                  {t('settings.title')}
                </h2>
                <div className="mt-5 grid gap-3">
                  <label className="grid gap-1 text-xs uppercase tracking-[0.08em] text-white/40">
                    {t('settings.host')}
                    <input
                      className="field"
                      value={settings.host}
                      onChange={(event) => setSettings({ ...settings, host: event.target.value })}
                    />
                  </label>
                  <label className="grid gap-1 text-xs uppercase tracking-[0.08em] text-white/40">
                    {t('settings.port')}
                    <input
                      className="field"
                      type="number"
                      value={settings.port}
                      onChange={(event) =>
                        setSettings({ ...settings, port: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs uppercase tracking-[0.08em] text-white/40">
                    {t('settings.anthropicUpstream')}
                    <input
                      className="field"
                      value={settings.anthropicUpstream}
                      onChange={(event) =>
                        setSettings({ ...settings, anthropicUpstream: event.target.value })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs uppercase tracking-[0.08em] text-white/40">
                    {t('settings.openAIUpstream')}
                    <input
                      className="field"
                      value={settings.openAIUpstream}
                      onChange={(event) =>
                        setSettings({ ...settings, openAIUpstream: event.target.value })
                      }
                    />
                  </label>
                  <div className="grid gap-3">
                    <label className="grid gap-1 text-xs uppercase tracking-[0.08em] text-white/40">
                      {t('settings.modelAllowlist')}
                      <input
                        className="field"
                        value={modelBasesText}
                        onChange={(event) => setModelBasesText(event.target.value)}
                      />
                    </label>
                    <div className="grid gap-3 inset p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs uppercase tracking-[0.08em] text-white/40">
                          {t('settings.knownModels')}
                        </span>
                        <span className="text-xs text-white/35">{t('settings.modelHint')}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-1 text-xs font-semibold uppercase tracking-[0.08em] text-white/35">
                          Claude
                        </span>
                        {modelChips('claude')}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-1 text-xs font-semibold uppercase tracking-[0.08em] text-white/35">
                          GPT
                        </span>
                        {modelChips('gpt')}
                      </div>
                    </div>
                  </div>
                  <label className="flex items-center gap-3 inset px-3 py-3 text-sm text-white/65">
                    <input
                      type="checkbox"
                      checked={settings.autoStart}
                      onChange={(event) =>
                        setSettings({ ...settings, autoStart: event.target.checked })
                      }
                    />
                    {t('settings.autoStart')}
                  </label>
                  <button
                    className="rounded-2xl bg-paper px-4 py-3 text-sm font-black text-ink transition hover:scale-[1.01]"
                    onClick={saveSettings}
                  >
                    {t('settings.save')}
                  </button>
                </div>
              </div>

              <UpdatePanel
                status={updateStatus}
                onCheck={() => void checkForUpdates()}
                onInstall={() => void installUpdate()}
              />

              <div className="panel p-5">
                <h2 className="font-display text-2xl font-bold tracking-[-0.03em]">
                  {t('settings.importTitle')}
                </h2>
                <p className="mt-2 text-sm text-white/45">{t('settings.importDescription')}</p>
                <div className="mt-4 flex gap-2">
                  <input
                    className="min-w-0 flex-1 field"
                    value={importPath}
                    onChange={(event) => setImportPath(event.target.value)}
                  />
                  <button
                    className="rounded-2xl border border-brass/40 px-4 py-2 text-sm font-bold text-brass hover:bg-brass/10"
                    onClick={importJsonl}
                  >
                    {t('settings.import')}
                  </button>
                </div>
              </div>
            </div>

            <div className="min-w-0 space-y-5">
              <div className="panel p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-2xl font-bold tracking-[-0.03em]">
                    {t('requests.title')}
                  </h2>
                  <button
                    className="btn-ghost px-3 py-2 text-xs uppercase tracking-[0.08em] text-white/55"
                    onClick={refresh}
                  >
                    {t('requests.refresh')}
                  </button>
                </div>
                <div className="mt-4 max-h-[360px] overflow-auto rounded-xl border border-line">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-surface-raised text-xs uppercase tracking-[0.16em] text-white/40">
                      <tr>
                        <th className="px-3 py-3">#</th>
                        <th className="whitespace-nowrap px-3 py-3">{t('requests.time')}</th>
                        <th className="px-3 py-3">{t('requests.status')}</th>
                        <th className="px-3 py-3">{t('requests.path')}</th>
                        <th className="px-3 py-3">{t('requests.model')}</th>
                        <th className="whitespace-nowrap px-3 py-3">{t('requests.type')}</th>
                        <th className="whitespace-nowrap px-3 py-3 text-right">
                          {t('requests.in')}
                        </th>
                        <th className="whitespace-nowrap px-3 py-3 text-right">
                          {t('requests.out')}
                        </th>
                        <th className="whitespace-nowrap px-3 py-3 text-right">
                          {t('requests.cacheR')}
                        </th>
                        <th className="whitespace-nowrap px-3 py-3 text-right">
                          {t('requests.saved')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {requestRows.map((row) => (
                        <tr
                          key={row.key}
                          onClick={() => {
                            if (row.imgId != null) void selectBreakdown(row.imgId)
                          }}
                          className={`transition ${row.imgId != null ? 'cursor-pointer' : ''} ${
                            row.imgId != null && row.imgId === selectedBreakdownId
                              ? 'bg-circuit/10'
                              : 'hover:bg-surface'
                          }`}
                        >
                          <td className="px-3 py-2.5 font-mono text-xs text-white/30">
                            {row.index}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-white/45">
                            {row.time}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <span
                              className={`rounded-md px-2 py-0.5 font-mono text-xs font-bold ${
                                row.status >= 500
                                  ? 'bg-danger/15 text-danger'
                                  : row.status >= 400
                                    ? 'bg-brass/15 text-brass'
                                    : 'bg-circuit/15 text-circuit'
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td
                            className="max-w-40 truncate px-3 py-2.5 font-mono text-xs text-white/70"
                            title={row.path}
                          >
                            {row.path}
                          </td>
                          <td
                            className="max-w-36 truncate px-3 py-2.5 text-xs text-white/55"
                            title={row.model ?? '—'}
                          >
                            {row.model ?? '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <span
                              className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${
                                row.imageCount > 0
                                  ? 'bg-brass/15 text-brass'
                                  : 'bg-white/[0.06] text-white/50'
                              }`}
                            >
                              {row.imageCount > 0
                                ? t('requests.imageType', { count: row.imageCount })
                                : t('requests.textType')}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-white/60">
                            {compactNumber(row.input)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-white/60">
                            {compactNumber(row.output)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-white/45">
                            {compactNumber(row.cacheRead)}
                          </td>
                          <td
                            className={`whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs font-bold ${
                              row.saved != null && row.saved < 0 ? 'text-danger' : 'text-brass'
                            }`}
                          >
                            {compactNumber(row.saved)}
                          </td>
                        </tr>
                      ))}
                      {requestRows.length === 0 && (
                        <tr>
                          <td className="px-4 py-10 text-center text-white/35" colSpan={10}>
                            {t('requests.empty')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-white/35">
                  {t('requests.hintPrefix')}{' '}
                  <span className="text-brass">{t('requests.hintImage')}</span>{' '}
                  {t('requests.hintSuffix')}
                </p>
              </div>

              <ImageVsTextPanel
                breakdown={breakdown}
                tokenImage={tokenImage}
                imageSource={imageSource}
                galleryImageDataUrls={galleryImageDataUrls}
                selectedTokenImageId={selectedTokenImageId}
                onSelectImage={(id) => void loadTokenImage(id)}
              />

              <div className="panel p-5">
                <h2 className="font-display text-2xl font-bold tracking-[-0.03em]">
                  {t('sessions.title')}
                </h2>
                <div className="mt-4 grid gap-3">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="inset p-4"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-mono text-sm text-circuit">{session.id}</div>
                          <div className="mt-1 truncate text-sm text-white/45">
                            {session.project ?? t('sessions.unknownProject')}
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          <div className="text-paper">
                            {t('sessions.requests', {
                              count: fmtNumber(session.requestCount, locale)
                            })}
                          </div>
                          <div className="text-brass">
                            {t('sessions.saved', {
                              count: fmtNumber(session.estimatedSavedTokens, locale)
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {sessions.length === 0 && (
                    <div className="rounded-card border border-dashed border-line p-8 text-center text-white/35">
                      {t('sessions.empty')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </section>
      </main>
    </I18nProvider>
  )
}

export default App
