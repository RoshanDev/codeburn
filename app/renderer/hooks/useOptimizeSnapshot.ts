import { useEffect, useRef, useState } from 'react'

import { codeburn } from '../lib/ipc'
import type { DateRange, OptimizeSnapshot, Period } from '../lib/types'

/** Force a recompute regardless of what is cached. */
const FORCE = 0

export type OptimizeScope = {
  period: Period
  provider: string
  range?: DateRange | null
  configSource?: string | null
  scope?: string
}

/**
 * The optimize scan, at DAILY speed. The live overview poll runs with
 * --no-optimize, so these figures come from the main process's on-disk cache:
 * served when one exists for this exact scope and is younger than a day,
 * recomputed otherwise.
 *
 * `alwaysFresh` (the Optimize page) recomputes on every mount, so that page
 * behaves exactly as it did when the poll carried the block. A change in
 * `refreshToken` (manual refresh) forces a recompute too. Nothing here is ever
 * driven by a timer.
 */
export function useOptimizeSnapshot(
  { period, provider, range = null, configSource = null, scope = 'local' }: OptimizeScope,
  { enabled = true, alwaysFresh = false, refreshToken = 0 }: { enabled?: boolean; alwaysFresh?: boolean; refreshToken?: number } = {},
): { data: OptimizeSnapshot | null; loading: boolean } {
  const [state, setState] = useState<{ data: OptimizeSnapshot | null; loading: boolean }>({ data: null, loading: true })
  const lastToken = useRef<number | null>(null)

  useEffect(() => {
    const forced = alwaysFresh || (lastToken.current !== null && lastToken.current !== refreshToken)
    lastToken.current = refreshToken
    const fetchSnapshot = codeburn.getOptimizeSnapshot
    if (!enabled || typeof fetchSnapshot !== 'function') {
      // No bridge method (older preload) is not a loading state that never ends.
      if (!enabled) setState({ data: null, loading: true })
      else setState({ data: null, loading: false })
      return
    }
    let cancelled = false
    setState({ data: null, loading: true })
    // Off the critical path: yield the frame so the headline paints first. The
    // main process additionally spawns this at background CLI priority.
    const handle = setTimeout(() => {
      fetchSnapshot(period, provider, range ?? undefined, configSource, scope, forced ? FORCE : undefined)
        .then(value => { if (!cancelled) setState({ data: value, loading: false }) })
        .catch(() => { if (!cancelled) setState({ data: null, loading: false }) })
    }, 0)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [period, provider, range?.from, range?.to, configSource, scope, enabled, alwaysFresh, refreshToken])

  return state
}
