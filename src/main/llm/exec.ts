import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface RunOptions {
  stdin?: string
  timeoutMs: number
  cwd: string
  maxBytes?: number
}

// Credentials that would make a CLI bill an API account instead of the signed-in subscription.
const API_KEY_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_BASE_URL',
  'ANTHROPIC_BASE_URL'
]

const searchDirs = (): string[] => [
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.claude', 'local'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(homedir(), '.npm-global', 'bin'),
  join(homedir(), '.bun', 'bin'),
  join(homedir(), '.volta', 'bin')
]

/** A GUI-launched Electron app has a minimal PATH, so add the usual CLI install locations. */
export function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const k of API_KEY_VARS) delete env[k]
  env['PATH'] = [...searchDirs(), ...(env['PATH'] ?? '').split(':')].filter(Boolean).join(':')
  return env
}

export function findBinary(name: string): string | null {
  for (const d of searchDirs()) {
    const p = join(d, name)
    if (existsSync(p)) return p
  }
  for (const d of (process.env['PATH'] ?? '').split(':')) {
    if (d && existsSync(join(d, name))) return join(d, name)
  }
  return null
}

/** Spawns without a shell; kills the child on timeout; caps captured output. */
export function runCli(bin: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const max = opts.maxBytes ?? 1_000_000
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: cliEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => reject(new Error(`Timed out after ${Math.round(opts.timeoutMs / 1000)}s`)))
    }, opts.timeoutMs)
    child.stdout.on('data', (b: Buffer) => {
      if (stdout.length < max) stdout += b.toString('utf8')
    })
    child.stderr.on('data', (b: Buffer) => {
      if (stderr.length < max) stderr += b.toString('utf8')
    })
    child.on('error', (e) => finish(() => reject(e)))
    child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })))
    child.stdin.on('error', () => undefined)
    child.stdin.end(opts.stdin ?? '')
  })
}
