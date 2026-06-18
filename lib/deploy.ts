/**
 * deploy.ts — replaces deploy-app.py
 *
 * Pure TypeScript/Node.js deployment: Neon + GitHub + Vercel + Cloudflare.
 * Uses fetch() for all API calls and GitHub's Git Trees API (no git binary).
 *
 * Registry (apps.json) note: currently reads/writes ~/.hermes/app-builder/apps.json.
 * For Vercel cloud deployment, replace registry with Supabase or Vercel KV.
 */

import { Pool } from '@neondatabase/serverless';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { getHermesEnv } from './env';
import { appendLog } from './build-state';

// ── Config ────────────────────────────────────────────────────────────────────

function cfg() {
  const env = getHermesEnv();
  return {
    githubToken: env.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? '',
    githubOwner: env.GITHUB_OWNER ?? process.env.GITHUB_OWNER ?? 'terenceng81',
    vercelToken: env.VERCEL_TOKEN ?? process.env.VERCEL_TOKEN ?? '',
    vercelTeamId: env.VERCEL_TEAM_ID ?? process.env.VERCEL_TEAM_ID ?? '',
    neonApiKey: env.NEON_API_KEY ?? process.env.NEON_API_KEY ?? '',
    neonRegion: env.NEON_REGION ?? process.env.NEON_REGION ?? 'aws-ap-southeast-1',
    cfToken: env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN ?? '',
    cfZone: env.CLOUDFLARE_ZONE_ID ?? process.env.CLOUDFLARE_ZONE_ID ?? '',
    customDomainBase: env.CUSTOM_DOMAIN_BASE ?? process.env.CUSTOM_DOMAIN_BASE ?? 'nhkclouds.com',
  };
}

// ── Registry (apps.json) ──────────────────────────────────────────────────────

const REGISTRY_PATH = path.join(os.homedir(), '.hermes', 'app-builder', 'apps.json');

function registryLoad(): Record<string, Record<string, string>> {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function registrySave(repoName: string, info: Record<string, string>) {
  try {
    fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
    const data = registryLoad();
    data[repoName] = info;
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    appendLog(`[registry] Write failed: ${e}`);
  }
}

export function registryGet(repoName: string): Record<string, string> {
  return registryLoad()[repoName] ?? {};
}

function registryDelete(repoName: string) {
  try {
    const data = registryLoad();
    delete data[repoName];
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2));
  } catch {}
}

// ── Neon ──────────────────────────────────────────────────────────────────────

async function neonRequest(method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const { neonApiKey } = cfg();
  const res = await fetch(`https://console.neon.tech/api/v2${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${neonApiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    appendLog(`[Neon] ${method} ${urlPath} → ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }
  return text ? JSON.parse(text) : {};
}

async function neonCreateProject(repoName: string) {
  const { neonRegion } = cfg();
  const resp = await neonRequest('POST', '/projects', {
    project: { name: repoName, region_id: neonRegion, pg_version: 17 },
  }) as Record<string, unknown> | null;
  if (!resp) return null;
  const project = resp.project as Record<string, string>;
  const conn = (resp.connection_uris as Array<Record<string, string>>)[0];
  const roles = resp.roles as Array<Record<string, string>>;
  const databases = resp.databases as Array<Record<string, string>>;
  return {
    project_id: project.id,
    branch_id: roles[0].branch_id,
    db_name: databases[0].name,
    connection_uri: conn.connection_uri,
  };
}

export async function neonRunSql(connectionUri: string, sql: string): Promise<boolean> {
  const pool = new Pool({ connectionString: connectionUri });
  const client = await pool.connect();
  try {
    const noComments = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const statements = noComments.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await client.query(stmt);
    }
    appendLog(`[Neon] Ran ${statements.length} SQL statements`);
    return true;
  } catch (e) {
    appendLog(`[Neon] SQL error: ${e}`);
    return false;
  } finally {
    client.release();
    await pool.end();
  }
}

async function neonDeleteProject(projectId: string): Promise<void> {
  const { neonApiKey } = cfg();
  await fetch(`https://console.neon.tech/api/v2/projects/${projectId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${neonApiKey}` },
  });
}

// ── GitHub ────────────────────────────────────────────────────────────────────

