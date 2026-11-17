import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { sessionQuery, usersQuery, type UserView } from "../../lib/queries.ts";
import { ErrorText } from "../ui.tsx";
import { Chip, Panel, Row, ttButton } from "../tt.tsx";
import {
  DialogButtons,
  Note,
  RowText,
  SIcon,
  TtConfirm,
  TtDialog,
  TtField,
  rowButton,
  ttSelect,
} from "./parts.tsx";

type Role = UserView["role"];

const label = (u: UserView) => u.username ?? u.tailscaleLogin ?? "User";
const roleName = (r: Role) => (r === "admin" ? "Admin" : "Viewer");

/** Everyone who can sign in, their roles and how they sign in. Admins only. */
export function UsersPanel() {
  const users = useQuery(usersQuery);
  const { data: session } = useSuspenseQuery(sessionQuery);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState<string | null>(null);
  const managed = users.data?.find((u) => u.id === managing);
  return (
    <Panel
      id="users"
      title="Users"
      action={
        <button type="button" className={rowButton.secondary} onClick={() => setAdding(true)}>
          <SIcon name="plus" size={15} />
          <span className="mt-[2px]">Add a user</span>
        </button>
      }
    >
      <Note className="!pb-1.5">
        Viewers can see everything. Admins can also manage machines and users.
      </Note>
      {users.error && <ErrorText className="px-4 pb-3" error={users.error} />}
      {users.data?.map((u) => (
        <Row key={u.id}>
          <SIcon name="user" />
          <RowText
            title={label(u)}
            detail={[
              roleName(u.role),
              u.tailscaleLogin && `Tailscale ${u.tailscaleLogin}`,
              u.username && "password",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          {session.user?.id === u.id && <Chip tone="plain">You</Chip>}
          <button type="button" className={rowButton.secondary} onClick={() => setManaging(u.id)}>
            Manage
          </button>
        </Row>
      ))}
      <AddUser open={adding} onOpenChange={setAdding} />
      {managed && (
        <ManageUser
          key={managed.id}
          user={managed}
          isYou={session.user?.id === managed.id}
          onClose={() => setManaging(null)}
        />
      )}
    </Panel>
  );
}

/** One user's role, password and removal, in a dialog. */
function ManageUser({
  user,
  isYou,
  onClose,
}: {
  user: UserView;
  isYou: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });
  const [password, setPassword] = useState("");
  const setRole = useMutation({
    mutationFn: (role: Role) =>
      call(api.users[":id"].$patch({ param: { id: user.id }, json: { role } })),
    onSuccess: async () => {
      await refresh();
      if (isYou) await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
    },
  });
  const reset = useMutation({
    mutationFn: () => call(api.users[":id"].$patch({ param: { id: user.id }, json: { password } })),
    onSuccess: () => setPassword(""),
  });
  const remove = useMutation({
    mutationFn: () => call(api.users[":id"].$delete({ param: { id: user.id } })),
    onSuccess: async () => {
      onClose();
      await refresh();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    reset.mutate();
  };
  return (
    <TtDialog open onOpenChange={(open) => !open && onClose()} title={label(user)}>
      <p className="text-[13.5px] text-tt-ink-2">
        {[
          user.tailscaleLogin && `Signs in through Tailscale as ${user.tailscaleLogin}`,
          user.username && `Signs in with a password as ${user.username}`,
        ]
          .filter(Boolean)
          .join(". ")}
        .
      </p>
      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-tt-ink-2">Role</span>
        <select
          className={ttSelect}
          value={user.role}
          disabled={setRole.isPending}
          onChange={(e) => setRole.mutate(e.target.value as Role)}
        >
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </select>
      </label>
      {setRole.error && <ErrorText className="mt-1.5" error={setRole.error} />}
      {user.username && (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
          <TtField
            label="Reset password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={12}
            hint={
              reset.isSuccess
                ? "Password reset. They're signed out everywhere."
                : "At least 12 characters. They're signed out everywhere."
            }
            required
          />
          {reset.error && <ErrorText error={reset.error} />}
          <div>
            <button
              type="submit"
              className={rowButton.secondary}
              disabled={reset.isPending || !password}
            >
              Reset password
            </button>
          </div>
        </form>
      )}
      <DialogButtons>
        {!isYou && (
          <span className="mr-auto">
            <TtConfirm
              trigger="Remove"
              title={`Remove ${label(user)}?`}
              description="They're signed out everywhere and can't sign in again."
              confirm="Remove"
              onConfirm={() => remove.mutate()}
              pending={remove.isPending}
              error={remove.error}
            />
          </span>
        )}
        <button type="button" className={ttButton.secondary} onClick={onClose}>
          Done
        </button>
      </DialogButtons>
    </TtDialog>
  );
}

function AddUser({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <TtDialog open={open} onOpenChange={onOpenChange} title="Add a user">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TtField
          label="Tailscale login"
          value={tailscaleLogin}
          onChange={(e) => setTailscaleLogin(e.target.value)}
          placeholder="name@example.com"
          autoComplete="off"
          hint="Signs them in automatically on the tailnet address."
        />
        <TtField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          hint="For signing in with a password, with or without Tailscale."
        />
        {username && (
          <TtField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={12}
            hint="At least 12 characters."
            required
          />
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-tt-ink-2">Role</span>
          <select
            className={ttSelect}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <p className="text-[12.5px] text-tt-ink-3">
          A Tailscale login, a username and password, or both. Viewers can see everything. Admins
          can also manage machines and users.
        </p>
        {add.error && <ErrorText error={add.error} />}
        <DialogButtons>
          <button type="button" className={ttButton.secondary} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="submit"
            className={ttButton.primary}
            disabled={add.isPending || (!username && !tailscaleLogin)}
          >
            Add user
          </button>
        </DialogButtons>
      </form>
    </TtDialog>
  );
}
