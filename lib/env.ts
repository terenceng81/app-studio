import fs from 'fs';
import path from 'path';
import os from 'os';

let cache: Record<string, string> | null = null;

export function getHermesEnv(): Record<string, string> {
  if (cache) return cache;
  try {
    const content = fs.readFileSync(path.join(os.homedir(), '.hermes', '.env'), 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      env[k] = v;
    }
    cache = env;
    return env;
  } catch {
    cache = {};
    return {};
  }
}
