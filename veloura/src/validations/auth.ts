import { z } from "zod";

export const registerSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_]{3,20}$/, "Use 3–20 letters, numbers or _"),
  password: z.string().min(8, "Use at least 8 characters"),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]),
  age18: z.literal("on", { errorMap: () => ({ message: "You must be 18 or older" }) }),
  terms: z.literal("on", { errorMap: () => ({ message: "Accept the terms to continue" }) }),
});

export const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(8),
});

export const recoverSchema = z.object({
  username: z.string().min(3),
  code: z.string().min(20),
  password: z.string().min(8),
});
