"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createPostSchema } from "@/validations/media";

const MESSAGES: Record<string, string> = {
  consent_required: "Please confirm the checkbox to post.",
  banned: "Your account cannot post.",
  invalid_category: "Choose a category.",
  empty_post: "Write something or add a photo or video.",
  too_much_media: "Too many files: up to 6 images and 1 video.",
  too_many_pending: "You have 10 posts waiting for review. Wait for those first.",
  invalid_upload: "One of your uploads is missing or not finished. Remove it and try again.",
};

export async function createPost(raw: unknown): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in to post." };

  const parsed = createPostSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const { error } = await supabaseAdmin().rpc("create_post_with_media", {
    p_user: user.id,
    p_category: v.categoryId,
    p_title: v.title,
    p_body: v.body,
    p_preview: v.preview,
    p_is_premium: true, // premium-only platform
    p_consent: v.consent,
    p_upload_ids: v.uploadIds,
  });
  if (error) {
    const key = Object.keys(MESSAGES).find((k) => error.message.includes(k));
    if (!key) console.error("[post] create failed", error);
    return { error: key ? MESSAGES[key] : "Could not submit your post. Try again." };
  }
  revalidatePath("/dashboard/my-posts");
  return { ok: true };
}
