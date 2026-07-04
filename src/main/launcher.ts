import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import type { AppSettings, LaunchKind, LaunchResult } from '../shared/types'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function expandHomePath(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return `${homedir()}/${value.slice(2)}`
  return value
}

function proxyUrl(settings: AppSettings): string {
  const host = settings.host.includes(':') ? `[${settings.host}]` : settings.host
  return `http://${host}:${settings.port}`
}

export function launchCommand(kind: LaunchKind, settings: AppSettings, cwd?: string): string {
  const dir = expandHomePath(cwd?.trim() || homedir())
  const base = proxyUrl(settings)
  const envPart =
    kind === 'claude'
      ? `ANTHROPIC_BASE_URL=${shellQuote(base)}`
      : `OPENAI_BASE_URL=${shellQuote(`${base}/v1`)}`
  const binary = kind === 'claude' ? 'claude' : 'codex'
  return `cd ${shellQuote(dir)} && ${envPart} ${binary}`
}

export function launchClient(kind: LaunchKind, settings: AppSettings, cwd?: string): LaunchResult {
  const command = launchCommand(kind, settings, cwd)
  try {
    if (process.platform === 'darwin') {
      const script = `tell application "Terminal"\n  activate\n  do script ${JSON.stringify(command)}\nend tell`
      const child = spawn('/usr/bin/osascript', ['-e', script], {
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
      return { ok: true, kind, command, pid: child.pid }
    }

    const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/sh'
    const args = process.platform === 'win32' ? ['/c', 'start', command] : ['-lc', command]
    const child = spawn(shell, args, {
      cwd: expandHomePath(cwd?.trim() || homedir()),
      env: {
        ...process.env,
        ...(kind === 'claude'
          ? { ANTHROPIC_BASE_URL: proxyUrl(settings) }
          : { OPENAI_BASE_URL: `${proxyUrl(settings)}/v1` })
      },
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    return { ok: true, kind, command, pid: child.pid }
  } catch (error) {
    return {
      ok: false,
      kind,
      command,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
