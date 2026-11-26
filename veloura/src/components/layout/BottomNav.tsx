import Link from "next/link";
import { Home, PlusCircle, User } from "lucide-react";

export function BottomNav({ loggedIn }: { loggedIn: boolean }) {
  const items = [
    { href: "/", label: "Home", Icon: Home },
    { href: loggedIn ? "/dashboard/create" : "/register", label: "Post", Icon: PlusCircle },
    { href: loggedIn ? "/dashboard" : "/login", label: "Me", Icon: User },
  ];
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/90 backdrop-blur md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-3">
        {items.map(({ href, label, Icon }) => (
          <li key={label}>
            <Link href={href} className="flex flex-col items-center gap-0.5 py-2 text-xs text-muted active:text-white">
              <Icon size={22} /> {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
