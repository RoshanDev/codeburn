import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { buildDurablePeriod, buildMenubarPayloadForRange, excludeProviderFromDay } from '../src/usage-aggregator.js'
import { aggregateProjectsIntoDays } from '../src/day-aggregator.js'
import { getDateRange } from '../src/cli-date.js'
import { loadPricing } from '../src/models.js'
import { setIncludeGatewayInTotals } from '../src/config.js'
import { emptyCache, type DailyCache } from '../src/daily-cache.js'
import type { ProjectSummary } from '../src/types.js'

// The gateway reports one aggregate row per day+model: $12.34 of spend that the
// local tools pointed at the gateway already recorded themselves. Counting both
// double counts, so the headline drops it and the provider row keeps it.
const GATEWAY_COST = 12.34
const LOCAL_COST = 1.5
const MODEL = 'openai/gpt-4o'

const ts = new Date().toISOString()
const emptyCat = { turns: 0, costUSD: 0, savingsUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 }

function makeCall(provider: string, costUSD: number, key: string, requestCount?: number) {
  return {
    provider,
    model: MODEL,
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      webSearchRequests: 0,
    },
    costUSD,
    tools: [],
    mcpTools: [],
    skills: [],
    subagentTypes: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard' as const,
    timestamp: ts,
    bashCommands: [],
    deduplicationKey: key,
    ...(requestCount != null ? { requestCount } : {}),
  }
}

function makeProject(provider: string, project: string, costUSD: number, key: string, requestCount?: number): ProjectSummary {
  return {
    project,
    projectPath: project,
    sessions: [{
      sessionId: `${key}-sess`,
      project,
      firstTimestamp: ts,
      lastTimestamp: ts,
      totalCostUSD: costUSD,
      totalSavingsUSD: 0,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      apiCalls: requestCount ?? 1,
      turns: [{
        userMessage: '',
        timestamp: ts,
        sessionId: `${key}-sess`,
        category: 'coding',
        retries: 0,
        hasEdits: false,
        assistantCalls: [makeCall(provider, costUSD, key, requestCount)],
      }],
      modelBreakdown: {},
      toolBreakdown: {},
      mcpBreakdown: {},
      bashBreakdown: {},
      subagentBreakdown: {},
      categoryBreakdown: { coding: { ...emptyCat, turns: 1, costUSD } },
      skillBreakdown: {},
    }],
    totalCostUSD: costUSD,
    totalSavingsUSD: 0,
    totalApiCalls: requestCount ?? 1,
  } as unknown as ProjectSummary
}

const gatewayProject = (): ProjectSummary => makeProject('vercel-gateway', 'Vercel AI Gateway', GATEWAY_COST, 'vercel-gateway:day:model', 3)
const localProject = (): ProjectSummary => makeProject('claude', 'local-repo', LOCAL_COST, 'claude-1')

/// What each parseAllSessions call should return, per provider scope. Set per
/// test so one fixture drives the all-provider and the `--provider` paths.
let corpus: ProjectSummary[] = []
/// Days the mocked durable cache holds (the "already sealed" case).
let cachedDays: DailyCache['days'] = []

const parseAllSessions = vi.hoisted(() => vi.fn())

vi.mock('../src/parser.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/parser.js')>()
  return {
    ...mod,
    parseAllSessions,
    isSessionHydrationComplete: vi.fn(() => true),
    sessionHydrationSnapshot: vi.fn(() => ({ complete: true, deferredForFirstPaint: false, indexedFiles: 0, pendingFiles: 0 })),
  }
})

vi.mock('../src/daily-cache.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/daily-cache.js')>()
  const cache = (): DailyCache => ({ ...mod.emptyCache(), days: cachedDays, complete: true })
  return {
    ...mod,
    ensureCacheHydrated: vi.fn(async () => cache()),
    loadDailyCache: vi.fn(async () => cache()),
  }
})

function sessionProvider(project: ProjectSummary): string {
  return project.sessions[0]!.turns[0]!.assistantCalls[0]!.provider
}

parseAllSessions.mockImplementation(async (_range: unknown, provider?: string) =>
  provider && provider !== 'all' ? corpus.filter(p => sessionProvider(p) === provider) : corpus,
)

const opts = { provider: 'all', optimize: false, timeline: false } as const

