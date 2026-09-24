/// The Capacity Dock's "this cycle" strip: what each provider has spent since the quota window
/// behind its ball last reset. The window's length is not in the quota answer, so it is read
/// from the label, which the CLI's adapters derive from the length in the first place
/// (`labelForSeconds` in src/quota/codex.ts). A window whose label names no length (Credits,
/// a model id) has no cycle to show.

import { invoke } from '@tauri-apps/api/core'

import type { ProviderToday } from './glance'
import type { QuotaWindow } from './quota'

export type WindowSpan = { hours: number } | { months: number }

export function windowSpan(label: string): WindowSpan | null {
  const text = label.toLowerCase()
  const hours = text.match(/(\d+)[- ]hour/)
  if (hours) return { hours: Number(hours[1]) }
  if (text.includes('five-hour')) return { hours: 5 }
  const days = text.match(/(\d+)[- ]day/)
  if (days) return { hours: Number(days[1]) * 24 }
  if (text.includes('week')) return { hours: 7 * 24 }
  if (text.includes('month')) return { months: 1 }
  if (text.includes('daily')) return { hours: 24 }
  if (text.includes('hour')) return { hours: 1 }
  return null
}

/// When the window last reset, as the nearest whole UTC minute, which is what the CLI is
/// asked from: `null` for a window with no known length or reset, or one whose start would
/// lie in the future. Rounding keeps the value, and so the Rust cache key, still while
/// resetsAt jitters by milliseconds between fetches, and reads Claude's 02:59:59.982 as 03:00.
export function cycleStart(window: QuotaWindow | null, now = Date.now()): string | null {
  if (!window?.resetsAt) return null
  const span = windowSpan(window.label)
  const reset = new Date(window.resetsAt)
  if (!span || Number.isNaN(reset.getTime())) return null
  const start = new Date(reset)
  if ('months' in span) start.setUTCMonth(start.getUTCMonth() - span.months)
  else start.setTime(start.getTime() - span.hours * 3_600_000)
  start.setTime(Math.round(start.getTime() / 60_000) * 60_000)
  if (start.getTime() > now) return null
  return start.toISOString().replace('.000Z', 'Z')
}

/// "since Fri 11:00", in the viewer's own clock and in English like the rest of the card.
export function sinceLabel(since: string, now = Date.now()): string {
  const start = new Date(since)
  const time = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (now - start.getTime() < 24 * 3_600_000 && new Date(now).getDate() === start.getDate()) {
    return `since ${time}`
  }
  const day = start.toLocaleDateString('en-US', now - start.getTime() < 6 * 24 * 3_600_000
    ? { weekday: 'short' }
    : { month: 'short', day: 'numeric' })
  return `since ${day} ${time}`
}

type CycleRow = {
  id: string
  cost: number
  calls: number
  hasUsage: boolean
  inputTokens?: number
  outputTokens?: number
}

/// The CLI's per-provider rows since `since`, in the shape the Today strip folds. Rust keeps
/// each answer a few minutes and runs one parse at a time, so asking on every hover is cheap.
export async function fetchCycle(since: string): Promise<ProviderToday[]> {
  const answer = await invoke<{ providerDetails?: CycleRow[] }>('dock_cycle', { since })
  return (answer.providerDetails ?? []).map((row) => ({
    id: row.id,
    cost: row.cost,
    calls: row.calls,
    hasUsage: row.hasUsage,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
  }))
}
