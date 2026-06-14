# AI Inference Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add working OpenAI and Gemini inference providers, backed by official SDKs and live model fetching.

**Architecture:** Keep the existing `IAIProvider` strategy interface. Add one SDK-backed provider class per missing provider, then extend existing main-process routing and settings model-fetch IPC without changing renderer behavior.

**Tech Stack:** Electron main process, TypeScript, SQLite through `better-sqlite3`, official `openai` SDK, official `@google/genai` SDK.

---

## File Structure

- Modify: `package.json` and `package-lock.json`
  - Add runtime dependencies for official SDKs.
- Create: `src/main/services/ai/OpenAIProvider.ts`
  - OpenAI API key validation, SDK request, response text extraction, error normalization.
- Create: `src/main/services/ai/GeminiProvider.ts`
  - Gemini API key validation, SDK request, response text extraction, error normalization.
- Modify: `src/main/services/AIProcessingService.ts`
  - Import new providers and route `openai` and `gemini`.
- Modify: `src/main/controllers/SettingsController.ts`
  - Fetch OpenAI models live from the OpenAI SDK.
  - Fetch Gemini models live from the Gemini SDK/API and persist only models supporting `generateContent`.

---

### Task 1: Install Official SDK Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install dependencies**

Run:

```powershell
npm install openai @google/genai
```

Expected: `package.json` contains `openai` and `@google/genai` under `dependencies`, and `package-lock.json` is updated.

- [ ] **Step 2: Verify current TypeScript baseline**

Run:

```powershell
npm run typecheck:node
```

Expected: PASS before provider code changes. If it fails from unrelated existing code, stop and record the exact failure before continuing.

- [ ] **Step 3: Commit dependency update**

Run:

```powershell
git add package.json package-lock.json
git commit -m "build: add ai provider sdk dependencies"
```

Expected: commit succeeds.

---

### Task 2: Add OpenAI Provider

**Files:**
- Create: `src/main/services/ai/OpenAIProvider.ts`

- [ ] **Step 1: Write the failing compile check**

Create `src/main/services/ai/OpenAIProvider.ts` with this intentionally incomplete code:

```typescript
import { IAIProvider } from './IAIProvider'

export class OpenAIProvider implements IAIProvider {
}
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run:

```powershell
npm run typecheck:node
```

Expected: FAIL because `OpenAIProvider` does not implement `generateCompletion`.

- [ ] **Step 3: Implement the provider**

Replace `src/main/services/ai/OpenAIProvider.ts` with:

```typescript
import OpenAI from 'openai'
import { IAIProvider } from './IAIProvider'

export class OpenAIProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string): Promise<string> {
    const normalizedKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    if (!normalizedKey) throw new Error('OpenAI API key is missing.')

    const client = new OpenAI({ apiKey: normalizedKey })

    try {
      const response = await client.chat.completions.create({
        model: model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })

      return response.choices[0]?.message?.content || ''
    } catch (error: any) {
      const message = error?.error?.message || error?.message || String(error)
      const status = error?.status ? ` (${error.status})` : ''
      throw new Error(`OpenAI API error${status}: ${message}`)
    }
  }
}
```

- [ ] **Step 4: Run typecheck to verify it passes**

Run:

```powershell
npm run typecheck:node
```

Expected: PASS.

- [ ] **Step 5: Commit OpenAI provider**

Run:

```powershell
git add src/main/services/ai/OpenAIProvider.ts
git commit -m "feat: add openai ai provider"
```

Expected: commit succeeds.

---

### Task 3: Add Gemini Provider

**Files:**
- Create: `src/main/services/ai/GeminiProvider.ts`

- [ ] **Step 1: Write the failing compile check**

Create `src/main/services/ai/GeminiProvider.ts` with this intentionally incomplete code:

```typescript
import { IAIProvider } from './IAIProvider'

export class GeminiProvider implements IAIProvider {
}
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run:

```powershell
npm run typecheck:node
```

Expected: FAIL because `GeminiProvider` does not implement `generateCompletion`.

