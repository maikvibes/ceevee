import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

describe('CV versioning integration', () => {
  it('migrates a legacy database without removing source files', () => {
    const result = spawnSync(require('electron'), [fileURLToPath(new URL('./CVVersionMigration.integration.cjs', import.meta.url))], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Legacy CV migration checks passed')
  })

  it('ranks local SQLite vectors in a worker and excludes stale versions and pending jobs', () => {
    const result = spawnSync(require('electron'), [fileURLToPath(new URL('./SemanticWorker.integration.cjs', import.meta.url))], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: `${process.cwd()}/node_modules` }, encoding: 'utf8', timeout: 30000
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Semantic worker checks passed')
  })

  it('rejects superseded indexing work and reuses unchanged embeddings', () => {
    const result = spawnSync(require('electron'), [fileURLToPath(new URL('./LocalIndex.integration.cjs', import.meta.url))], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Local index integration checks passed')
  })

  it('retains queued copies and retries even after the original is moved', () => {
    const result = spawnSync(require('electron'), [fileURLToPath(new URL('./DocumentQueueVersion.integration.cjs', import.meta.url))], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Durable queue integration checks passed')
  })

  it('preserves documents, profiles and review state in SQLite', () => {
    const result = spawnSync(require('electron'), [fileURLToPath(new URL('./CVVersionService.integration.cjs', import.meta.url))], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('CV versioning integration checks passed')
  })
})
