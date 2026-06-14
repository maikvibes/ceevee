# AI Inference Providers Design

## Scope

Implement the currently exposed but missing AI inference providers for CeeVee:

- OpenAI
- Gemini

The existing Anthropic and OpenRouter providers remain functionally unchanged, except where small shared cleanup is needed to keep provider routing consistent.

## Context

The renderer settings view exposes four AI providers: OpenAI, Anthropic, OpenRouter, and Gemini. The README also lists those four providers. The main process currently routes candidate extraction only to Anthropic or OpenRouter, so selecting OpenAI or Gemini in settings can save configuration but cannot successfully process documents.

Model fetching is similarly incomplete. Anthropic is seeded manually and OpenRouter fetches live models from its models endpoint. OpenAI and Gemini should use live model listing, not hardcoded model assumptions.

## Architecture

Add first-party SDK implementations for the missing providers:

- `OpenAIProvider` implements `IAIProvider` using the official `openai` package.
- `GeminiProvider` implements `IAIProvider` using the official `@google/genai` package.

`AIProcessingService` continues to own the extraction prompt, provider selection, rejection handling, and markdown parsing. Provider classes only handle API request construction, API key validation, response text extraction, and provider-specific error normalization.

## Inference Flow

OpenAI:

- Validate that an API key is present.
- Use the official OpenAI SDK with the supplied key.
- Send the existing extraction prompt to the selected model.
- Return the response text as a string.
- Default only at execution time if no saved model exists, using a stable SDK-compatible OpenAI model.

Gemini:

- Validate that an API key is present.
- Use the official Google GenAI SDK with the supplied key.
- Send the existing extraction prompt to the selected model via `generateContent`.
- Join returned text parts into a single string where needed.
- Default only at execution time if no saved model exists, using a stable SDK-compatible Gemini model.

## Model Fetching

OpenAI model fetching should be live:

- Use the OpenAI SDK/API model listing capability corresponding to `GET /v1/models`.
- Persist returned model IDs into `ai_models` with both `model_id` and display `name` derived from the live response.
- Return an error if the request fails instead of seeding guessed models.

Gemini model fetching should be live:

- Use Gemini's live model listing API.
- Persist models that support text generation, specifically models whose supported generation methods include `generateContent`.
- Store usable model IDs in `ai_models`.
- Return an error if the request fails instead of seeding guessed models.

OpenRouter keeps its current live fetch behavior. Anthropic keeps its current manual seed behavior unless later work adds a reliable live model endpoint for the selected Anthropic API version.

## Data Flow

1. User selects provider and model in Settings.
2. Settings stores the selected provider in local storage and saves the API key/model in SQLite.
3. Document queue reads the active provider and saved model.
4. `AIProcessingService.extractCandidateData` builds the CV extraction prompt.
5. `AIProcessingService` selects the matching provider strategy.
6. The provider SDK returns raw response text.
7. Existing rejection and structured markdown parsing continue unchanged.

## Error Handling

Provider classes should throw errors with provider names and useful API messages. Missing API keys should fail before SDK calls. Model-fetch failures should return through the existing `{ success: false, error }` IPC shape.

The model fetch path must not silently fall back to hardcoded OpenAI or Gemini models, because the user explicitly wants live provider model lists.

## Testing And Verification

The repository currently has no configured app test runner. Implementation should still follow a test-first path where practical by adding a minimal test setup or focused tests for pure provider helpers if that is lower risk than broader test infrastructure.

Required verification before completion:

- `npm install` or equivalent dependency update succeeds.
- `npm run typecheck` succeeds.
- `npm run build` succeeds if local environment dependencies allow it.

If live provider calls are not run because valid API keys are unavailable, report that explicitly.

## Non-Goals

- Do not implement the future natural-language chat feature in this pass.
- Do not redesign the settings UI.
- Do not replace Anthropic or OpenRouter with SDK implementations.
- Do not add hardcoded OpenAI or Gemini model seed lists.