async function githubRequest(method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const { githubToken } = cfg();
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `token ${githubToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok && res.status !== 422) {
    appendLog(`[GitHub] ${method} ${urlPath} → ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }
  return text ? JSON.parse(text) : {};
}

async function githubCreateRepo(repoName: string, description: string): Promise<boolean> {
  const result = await githubRequest('POST', '/user/repos', {
    name: repoName,
    description,
    private: false,
    auto_init: false,
  }) as Record<string, unknown> | null;
  return !!result?.id;
}

export async function githubPushFiles(
  repoName: string,
  files: Record<string, string>,
  message: string,
  isUpdate = false,
): Promise<boolean> {
  const { githubOwner } = cfg();

  // Create blobs for all files
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const [filePath, content] of Object.entries(files)) {
    const blob = await githubRequest(
      'POST',
      `/repos/${githubOwner}/${repoName}/git/blobs`,
      { content: Buffer.from(content, 'utf-8').toString('base64'), encoding: 'base64' },
    ) as Record<string, string> | null;
    if (!blob?.sha) { appendLog(`[GitHub] Blob failed for ${filePath}`); return false; }
    treeEntries.push({ path: filePath, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // Get base tree for updates
  let baseTreeSha: string | undefined;
  const parentShas: string[] = [];
  if (isUpdate) {
    const refData = await githubRequest(
      'GET',
      `/repos/${githubOwner}/${repoName}/git/refs/heads/main`,
    ) as Record<string, Record<string, string>> | null;
    const lastSha = refData?.object?.sha;
    if (lastSha) {
      parentShas.push(lastSha);
      const commitData = await githubRequest(
        'GET',
        `/repos/${githubOwner}/${repoName}/git/commits/${lastSha}`,
      ) as Record<string, Record<string, string>> | null;
      if (commitData?.tree?.sha) baseTreeSha = commitData.tree.sha;
    }
  }

  // Create tree
  const treePayload: Record<string, unknown> = { tree: treeEntries };
  if (baseTreeSha) treePayload.base_tree = baseTreeSha;
  const tree = await githubRequest(
    'POST',
    `/repos/${githubOwner}/${repoName}/git/trees`,
    treePayload,
  ) as Record<string, string> | null;
  if (!tree?.sha) return false;

  // Create commit
  const commitPayload: Record<string, unknown> = { message, tree: tree.sha };
  if (parentShas.length) commitPayload.parents = parentShas;
  const commit = await githubRequest(
    'POST',
    `/repos/${githubOwner}/${repoName}/git/commits`,
    commitPayload,
  ) as Record<string, string> | null;
  if (!commit?.sha) return false;

  // Create or update ref
  if (isUpdate) {
    await githubRequest('PATCH', `/repos/${githubOwner}/${repoName}/git/refs/heads/main`, {
      sha: commit.sha,
      force: false,
    });
  } else {
    await githubRequest('POST', `/repos/${githubOwner}/${repoName}/git/refs`, {
      ref: 'refs/heads/main',
      sha: commit.sha,
    });
  }

  appendLog(`[GitHub] Pushed ${Object.keys(files).length} files to ${repoName}`);
  return true;
}

async function githubDeleteRepo(repoName: string): Promise<void> {
  const { githubOwner } = cfg();
  await githubRequest('DELETE', `/repos/${githubOwner}/${repoName}`);
}

export async function githubGetRepoFiles(repoName: string): Promise<{
  fileList: string;
  existingCode: string;
}> {
  const { githubOwner } = cfg();
  const tree = await githubRequest(
    'GET',
    `/repos/${githubOwner}/${repoName}/git/trees/main?recursive=1`,
  ) as Record<string, unknown> | null;

  if (!tree?.tree) return { fileList: '', existingCode: '' };
  const allFiles = (tree.tree as Array<{ path: string; type: string }>)
    .filter(f => f.type === 'blob' && /\.(js|jsx|ts|tsx|css)$/.test(f.path))
    .map(f => f.path);

  const fileList = allFiles.join(' ');

  // Fetch key files for AI context (limit to avoid token overflow)
  const keyPaths = allFiles.filter(p =>
    p.startsWith('app/') || p.startsWith('lib/') || p === 'app/globals.css'
  ).slice(0, 15);

  const codeBlocks: string[] = [];
  for (const filePath of keyPaths) {
    const file = await githubRequest(
      'GET',
      `/repos/${githubOwner}/${repoName}/contents/${filePath}`,
    ) as Record<string, string> | null;
    if (file?.content) {
      const content = Buffer.from(file.content, 'base64').toString('utf-8');
      codeBlocks.push(`// ${filePath}\n${content.slice(0, 2000)}`);
    }
  }

  return { fileList, existingCode: codeBlocks.join('\n\n---\n\n') };
}

// ── Vercel ────────────────────────────────────────────────────────────────────

async function vercelRequest(method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const { vercelToken, vercelTeamId } = cfg();
  const sep = urlPath.includes('?') ? '&' : '?';
  const url = `https://api.vercel.com${urlPath}${vercelTeamId ? `${sep}teamId=${vercelTeamId}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    appendLog(`[Vercel] ${method} ${urlPath} → ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }
  return text ? JSON.parse(text) : {};
}

async function vercelCreateProject(repoName: string): Promise<string | null> {
  const { githubOwner } = cfg();
  const result = await vercelRequest('POST', '/v10/projects', {
    name: repoName,
    framework: 'nextjs',
    gitRepository: { type: 'github', repo: `${githubOwner}/${repoName}` },
    publicSource: true,
  }) as Record<string, string> | null;
  return result?.id ?? null;
}

async function vercelGetProjectId(repoName: string): Promise<string | null> {
  const result = await vercelRequest('GET', `/v9/projects/${repoName}`) as Record<string, string> | null;
  return result?.id ?? null;
}

async function vercelSetEnvVars(projectId: string, vars: Record<string, string>): Promise<void> {
  const payload = Object.entries(vars).map(([key, value]) => ({
    key,
    value,
    type: 'plain',
    target: ['production', 'preview'],
  }));
  await vercelRequest('POST', `/v10/projects/${projectId}/env`, payload);
}

async function vercelAddDomain(projectId: string, domain: string): Promise<void> {
  await vercelRequest('POST', `/v10/projects/${projectId}/domains`, { name: domain });
  appendLog(`[Vercel] Custom domain: ${domain}`);
}

async function vercelDisableProtection(projectId: string): Promise<void> {
  await vercelRequest('PATCH', `/v9/projects/${projectId}`, { ssoProtection: null });
}

async function vercelTriggerDeploy(repoName: string): Promise<void> {
  const { githubOwner } = cfg();
  await vercelRequest('POST', '/v13/deployments', {
    name: repoName,
    gitSource: { type: 'github', org: githubOwner, repo: repoName, ref: 'main' },
    projectSettings: { framework: 'nextjs' },
  });
}

async function vercelWaitForDeployment(repoName: string, maxWaitMs = 180_000): Promise<string | null> {
  appendLog(`[Vercel] Waiting for deployment...`);
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10_000));
    const result = await vercelRequest(
      'GET',
      `/v6/deployments?projectId=${repoName}&limit=1&state=READY`,
    ) as Record<string, unknown> | null;
    const deps = result?.deployments as Array<Record<string, string>> | undefined;
    if (deps?.[0]?.state === 'READY') {
      const url = `https://${deps[0].url}`;
      appendLog(`[Vercel] Deployed: ${url}`);
      return url;
    }
    appendLog(`[Vercel] Still deploying...`);
  }
  appendLog(`[Vercel] Timeout waiting for deployment`);
  return null;
}

async function vercelDeleteProject(repoName: string): Promise<void> {
  await vercelRequest('DELETE', `/v9/projects/${repoName}`);
}

// ── Cloudflare ────────────────────────────────────────────────────────────────

async function cloudflareAddCname(subdomain: string): Promise<void> {
  const { cfToken, cfZone, customDomainBase } = cfg();
  if (!cfToken || !cfZone) return;
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${cfZone}/dns_records`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'CNAME',
      name: subdomain,
      content: 'cname.vercel-dns.com',
      ttl: 1,
      proxied: false,
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (data.success) {
    appendLog(`[Cloudflare] CNAME ${subdomain}.${customDomainBase} created`);
  } else {
    const errors = data.errors as Array<Record<string, unknown>>;
    if (errors?.[0]?.code === 81057) {
      appendLog(`[Cloudflare] CNAME already exists — reusing`);
    } else {
      appendLog(`[Cloudflare] CNAME error: ${JSON.stringify(errors)}`);
    }
  }
}

async function cloudflareDeleteCname(subdomain: string): Promise<void> {
  const { cfToken, cfZone, customDomainBase } = cfg();
  if (!cfToken || !cfZone) return;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${cfZone}/dns_records?type=CNAME&name=${subdomain}.${customDomainBase}`,
    { headers: { Authorization: `Bearer ${cfToken}` } },
  );
  const data = await res.json() as Record<string, unknown>;
  const result = (data.result as Array<Record<string, string>>)?.[0];
  if (!result?.id) return;
  await fetch(`https://api.cloudflare.com/client/v4/zones/${cfZone}/dns_records/${result.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${cfToken}` },
  });
  appendLog(`[Cloudflare] CNAME ${subdomain}.${customDomainBase} deleted`);
}

