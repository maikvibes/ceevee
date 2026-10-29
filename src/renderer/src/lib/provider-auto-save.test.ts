import { describe, expect, it, vi } from 'vitest'
import { ProviderAutoSaver } from './provider-auto-save'

describe('provider autosave', () => {
  it('coalesces edits and flushes them before model discovery', async () => {
    const save = vi.fn().mockResolvedValue({ success: true })
    const saver = new ProviderAutoSaver(save, () => {}, 10000)
    saver.schedule('gemini', { baseUrl: 'http://localhost' })
    saver.schedule('gemini', { model: 'new-model' })
    expect(await saver.flush('gemini')).toEqual({ success: true })
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith('gemini', { baseUrl: 'http://localhost', model: 'new-model' })
  })

  it('keeps failed changes for retry after unlocking', async () => {
    const save = vi.fn().mockResolvedValueOnce({ success: false, error: 'locked' }).mockResolvedValueOnce({ success: true })
    const saver = new ProviderAutoSaver(save, () => {}, 10000)
    saver.schedule('openai', { baseUrl: 'http://localhost/v1' })
    expect((await saver.flush('openai')).success).toBe(false)
    expect((await saver.flush('openai')).success).toBe(true)
    expect(save).toHaveBeenLastCalledWith('openai', { baseUrl: 'http://localhost/v1' })
  })

  it('serializes changes made while an earlier save is in flight', async () => {
    let resolve!: (result: { success: boolean }) => void
    const save = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done })).mockResolvedValue({ success: true })
    const saver = new ProviderAutoSaver(save, () => {}, 10000)
    saver.schedule('openai', { model: 'first' })
    const first = saver.flush('openai')
    saver.schedule('openai', { model: 'second' })
    const second = saver.flush('openai')
    resolve({ success: true })
    await Promise.all([first, second])
    expect(save.mock.calls).toEqual([['openai', { model: 'first' }], ['openai', { model: 'second' }]])
  })
})
