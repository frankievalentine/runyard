import { Menu } from "@base-ui/react/menu";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api, call } from "../api.ts";
import { sessionQuery } from "../lib/queries.ts";
import { setTheme, useTheme, type Theme } from "../lib/theme.ts";
import { Icon } from "./icons.tsx";

const item =
  "flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left outline-none data-[highlighted]:bg-selected";

/** Takes the place of fleet's Settings gear: account, users, theme and sign-out. */
export function AccountMenu() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const theme = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => call(api.logout.$post()),
    onSuccess: () => {
      queryClient.clear();
      void navigate({ to: "/login" });
    },
  });
  const user = session.user;
  if (!user) return null;
  const name = user.username ?? user.tailscaleLogin ?? "";
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Account and settings"
        className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-hover data-[popup-open]:bg-selected"
      >
        <Icon name="settings" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="end" sideOffset={6}>
          <Menu.Popup className="panel min-w-52 p-1 text-[13px] outline-none">
            <div className="px-2 pt-1 pb-1.5">
              <div className="truncate font-medium">{name}</div>
              <div className="text-[11.5px] text-ink-2">
                {user.role === "admin" ? "Admin" : "Viewer"}
                {session.via === "tailscale" ? " · via Tailscale" : ""}
              </div>
            </div>
            <Menu.Separator className="my-1 h-px bg-line" />
            <Menu.Item className={item} onClick={() => void navigate({ to: "/account" })}>
              Account
            </Menu.Item>
            {user.role === "admin" && (
              <>
                <Menu.Item
                  className={item}
                  onClick={() => void navigate({ to: "/getting-started" })}
                >
                  Getting started
                </Menu.Item>
                <Menu.Item
                  className={item}
                  onClick={() => void navigate({ to: "/settings/github" })}
                >
                  GitHub
                </Menu.Item>
                <Menu.Item
                  className={item}
                  onClick={() => void navigate({ to: "/settings/forgejo" })}
                >
                  Forgejo
                </Menu.Item>
                <Menu.Item className={item} onClick={() => void navigate({ to: "/settings/boat" })}>
                  boat
                </Menu.Item>
                <Menu.Item className={item} onClick={() => void navigate({ to: "/users" })}>
                  Users
                </Menu.Item>
              </>
            )}
            <Menu.Separator className="my-1 h-px bg-line" />
            <Menu.Group>
              <Menu.GroupLabel className="px-2 py-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
                Theme
              </Menu.GroupLabel>
              <Menu.RadioGroup value={theme} onValueChange={(value: Theme) => setTheme(value)}>
                {(["system", "light", "dark"] as const).map((t) => (
                  <Menu.RadioItem key={t} value={t} className={item} closeOnClick={false}>
                    <span className="w-3 text-accent">
                      <Menu.RadioItemIndicator>
                        <Icon name="check" size={12} />
                      </Menu.RadioItemIndicator>
                    </span>
                    {t[0]!.toUpperCase() + t.slice(1)}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            {session.via === "session" && (
              <>
                <Menu.Separator className="my-1 h-px bg-line" />
                <Menu.Item className={item} onClick={() => logout.mutate()}>
                  Sign out
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