// ── File helpers ──────────────────────────────────────────────────────────────

function makeReadme(repoName: string, description: string, liveUrl: string, hasDb: boolean): string {
  const title = repoName.split('-').slice(3).join(' ').replace(/\b\w/g, c => c.toUpperCase()) || repoName;
  const stack = hasDb
    ? '- Next.js 14 App Router · Neon Postgres · Better Auth'
    : '- Next.js 14 App Router (no database)';
  return `# ${title}\n\n${description}\n\n## Live App\n\n${liveUrl}\n\n## Stack\n\n${stack}\n- Deployed to Vercel\n\n*Built with [App Builder Studio](https://github.com/terenceng81/app-studio)*\n`;
}

function makeGitignore(): string {
  return `node_modules/\n.next/\n.env.local\n.env*.local\nout/\nbuild/\n`;
}

// ── Public flows ──────────────────────────────────────────────────────────────

export async function deployCreate(params: {
  files: Record<string, string>;
  schemaSql: string | null;
  repoName: string;
  description: string;
  tgUserId: string;
}): Promise<{ liveUrl: string | null; customUrl: string | null; githubUrl: string }> {
  const { files, schemaSql, repoName, description, tgUserId } = params;
  const { githubOwner, cfToken, cfZone, customDomainBase } = cfg();
  const hasDb = !!schemaSql;

  const appSlug = repoName.replace(`app-tg${tgUserId}-`, '');
  const customDomain = cfToken && cfZone ? `${appSlug}.${customDomainBase}` : '';
  const canonicalUrl = customDomain ? `https://${customDomain}` : `https://${repoName}.vercel.app`;

  // 1. Provision Neon database
  let appEnv: Record<string, string> = {};
  if (hasDb) {
    appendLog(`[1/8] Creating Neon project...`);
    const proj = await neonCreateProject(repoName);
    if (!proj) throw new Error('Neon project creation failed');
    appendLog(`[1/8] Neon: ${proj.project_id}`);
    appendLog(`[1/8] Running schema SQL...`);
    const ok = await neonRunSql(proj.connection_uri, schemaSql!);
    if (!ok) throw new Error('Schema SQL failed');
    const authSecret = crypto.randomBytes(32).toString('hex');
    appEnv = {
      DATABASE_URL: proj.connection_uri,
      AUTH_SECRET: authSecret,
      NEXT_PUBLIC_APP_URL: canonicalUrl,
    };
    registrySave(repoName, {
      provider: 'neon',
      project_id: proj.project_id,
      branch_id: proj.branch_id,
      connection_uri: proj.connection_uri,
    });
  } else {
    appendLog(`[1/8] No database needed`);
  }

  // 2. Prepare files with README + .gitignore
  const allFiles = {
    ...files,
    'README.md': makeReadme(repoName, description, canonicalUrl, hasDb),
    '.gitignore': makeGitignore(),
  };

  // 3. Create GitHub repo
  appendLog(`[2/8] Creating GitHub repo: ${githubOwner}/${repoName}`);
  await githubCreateRepo(repoName, `Built by App Builder`);
  await new Promise(r => setTimeout(r, 2000));

  // 4. Push files via Tree API
  appendLog(`[3/8] Pushing ${Object.keys(allFiles).length} files to GitHub...`);
  const pushed = await githubPushFiles(repoName, allFiles, 'feat: initial app generated by App Builder');
  if (!pushed) throw new Error('GitHub push failed');
  const githubUrl = `https://github.com/${githubOwner}/${repoName}`;

  // 5. Create Vercel project
  appendLog(`[4/8] Setting up Vercel project...`);
  let projectId = await vercelGetProjectId(repoName);
  if (!projectId) {
    projectId = await vercelCreateProject(repoName);
    if (!projectId) throw new Error('Vercel project creation failed');
    appendLog(`[4/8] Vercel project: ${projectId}`);
  }

  // 6. Set env vars
  if (Object.keys(appEnv).length) {
    appendLog(`[5/8] Setting Vercel env vars...`);
    await vercelSetEnvVars(projectId, appEnv);
  }

  // 7. Custom domain
  if (customDomain) {
    appendLog(`[6/8] Adding custom domain: ${customDomain}`);
    await vercelAddDomain(projectId, customDomain);
    await cloudflareAddCname(appSlug);
  }

  // 8. Disable protection + trigger deploy
  appendLog(`[7/8] Disabling deployment protection...`);
  await vercelDisableProtection(projectId);
  appendLog(`[8/8] Triggering deployment...`);
  await vercelTriggerDeploy(repoName);

  const liveUrl = await vercelWaitForDeployment(repoName);
  appendLog(`\n${'='.repeat(50)}`);
  if (liveUrl) {
    appendLog(`SUCCESS`);
    appendLog(`URL: ${liveUrl}`);
    if (customDomain) appendLog(`CUSTOM_URL: ${canonicalUrl}`);
    appendLog(`REPO: ${githubUrl}`);
  } else {
    appendLog(`PARTIAL — check Vercel dashboard`);
    appendLog(`REPO: ${githubUrl}`);
  }
  appendLog('='.repeat(50));

  return { liveUrl, customUrl: customDomain ? canonicalUrl : null, githubUrl };
}

