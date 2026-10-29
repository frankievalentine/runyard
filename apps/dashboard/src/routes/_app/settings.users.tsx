import { Dialog } from "@base-ui/react/dialog";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Button, TextField } from "../../components/form.tsx";
import { Card, ErrorText, Section, SubHeader } from "../../components/ui.tsx";
import { sessionQuery, usersQuery, type UserView } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/settings/users")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/" });
  },
  component: Users,
});

type Role = UserView["role"];

function Users() {
  const users = useQuery(usersQuery);
  return (
    <div className="max-w-2xl">
      <SubHeader
        title="Users"
        subtitle="Viewers can see everything. Admins can also manage machines and users."
      />
      <Section title="People" count={users.data?.length}>
        {users.error && <ErrorText error={users.error} />}
        <Card className="overflow-hidden">
          {users.data?.map((user) => (
            <UserRow key={user.id} user={user} />
          ))}
        </Card>
      </Section>
      <AddUser />
    </div>
  );
}

function UserRow({ user }: { user: UserView }) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const queryClient = useQueryClient();
  const isYou = session.user?.id === user.id;
  const refresh = () => queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });

  const setRole = useMutation({
    mutationFn: (role: Role) =>
      call(api.users[":id"].$patch({ param: { id: user.id }, json: { role } })),
    onSuccess: async () => {
      await refresh();
      if (isYou) await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
    },
  });
  const remove = useMutation({
    mutationFn: () => call(api.users[":id"].$delete({ param: { id: user.id } })),
    onSuccess: refresh,
  });

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {user.username ?? user.tailscaleLogin}
          {isYou && <span className="ml-1.5 text-[12px] font-normal text-ink-3">(you)</span>}
        </div>
        <div className="truncate text-[12px] text-ink-2">
          {[user.username && "Password", user.tailscaleLogin && `Tailscale ${user.tailscaleLogin}`]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <select
        aria-label={`Role for ${user.username ?? user.tailscaleLogin}`}
        className="input !w-28"
        value={user.role}
        disabled={setRole.isPending}
        onChange={(e) => setRole.mutate(e.target.value as Role)}
      >
        <option value="admin">Admin</option>
        <option value="viewer">Viewer</option>
      </select>
      {user.username && <ResetPassword user={user} />}
      {!isYou && (
        <ConfirmDialog
          trigger="Remove"
          title={`Remove ${user.username ?? user.tailscaleLogin}?`}
          description="They're signed out everywhere and can't sign in again."
          confirm="Remove"
          onConfirm={() => remove.mutate()}
          pending={remove.isPending}
          error={remove.error}
        />
      )}
      {setRole.error && <ErrorText className="w-full" error={setRole.error} />}
    </div>
  );
}

function ResetPassword({ user }: { user: UserView }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const reset = useMutation({
    mutationFn: () => call(api.users[":id"].$patch({ param: { id: user.id }, json: { password } })),
    onSuccess: () => {
      setOpen(false);
      setPassword("");
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    reset.mutate();
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button small />}>Reset password</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/30" />
        <Dialog.Popup className="panel fixed top-1/2 left-1/2 w-[min(92vw,380px)] -translate-x-1/2 -translate-y-1/2 p-5">
          <Dialog.Title className="text-[15px] font-semibold">
            Reset {user.username}'s password
          </Dialog.Title>
          <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
            <TextField
              label="New password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              description="At least 12 characters. They're signed out everywhere."
              required
              autoFocus
            />
            {reset.error && <ErrorText error={reset.error} />}
            <div className="flex justify-end gap-2">
              <Dialog.Close render={<Button />}>Cancel</Dialog.Close>
              <Button type="submit" variant="primary" disabled={reset.isPending}>
                Reset password
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AddUser() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tailscaleLogin, setTailscaleLogin] = useState("");
  const [role, setRole] = useState<Role>("viewer");

  const add = useMutation({
    mutationFn: () =>
      call(
        api.users.$post({
          json: {
            role,
            ...(username ? { username, password } : {}),
            ...(tailscaleLogin ? { tailscaleLogin } : {}),
          },
        }),
      ),
    onSuccess: async () => {
      setUsername("");
      setPassword("");
      setTailscaleLogin("");
      await queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <Section title="Add a user">
      <Card className="px-4 py-4">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TextField
            label="Tailscale login"
            value={tailscaleLogin}
            onChange={(e) => setTailscaleLogin(e.target.value)}
            placeholder="name@example.com"
            description="Signs them in automatically on the tailnet address."
          />
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            description="For signing in with a password, with or without Tailscale."
          />
          {username && (
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              description="At least 12 characters."
              required
            />
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-2">Role</span>
            <select
              className="input !w-40"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {add.error && <ErrorText error={add.error} />}
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={add.isPending || (!username && !tailscaleLogin)}
            >
              Add user
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}
