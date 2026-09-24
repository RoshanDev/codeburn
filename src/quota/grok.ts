// Live Grok Build quota with the OAuth login the Grok CLI already owns
// (ported from the menubar's GrokBuildSubscriptionService.swift):
//
// - GET https://cli-chat-proxy.grok.com/v1/billing?format=credits -> usage
// - GET https://cli-chat-proxy.grok.com/v1/settings -> the plan display name,
//     optional: a failure there costs the label, not the reading.
//
// Credential: $GROK_HOME/auth.json (default ~/.grok/auth.json), read-only. The
// file maps a login scope to its token; the current OIDC login wins over the
// older sign-in one. The access token lives six hours and only the Grok CLI
// refreshes it, so a login nobody has used for an afternoon reads as expired
// while its refresh token is still good. CodeBurn never writes the file and
// never spends the refresh token itself (a rotation the CLI did not see would
// sign it out); it asks the CLI to refresh by running a command that needs the
// login, reads the file again, and calls it terminal only if that fails.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { quotaRequestSignal, readSecureFile, sanitizeError } from './security.js'
import type { QuotaProvider, QuotaWindow } from './types.js'

const BILLING_ENDPOINT = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'
const SETTINGS_ENDPOINT = 'https://cli-chat-proxy.grok.com/v1/settings'
const SOURCE_FOOTER = ['Source: Grok Build']
const EXPIRED_FOOTER = ['The Grok Build login has expired. Run `grok login`, then click Retry.']
const UNREADABLE_FOOTER = ["Could not read Grok Build's local login. Run `grok login` again, then click Retry."]
const REJECTED_FOOTER = ['Grok rejected the current Grok Build login. Run `grok login`, then click Retry.']
const RATE_LIMITED_FOOTER = ['Grok rate-limited the quota request.']
const UNAVAILABLE_FOOTER = ['Grok quota is temporarily unavailable.']
const PARSE_FOOTER = ['Grok returned an unrecognized quota response.']

export type GrokDeps = {
  fetch: typeof fetch
  credentialPath: string
  readFile: typeof readSecureFile
  now: () => number
  /** Has the Grok CLI refresh its own login. Resolves true when the CLI ran cleanly. */
  refreshLogin: () => Promise<boolean>
}

/** Refresh this far ahead of the stamp, so a token does not lapse mid-request. */
const EXPIRY_MARGIN_MS = 60_000
/** Long enough for a cold CLI start plus the token grant behind a slow proxy. */
const REFRESH_TIMEOUT_MS = 30_000

export function grokAuthPath(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const configured = env['GROK_HOME']?.trim()
  const grokHome = configured
    ? (configured.startsWith('~') ? path.join(home, configured.slice(1)) : configured)
    : path.join(home, '.grok')
  return path.join(grokHome, 'auth.json')
}

/** The CLI the installer puts under $GROK_HOME/bin, else whatever `grok` is on PATH. */
export function grokBinary(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const bundled = path.join(path.dirname(grokAuthPath(env, home)), 'bin', 'grok')
  return existsSync(bundled) ? bundled : 'grok'
}

/** `grok models` needs a live login, so the CLI refreshes an expired access
 *  token (under its own lock, with its own refresh-token rotation) before it
 *  lists them. It opens no UI and makes no model call. */
function runGrokRefresh(): Promise<boolean> {
  return new Promise(resolve => {
    execFile(grokBinary(), ['models'], { timeout: REFRESH_TIMEOUT_MS, windowsHide: true }, error => {
      resolve(error === null)
    })
  })
}

function defaultDeps(): GrokDeps {
  return { fetch: globalThis.fetch, credentialPath: grokAuthPath(), readFile: readSecureFile, now: Date.now, refreshLogin: runGrokRefresh }
}

type CredentialRead = GrokCredential | 'malformed' | null

async function readCredential(deps: GrokDeps): Promise<CredentialRead> {
  const raw = await deps.readFile(deps.credentialPath, 128 * 1024)
  return raw ? decodeGrokCredential(raw) : null
}

/** Asks the CLI to refresh, then reads the file again. Null when nothing newer came of it. */
async function refreshedCredential(deps: GrokDeps, held: GrokCredential): Promise<GrokCredential | null> {
  if (!(await deps.refreshLogin())) return null
  const next = await readCredential(deps)
  if (next === null || next === 'malformed' || next.accessToken === held.accessToken) return null
  return next
}

