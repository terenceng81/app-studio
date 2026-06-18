import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { getHermesEnv } from '@/lib/env';
import { buildState, resetBuild, appendLog, finishBuild } from '@/lib/build-state';

const BUILD_SCRIPT = path.join(os.homedir(), '.hermes', 'scripts', 'build-app.sh');

export async function POST(request: Request) {
  if (buildState.running) {
    return Response.json(
      { detail: `Build already running: ${buildState.repoName}. Please wait.` },
      { status: 409 },
    );
  }

  let body: { repo_name?: string; update_request?: string; provider?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.repo_name || !body.update_request?.trim()) {
    return Response.json({ error: 'repo_name and update_request are required' }, { status: 400 });
  }

  const env = getHermesEnv();
  const tgUserId = env.TG_USER_ID ?? env.TELEGRAM_USER_ID ?? '0';

  resetBuild(body.repo_name);

  const child = spawn(
    'bash',
    [BUILD_SCRIPT, 'update', tgUserId, body.repo_name, body.update_request.trim(), body.provider ?? 'claude-code'],
    { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const onData = (d: Buffer) =>
    d.toString('utf-8').split('\n').forEach(line => appendLog(line));

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', code => finishBuild(code ?? 1));

  return Response.json({ status: 'started', stream: '/api/log/stream' });
}
