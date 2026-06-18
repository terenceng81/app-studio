@AGENTS.md

# App Builder Studio — Claude Code Context

## What is this?

A Next.js 16 App Router web UI for the Hermes App Builder pipeline.
Users describe an app in natural language → Studio generates + deploys a full Next.js 14 app to Vercel with a custom `{slug}.nhkclouds.com` domain.

**Runs locally at:** `http://localhost:3100`
**GitHub repo:** `github.com/terenceng81/app-studio`

## Running locally

```bash
npm install
npm run dev        # dev server on :3100
npm run build      # production build (must pass before pushing)
```

## Key files

| File | Purpose |
|---|---|
| `lib/ai-pipeline.ts` | Stage 1 (dynamic experts) + Stage 2 (db/frontend/qa) + update pipeline |
| `lib/deploy.ts` | Stage 3 — Neon → GitHub → Vercel → Cloudflare → registry |
| `lib/env.ts` | Reads `~/.hermes/.env`; falls back to `process.env.*` |
| `lib/build-state.ts` | In-memory SSE log state (singleton via global) |
| `app/api/build/route.ts` | POST → fire-and-forget pipeline, streams via `/api/log/stream` |
| `app/api/update/route.ts` | POST → update pipeline |
| `app/api/app/[repo]/route.ts` | DELETE → `deployDelete()` |
| `app/api/apps/route.ts` | GET → list from `apps.json` registry |
| `app/api/log/stream/route.ts` | SSE endpoint for live build log |

## Pipeline — 3 stages

**Stage 1** (`stage1Compose` in `ai-pipeline.ts`)
- `composeWorkflow()` from `agency-orchestrator` — dynamically picks 4–6 experts from 199 roles in `agency-agents-zh`
- Generates a workflow YAML (task embedded via `autoRun: true`), patches `agents_dir` to absolute path
- `aoRun()` executes it — each expert produces output; all outputs become the design spec
- Uses `llmOverride: { provider: 'claude', api_key }` — no `ao` CLI binary needed

**Stage 2** (`stage2DbArchitect` → `stage2FrontendCoder` → `stage2QaReviewer`)
- 2a: Claude decides PATH A (no DB) or PATH B (Neon Postgres + Better Auth), picks REPO_SLUG
- 2b: Claude generates the full Next.js 14 file tree (3 files PATH A, 12 files PATH B)
- 2c: Claude (sonnet) reviews for 6 deployment-blocking bugs; re-emits only fixed files

**Stage 3** (`deployCreate` in `deploy.ts`)
- Neon: create DB + run schema.sql (PATH B only)
- GitHub: create repo + push files via Tree API (no `git` binary)
- Vercel: create project + link GitHub + set env vars + deploy
- Cloudflare: add CNAME `{slug}.nhkclouds.com`
- Registry: write entry to `apps.json`

## Rules

- **Never import subpaths from `agency-orchestrator`** — only the root export is in the exports map. Use `composeWorkflow`, `buildRoleCatalog`, `run` from `'agency-orchestrator'`.
- **Stage 1 must stay dynamic** — never hardcode expert roles. `composeWorkflow()` reads all 199 roles and lets Claude pick.
- **Deploy logic lives in `deploy.ts`** — `ai-pipeline.ts` is AI-only (no fetch calls to GitHub/Vercel/Neon).
- `npm run build` must pass before every push.

## Remaining work (not yet done)

| Task | Blocker |
|---|---|
| Full Vercel deploy | `getHermesEnv()` reads local `~/.hermes/.env` — needs Vercel env vars |
| Cloud app registry | `apps.json` is local — needs Supabase table or Vercel KV |
| Long-running timeout | Pipeline takes 5–10 min — needs `waitUntil()` or background function |
