import { describe, expect, it } from 'vitest'
import { EMPTY_GLANCE, providerTotals, sessionsForSource, type Glance } from '../windows/src/lib/glance'
import { transientRead } from '../windows/src/lib/quota'
import { cycleStart } from '../windows/src/lib/cycle'

describe('local dock behavior alongside upstream profiles', () => {
  it('keeps provider totals separate and folds Cursor CLI usage into Cursor', () => {
    const row = (id: string, cost: number) => ({ id, cost, calls: 1, hasUsage: true, inputTokens: 10, outputTokens: 5 })
    expect(providerTotals([row('claude', 100), row('cursor', 2), row('cursor-agent', 3)], 'cursor'))
      .toMatchObject({ cost: 5, calls: 2, inputTokens: 20, outputTokens: 10 })
  })

  it('retains upstream source-specific sessions', () => {
    const glance = {
      ...EMPTY_GLANCE,
      liveSessions: { sessions: [
        { id: 'a', provider: 'claude', claudeConfigSourceId: 'work' },
        { id: 'b', provider: 'claude', claudeConfigSourceId: 'personal' },
        { id: 'c', provider: 'codex', claudeConfigSourceId: 'work' },
      ] },
    } as Glance
    expect(sessionsForSource(glance, 'work')?.map(s => s.id)).toEqual(['a'])
  })

  it('does not ask for reconnect on transient failures', () => {
    const provider = { id: 'codex', name: 'Codex', available: false, windows: [], error: 'HTTP 429' }
    expect(transientRead({ ...provider, connection: 'transientFailure' })).toBe(true)
    expect(transientRead({ ...provider, connection: 'terminalFailure' })).toBe(false)
  })

  it('uses the API billing start for an enterprise team meter', () => {
    expect(cycleStart({ label: 'Team on-demand', usedPct: 25, startsAt: '2026-09-01T00:00:00Z', resetsAt: '2026-10-01T00:00:00Z' }, Date.parse('2026-09-20T00:00:00Z')))
      .toBe('2026-09-01T00:00:00Z')
  })
})
