"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <h1 className="font-display text-3xl">Something went wrong</h1>
        <p className="mt-3 text-muted">Please try again. If it keeps happening, come back in a few minutes.</p>
        <button onClick={reset} className="mt-6 rounded-xl bg-accent-gradient px-6 py-3 font-semibold">Try again</button>
      </div>
    </main>
  );
}
