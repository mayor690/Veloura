import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <h1 className="font-display text-5xl text-accent-gradient">404</h1>
        <p className="mt-3 text-muted">We couldn&apos;t find that page.</p>
        <Link href="/" className="mt-6 inline-block rounded-xl bg-accent-gradient px-6 py-3 font-semibold">Back home</Link>
      </div>
    </main>
  );
}