- [ ] **Step 3: Implement the provider**

Replace `src/main/services/ai/GeminiProvider.ts` with:

```typescript
import { GoogleGenAI } from '@google/genai'
import { IAIProvider } from './IAIProvider'

export class GeminiProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string): Promise<string> {
    const normalizedKey = apiKey.trim()
    if (!normalizedKey) throw new Error('Gemini API key is missing.')

    const client = new GoogleGenAI({ apiKey: normalizedKey })

    try {
      const response = await client.models.generateContent({
        model: model || 'gemini-1.5-flash',
        contents: prompt,
        config: {
          temperature: 0.1
        }
      })

      return response.text || ''
    } catch (error: any) {
      const message = error?.error?.message || error?.message || String(error)
      const status = error?.status ? ` (${error.status})` : ''
      throw new Error(`Gemini API error${status}: ${message}`)
    }
  }
}
```

- [ ] **Step 4: Run typecheck to verify it passes**

Run:

```powershell
npm run typecheck:node
```

Expected: PASS.

- [ ] **Step 5: Commit Gemini provider**

Run:

```powershell
git add src/main/services/ai/GeminiProvider.ts
git commit -m "feat: add gemini ai provider"
```

Expected: commit succeeds.

---

### Task 4: Route OpenAI And Gemini During CV Extraction

**Files:**
- Modify: `src/main/services/AIProcessingService.ts`

- [ ] **Step 1: Write the failing compile check**

Add these imports to `src/main/services/AIProcessingService.ts`:

```typescript
import { OpenAIProvider } from './ai/OpenAIProvider'
import { GeminiProvider } from './ai/GeminiProvider'
```

Then add these switch cases:

```typescript
      case 'openai':
        strategy = new OpenAIProvider()
        break
      case 'gemini':
        strategy = new GeminiProvider()
        break
```

Run:

```powershell
npm run typecheck:node
```

Expected: PASS if Tasks 2 and 3 are complete. If run before Tasks 2 and 3, expected FAIL because provider files are missing.

- [ ] **Step 2: Verify final routing code**

Ensure the switch in `src/main/services/AIProcessingService.ts` is:

```typescript
    switch (_provider.toLowerCase()) {
      case 'anthropic':
        strategy = new AnthropicProvider()
        break
      case 'openai':
        strategy = new OpenAIProvider()
        break
      case 'gemini':
        strategy = new GeminiProvider()
        break
      case 'openrouter':
      default:
        strategy = new OpenRouterProvider()
        break
    }
```

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck:node
```

Expected: PASS.

- [ ] **Step 4: Commit routing**

Run:

```powershell
git add src/main/services/AIProcessingService.ts
git commit -m "feat: route openai and gemini providers"
```

Expected: commit succeeds.

---

### Task 5: Add Live OpenAI And Gemini Model Fetching

**Files:**
- Modify: `src/main/controllers/SettingsController.ts`

- [ ] **Step 1: Write the failing compile check**

Add these imports to `src/main/controllers/SettingsController.ts`:

```typescript
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
```

Inside the `fetch-models` handler, add an `openai` branch that references an undefined helper:

```typescript
        if (provider === 'openai') {
          return await fetchOpenAIModels()
        }
```

Run:

```powershell
npm run typecheck:node
```

Expected: FAIL because `fetchOpenAIModels` is not defined.

- [ ] **Step 2: Implement OpenAI live model fetching**

Add this branch before the final unsupported-provider return:

```typescript
        if (provider === 'openai') {
          if (KeyStoreService.isLocked()) {
            return { success: false, error: 'Keystore is locked' }
          }

          const keyRow = db.prepare('SELECT encrypted_key, iv, auth_tag FROM api_key_store WHERE provider = ?').get(provider) as any
          if (!keyRow) {
            return { success: false, error: 'OpenAI API key not configured. Please save it before fetching models.' }
          }

          const apiKey = KeyStoreService.decrypt(keyRow.encrypted_key, keyRow.iv, keyRow.auth_tag)
          const client = new OpenAI({ apiKey })
          const models = await client.models.list()

          const insert = db.prepare('INSERT OR IGNORE INTO ai_models (provider, model_id, name) VALUES (?, ?, ?)')
          db.transaction(() => {
            for (const model of models.data) {
              insert.run(provider, model.id, model.id)
            }
          })()
          return { success: true }
        }
