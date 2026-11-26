import { z } from "zod";

export const settingsSchema = z
  .object({
    usd_ngn_rate: z.coerce.number().min(1, "Rate must be at least 1").max(100000),
    daily_price_naira: z.coerce.number().min(1).max(100000),
    full_pass_naira: z.coerce.number().min(1).max(1000000),
    min_topup_naira: z.coerce.number().min(1).max(1000000),
    min_topup_usd: z.coerce.number().min(0.5).max(1000),
    max_topup_usd: z.coerce.number().min(1).max(10000),
    unlock_hours: z.coerce.number().int().min(1).max(168),
    creator_share_pct: z.coerce.number().min(0).max(100),
    min_payout_naira: z.coerce.number().min(1).max(10000000),
    weight_view: z.coerce.number().int().min(0).max(20),
    weight_reaction: z.coerce.number().int().min(0).max(20),
    weight_comment: z.coerce.number().int().min(0).max(20),
    comment_trust_min_approved: z.coerce.number().int().min(1).max(100),
    tip_fee_pct: z.coerce.number().min(0).max(50),
    tip_min_naira: z.coerce.number().min(1).max(1000000),
    tip_max_naira: z.coerce.number().min(1).max(10000000),
    tip_daily_cap_naira: z.coerce.number().min(1).max(100000000),
  })
  .refine((v) => v.max_topup_usd > v.min_topup_usd, { message: "Maximum top-up must be above the minimum", path: ["max_topup_usd"] })
  .refine((v) => v.tip_max_naira >= v.tip_min_naira, { message: "Maximum tip must be at least the minimum", path: ["tip_max_naira"] })
  .refine((v) => v.tip_daily_cap_naira >= v.tip_max_naira, { message: "Daily cap must be at least the maximum tip", path: ["tip_daily_cap_naira"] })
  .refine((v) => v.full_pass_naira >= v.daily_price_naira, { message: "Full Pass should cost at least one category", path: ["full_pass_naira"] });

export const reportSchema = {
  reasons: ["possible_minor", "non_consensual", "illegal", "spam", "personal_info", "other"] as const,
};
