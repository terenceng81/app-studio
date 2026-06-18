import { getHermesEnv } from '@/lib/env';
import { buildState, resetBuild, appendLog, finishBuild } from '@/lib/build-state';
import { updateApp } from '@/lib/ai-pipeline';
import { deployUpdate, githubGetRepoFiles } from '@/lib/deploy';

async function updatePipeline(repoName: string, updateRequest: string, tgUserId: string) {
  try {
    appendLog(`[update] Fetching existing code from GitHub...`);
    const { fileList, existingCode } = await githubGetRepoFiles(repoName);

    const { files, migrationSql, commitMessage } = await updateApp({
      repoName,
      updateRequest,
      existingCode,
      existingFileList: fileList,
      tgUserId,
    });

    await deployUpdate({ repoName, files, migrationSql, commitMessage });
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

  void updatePipeline(body.repo_name, body.update_request.trim(), tgUserId);

  return Response.json({ status: 'started', stream: '/api/log/stream' });
}
