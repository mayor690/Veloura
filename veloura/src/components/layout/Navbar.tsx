import Link from "next/link";
import { Wallet } from "lucide-react";

export function Navbar({ username, balance }: { username?: string; balance?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-display text-2xl text-accent-gradient">Veloura</Link>
        <nav className="flex items-center gap-2 text-sm">
          {username ? (
            <>
              <Link href="/checkout/topup" className="flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5">
                <Wallet size={14} className="text-purple" /> {balance}
              </Link>
              <Link href="/dashboard" className="hidden rounded-full px-3 py-1.5 text-muted hover:text-white md:block">
                @{username}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="px-3 py-1.5 text-muted hover:text-white">Log in</Link>
              <Link href="/register" className="rounded-full bg-accent-gradient px-4 py-1.5 font-medium">Join</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
