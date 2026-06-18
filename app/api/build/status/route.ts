import { buildState } from '@/lib/build-state';

export async function GET() {
  return Response.json({
    running: buildState.running,
    repo_name: buildState.repoName,
    started_at: buildState.startedAt,
    log: buildState.log.slice(-100),
  });
}
