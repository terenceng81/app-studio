'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './theme-toggle';

export function Navbar() {
  const path = usePathname();
  const isNew = path === '/new';

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
          <span className="text-indigo-500 text-base">⬡</span>
          <span>App Builder Studio</span>
        </Link>

        <div className="flex-1" />

        <ThemeToggle />

        {!isNew && (
          <Link
            href="/new"
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + New App
          </Link>
        )}
      </div>
    </header>
  );
}