describe('vercel-gateway: daily aggregates are shown but not totalled', () => {
  beforeAll(async () => {
    await loadPricing()
  })

  afterEach(() => {
    setIncludeGatewayInTotals(false)
    corpus = []
    cachedDays = []
  })

  it('keeps gateway-only spend off the headline and on its own row', async () => {
    corpus = [gatewayProject()]
    const payload = await buildMenubarPayloadForRange(getDateRange('today'), opts)

    expect(payload.current.cost).toBe(0)
    const row = payload.current.providerDetails!.find(p => p.id === 'vercel-gateway')!
    expect(row.cost).toBeCloseTo(GATEWAY_COST, 10)
    expect(row.excludedFromTotal).toBe(true)
    // The legacy providers map keeps the provider too: it is real spend.
    expect(payload.current.providers['vercel ai gateway']).toBeCloseTo(GATEWAY_COST, 10)
    // Nothing derived from the day may smuggle it back in.
    expect(payload.current.topModels).toEqual([])
    expect(payload.current.topActivities).toEqual([])
    expect(payload.history.daily.reduce((s, d) => s + d.cost, 0)).toBe(0)

    const durable = await buildDurablePeriod(getDateRange('today'), opts)
    expect(durable.excludedGatewayCostUSD).toBeCloseTo(GATEWAY_COST, 10)
  })

  it('counts it exactly once with the opt-in on', async () => {
    corpus = [gatewayProject()]
    setIncludeGatewayInTotals(true)
    const payload = await buildMenubarPayloadForRange(getDateRange('today'), opts)

    expect(payload.current.cost).toBeCloseTo(GATEWAY_COST, 10)
    const row = payload.current.providerDetails!.find(p => p.id === 'vercel-gateway')!
    expect(row.cost).toBeCloseTo(GATEWAY_COST, 10)
    expect(row.excludedFromTotal).toBeUndefined()

    const durable = await buildDurablePeriod(getDateRange('today'), opts)
    expect(durable.excludedGatewayCostUSD).toBe(0)
  })

  it('leaves a local session on the headline when the gateway shares its day and model', async () => {
    corpus = [gatewayProject(), localProject()]
    const payload = await buildMenubarPayloadForRange(getDateRange('today'), opts)

    expect(payload.current.cost).toBeCloseTo(LOCAL_COST, 8)
    // The shared model row keeps the local remainder only.
    expect(payload.current.topModels.reduce((s, m) => s + m.cost, 0)).toBeCloseTo(LOCAL_COST, 8)
    expect(payload.current.providerDetails!.find(p => p.id === 'vercel-gateway')!.cost).toBeCloseTo(GATEWAY_COST, 10)
  })

  it('makes the headline the exact sum of the providers it counts', async () => {
    corpus = [gatewayProject(), localProject()]
    const payload = await buildMenubarPayloadForRange(getDateRange('today'), opts)

    const counted = payload.current.providerDetails!
      .filter(p => !p.excludedFromTotal)
      .reduce((sum, p) => sum + p.cost, 0)
    expect(counted).toBeCloseTo(payload.current.cost, 8)
  })

  it('leaves --provider vercel-gateway reporting the full amount', async () => {
    corpus = [gatewayProject(), localProject()]
    const payload = await buildMenubarPayloadForRange(getDateRange('today'), { ...opts, provider: 'vercel-gateway' })

    expect(payload.current.cost).toBeCloseTo(GATEWAY_COST, 10)
    expect(payload.current.providerDetails![0]!.excludedFromTotal).toBeUndefined()

    const durable = await buildDurablePeriod(getDateRange('today'), { ...opts, provider: 'vercel-gateway' })
    expect(durable.data.cost).toBeCloseTo(GATEWAY_COST, 10)
    expect(durable.excludedGatewayCostUSD).toBe(0)
  })

  it('reports request_count as the row call count', async () => {
    corpus = [gatewayProject()]
    const payload = await buildMenubarPayloadForRange(getDateRange('today'), { ...opts, provider: 'vercel-gateway' })
    expect(payload.current.calls).toBe(3)

    const all = await buildMenubarPayloadForRange(getDateRange('today'), opts)
    expect(all.current.providerDetails!.find(p => p.id === 'vercel-gateway')!.calls).toBe(3)
  })

  // The slice is sealed into the daily cache whether or not it is counted, so
  // flipping the opt-in re-reads history that can never be fetched again.
  it('applies retroactively to sealed days with no re-fetch', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('no network in this test') })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    try {
      const sealed = aggregateProjectsIntoDays([gatewayProject(), localProject()])
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const key = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
      cachedDays = sealed.map(d => ({ ...d, date: key }))
      corpus = []

      const excluded = await buildDurablePeriod(getDateRange('week'), opts)
      expect(excluded.data.cost).toBeCloseTo(LOCAL_COST, 8)
      expect(excluded.excludedGatewayCostUSD).toBeCloseTo(GATEWAY_COST, 10)

      setIncludeGatewayInTotals(true)
      const included = await buildDurablePeriod(getDateRange('week'), opts)
      expect(included.data.cost).toBeCloseTo(LOCAL_COST + GATEWAY_COST, 8)
      expect(included.excludedGatewayCostUSD).toBe(0)

      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('subtracts a day exactly, keeping the slice for the provider row', () => {
    const [day] = aggregateProjectsIntoDays([gatewayProject(), localProject()])
    const left = excludeProviderFromDay(day!, 'vercel-gateway')

    expect(left.cost).toBeCloseTo(LOCAL_COST, 8)
    expect(left.calls).toBe(1)
    expect(left.providers['vercel-gateway']!.cost).toBeCloseTo(GATEWAY_COST, 10)
    expect(left.providers['vercel-gateway']!.calls).toBe(3)
    // A day with no slice for the provider is returned untouched.
    expect(excludeProviderFromDay(day!, 'nope')).toBe(day)
  })
})
