/**
 * ai-pipeline.ts — replaces ao CLI + build-app.sh stages 1+2
 *
 * Stage 1: compose (design spec via multi-expert prompt)
 * Stage 2: db_architect → frontend_coder → qa_reviewer (sequential Claude calls)
 * Stage 3: update pipeline (change_analyzer → db_migration → code_modifier)
 *
 * Runs entirely in Node.js — no ao binary, no bash, no filesystem writes.
 * Compatible with Vercel serverless (fire-and-forget from API route).
 */

import Anthropic from '@anthropic-ai/sdk';
import { getHermesEnv } from './env';
import { appendLog } from './build-state';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getClient(): Anthropic {
  const env = getHermesEnv();
  const apiKey = env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not found in ~/.hermes/.env');
  return new Anthropic({ apiKey });
}

async function callClaude(
  system: string,
  user: string,
  model = 'claude-opus-4-8',
): Promise<string> {
  const client = getClient();
  const msg = await client.messages.create({
    model,
    max_tokens: 8192,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
}

function ts(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

// ── Parsers ───────────────────────────────────────────────────────────────────

export function parseCodeFiles(text: string): Record<string, string> {
  const files: Record<string, string> = {};
  const re = /\*\*`([^`]+)`\*\*\s*\n```[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    files[m[1].trim()] = m[2];
  }
  return files;
}

export function extractSchemaSql(text: string): string | null {
  if (/NO_DATABASE_NEEDED/i.test(text)) return null;
  const m = /```sql\s*\n(-- schema\.sql[\s\S]*?)```/i.exec(text);
  return m ? m[1].trim() : null;
}

export function extractMigrationSql(text: string): string | null {
  if (/NO_MIGRATION_NEEDED/i.test(text)) return null;
  const m = /```sql\s*\n(-- migration\.sql[\s\S]*?)```/i.exec(text);
  return m ? m[1].trim() : null;
}

export function extractRepoSlug(dbArchitectOutput: string): string {
  const m = /REPO_SLUG:\s*([a-z0-9-]+)/i.exec(dbArchitectOutput);
  return m ? m[1].trim() : 'app';
}

// ── Stage 1: Design compose ───────────────────────────────────────────────────

async function stage1Compose(description: string): Promise<string> {
  appendLog(`[${ts()}] Stage 1: Convening design team...`);
  const system = `You are a multidisciplinary product design team for web applications.
Your team includes a requirements analyst, UX designer, UI art director, and technical architect.
You collaborate to produce a comprehensive design specification for Next.js 14 App Router applications.`;

  const user = `Design and plan a full-stack Next.js 14 web application (App Router, deployed to Vercel).

User requirement: ${description}

CONSTRAINTS:
1. Mobile-first — all layouts must work at 375px first, then scale up.
2. Pick ONE deliberate aesthetic direction (minimalist / retro-futuristic / organic-natural / luxe-refined / playful-toy / editorial-magazine / brutalist / geometric-art-deco / soft-macaron / industrial-utilitarian) and name it explicitly in the spec so the coder carries it through.
3. Auth and database are conditional — only include if the app truly needs multi-user data or cross-device sync.

Cover: requirements analysis, UX flows, UI design direction with explicit aesthetic choice, data model, and feature list.
Produce the design plan only — do not write the final code.`;

  const spec = await callClaude(system, user);
  appendLog(`[${ts()}] Stage 1 done (${spec.length} chars)`);
  return spec;
}

// ── Stage 2a: db_architect ────────────────────────────────────────────────────

async function stage2DbArchitect(
  description: string,
  tgUserId: string,
  spec: string,
): Promise<string> {
  appendLog(`[${ts()}] Stage 2a: db_architect — deciding PATH A/B...`);
  const system = `You are a senior backend architect specializing in Neon Postgres for Next.js 14.
You make precise database decisions and output clean, deployable SQL schemas.`;

  const user = `Based on the upstream team's design, decide on and design the database
(target platform: Neon Postgres, accessed via server-side Next.js).

Original user requirement: ${description}
Telegram User ID: ${tgUserId}

Upstream design:
${spec}

## App Slug
First pick a short English slug for this app (kebab-case, e.g. budget-tracker, habit-log),
and output it on its own line at the very top (strict format):
\`REPO_SLUG: your-slug-here\`

Then decide whether this app needs a cloud database:
- **Not needed**: pure tools (calculator, converter, timer), no data to persist → output \`-- NO_DATABASE_NEEDED\`
- **localStorage is enough**: personal notes/todos, no login or cross-device sync → output \`-- NO_DATABASE_NEEDED\`
- **Needs Neon**: requires login, multi-device sync, or multiple users → design a full schema

**If no database is needed:**
\`\`\`sql
-- NO_DATABASE_NEEDED
\`\`\`
Briefly explain why, then stop.

**If Neon is needed:** output a complete schema.sql with two sections:

**Section 1 — Better Auth tables (copy exactly, do not modify):**
\`\`\`sql
-- schema.sql
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL UNIQUE,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  password TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
\`\`\`

**Section 2 — App-specific tables:**
- Every table: \`id UUID PRIMARY KEY DEFAULT gen_random_uuid()\`, \`owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE\`, \`created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\`
- No RLS needed — server-side auth handles access control
- Use short table names, public schema, no prefix
- Design only what the app actually needs; no speculative columns

Output both sections in a single \`\`\`sql block starting with \`-- schema.sql\`.`;

  const result = await callClaude(system, user);
  appendLog(`[${ts()}] Stage 2a done`);
  return result;
}

// ── Stage 2b: frontend_coder ──────────────────────────────────────────────────

async function stage2FrontendCoder(
  description: string,
  spec: string,
  dbSchema: string,
): Promise<string> {
  appendLog(`[${ts()}] Stage 2b: frontend_coder — generating app...`);
  const system = `You are a senior full-stack Next.js 14 developer.
You write clean, deployable, production-ready Next.js 14 App Router applications.
Follow karpathy's clean code principles: minimal viable code, no TODOs, every file complete and runnable.`;

  const user = `Turn the design into a complete, deployable Next.js 14 full-stack application.
Output each file with a bold filename heading followed immediately by the code block.
Strict format: **\`path/to/filename\`** then the code block. No other structure.

Original user requirement: ${description}
Upstream design: ${spec}
Database plan: ${dbSchema}

━━━ Tech stack (mandatory — do not change) ━━━
- Next.js 14 App Router, full-stack (frontend + API in one repo)
- Deployed to Vercel (zero-config)
- Styling: plain CSS with CSS variables in globals.css — no Tailwind, no CSS-in-JS
- NO Vite, NO React Native, NO Next.js Pages Router, NO separate backend service
- Auth + DB are conditional — see "Required files" below

━━━ Design principles (goal: not look AI-generated) ━━━
First commit to a **bold, deliberate** aesthetic direction and carry it through:
- Pick one that genuinely fits: minimalist / maximalist / retro-futuristic /
  organic-natural / luxe-refined / playful-toy / editorial-magazine /
  brutalist / geometric-art-deco / soft-macaron / industrial-utilitarian

Typography:
- ❌ Never use Inter, Roboto, Arial, system-ui, Space Grotesk (AI clichés)
- ✅ Pick a characterful display font + refined body font from Google Fonts (loaded in layout.js)
Color:
- ❌ Never "purple gradient on white"
- ✅ CSS variables: strong primary + sharp accent; alternate light/dark themes each build
Motion & background:
- One choreographed page load (staggered via animation-delay) beats scattered micro-interactions
- Use gradient meshes / noise texture / geometric patterns for background, not flat color
Layout:
- Asymmetry, overlap, broken grids — avoid the uniform centered card

━━━ Code principles (karpathy) ━━━
- Minimal viable code; no speculative abstractions; no config for single-use things
- No TODOs, no ellipses — every file complete and runnable
- Would a senior engineer call it over-engineered? If so, rein it in

━━━ Required files — READ the database plan FIRST to decide which path ━━━

Always generate (every app regardless of DB):
**\`jsconfig.json\`**
**\`app/layout.js\`**
**\`app/globals.css\`**

── PATH A: if the database plan contains \`-- NO_DATABASE_NEEDED\` ──────────────
Simple app — no auth, no database. Do NOT generate any auth or DB files.
**\`package.json\`** (next/react/react-dom only — no better-auth, no pg)
**\`next.config.js\`** (minimal — no serverComponentsExternalPackages needed)
**\`app/page.js\`** (full app UI as a direct 'use client' component — no SSR wrapper needed)

── PATH B: if the database plan contains a real SQL schema ─────────────────────
Full stack — auth + Neon Postgres. Generate ALL of the following:
**\`package.json\`** (with better-auth, pg, @neondatabase/serverless)
**\`next.config.js\`** (with experimental.serverComponentsExternalPackages)
**\`middleware.js\`**
**\`lib/auth.js\`**
**\`lib/auth-client.js\`**
**\`lib/db.js\`**
**\`app/api/auth/[...all]/route.js\`**
**\`app/page.js\`** (thin dynamic wrapper — no 'use client')
**\`app/_client.js\`** (auth UI — 'use client')
**\`app/app/page.js\`** (thin dynamic wrapper — no 'use client')
**\`app/app/_client.js\`** (main app UI — 'use client')
**\`app/app/actions.js\`**

━━━ Exact templates (follow precisely — these are battle-tested) ━━━

**\`jsconfig.json\`** — required for @/ path alias (CRITICAL — without this, all @/ imports fail at build):
\`\`\`json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
\`\`\`

── PATH A templates ──

**\`package.json\`** (PATH A — no auth/DB):
\`\`\`json
{
  "name": "app",
  "version": "0.1.0",
  "private": true,
  "scripts": { "dev": "next dev", "build": "next build", "start": "next start" },
  "dependencies": { "next": "14.2.29", "react": "^18", "react-dom": "^18" }
}
\`\`\`

**\`next.config.js\`** (PATH A — minimal):
\`\`\`js
const nextConfig = {}
module.exports = nextConfig
\`\`\`

**\`app/page.js\`** (PATH A):
- \`'use client'\` on line 1, full app UI here, no \`_client.js\` split
- Use React state for interactivity; localStorage if persistence is needed

── PATH B templates ──

**\`package.json\`** (PATH B):
\`\`\`json
{
  "name": "app",
  "version": "0.1.0",
  "private": true,
  "scripts": { "dev": "next dev", "build": "next build", "start": "next start" },
  "dependencies": {
    "next": "14.2.29", "react": "^18", "react-dom": "^18",
    "better-auth": "^1.2.7", "@neondatabase/serverless": "^0.10.4", "pg": "^8.13.3"
  }
}
\`\`\`

**\`next.config.js\`** (PATH B — MUST use experimental.serverComponentsExternalPackages, NOT serverExternalPackages which is Next.js 15+):
\`\`\`js
const nextConfig = { experimental: { serverComponentsExternalPackages: ['better-auth', 'pg'] } }
module.exports = nextConfig
\`\`\`

**\`middleware.js\`**:
\`\`\`js
import { NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
export function middleware(request) {
  const session = getSessionCookie(request)
  if (!session && request.nextUrl.pathname.startsWith('/app')) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  return NextResponse.next()
}
export const config = { matcher: ['/app/:path*'] }
\`\`\`

**\`lib/auth.js\`**:
\`\`\`js
import { betterAuth } from 'better-auth'
import { Pool } from 'pg'
export const auth = betterAuth({
  secret: process.env.AUTH_SECRET,
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: { enabled: true },
  trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'],
})
\`\`\`

**\`lib/auth-client.js\`**:
\`\`\`js
import { createAuthClient } from 'better-auth/react'
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL,
})
\`\`\`

**\`app/api/auth/[...all]/route.js\`**:
\`\`\`js
import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'
export const { GET, POST } = toNextJsHandler(auth)
\`\`\`

**\`lib/db.js\`**:
\`\`\`js
import { neon } from '@neondatabase/serverless'
export const sql = neon(process.env.DATABASE_URL)
\`\`\`

━━━ PATH B auth flow (battle-tested — follow exactly or login fails) ━━━

CRITICAL: better-auth's React client crashes during Next.js SSR. The ONLY fix is \`ssr: false\` via next/dynamic.

**\`app/page.js\`** (PATH B — thin server wrapper, NO 'use client'):
\`\`\`js
import dynamic from 'next/dynamic'
const Page = dynamic(() => import('./_client'), { ssr: false, loading: () => null })
export default Page
\`\`\`

**\`app/_client.js\`** ('use client', auth UI — useSession, signIn, signUp, redirect to /app on success)

**\`app/app/page.js\`** (PATH B — thin wrapper same pattern as app/page.js)

**\`app/app/_client.js\`** ('use client', protected app UI — useSession, signOut, call Server Actions)

**\`app/app/actions.js\`**:
\`\`\`js
'use server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { sql } from '@/lib/db'
async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user
}
\`\`\`

━━━ app/layout.js ━━━
- Import './globals.css' first
- Load Google Fonts via <link> in <head> (not next/font)
- metadata export with app name + description

━━━ app/globals.css ━━━
- CSS variables on :root for all design tokens
- Base reset, font assignments, animation keyframes
- No utility classes`;

  const result = await callClaude(system, user);
  appendLog(`[${ts()}] Stage 2b done (${Object.keys(parseCodeFiles(result)).length} files)`);
  return result;
}

// ── Stage 2c: qa_reviewer ─────────────────────────────────────────────────────

async function stage2QaReviewer(dbSchema: string, frontendCode: string): Promise<string> {
  appendLog(`[${ts()}] Stage 2c: qa_reviewer — checking for bugs...`);
  const system = `You are a senior QA engineer specializing in Next.js 14 deployments.
You catch deployment-blocking bugs before code ships to Vercel.`;

  const user = `Review the generated Next.js 14 code for deployment-blocking bugs.
Re-emit ONLY files that need fixes, using the exact same format:
**\`path/to/filename\`** then the corrected code block.

Database decision: ${dbSchema}
Generated code: ${frontendCode}

Check for these issues in order:

1. **PATH mismatch** — if the database plan contains \`-- NO_DATABASE_NEEDED\`, flag any
   file that imports better-auth, pg, or @neondatabase/serverless. Simplify to plain 'use client'.

2. **Missing 'use client'** — files using useState, useEffect, useRef, authClient, or event
   handlers that lack \`'use client'\` on line 1.

3. **PATH B SSR crash** — app/page.js or app/app/page.js must use \`next/dynamic\` with \`ssr: false\`.

4. **next/dynamic with ssr: false in PATH A** — unnecessary. Replace with direct 'use client'.

5. **'use server' + 'use client' in same file** — illegal. Split the file.

6. **Missing jsconfig.json** — emit it if absent.

If NO issues found: output exactly: \`-- NO_FIXES_NEEDED\`
If issues found: re-emit only corrected files.`;

  const result = await callClaude(system, user, 'claude-sonnet-4-6');
  appendLog(`[${ts()}] Stage 2c done`);
  return result;
}

// ── Update pipeline ───────────────────────────────────────────────────────────

async function updateChangeAnalyzer(
  repoName: string,
  updateRequest: string,
  existingFileList: string,
  tgUserId: string,
): Promise<string> {
  appendLog(`[${ts()}] Update: analyzing change...`);
  const system = `You are a product manager analyzing update requests for software changes.`;
  const user = `The user wants to update their app. Analyze the request and its blast radius.

Update request: ${updateRequest}

Existing file list: ${existingFileList}

Repo: ${repoName}, User ID: ${tgUserId}

Output:
## 1. Change type
Classify: UI/UX change | Feature addition | Feature modification | Database change

## 2. Affected files
List files to modify (exact filenames) and what each change is.

## 3. Database change needed?
If yes: describe new tables or columns. If no: "No database change".

## 4. Change summary
One sentence for the git commit message.`;

  const result = await callClaude(system, user, 'claude-sonnet-4-6');
  appendLog(`[${ts()}] Change analyzed`);
  return result;
}

async function updateDbMigration(changeAnalysis: string): Promise<string> {
  const system = `You are a database architect. Generate migration SQL for Neon Postgres.`;
  const user = `Generate a database migration SQL based on this change analysis.

Change analysis: ${changeAnalysis}

If the change analysis says "No database change", output:
\`\`\`sql
-- NO_MIGRATION_NEEDED
\`\`\`

If a database change is needed, output additive-only migration SQL:
\`\`\`sql
-- migration.sql
-- Additive only — never drop existing data
\`\`\``;

  return callClaude(system, user, 'claude-sonnet-4-6');
}

async function updateCodeModifier(
  changeAnalysis: string,
  migrationSql: string,
  existingCode: string,
): Promise<string> {
  appendLog(`[${ts()}] Update: modifying code...`);
  const system = `You are a senior full-stack developer making surgical, minimal code changes.
Touch only what the change requires. Never refactor unrelated code.`;

  const user = `Modify the existing code files per the change analysis.

Change analysis: ${changeAnalysis}
Migration SQL: ${migrationSql}

Existing code:
${existingCode}

━━━ Rules ━━━
- Every changed line must trace to the user's update request
- Keep existing style even if you'd write it differently
- Minimal code to solve it — no scope creep

Output format for each modified file:
**\`path/to/file.js\`**
\`\`\`js
// full modified file
\`\`\`

Only output files that changed.`;

  const result = await callClaude(system, user);
  appendLog(`[${ts()}] Code modified`);
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function createApp(
  description: string,
  tgUserId: string,
): Promise<{ files: Record<string, string>; schemaSql: string | null; repoName: string }> {
  const spec = await stage1Compose(description);
  const dbSchema = await stage2DbArchitect(description, tgUserId, spec);
  const slug = extractRepoSlug(dbSchema);
  const repoName = `app-tg${tgUserId}-${slug}`;
  appendLog(`[${ts()}] Repo: ${repoName}`);
  const frontendCode = await stage2FrontendCoder(description, spec, dbSchema);
  const qaFixes = await stage2QaReviewer(dbSchema, frontendCode);
  const base = parseCodeFiles(frontendCode);
  const fixes = /NO_FIXES_NEEDED/i.test(qaFixes) ? {} : parseCodeFiles(qaFixes);
  const files = { ...base, ...fixes };
  const schemaSql = extractSchemaSql(dbSchema);
  appendLog(`[${ts()}] Pipeline done — ${Object.keys(files).length} files, DB: ${schemaSql ? 'yes' : 'no'}`);
  return { files, schemaSql, repoName };
}

export async function updateApp(params: {
  repoName: string;
  updateRequest: string;
  existingCode: string;
  existingFileList: string;
  tgUserId: string;
}): Promise<{ files: Record<string, string>; migrationSql: string | null; commitMessage: string }> {
  const changeAnalysis = await updateChangeAnalyzer(
    params.repoName,
    params.updateRequest,
    params.existingFileList,
    params.tgUserId,
  );
  const migrationOutput = await updateDbMigration(changeAnalysis);
  const migrationSql = extractMigrationSql(migrationOutput);
  const codeOutput = await updateCodeModifier(changeAnalysis, migrationOutput, params.existingCode);
  const files = parseCodeFiles(codeOutput);
  const commitMatch = /## 4\.\s*Change summary\s*\n(.+)/i.exec(changeAnalysis);
  const commitMessage = commitMatch ? commitMatch[1].trim() : `feat: update ${params.repoName}`;
  appendLog(`[${ts()}] Update done — ${Object.keys(files).length} files changed`);
  return { files, migrationSql, commitMessage };
}
