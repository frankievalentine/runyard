import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Icon } from "../../components/icons.tsx";
import { PageHeader } from "../../components/ui.tsx";
import { sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/settings")({
  component: Settings,
});

const tab = "inline-flex h-8 items-center border-b-2 px-1 text-[13px] font-medium";

/** Settings: your account, the forges and services Runyard reads, and (for admins) users. */
function Settings() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const admin = session.user?.role === "admin";
  const tabs = [
    {
      to: "/settings/account" as const,
      label: "Account",
      active: pathname === "/settings/account",
    },
    ...(admin
      ? [
          {
            to: "/settings/connections" as const,
            label: "Connections",
            // GitHub and Forgejo's own pages sit under Connections.
            active: /^\/settings\/(connections|github|forgejo)$/.test(pathname),
          },
          {
            to: "/settings/users" as const,
            label: "Users",
            active: pathname === "/settings/users",
          },
        ]
      : []),
  ];
  return (
    <div>
      <PageHeader icon={<Icon name="settings" size={18} />} title="Settings" />
      <nav className="mt-5 flex gap-5 border-b border-line" aria-label="Settings">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            aria-current={t.active ? "page" : undefined}
            className={`${tab} ${t.active ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
