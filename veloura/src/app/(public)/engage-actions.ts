"use server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type Engagement = { like: number; love: number; fire: number; mine: string | null; comments: number };

const ERR: Record<string, string> = {
  no_access: "Unlock this category to join in.",
  banned: "Your account cannot do that.",
  post_not_found: "This post is no longer available.",
  invalid_body: "Write between 2 and 1000 characters.",
  rate_limited: "You've commented a lot today. Please try again tomorrow.",
  too_many_pending: "You have comments waiting for review. Please wait for those first.",
};
const msg = (m: string) => Object.entries(ERR).find(([k]) => m.includes(k))?.[1] ?? "Something went wrong. Try again.";

export async function setReaction(postId: string, kind: string | null): Promise<{ ok: true; engagement: Engagement } | { error: string }> {
  const { data: { user } } = await createClient().then((s) => s.auth.getUser());
  if (!user) return { error: "Log in to react." };
  const { data, error } = await supabaseAdmin().rpc("set_reaction", { p_user: user.id, p_post: postId, p_kind: kind });
  if (error) return { error: msg(error.message) };
  return { ok: true, engagement: data as Engagement };
}

export async function addComment(postId: string, body: string): Promise<{ ok: true } | { error: string }> {
  const { data: { user } } = await createClient().then((s) => s.auth.getUser());
  if (!user) return { error: "Log in to comment." };
  const { error } = await supabaseAdmin().rpc("create_comment", { p_user: user.id, p_post: postId, p_body: String(body ?? "").slice(0, 1000) });
  if (error) return { error: msg(error.message) };
  return { ok: true };
}
