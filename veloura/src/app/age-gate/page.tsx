import { confirmAge } from "./actions";

export default async function AgeGate({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "/" } = await searchParams;
  return (
    <main className="min-h-dvh grid place-items-center px-5 bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,.18),transparent_60%)]">
      <div className="w-full max-w-sm rounded-3xl bg-card border border-line p-8 text-center glow">
        <h1 className="font-display text-4xl text-accent-gradient">Veloura</h1>
        <p className="mt-4 text-sm text-muted">
          This site contains adult content and is strictly for people aged 18 or over.
        </p>
        <form action={confirmAge} className="mt-8 grid gap-3">
          <input type="hidden" name="next" value={next} />
          <button className="h-12 rounded-xl bg-accent-gradient font-semibold">I am 18 or older</button>
          <a href="https://www.google.com" className="h-12 grid place-items-center rounded-xl border border-line text-muted">
            I am under 18, leave
          </a>
        </form>
        <p className="mt-6 text-xs text-muted">By entering you agree to our Terms and Content Policy.</p>
      </div>
    </main>
  );
}
