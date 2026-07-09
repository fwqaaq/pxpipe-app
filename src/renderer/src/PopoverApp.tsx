import { useCallback, useEffect, useState } from 'react'
import type { PopoverStatsPayload, ProxyStatsPayload, ProxyStatus } from '../../shared/types'
import { I18nProvider, useI18n, type Lang } from './i18n'
import { Sparkline } from './components/SparklineChart'

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
    const refreshTimer = window.setTimeout(() => {
      void refresh()
    }, 0)
    const offShow = window.pxpipe.onPopoverShow(() => void refresh())
    const offStatus = window.pxpipe.onProxyStatus(() => void refresh())
    const offEvent = window.pxpipe.onProxyEvent(() => void refresh())
    return () => {
      window.clearTimeout(refreshTimer)
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
            running ? 'bg-neutral-700 hover:bg-neutral-600' : 'bg-emerald-600 hover:bg-emerald-500'
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
        <StatCard
          label={t('popover.todaySaved')}
          value={fmtCompact(stats.today.savedTokens, locale)}
        />
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