export async function deployUpdate(params: {
  repoName: string;
  files: Record<string, string>;
  migrationSql: string | null;
  commitMessage: string;
}): Promise<{ liveUrl: string | null }> {
  const { repoName, files, migrationSql, commitMessage } = params;

  // Run migration if needed
  if (migrationSql) {
    appendLog(`[update] Running migration SQL...`);
    const info = registryGet(repoName);
    if (!info.connection_uri) {
      appendLog(`[update] No stored connection for ${repoName} — skipping migration`);
    } else {
      await neonRunSql(info.connection_uri, migrationSql);
    }
  }

  // Push changed files
  appendLog(`[update] Pushing ${Object.keys(files).length} file(s) to GitHub...`);
  await githubPushFiles(repoName, files, commitMessage, true);

  // Vercel auto-redeploys on push
  appendLog(`[update] Waiting for Vercel redeploy...`);
  const liveUrl = await vercelWaitForDeployment(repoName);
  appendLog(`[update] Done — ${liveUrl ?? 'check Vercel dashboard'}`);
  return { liveUrl };
}

export async function deployDelete(repoName: string): Promise<void> {
  appendLog(`[delete] Deleting ${repoName}...`);

  // 1. Neon
  const info = registryGet(repoName);
  if (info.project_id) {
    appendLog(`[delete] Neon project: ${info.project_id}`);
    await neonDeleteProject(info.project_id);
  }

  // 2. Vercel
  appendLog(`[delete] Vercel project...`);
  await vercelDeleteProject(repoName);

  // 3. Cloudflare CNAME
  const { cfToken, cfZone } = cfg();
  if (cfToken && cfZone) {
    const slug = repoName.replace(/^app-tg\d+-/, '');
    await cloudflareDeleteCname(slug);
  }

  // 4. GitHub repo
  appendLog(`[delete] GitHub repo...`);
  await githubDeleteRepo(repoName);

  // 5. Registry
  registryDelete(repoName);
  appendLog(`[delete] Done`);
}
