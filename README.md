# App Builder Studio

Web UI for the Hermes App Builder pipeline. Describe an app → Studio generates and deploys a full Next.js 14 app to Vercel with a `{slug}.nhkclouds.com` custom domain.

**Stack:** Next.js 16 App Router · Tailwind v4 · TypeScript · dark/light mode
**Port:** 3100
**Repo:** `github.com/terenceng81/app-studio`

## Setup (new machine)

```bash
git clone git@github.com:terenceng81/app-studio.git
cd app-studio
npm install
cp .env.example .env.local   # fill in your keys
npm run dev                   # http://localhost:3100
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in all values.
When running under Hermes locally, Studio reads keys from `~/.hermes/.env` automatically.

## How the pipeline works

A single user description triggers 3 stages:

**Stage 1 — Expert design** (`lib/ai-pipeline.ts`)
`composeWorkflow()` from `agency-orchestrator` dynamically picks 4–6 experts from 199 roles, runs them, and produces a design spec.

**Stage 2 — Code generation** (`lib/ai-pipeline.ts`)
`db_architect` decides PATH A (no DB) or PATH B (Neon + Better Auth). `frontend_coder` generates the full file tree. `qa_reviewer` catches deployment-blocking bugs.

**Stage 3 — Deploy** (`lib/deploy.ts`)
Neon DB creation → GitHub repo (via Tree API, no git binary) → Vercel project + env vars → Cloudflare CNAME → local registry.

Build progress streams live via SSE at `/api/log/stream`.

## Key files

| File | Purpose |
|---|---|
| `lib/ai-pipeline.ts` | Stage 1 + 2 — all LLM calls |
| `lib/deploy.ts` | Stage 3 — Neon, GitHub, Vercel, Cloudflare |
| `lib/env.ts` | Reads `~/.hermes/.env`; falls back to `process.env.*` |
| `lib/build-state.ts` | In-memory SSE log singleton |
| `app/api/build/route.ts` | POST trigger — fire and forget |
| `app/api/log/stream/route.ts` | SSE stream for live build log |

## Related repos

- [`app-agents`](https://github.com/terenceng81/app-agents) — original Mac-local `ao` CLI + Python version of the same pipeline
