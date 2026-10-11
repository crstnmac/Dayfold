// Turns raw visible window text into a short, redacted summary of what is on screen. Pure: the
// helper sends text, this decides what (if anything) is worth keeping. Nothing here touches
// the DB or the network, so the privacy rules are covered by plain unit tests.
import { redact } from './adapters/privacy'

/** Longest summary stored per sample. */
export const MAX_CONTEXT_CHARS = 420
const MAX_LINES = 5
const MAX_LINE_CHARS = 140
/** Raw text longer than this is cut before any processing. */
export const MAX_RAW_CHARS = 6000

/** A line mentioning any of these is dropped whole, not just masked. */
const SECRET_LINE =
  /\b(pass(word|wd|phrase|code)?|secret|api[_ -]?key|access[_ -]?key|private[_ -]?key|token|bearer|authorization|credential|otp|one[- ]time|verification code|2fa|cvv|card number|iban|ssn|social security|seed phrase|recovery (code|phrase))\b/i
/** Card-like numbers and long digit runs. */
const DIGIT_RUN = /\b\d(?:[ -]?\d){11,}\b/
const URL_QUERY = /(https?:\/\/[^\s?#]+)[^\s]*/g
/** Labels that are interface chrome, not content. */
const CHROME = new Set([
  'file',
  'edit',
  'view',
  'window',
  'help',
  'back',
  'forward',
  'reload',
  'share',
  'search',
  'close',
  'minimize',
  'zoom',
  'settings',
  'new tab',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'send',
  'reply',
  'inbox',
  'sent',
  'drafts',
  'more',
  'menu',
  'home',
  'save',
  'cancel',
  'ok'
])

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

/** Higher is more likely to describe the work: sentence-like, not tiny, not a path or code blob. */
function score(line: string): number {
  const w = wordCount(line)
  if (w < 3) return 0
  const symbols = (line.match(/[{}()[\];=<>|\\/]/g) ?? []).length
  if (symbols / line.length > 0.12) return 0 // code or markup: noisy, and the likeliest to hold secrets
  let sc = Math.min(w, 20)
  if (/[a-z]{3,}/i.test(line)) sc += 2
  if (/[.!?:]$/.test(line)) sc += 1
  return sc
}

/**
 * Cleans raw window text and returns up to a few of its most meaningful lines, or '' when
 * nothing safe and useful remains. Deterministic: same text in, same summary out.
 */
export function summarizeVisibleText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const lines = raw
    .slice(0, MAX_RAW_CHARS)
    .replace(/\p{Cc}/gu, (c) => (c === '\n' ? '\n' : ' '))
    .split('\n')
  const seen = new Set<string>()
  const kept: { text: string; score: number; at: number }[] = []
  lines.forEach((l, at) => {
    let t = l.replace(/\s+/g, ' ').trim()
    if (t.length < 8 || SECRET_LINE.test(t) || DIGIT_RUN.test(t)) return
    t = redact(t.replace(URL_QUERY, '$1')) // never keep query strings or fragments
    if (CHROME.has(t.toLowerCase()) || /^\[(email|token|number|ip)\]$/.test(t)) return
    if (t.length > MAX_LINE_CHARS) t = `${t.slice(0, MAX_LINE_CHARS - 1)}…`
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    const s = score(t)
    if (s > 0) kept.push({ text: t, score: s, at })
  })
  const top = kept
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, MAX_LINES)
    .sort((a, b) => a.at - b.at) // back to reading order
  let out = ''
  for (const l of top) {
    if (out.length + l.text.length + 1 > MAX_CONTEXT_CHARS) break
    out += (out ? '\n' : '') + l.text
  }
  return out
}
