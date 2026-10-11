import type { DatabaseSync } from 'node:sqlite'
import type {
  LlmConfig,
  LlmProviderId,
  LlmStatus,
  ActivitySession,
  AppState,
  DayReview,
  ISODate,
  LlmTestResult,
  TriageResult
} from '../../shared/types'
import { interpret, type Interpretation } from './interpret'
import { triage } from './triage'
import { buildReviewInput, reviewDay } from './review'
import { isValidModel, PROVIDERS, type LlmProvider } from './providers'

const KEY = 'llm.config'
const DEFAULT: LlmConfig = { provider: null, model: '' }

export function getConfig(db: DatabaseSync): LlmConfig {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as
    { value: string } | undefined
  if (!row) return DEFAULT
  try {
    return sanitize(JSON.parse(row.value))
  } catch {
    return DEFAULT
  }
}

/** Accepts untrusted input (IPC) and returns a safe config or throws. */
export function sanitize(raw: unknown): LlmConfig {
  const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const provider = c.provider ?? null
  if (provider !== null && provider !== 'claude' && provider !== 'codex')
    throw new Error('Unknown provider')
  const model = typeof c.model === 'string' ? c.model.trim() : ''
  if (!isValidModel(model)) throw new Error('Invalid model name')
  return { provider: provider as LlmProviderId | null, model }
}

export function setConfig(db: DatabaseSync, raw: unknown): LlmConfig {
  const config = sanitize(raw)
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    KEY,
    JSON.stringify(config)
  )
  return config
}

export async function getStatus(db: DatabaseSync): Promise<LlmStatus> {
  const providers = await Promise.all(Object.values(PROVIDERS).map((p) => p.status()))
  return { config: getConfig(db), providers }
}

/** Calls are serialized: one CLI process at a time keeps the subscription's rate limits calm. */
let tail: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  tail = run.catch(() => undefined)
  return run
}

const PING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' } }
}

export async function testConnection(db: DatabaseSync): Promise<LlmTestResult> {
  const { provider, model } = getConfig(db)
  if (!provider) return { ok: false, message: 'Choose a provider first.', ms: 0 }
  const p = PROVIDERS[provider]
  const status = await p.status()
  if (!status.installed || !status.loggedIn || status.authMethod !== 'subscription')
    return { ok: false, message: status.detail, ms: 0 }
  const t0 = Date.now()
  try {
    const out = (await serial(() =>
      p.complete({
        system: 'You are a connectivity check. Reply with ok set to true.',
        user: 'ping',
        schema: PING_SCHEMA,
        model,
        timeoutMs: 90_000
      })
    )) as { ok?: unknown }
    const ms = Date.now() - t0
    return out?.ok === true
      ? { ok: true, message: `${p.label} responded in ${(ms / 1000).toFixed(1)}s.`, ms }
      : { ok: false, message: 'Unexpected response from the model.', ms }
  } catch (e) {
    return { ok: false, message: (e as Error).message, ms: Date.now() - t0 }
  }
}

export interface FallbackResult {
  provider: LlmProvider
  result: Interpretation
}

/** Returns null when the LLM is switched off. Throws if the provider is unusable or misbehaves. */
export async function interpretWithConfigured(
  db: DatabaseSync,
  utterance: string
): Promise<FallbackResult | null> {
  const { provider: id, model } = getConfig(db)
  if (!id) return null
  const provider = PROVIDERS[id]
  const result = await serial(() => interpret(db, utterance, provider, model))
  return { provider, result }
}

export async function triageDump(db: DatabaseSync): Promise<TriageResult> {
  const { provider: id, model } = getConfig(db)
  if (!id)
    return { ok: false, message: 'Turn on AI assist (header) to get suggestions.', suggestions: [] }
  try {
    const suggestions = await serial(() => triage(db, PROVIDERS[id], model))
    return { ok: true, message: '', suggestions }
  } catch (e) {
    return {
      ok: false,
      message: `AI assist failed (${(e as Error).message.slice(0, 160)}).`,
      suggestions: []
    }
  }
}

export interface ReviewOutcome {
  ok: boolean
  message: string
  review?: DayReview
}

/** Writes the AI review of a day. Sends redacted session summaries to the configured CLI. */
export async function reviewActivityDay(
  db: DatabaseSync,
  date: ISODate,
  sessions: ActivitySession[],
  state: Pick<AppState, 'doneToday' | 'plate'>
): Promise<ReviewOutcome> {
  const { provider: id, model } = getConfig(db)
  if (!id) return { ok: false, message: 'Turn on AI assist (header) to review your day.' }
  if (sessions.length === 0)
    return { ok: false, message: 'No work sessions to review for this day yet.' }
  try {
    const input = buildReviewInput(date, sessions, state)
    const review = await serial(() => reviewDay(PROVIDERS[id], model, input))
    return { ok: true, message: '', review }
  } catch (e) {
    return { ok: false, message: `AI review failed (${(e as Error).message.slice(0, 160)}).` }
  }
}
