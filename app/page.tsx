'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppCard, type App } from '@/components/app-card';

export default function HomePage() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildingRepo, setBuildingRepo] = useState<string | null>(null);

  const fetchApps = async () => {
    try {
      const res = await fetch('/api/apps');
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.error) throw new Error();
      setApps(Object.values(data) as App[]);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/build/status');
      const data = await res.json();
      const wasBuilding = building;
      setBuilding(data.running ?? false);
      setBuildingRepo(data.repo_name ?? null);
      if (wasBuilding && !data.running) fetchApps();
    } catch {}
  };

  useEffect(() => {
    fetchApps();
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {building && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-sm text-amber-400">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <span>
            Build in progress{buildingRepo ? `: ${buildingRepo.replace(/^app-tg\d+-/, '')}` : ''}…
          </span>
          <Link href="/new" className="ml-auto text-xs text-amber-300 hover:underline">
            View log →
          </Link>
        </div>
      )}

      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your Apps</h1>
          {!loading && !offline && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {apps.length} app{apps.length !== 1 ? 's' : ''} deployed
            </p>
          )}
        </div>
      </div>

      {offline && (
        <div className="rounded-xl border border-red-900/30 bg-red-900/10 p-8 text-center">
          <p className="text-red-400 font-medium">App Builder API is offline</p>
          <p className="text-zinc-500 text-sm mt-1.5">
            Restart it:{' '}
            <code className="font-mono text-xs bg-zinc-800 px-1.5 py-0.5 rounded">
              launchctl start ai.hermes.appbuilder-api
            </code>
          </p>
        </div>
      )}

      {loading && !offline && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 rounded-xl bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && !offline && apps.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 py-20 text-center">
          <p className="text-zinc-400 text-sm">No apps yet</p>
          <Link
            href="/new"
            className="mt-3 inline-block text-indigo-500 dark:text-indigo-400 text-sm hover:underline"
          >
            Build your first app →
          </Link>
        </div>
      )}

      {!loading && !offline && apps.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {apps.map(app => (
            <AppCard key={app.repo_name} app={app} onDelete={fetchApps} />
          ))}
        </div>
      )}
    </div>
  );
}
