# MEMORY.md — Institutional Knowledge for AI Coders

Decisions, gotchas, and hard-won lessons. Read this before making structural changes.

---

## Why composeWorkflow() instead of internal compose helpers

`agency-orchestrator@0.7.5` has a restrictive exports map:
```json
{ ".": { "import": "./dist/index.js" } }
```
This blocks all subpath imports. `formatCatalogForPrompt`, `buildComposeSystemPrompt`, and `buildComposeUserPrompt` exist inside `dist/cli/compose.js` but are NOT re-exported from the main index. Any attempt to import them via `agency-orchestrator/dist/cli/compose.js` fails at build time with "Module not found".

**Solution:** `composeWorkflow()` IS exported from the main index and does everything those three helpers do internally — it builds the catalog, formats the prompt, calls the LLM, generates the YAML, and saves it. Use it.

---

## Why autoRun: true in Stage 1

`composeWorkflow` has two modes:
- `autoRun: false` — generates YAML with `{{description}}` placeholders; you must pass inputs when running
- `autoRun: true` — embeds the task description directly in each step's `task` field; `aoRun()` needs no inputs

Stage 1 uses `autoRun: true` because we want all 4–6 experts to respond directly to the task without any runtime input plumbing.

---

## Why Stage 3 is in deploy.ts, not ai-pipeline.ts

Clean separation:
- `ai-pipeline.ts` owns: LLM calls, prompt logic, file generation, YAML orchestration
- `deploy.ts` owns: all external API calls (GitHub, Vercel, Neon, Cloudflare, registry)

This means the AI pipeline can be tested/run independently without any infra credentials. It also means the update flow (`deployUpdate`) can reuse Stage 3 logic without touching the AI stages.

---

## Why GitHub Tree API instead of git binary

Vercel serverless functions have no `git` binary. The Tree API approach:
1. Create a blob for each file (`POST /repos/{owner}/{repo}/git/blobs`)
2. Create a tree referencing all blobs (`POST /repos/{owner}/{repo}/git/trees`)
3. Create a commit pointing to the tree (`POST /repos/{owner}/{repo}/git/commits`)
4. Update the branch ref (`PATCH /repos/{owner}/{repo}/git/refs/heads/main`)

For updates: pass the current tree SHA as `base_tree` in step 2 so unchanged files are inherited.

---

## agency-agents-zh location — three candidates

The package may install in different places depending on npm version and hoisting:
```typescript
const candidates = [
  path.join(process.cwd(), 'node_modules', 'agency-agents-zh'),
  path.join(process.cwd(), 'node_modules', 'agency-orchestrator', 'node_modules', 'agency-agents-zh'),
  path.join(process.cwd(), 'node_modules', 'agency-orchestrator', 'agency-agents'),
];
```
Always try all three in order. The first one that exists wins.

---

## PATH A vs PATH B — exact signal strings

These strings are parsed by regex throughout the codebase — do not change them:

| Signal | Meaning | Where output |
|---|---|---|
| `-- NO_DATABASE_NEEDED` | PATH A, no Neon | `stage2DbArchitect` output |
| `-- NO_FIXES_NEEDED` | QA clean | `stage2QaReviewer` output |
| `-- NO_MIGRATION_NEEDED` | No DB change in update | `updateDbMigration` output |
| `REPO_SLUG: kebab-name` | App slug | `stage2DbArchitect` output |

---

## Better Auth SSR crash — why next/dynamic is mandatory

`better-auth`'s React client (`createAuthClient`) accesses `window` and other browser APIs during module initialisation. Next.js App Router pre-renders pages on the server. This causes a hard crash on any PATH B page that imports `auth-client` directly.

**The only fix:** wrap every page that uses `authClient` with `next/dynamic` + `ssr: false`:
```js
import dynamic from 'next/dynamic'
const Page = dynamic(() => import('./_client'), { ssr: false, loading: () => null })
export default Page
```
`stage2QaReviewer` enforces this. Do not remove the check.

---

## Remaining Vercel deployment blockers

| Blocker | Current behaviour | Fix needed |
|---|---|---|
| Env vars | `getHermesEnv()` reads `~/.hermes/.env` | Set all vars in Vercel dashboard; `process.env.*` fallback already in place |
| App registry | Reads/writes `~/.hermes/app-builder/apps.json` | Migrate to Supabase table or Vercel KV |
| Function timeout | Pipeline takes 5–10 min, default Vercel timeout 300s | Use `waitUntil()` (Vercel) or a background queue |

---

## llmOverride format for aoRun

```typescript
llmOverride: { provider: 'claude', api_key: string, model: string }
```
This tells `agency-orchestrator` to use the `ClaudeConnector` (direct Anthropic API) instead of the `ao` CLI. Required for Vercel serverless — there is no Claude CLI binary in the Vercel runtime.

---

## SSE log streaming — fire-and-forget pattern

`/api/build` returns immediately (`200 { status: 'started' }`). The pipeline runs async via `void buildPipeline(...)`. The client polls `/api/log/stream` (SSE) for progress.

`build-state.ts` uses a module-level singleton (with `global` fallback for hot-reload) to share state between the build route and the stream route. Do not refactor this into a closure or class — the singleton pattern is intentional.
