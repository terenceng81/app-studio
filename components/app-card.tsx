'use client';
import Link from 'next/link';
import { useState } from 'react';

export interface App {
  repo_name: string;
  custom_url: string;
  vercel_url: string;
  github_url: string;
  provider?: string;
  project_id?: string;
}

function slugToTitle(slug: string) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function AppCard({ app, onDelete }: { app: App; onDelete?: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const slug = app.repo_name.replace(/^app-tg\d+-/, '');
  const hasDb = !!app.provider;

  const handleDelete = async () => {
    if (!confirm(`Delete "${slugToTitle(slug)}"?\n\nThis will remove the GitHub repo, Vercel project, Neon database, and Cloudflare DNS record.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/app/${encodeURIComponent(app.repo_name)}`, { method: 'DELETE' });
      if (res.ok) onDelete?.();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="group rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col gap-3.5 hover:border-indigo-400/50 dark:hover:border-indigo-500/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {slugToTitle(slug)}
          </h2>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 font-mono mt-0.5 truncate">{slug}</p>
        </div>
        <span className={`shrink-0 mt-0.5 text-xs px-2 py-0.5 rounded-full border ${
          hasDb
            ? 'border-indigo-500/30 text-indigo-400 bg-indigo-500/10'
            : 'border-zinc-700 text-zinc-500 bg-zinc-800/40'
        }`}>
          {hasDb ? 'DB' : 'Static'}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 text-xs">
        <a
          href={app.custom_url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-indigo-500 dark:text-indigo-400 hover:underline font-mono truncate"
        >
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          {app.custom_url.replace('https://', '')}
        </a>
        <div className="flex items-center gap-3 text-zinc-400 dark:text-zinc-500">
          <a href={app.github_url} target="_blank" rel="noreferrer" className="hover:text-zinc-200 transition-colors">
            GitHub ↗
          </a>
          <a href={app.vercel_url} target="_blank" rel="noreferrer" className="hover:text-zinc-200 transition-colors">
            Vercel ↗
          </a>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <Link
          href={`/app/${encodeURIComponent(app.repo_name)}`}
          className="flex-1 text-center py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          Update
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="py-1.5 px-3 text-xs font-medium rounded-lg border border-red-900/30 text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40"
        >
          {deleting ? '…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
