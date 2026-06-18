import { getHermesEnv } from '@/lib/env';
import { buildState, resetBuild, appendLog, finishBuild } from '@/lib/build-state';
import { createApp } from '@/lib/ai-pipeline';
import { deployCreate } from '@/lib/deploy';

async function buildPipeline(description: string, tgUserId: string) {
  try {
    const { files, schemaSql, repoName } = await createApp(description, tgUserId);
    await deployCreate({ files, schemaSql, repoName, description, tgUserId });
    finishBuild(0);
  } catch (err) {
    appendLog(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
    finishBuild(1);
  }
}

export async function POST(request: Request) {
  if (buildState.running) {
    return Response.json(
      { detail: `Build already running: ${buildState.repoName}. Please wait.` },
      { status: 409 },
    );
  }

  let body: { description?: string; provider?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.description?.trim()) {
    return Response.json({ error: 'description is required' }, { status: 400 });
  }

  const env = getHermesEnv();
  const tgUserId = env.TG_USER_ID ?? env.TELEGRAM_USER_ID ?? '0';

  resetBuild(`app-tg${tgUserId}-pending`);

  // Fire-and-forget — client streams progress via /api/log/stream
  void buildPipeline(body.description.trim(), tgUserId);

  return Response.json({ status: 'started', stream: '/api/log/stream' });
}
