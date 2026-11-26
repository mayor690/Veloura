import { Navbar } from "@/components/layout/Navbar";
import { BottomNav } from "@/components/layout/BottomNav";
import { getViewer } from "@/lib/viewer";
import { getPublicSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/admin-guard";
import { naira } from "@/lib/constants";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [viewer, settings] = await Promise.all([getViewer(), getPublicSettings()]);

  if (settings.maintenance && !(await requireStaff())) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="font-display text-4xl text-accent-gradient">Veloura</h1>
          <p className="mt-4 text-muted">We&apos;re making some improvements. Please check back shortly.</p>
        </div>
      </main>
    );
  }

  return (
    <>
      <Navbar username={viewer?.username} balance={viewer ? naira(viewer.balanceKobo) : undefined} />
      <div className="pb-24 md:pb-0">{children}</div>
      <BottomNav loggedIn={!!viewer} />
    </>
  );
}
