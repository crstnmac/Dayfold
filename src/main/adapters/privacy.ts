/** Strip query string and fragment; return host and path. Never keep tokens or search terms. */
export function sanitizeUrl(raw: string): { url: string; host: string; path: string } {
  if (!raw) return { url: '', host: '', path: '' }
  try {
    const u = new URL(raw)
    if (!/^https?:$/.test(u.protocol)) return { url: '', host: '', path: '' }
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    return { url: `${host}${u.pathname}`, host, path: u.pathname }
  } catch {
    return { url: '', host: '', path: '' }
  }
}

/** Pages where the title/URL are likely to expose credentials or one-time links. */
const SENSITIVE_PATH =
  /(^|[/._-])(log-?in|sign-?(in|up|on)|sso|auth|oauth2?|password|passwd|reset|verify|2fa|mfa|otp|magic|token|secure|account)([/._-]|$)/i
const SENSITIVE_HOST = /^(accounts?|login|auth|id|sso|secure|signin)\./i

export function isSensitivePage(host: string, path: string): boolean {
  return SENSITIVE_HOST.test(host) || SENSITIVE_PATH.test(path)
}

/**
 * Sites that are never recorded, not even by host: banking and payments, identity providers,
 * password managers, HR/payroll and health portals. (Domain list ported from the owner's
 * Memento project, adapters.rs.)
 */
const BLOCKED_HOSTS = [
  'chase.com',
  'wellsfargo.com',
  'bankofamerica.com',
  'citibank.com',
  'capitalone.com',
  'hdfcbank.com',
  'icicibank.com',
  'axisbank.com',
  'sbi.co.in',
  'paytm.com',
  'phonepe.com',
  'gpay.app',
  'razorpay.com',
  'stripe.com',
  'plaid.com',
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'login.yahoo.com',
  'appleid.apple.com',
  'okta.com',
  'auth0.com',
  '1password.com',
  'bitwarden.com',
  'lastpass.com',
  'dashlane.com',
  'keeper.io',
  'workday.com',
  'bamboohr.com',
  'gusto.com',
  'adp.com',
  'paylocity.com',
  'rippling.com',
  'mychart.com',
  'kaiserpermanente.org',
  'practo.com'
]

export function isBlockedHost(host: string): boolean {
  return BLOCKED_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))
}

/** Keep readable path segments only; drop IDs, hashes and long tokens. */
export function safePath(path: string): string {
  return path
    .split('/')
    .filter(
      (seg) => seg && seg.length < 16 && !(/\d/.test(seg) && /[a-z]/i.test(seg) && seg.length >= 8)
    )
    .map((seg) => (/^\d+$/.test(seg) ? '#' : seg))
    .join('/')
    .replace(/^/, '/')
}

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g
const PHONE = /\+?\d[\d\s().-]{6,}\d/g
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g
// 16+ chars mixing letters and digits, or base64-ish with +/=; plain long words are left alone.
const TOKEN = /(?=[A-Za-z0-9+/_=-]*\d)(?=[A-Za-z0-9+/_=-]*[A-Za-z])[A-Za-z0-9+/_=-]{16,}/g

const KEY_PREFIX = /\b(?:sk|pk|rk|ghp|gho|ghs|xox[abp]|AKIA|ASIA)[-_A-Za-z0-9]{8,}/g
const LONG_RUN = /[A-Za-z0-9+/_=-]{32,}/g

/** Remove obvious identifiers from free text before it is ever stored. */
export function redact(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(IPV4, '[ip]')
    .replace(PHONE, '[number]')
    .replace(KEY_PREFIX, '[token]')
    .replace(LONG_RUN, '[token]')
    .replace(TOKEN, '[token]')
}
