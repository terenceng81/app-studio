import { EventEmitter } from 'events';

export interface BuildState {
  running: boolean;
  repoName: string | null;
  startedAt: number | null;
  log: string[];
}

class BuildEmitter extends EventEmitter {}

// Use globals to survive Next.js hot-reload in dev mode
const g = global as typeof global & {
  _buildState?: BuildState;
  _buildEmitter?: BuildEmitter;
};

if (!g._buildState) {
  g._buildState = { running: false, repoName: null, startedAt: null, log: [] };
}
if (!g._buildEmitter) {
  g._buildEmitter = new BuildEmitter();
  g._buildEmitter.setMaxListeners(100);
}

export const buildState = g._buildState!;
export const buildEmitter = g._buildEmitter!;

export function resetBuild(repoName: string) {
  buildState.running = true;
  buildState.repoName = repoName;
  buildState.startedAt = Date.now();
  buildState.log = [];
}

export function appendLog(line: string) {
  const trimmed = line.trimEnd();
  if (trimmed) {
    buildState.log.push(trimmed);
    buildEmitter.emit('line', trimmed);
  }
}

export function finishBuild(code: number) {
  const exitLine = `[exit ${code}]`;
  buildState.log.push(exitLine);
  buildEmitter.emit('line', exitLine);
  buildEmitter.emit('done', { code });
  buildState.running = false;
}
