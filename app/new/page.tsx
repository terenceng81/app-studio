'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BuildLog } from '@/components/build-log';

export default function NewAppPage() {
  const router = useRouter();
  const [description, setDescription] = useState('');
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [buildSuccess, setBuildSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = description.trim();
    if (!text) return;
    setError('');

    try {
      const res = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? data.error ?? 'Failed to start build');
        return;
      }
      setBuilding(true);
    } catch {
      setError('Backend offline — is the App Builder API running?');
    }
  };

  const handleComplete = useCallback((success: boolean) => {
    setDone(true);
    setBuildSuccess(success);
    if (success) setTimeout(() => router.push('/'), 3000);
  }, [router]);

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="mb-2">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
          ← All apps
        </Link>
      </div>

      <div className="mb-8 mt-3">
        <h1 className="text-2xl font-semibold tracking-tight">Build a new app</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Describe what you want — the AI team will design, build, and deploy it to{' '}
          <span className="font-mono text-zinc-400">appname.nhkclouds.com</span>
        </p>
      </div>

      {!building && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. A Pomodoro timer with task list, streak tracking, and a minimal dark UI"
            rows={5}
            autoFocus
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 p-4 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!description.trim()}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              Build App
            </button>
            <Link
              href="/"
              className="py-2.5 px-4 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}

      {building && !done && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4 text-sm text-zinc-500 dark:text-zinc-400">
          <span className="text-zinc-400 dark:text-zinc-500 text-xs uppercase tracking-wide font-medium">Building</span>
          <p className="mt-1 text-zinc-700 dark:text-zinc-300">{description}</p>
        </div>
      )}

      {done && buildSuccess && (
        <div className="rounded-xl border border-emerald-700/30 bg-emerald-900/10 p-4 text-sm text-emerald-400">
          App deployed! Redirecting to dashboard…
        </div>
      )}

      {done && !buildSuccess && (
        <div className="rounded-xl border border-red-900/30 bg-red-900/10 p-4 text-sm text-red-400">
          Build failed. Check the log above for details.{' '}
          <button onClick={() => { setBuilding(false); setDone(false); }} className="underline ml-1">
            Try again
          </button>
        </div>
      )}

      <BuildLog active={building} onComplete={handleComplete} />
    </div>
  );
}