```

- [ ] **Step 3: Add failing Gemini helper reference**

Add a `gemini` branch that references an undefined helper:

```typescript
        if (provider === 'gemini') {
          return await fetchGeminiModels()
        }
```

Run:

```powershell
npm run typecheck:node
```

Expected: FAIL because `fetchGeminiModels` is not defined.

- [ ] **Step 4: Implement Gemini live model fetching**

Replace the failing Gemini branch with:

```typescript
        if (provider === 'gemini') {
          if (KeyStoreService.isLocked()) {
            return { success: false, error: 'Keystore is locked' }
          }

          const keyRow = db.prepare('SELECT encrypted_key, iv, auth_tag FROM api_key_store WHERE provider = ?').get(provider) as any
          if (!keyRow) {
            return { success: false, error: 'Gemini API key not configured. Please save it before fetching models.' }
          }

          const apiKey = KeyStoreService.decrypt(keyRow.encrypted_key, keyRow.iv, keyRow.auth_tag)
          const client = new GoogleGenAI({ apiKey })
          const pager = await client.models.list()

          const insert = db.prepare('INSERT OR IGNORE INTO ai_models (provider, model_id, name) VALUES (?, ?, ?)')
          db.transaction(() => {
            for (const model of pager) {
              const supportedMethods = model.supportedActions || model.supportedGenerationMethods || []
              if (supportedMethods.includes('generateContent') && model.name) {
                insert.run(provider, model.name, model.displayName || model.name)
              }
            }
          })()
          return { success: true }
        }
```

- [ ] **Step 5: Run typecheck and fix SDK shape drift if needed**

Run:

```powershell
npm run typecheck:node
```

Expected: PASS. If the installed `@google/genai` types use different list result property names, update only the Gemini branch to match the installed SDK types while preserving these requirements:

```typescript
const supportedMethods = model.supportedGenerationMethods || []
if (supportedMethods.includes('generateContent') && model.name) {
  insert.run(provider, model.name, model.displayName || model.name)
}
```

- [ ] **Step 6: Commit model fetching**

Run:

```powershell
git add src/main/controllers/SettingsController.ts
git commit -m "feat: fetch openai and gemini models"
```

Expected: commit succeeds.

---

### Task 6: Final Verification

**Files:**
- Review: `package.json`
- Review: `src/main/services/ai/OpenAIProvider.ts`
- Review: `src/main/services/ai/GeminiProvider.ts`
- Review: `src/main/services/AIProcessingService.ts`
- Review: `src/main/controllers/SettingsController.ts`

- [ ] **Step 1: Check worktree status**

Run:

```powershell
git status --short
```

Expected: no unrelated changes. If changes remain, inspect them before committing or reporting completion.

- [ ] **Step 2: Run full typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 4: Report live API coverage**

If no OpenAI or Gemini API keys are available in the local app keystore, report:

```text
OpenAI and Gemini live model fetches were not exercised because no local API keys were provided through the app settings.
```

If keys are available, manually verify in the running app:

```powershell
npm run dev
```

Expected: Settings can fetch live OpenAI and Gemini model lists, selecting either provider saves a model, and document processing reaches the selected provider.

- [ ] **Step 5: Final commit if verification caused changes**

Run:

```powershell
git status --short
git add package.json package-lock.json src/main/services/ai/OpenAIProvider.ts src/main/services/ai/GeminiProvider.ts src/main/services/AIProcessingService.ts src/main/controllers/SettingsController.ts
git commit -m "feat: support openai and gemini providers"
```

Expected: commit succeeds only if there are uncommitted implementation changes.
