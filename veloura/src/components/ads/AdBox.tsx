"use client";
import { useEffect, useRef } from "react";

/** Wraps an ad and records one impression the first time at least half of it is visible. */
export function AdBox({ kind, id, className, children }: { kind: "ad" | "sp"; id: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      fetch("/api/ads/impression", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: kind, id }), keepalive: true }).catch(() => {});
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [kind, id]);
  return <div ref={ref} className={className}>{children}</div>;
}
