export function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <input
        {...props}
        className="h-12 rounded-xl border border-line bg-ink px-4 text-white outline-none focus:border-purple"
      />
    </label>
  );
}
