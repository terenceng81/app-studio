'use client';
import { useEffect, useRef, useState } from 'react';

interface BuildLogProps {
  active: boolean;
  onComplete?: (success: boolean) => void;
}

function lineColor(line: string) {
  if (line.startsWith('[ERROR]') || /\berror\b/i.test(line)) return 'text-red-400';
  if (line.startsWith('[exit 0]') || /success|✓|SUCCESS/i.test(line)) return 'text-emerald-400';
  if (/^(Stage|\[1\]|\[2\]|\[3\]|\[4\]|\[5\]|\[6\]|\[7\]|\[8\]|\[9\]|\[10\]|\[11\]|===)/.test(line)) return 'text-indigo-400 font-medium';
  if (/^\[Vercel\]|\[Neon\]|\[GitHub\]|\[Cloudflare\]/.test(line)) return 'text-sky-400';
  if (/URL:|CUSTOM_URL:|REPO:|SCREENSHOT:/.test(line)) return 'text-emerald-300 font-semibold';
  return 'text-zinc-400';
}

export function BuildLog({ active, onComplete }: BuildLogProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [success, setSuccess] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!active) return;
    setLines([]);
    setDone(false);
    setSuccess(null);

    esRef.current?.close();
    const es = new EventSource('/api/log/stream');
    esRef.current = es;

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.done) {
        setDone(true);
        const lastLine = (msg.log as string[] | undefined)?.at(-1) ?? '';
        const ok = lastLine.includes('[exit 0]');
        setSuccess(ok);
        onComplete?.(ok);
        es.close();
      } else if (msg.line !== undefined) {
        setLines(prev => [...prev, msg.line]);
      }
    };

    es.onerror = () => {
      es.close();
      setDone(true);
      setSuccess(false);
      onComplete?.(false);
    };

    return () => es.close();
  }, [active, onComplete]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  if (!active && lines.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900">
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          done
            ? success ? 'bg-emerald-500' : 'bg-red-500'
            : 'bg-amber-500 animate-pulse'
        }`} />
        <span className="text-xs text-zinc-400">
          {done
            ? success ? 'Build complete' : 'Build failed'
            : 'Building…'}
        </span>
        {!done && (
          <span className="ml-auto text-xs text-zinc-600 font-mono">{lines.length} lines</span>
        )}
      </div>
      <div className="p-4 max-h-[460px] overflow-y-auto font-mono text-xs leading-relaxed bg-zinc-950 space-y-px">
        {lines.map((line, i) => (
          <div key={i} className={lineColor(line)}>{line || ' '}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
