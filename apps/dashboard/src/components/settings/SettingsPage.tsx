import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { EXTRA_WIDE, useMediaQuery } from "../../lib/media.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { AccessTokens } from "../AccessTokens.tsx";
import { SetupSummary } from "../SetupChecklist.tsx";
import { PageHead } from "../tt.tsx";
import { AccountPanel } from "./AccountPanel.tsx";
import { BoatPanel, ConnectionsPanel, HostPanel } from "./ConnectionsPanels.tsx";
import { InstallPanel } from "./InstallPanel.tsx";
import { UsersPanel } from "./UsersPanel.tsx";

/**
 * Settings on one page, as in the Timetable design: the forges, this host, boat.dev, access tokens
 * and installing the app on the left; your account, users and Getting started on the right. On a
 * phone the two columns stack. From 1800px an admin's page has three: the forges and this host;
 * boat.dev, tokens, installing the app and users; then your account and Getting started.
 * Only admins see connections, the host, users and Getting started.
 * `focus` scrolls to a panel, for the older /settings/connections and /settings/users links; a
 * link's #panel does the same, as the Board's host notices do with #host.
 */
export function SettingsPage({ focus }: { focus?: "connections" | "users" }) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const wide = useMediaQuery(EXTRA_WIDE);
  useEffect(() => {
    const target = focus ?? window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [focus]);
  // Columns of panels, left to right. Three only for admins on extra wide screens, balanced so
  // that none ends far short of the others: users join the tokens in the middle.
  const columns: ReactNode[][] = !admin
    ? [
        [<AccessTokens key="tokens" admin={false} />, <InstallPanel key="install" />],
        [<AccountPanel key="account" />],
      ]
    : wide
      ? [
          [<ConnectionsPanel key="forges" />, <HostPanel key="host" />],
          [
            <BoatPanel key="boat" />,
            <AccessTokens key="tokens" admin />,
            <InstallPanel key="install" />,
            <UsersPanel key="users" />,
          ],
          [<AccountPanel key="account" />, <SetupSummary key="setup" />],
        ]
      : [
          [
            <ConnectionsPanel key="forges" />,
            <HostPanel key="host" />,
            <BoatPanel key="boat" />,
            <AccessTokens key="tokens" admin />,
            <InstallPanel key="install" />,
          ],
          [
            <AccountPanel key="account" />,
            <UsersPanel key="users" />,
            <SetupSummary key="setup" />,
          ],
        ];
  return (
    <div>
      <PageHead title="Settings" />
      <div
        className={`grid grid-cols-1 items-start gap-3 lg:gap-[18px] ${columns.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}
      >
        {columns.map((panels, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-3 lg:gap-[18px]">
            {panels}
          </div>
        ))}
      </div>
    </div>
  );
}
