import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;

  // 18+ gate for first-time visitors
  const publicOk = ["/age-gate", "/terms", "/privacy", "/content-policy", "/api/webhooks"];
  if (!req.cookies.get("v_age_ok") && !publicOk.some((p) => path.startsWith(p))) {
    const url = req.nextUrl.clone();
    url.pathname = "/age-gate";
    url.search = "";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (!user && (path.startsWith("/dashboard") || path.startsWith("/admin") || path.startsWith("/checkout"))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Role check for /admin happens in the admin layout (server-side DB lookup).
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|api/health|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
