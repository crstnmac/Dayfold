import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LlmProviderId, LlmProviderStatus } from '../../shared/types'
import { findBinary, runCli } from './exec'

export interface LlmRequest {
  system: string
  user: string
  /** JSON Schema (strict: every property required, additionalProperties false). */
  schema: object
  /** Empty string = provider default. */
  model: string
  timeoutMs: number
}

export interface LlmProvider {
  id: LlmProviderId
  label: string
  defaultModel: string
  status(): Promise<LlmProviderStatus>
  /** Returns the model's structured output, parsed. Throws on any failure. */
  complete(req: LlmRequest): Promise<unknown>
}

// Model ids go to a CLI argv; keep them to a conservative alphabet.
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/
export const isValidModel = (m: string): boolean => m === '' || MODEL_RE.test(m)

const firstLine = (s: string): string => s.trim().split('\n')[0]?.slice(0, 200) ?? ''

/** Runs in an empty scratch dir so the CLI never picks up project files or instructions. */
async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'dash-llm-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function notInstalled(id: LlmProviderId, label: string, hint: string): LlmProviderStatus {
  return {
    id,
    label,
    installed: false,
    version: null,
    loggedIn: null,
    account: null,
    authMethod: 'unknown',
    detail: hint,
    defaultModel: ''
  }
}

export const claudeProvider: LlmProvider = {
  id: 'claude',
  label: 'Claude (subscription)',
  defaultModel: 'haiku',

  async status() {
    const bin = findBinary('claude')
    if (!bin)
      return notInstalled(
        'claude',
        this.label,
        'Claude Code CLI not found. Install it, then run `claude` once to sign in.'
      )
    const base = {
      id: this.id,
      label: this.label,
      defaultModel: this.defaultModel,
      installed: true
    }
    try {
      const cwd = tmpdir()
      const [v, a] = await Promise.all([
        runCli(bin, ['--version'], { cwd, timeoutMs: 10_000 }),
        runCli(bin, ['auth', 'status'], { cwd, timeoutMs: 15_000 })
      ])
      const version = firstLine(v.stdout) || null
      let info: {
        loggedIn?: boolean
        authMethod?: string
        email?: string
        subscriptionType?: string
      } = {}
      try {
        info = JSON.parse(a.stdout)
      } catch {
        /* older CLI or unexpected output */
      }
      const loggedIn = info.loggedIn === true
      const subscription = info.authMethod === 'claude.ai'
      return {
        ...base,
        version,
        loggedIn,
        account: info.email ?? null,
        authMethod: !loggedIn ? 'unknown' : subscription ? 'subscription' : 'api-key',
        detail: !loggedIn
          ? 'Not signed in. Run `claude` in a terminal and sign in with your Claude account.'
          : subscription
            ? `Signed in with your Claude ${info.subscriptionType ?? ''} subscription.`.replace(
                '  ',
                ' '
              )
            : 'Signed in with an API key, not a subscription. Dayfold will not use it; run `claude auth login`.'
      }
    } catch (e) {
      return {
        ...base,
        version: null,
        loggedIn: null,
        account: null,
        authMethod: 'unknown',
        detail: (e as Error).message
      }
    }
  },

  async complete(req) {
    const bin = findBinary('claude')
    if (!bin) throw new Error('Claude Code CLI not found')
    if (!isValidModel(req.model)) throw new Error('Invalid model name')
    const args = [
      '-p',
      req.user,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(req.schema),
      '--model',
      req.model || this.defaultModel,
      '--system-prompt',
      req.system,
      // Pure text-in/JSON-out: no tools, skills, MCP servers, user settings or saved session.
      '--tools',
      '',
      '--disable-slash-commands',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--no-session-persistence'
    ]
    const r = await withScratch((cwd) => runCli(bin, args, { cwd, timeoutMs: req.timeoutMs }))
    let out: { is_error?: boolean; result?: string; structured_output?: unknown }
    try {
      out = JSON.parse(r.stdout)
    } catch {
      throw new Error(firstLine(r.stderr) || firstLine(r.stdout) || `claude exited with ${r.code}`)
    }
    if (out.is_error)
      throw new Error(firstLine(String(out.result ?? '')) || 'Claude returned an error')
    if (out.structured_output !== undefined && out.structured_output !== null)
      return out.structured_output
    try {
      return JSON.parse(String(out.result))
    } catch {
      throw new Error('Claude did not return structured output')
    }
  }
}

export const codexProvider: LlmProvider = {
  id: 'codex',
  label: 'Codex (ChatGPT subscription)',
  defaultModel: '',

  async status() {
    const bin = findBinary('codex')
    if (!bin)
      return notInstalled(
        'codex',
        this.label,
        'Codex CLI not found. Install it, then run `codex login`.'
      )
    const base = {
      id: this.id,
      label: this.label,
      defaultModel: this.defaultModel,
      installed: true
    }
    try {
      const cwd = tmpdir()
      const [v, a] = await Promise.all([
        runCli(bin, ['--version'], { cwd, timeoutMs: 10_000 }),
        runCli(bin, ['login', 'status'], { cwd, timeoutMs: 15_000 })
      ])
      const text = `${a.stdout}\n${a.stderr}`
      const loggedIn = a.code === 0 && /logged in/i.test(text)
      const subscription = /chatgpt/i.test(text)
      return {
        ...base,
        version: firstLine(v.stdout) || null,
        loggedIn,
        account: null,
        authMethod: !loggedIn ? 'unknown' : subscription ? 'subscription' : 'api-key',
        detail: !loggedIn
          ? 'Not signed in. Run `codex login` and choose Sign in with ChatGPT.'
          : subscription
            ? 'Signed in with your ChatGPT subscription.'
            : 'Signed in with an API key, not a subscription. Dayfold will not use it; run `codex login`.'
      }
    } catch (e) {
      return {
        ...base,
        version: null,
        loggedIn: null,
        account: null,
        authMethod: 'unknown',
        detail: (e as Error).message
      }
    }
  },

  async complete(req) {
    const bin = findBinary('codex')
    if (!bin) throw new Error('Codex CLI not found')
    if (!isValidModel(req.model)) throw new Error('Invalid model name')
    return withScratch(async (cwd) => {
      const schemaFile = join(cwd, 'schema.json')
      const outFile = join(cwd, 'out.json')
      writeFileSync(schemaFile, JSON.stringify(req.schema))
      const args = [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--ignore-user-config',
        '--ignore-rules',
        '--sandbox',
        'read-only',
        '-c',
        'model_reasoning_effort="low"',
        '--output-schema',
        schemaFile,
        '-o',
        outFile,
        '-C',
        cwd,
        ...(req.model ? ['-m', req.model] : []),
        '-'
      ]
      // Codex has no system-prompt flag, so the instructions travel with the input.
      const r = await runCli(bin, args, {
        cwd,
        timeoutMs: req.timeoutMs,
        stdin: `${req.system}\n\n${req.user}`
      })
      let text = ''
      try {
        text = readFileSync(outFile, 'utf8')
      } catch {
        throw new Error(firstLine(r.stderr) || `codex exited with ${r.code}`)
      }
      try {
        return JSON.parse(text)
      } catch {
        throw new Error('Codex did not return structured output')
      }
    })
  }
}

export const PROVIDERS: Record<LlmProviderId, LlmProvider> = {
  claude: claudeProvider,
  codex: codexProvider
}
