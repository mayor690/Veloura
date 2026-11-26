"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function confirmAge(fd: FormData) {
  const next = String(fd.get("next") ?? "/");
  (await cookies()).set("v_age_ok", "1", { maxAge: 60 * 60 * 24 * 30, path: "/", sameSite: "lax" });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
