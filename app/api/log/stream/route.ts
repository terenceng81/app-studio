import { buildState, buildEmitter } from '@/lib/build-state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const enc = new TextEncoder();

  let onLine: ((line: string) => void) | null = null;
  let onDone: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller already closed
        }
      };

      // Flush buffered lines to catch up
      buildState.log.forEach(line => send({ line }));

      if (!buildState.running) {
        send({ done: true });
        controller.close();
        return;
      }

      // Heartbeat every 20s — keeps reverse proxies (Northflank, nginx) from
      // closing the idle connection during long LLM calls (30-60s of silence)
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(': ping\n\n'));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 20000);

      onLine = (line: string) => send({ line });
      onDone = () => {
        send({ done: true });
        if (heartbeat) clearInterval(heartbeat);
        buildEmitter.off('line', onLine!);
        try { controller.close(); } catch {}
      };

      buildEmitter.on('line', onLine);
      buildEmitter.once('done', onDone);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (onLine) buildEmitter.off('line', onLine);
      if (onDone) buildEmitter.off('done', onDone);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
