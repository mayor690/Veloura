export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_top,rgba(244,63,94,.12),transparent_60%)] px-5 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-line bg-card p-7">{children}</div>
    </main>
  );
}
