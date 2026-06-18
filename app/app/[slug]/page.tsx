'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { BuildLog } from '@/components/build-log';
import { type App } from '@/components/app-card';

function slugToTitle(slug: string) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function AppDetailPage() {
  const params = useParams();
  const router = useRouter();
  const repoName = decodeURIComponent(params.slug as string);
  const displaySlug = repoName.replace(/^app-tg\d+-/, '');

  const [app, setApp] = useState<App | null>(null);
  const [loading, setLoading] = useState(true);
  const [updateText, setUpdateText] = useState('');
  const [updating, setUpdating] = useState(false);
  const [done, setDone] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/apps')
      .then(r => r.json())
      .then(data => {
        setApp(data[repoName] ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [repoName]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = updateText.trim();
    if (!text) return;
    setError('');

    try {
      const res = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_name: repoName, update_request: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? data.error ?? 'Failed to start update');
        return;
      }
      setUpdating(true);
    } catch {
      setError('Backend offline');
    }
  };

  const handleComplete = useCallback((success: boolean) => {
    setDone(true);
    setUpdateSuccess(success);
    if (success) setTimeout(() => router.push('/'), 3000);
  }, [router]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="h-6 w-32 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mb-8" />
        <div className="h-40 bg-zinc-100 dark:bg-zinc-900 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-10 text-center">
        <p className="text-zinc-500">App not found</p>
        <Link href="/" className="mt-3 inline-block text-indigo-400 text-sm hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="mb-2">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
          ← All apps
        </Link>
      </div>

      <div className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{slugToTitle(displaySlug)}</h1>
        <p className="text-sm font-mono text-zinc-500 dark:text-zinc-400 mt-1">{displaySlug}</p>
      </div>

      {/* App info card */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 mb-8 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-zinc-500 dark:text-zinc-400">Live URL</span>
          <a href={app.custom_url} target="_blank" rel="noreferrer" className="text-indigo-500 dark:text-indigo-400 hover:underline font-mono text-xs">
            {app.custom_url.replace('https://', '')} ↗
          </a>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500 dark:text-zinc-400">GitHub</span>
          <a href={app.github_url} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-zinc-200 text-xs hover:underline">
            {app.github_url.replace('https://github.com/', '')} ↗
          </a>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500 dark:text-zinc-400">Database</span>
          <span className="text-xs">{app.provider ? `Neon (${app.project_id ?? '…'})` : 'None'}</span>
        </div>
      </div>

      {/* Update form */}
      {!updating && (
        <div>
          <h2 className="text-base font-semibold mb-4">Request an update</h2>
          <form onSubmit={handleUpdate} className="space-y-4">
            <textarea
              value={updateText}
              onChange={e => setUpdateText(e.target.value)}
              placeholder="e.g. Add a dark mode toggle, fix the mobile layout, add CSV export"
              rows={4}
              autoFocus
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 p-4 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={!updateText.trim()}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              Update App
            </button>
          </form>
        </div>
      )}

      {done && updateSuccess && (
        <div className="rounded-xl border border-emerald-700/30 bg-emerald-900/10 p-4 text-sm text-emerald-400">
          Update deployed! Redirecting…
        </div>
      )}

      {done && !updateSuccess && (
        <div className="rounded-xl border border-red-900/30 bg-red-900/10 p-4 text-sm text-red-400">
          Update failed. Check the log above.{' '}
          <button onClick={() => { setUpdating(false); setDone(false); }} className="underline ml-1">
            Try again
          </button>
        </div>
      )}

      <BuildLog active={updating} onComplete={handleComplete} />
    </div>
  );
}
