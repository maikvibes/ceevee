export type ProviderChanges = { key?: string; model?: string; baseUrl?: string }
export type SaveResult = { success: boolean; error?: string }

type Pending = { changes: ProviderChanges; timer?: ReturnType<typeof setTimeout>; inFlight?: Promise<SaveResult> }

export class ProviderAutoSaver {
  private pending = new Map<string, Pending>()

  constructor(
    private readonly save: (provider: string, changes: ProviderChanges) => Promise<SaveResult>,
    private readonly report: (provider: string, result: SaveResult) => void,
    private readonly delay = 600,
  ) {}

  schedule(provider: string, changes: ProviderChanges) {
    const state = this.pending.get(provider) || { changes: {} }
    this.pending.set(provider, state)
    Object.assign(state.changes, changes)
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => { void this.flush(provider) }, this.delay)
  }

  async flush(provider: string): Promise<SaveResult> {
    const state = this.pending.get(provider)
    if (!state) return { success: true }
    if (state.timer) clearTimeout(state.timer)
    state.timer = undefined
    if (state.inFlight) {
      const result = await state.inFlight
      if (!result.success) return result
    }
    if (Object.keys(state.changes).length === 0) return { success: true }
    const changes = state.changes
    state.changes = {}
    const request = this.save(provider, changes).catch((error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }))
    state.inFlight = request
    const result = await request
    if (state.inFlight === request) state.inFlight = undefined
    if (!result.success) state.changes = { ...changes, ...state.changes }
    this.report(provider, result)
    if (!result.success) return result
    if (Object.keys(state.changes).length) return this.flush(provider)
    return result
  }

  flushAll() {
    for (const provider of this.pending.keys()) void this.flush(provider)
  }
}
