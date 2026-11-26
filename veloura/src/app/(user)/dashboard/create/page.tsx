import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { r2Configured } from "@/lib/r2/client";
import { PostComposer } from "@/components/feed/PostComposer";

export default async function Create() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const supabase = await createClient();
  const { data } = await supabase.from("categories").select("id,name").order("sort_order");
  const categories = (data ?? []) as { id: string; name: string }[];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/dashboard" className="text-sm text-muted">&larr; Dashboard</Link>
      <h1 className="mt-3 font-display text-3xl">New post</h1>
      <p className="mt-1 text-sm text-muted">Anonymous. Reviewed before it goes live.</p>
      <div className="mt-6">
        <PostComposer categories={categories} mediaEnabled={r2Configured()} />
      </div>
    </main>
  );
}
