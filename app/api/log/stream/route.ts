import { buildState, buildEmitter } from '@/lib/build-state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const enc = new TextEncoder();

  // Capture listener refs for cleanup in cancel()
  let onLine: ((line: string) => void) | null = null;
  let onDone: (() => void) | null = null;

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

      onLine = (line: string) => send({ line });
      onDone = () => {
        send({ done: true });
        buildEmitter.off('line', onLine!);
        try { controller.close(); } catch {}
      };

      buildEmitter.on('line', onLine);
      buildEmitter.once('done', onDone);
    },
    cancel() {
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
