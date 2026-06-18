<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent Rules — App Builder Studio

## agency-orchestrator imports

**Only import from the package root.** The exports map only exposes `.`:

```typescript
// CORRECT
import { composeWorkflow, buildRoleCatalog, run } from 'agency-orchestrator';

// WRONG — blocked by exports map, will fail at build
import { buildComposeSystemPrompt } from 'agency-orchestrator/dist/cli/compose.js';
```

## Stage 1 must stay dynamic

Never hardcode expert roles in `stage1Compose`. The entire point is that `composeWorkflow()` reads all 199 roles from `agency-agents-zh` and Claude picks the right ones per task. If you find yourself writing a role list, stop.

## Separation of concerns

- `lib/ai-pipeline.ts` — AI generation only (Anthropic SDK + agency-orchestrator)
- `lib/deploy.ts` — infra only (GitHub, Vercel, Neon, Cloudflare via `fetch()`)
- Do not mix them.

## PATH A vs PATH B

`stage2DbArchitect` outputs either `-- NO_DATABASE_NEEDED` (PATH A) or a real SQL schema (PATH B). Every downstream stage reads this signal. Never assume one path — always parse the db architect output.

## Better Auth SSR

PATH B apps crash during Next.js SSR. The only fix is `next/dynamic` with `ssr: false`. This pattern is enforced by `stage2QaReviewer` — do not remove it.

## Build gate

`npm run build` must pass before any push. TypeScript errors are blocking.
