import { z } from "zod";

export const initUploadSchema = z.object({
  kind: z.enum(["image", "video"]),
  mime: z.string().max(100),
  size: z.number().int().positive(),
  durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const createPostSchema = z.object({
  categoryId: z.string().uuid("Choose a category"),
  title: z.string().trim().max(120, "Title is too long").default(""),
  body: z.string().trim().max(5000, "Post is too long").default(""),
  preview: z.string().trim().max(200, "Summary is too long").default(""),
  consent: z.literal(true, { errorMap: () => ({ message: "Please confirm the checkbox to post" }) }),
  uploadIds: z.array(z.string().uuid()).max(7),
});
