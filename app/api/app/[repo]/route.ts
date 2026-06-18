import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { getHermesEnv } from '@/lib/env';

const BUILD_SCRIPT = path.join(os.homedir(), '.hermes', 'scripts', 'build-app.sh');

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ repo: string }> },
) {
  const { repo } = await params;
  const env = getHermesEnv();
  const tgUserId = env.TG_USER_ID ?? env.TELEGRAM_USER_ID ?? '0';

  return new Promise<Response>(resolve => {
    const lines: string[] = [];
    const child = spawn('bash', [BUILD_SCRIPT, 'delete', tgUserId, repo], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (d: Buffer) => lines.push(d.toString('utf-8')));
    child.stderr.on('data', (d: Buffer) => lines.push(d.toString('utf-8')));
    child.on('close', code => {
      resolve(
        Response.json(
          { status: code === 0 ? 'deleted' : 'error', output: lines.join('') },
          { status: code === 0 ? 200 : 500 },
        ),
      );
    });
  });
}