function expired(credential: GrokCredential, now: number): boolean {
  return credential.expiresAt !== null && credential.expiresAt - EXPIRY_MARGIN_MS <= now
}

function empty(connection: QuotaProvider['connection'], footerLines: string[] = []): QuotaProvider {
  return { provider: 'grok', connection, primary: null, details: [], planLabel: null, footerLines }
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseDate(value: unknown): number | null {
  const raw = nonEmpty(value)
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export type GrokCredential = { accessToken: string; authMode: string | null; expiresAt: number | null }

/** The current OIDC login first, then the older sign-in one, then anything
 *  else; equal ranks break by scope so the pick never depends on key order. */
function credentialRank(scope: string): number {
  if (scope.startsWith('https://auth.x.ai::')) return 0
  if (scope.includes('/sign-in')) return 1
  return 2
}

/** `'malformed'` separates a file we cannot understand (terminal, the user has
 *  to log in again) from a file with no token in it at all. */
export function decodeGrokCredential(raw: string): GrokCredential | 'malformed' | null {
  let entries: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'malformed'
    entries = parsed as Record<string, unknown>
  } catch {
    return 'malformed'
  }
  const usable = Object.entries(entries)
    .map(([scope, entry]) => ({
      scope,
      entry: (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>,
    }))
    .filter(row => nonEmpty(row.entry['key']) !== null)
    .sort((a, b) => credentialRank(a.scope) - credentialRank(b.scope) || (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0))
  const selected = usable[0]
  if (!selected) return null
  return {
    accessToken: nonEmpty(selected.entry['key'])!,
    authMode: nonEmpty(selected.entry['auth_mode']),
    expiresAt: parseDate(selected.entry['expires_at']),
  }
}

/** The period type the billing API sends, when it is one with a name. */
const PERIOD_TYPE_LABELS: Record<string, string> = {
  USAGE_PERIOD_TYPE_DAILY: 'Daily',
  USAGE_PERIOD_TYPE_WEEKLY: 'Weekly',
  USAGE_PERIOD_TYPE_MONTHLY: 'Monthly',
}

/** Grok bills one credit pool. The window is named by the period type the API
 *  sends, else by its length, and only failing both by how long is left: a
 *  weekly window three days from its reset is still weekly. */
export function grokPeriodLabel(type: unknown, startsAt: number | null, resetsAt: number | null, now: number): string {
  const named = typeof type === 'string' ? PERIOD_TYPE_LABELS[type] : undefined
  if (named) return named
  if (startsAt !== null && resetsAt !== null && resetsAt > startsAt) {
    const days = Math.round((resetsAt - startsAt) / 86_400_000)
    if (days === 1) return 'Daily'
    if (days === 7) return 'Weekly'
    if (days >= 28 && days <= 31) return 'Monthly'
  }
  return grokWindowLabel(resetsAt, now)
}

/** The fallback for a payload with no period: named after how long is left. */
export function grokWindowLabel(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return 'Credits'
  const days = Math.round((resetsAt - now) / 86_400_000)
  if (days >= 4 && days <= 12) return 'Weekly'
  if (days >= 20 && days <= 45) return 'Monthly'
  return 'Credits'
}

/** "supergrok_heavy" and "SuperGrok Heavy" are the same plan; anything the
 *  menubar does not know is passed through as sent. */
export function grokPlanLabel(value: unknown): string | null {
  const raw = nonEmpty(value)
  if (!raw) return null
  const letters = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (letters === 'supergrokheavy' || letters === 'heavy') return 'SuperGrok Heavy'
  if (letters === 'supergrok') return 'SuperGrok'
  return raw
}

export type GrokBilling = { window: QuotaWindow; tier: string | null }

/** `null` when the payload carries no usable percentage. */
export function decodeGrokBilling(body: unknown, now: number): GrokBilling | null {
  const root = body && typeof body === 'object' ? body as Record<string, any> : {}
  const config = root.config
  if (!config || typeof config !== 'object') return null

  let percent = num(config.creditUsagePercent)
  if (percent === null) {
    const used = num(config.onDemandUsed?.val)
    const cap = num(config.onDemandCap?.val)
    if (used !== null && cap !== null && used >= 0 && cap > 0) percent = used / cap * 100
  }
  if (percent === null) return null

  const resetsAt = parseDate(config.currentPeriod?.end ?? config.billingPeriodEnd)
  const startsAt = parseDate(config.currentPeriod?.start ?? config.billingPeriodStart)
  return {
    window: {
      label: grokPeriodLabel(config.currentPeriod?.type, startsAt, resetsAt, now),
      percent: Math.min(1, Math.max(0, percent / 100)),
      resetsAt: resetsAt === null ? null : new Date(resetsAt).toISOString(),
      ...(startsAt === null ? {} : { startsAt: new Date(startsAt).toISOString() }),
    },
    tier: nonEmpty(config.subscriptionTier) ?? nonEmpty(root.subscriptionTier),
  }
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'x-xai-token-auth': 'xai-grok-cli',
    Accept: 'application/json',
    'User-Agent': 'CodeBurn',
  }
}

/** The plan name is a nicety: any failure leaves the reading intact. */
async function fetchPlan(token: string, deps: GrokDeps, parent?: AbortSignal): Promise<string | null> {
  try {
    const response = await deps.fetch(SETTINGS_ENDPOINT, {
      method: 'GET', signal: quotaRequestSignal(parent), headers: headers(token),
    })
    if (!response.ok) return null
    const body = await response.json() as Record<string, unknown>
    return nonEmpty(body['subscription_tier_display'])
  } catch {
    return null
  }
}

export type GrokResult = { quota: QuotaProvider; retryAfterSeconds?: number }

export async function fetchGrokQuota(options: Partial<GrokDeps> & { signal?: AbortSignal } = {}): Promise<GrokResult> {
  const deps = { ...defaultDeps(), ...options }
  try {
    const read = await readCredential(deps)
    if (read === 'malformed') return { quota: empty('terminalFailure', UNREADABLE_FOOTER) }
    if (read === null) return { quota: empty('disconnected') }
    let credential = read

    const now = deps.now()
    if (expired(credential, now)) {
      const next = await refreshedCredential(deps, credential)
      if (next === null || expired(next, deps.now())) return { quota: empty('terminalFailure', EXPIRED_FOOTER) }
      credential = next
    }

    const requestBilling = (token: string) => deps.fetch(BILLING_ENDPOINT, {
      method: 'GET', signal: quotaRequestSignal(options.signal), headers: headers(token),
    })
    let response = await requestBilling(credential.accessToken)
    if (response.status === 401 || response.status === 403) {
      // A token revoked before its stamp says so gets the same one refresh.
      const next = await refreshedCredential(deps, credential)
      if (next === null) return { quota: empty('terminalFailure', REJECTED_FOOTER) }
      credential = next
      response = await requestBilling(credential.accessToken)
      if (response.status === 401 || response.status === 403) return { quota: empty('terminalFailure', REJECTED_FOOTER) }
    }
    if (response.status === 429) {
      const header = response.headers.get('Retry-After')
      const seconds = header === null ? NaN : Number(header)
      return {
        quota: { ...empty('transientFailure', RATE_LIMITED_FOOTER), rateLimited: true },
        retryAfterSeconds: Math.max(Number.isFinite(seconds) ? Math.ceil(seconds) : 300, 60),
      }
    }
    if (response.status >= 500) return { quota: empty('transientFailure', UNAVAILABLE_FOOTER) }
    if (!response.ok) return { quota: empty('transientFailure', PARSE_FOOTER) }

    // Never log the body - it carries account data.
    const billing = decodeGrokBilling(await response.json(), now)
    if (billing === null) return { quota: empty('transientFailure', PARSE_FOOTER) }

    const plan = await fetchPlan(credential.accessToken, deps, options.signal)
    return {
      quota: {
        provider: 'grok', connection: 'connected',
        primary: billing.window,
        details: [billing.window],
        planLabel: grokPlanLabel(plan) ?? grokPlanLabel(billing.tier),
        footerLines: SOURCE_FOOTER,
      },
    }
  } catch (error) {
    console.warn(`Grok quota unavailable: ${sanitizeError(error)}`)
    return { quota: empty('transientFailure') }
  }
}
