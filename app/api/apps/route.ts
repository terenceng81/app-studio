import fs from 'fs';
import path from 'path';
import os from 'os';
import { getHermesEnv } from '@/lib/env';

const REGISTRY = path.join(os.homedir(), '.hermes', 'app-builder', 'apps.json');
const SENSITIVE = ['connection_uri', 'branch_id'];

function slugFromRepo(repo: string) {
  return repo.replace(/^app-tg\d+-/, '');
}

export async function GET() {
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY, 'utf-8')) as Record<string, Record<string, unknown>>;
    const env = getHermesEnv();
    const cfBase = env.CUSTOM_DOMAIN_BASE ?? 'nhkclouds.com';
    const ghOwner = env.GITHUB_OWNER ?? 'terenceng81';

    const result: Record<string, unknown> = {};
    for (const [repo, info] of Object.entries(raw)) {
      const enriched = { ...info };
      for (const field of SENSITIVE) delete enriched[field];
      result[repo] = {
        ...enriched,
        repo_name: repo,
        custom_url: `https://${slugFromRepo(repo)}.${cfBase}`,
        vercel_url: `https://${repo}.vercel.app`,
        github_url: `https://github.com/${ghOwner}/${repo}`,
      };
    }
    return Response.json(result);
  } catch {
    return Response.json({});
  }
}
