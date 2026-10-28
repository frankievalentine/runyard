import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { Pool, Scope } from "@runyard/core";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Button, TextField } from "../../components/form.tsx";
import { Icon } from "../../components/icons.tsx";
import { PoolForm } from "../../components/PoolForm.tsx";
import { Label } from "../../components/runners.tsx";
import {
  Callout,
  Card,
  EmptyLine,
  ErrorText,
  LinkRow,
  LinkTable,
  PageHeader,
  Pill,
  Section,
  StatusDot,
} from "../../components/ui.tsx";
import { fleetQuery, useFleet } from "../../lib/fleet.ts";
import { runnerFor, scopeLabel } from "../../lib/pools.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { runnerStatus } from "../../lib/status.ts";

export const Route = createFileRoute("/_app/pools/$id")({
  component: PoolPage,
});

function PoolPage() {
  const { id } = Route.useParams();
  const view = useFleet();
  const navigate = useNavigate();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const [editing, setEditing] = useState(false);
  const pool = view.pools.pools.find((p) => p.id === id);
  if (!pool) {
    return (
      <Card>
        <EmptyLine>
          This pool no longer exists.{" "}
          <Link to="/" className="text-accent hover:underline">
            Back to the overview
          </Link>
        </EmptyLine>
      </Card>
    );
  }
  const admin = session.user?.role === "admin";
  const desired = view.pools.desired.filter((d) => d.poolId === pool.id);
  const existing = desired.filter((d) => runnerFor(view, d)).length;
  const repos = pool.scopes.filter((s) => s.kind === "repo");
  const machinesNeedingReview = [
    ...new Set(desired.filter((d) => !runnerFor(view, d)).map((d) => d.machineId)),
  ];

  return (
    <div>
      <PageHeader
        icon={<Icon name="plan" size={18} />}
        title={pool.name}
        status={
          <>
            <Pill
              tone={existing === desired.length && desired.length ? "ok" : "muted"}
              hollow={existing < desired.length}
            >
              {existing} of {desired.length} runners
            </Pill>
            {admin && !editing && (
              <Button small variant="ghost" onClick={() => setEditing(true)}>
                Edit…
              </Button>
            )}
          </>
        }
        subtitle={`${pool.scopes.map(scopeLabel).join(", ")} · ${pool.machines.length} machine${pool.machines.length === 1 ? "" : "s"}`}
        actions={admin && <DeletePool pool={pool} onDeleted={() => void navigate({ to: "/" })} />}
      />
      {editing && (
        <div className="mt-6">
          <PoolForm pool={pool} onDone={() => setEditing(false)} />
        </div>
      )}
      {pool.labels.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {[...pool.labels, "runyard", `runyard-pool-${pool.name}`].map((l) => (
            <Label key={l}>{l}</Label>
          ))}
        </div>
      )}
      {view.pools.collisions.length > 0 && (
        <Callout tone="bad" title="Runner names collide">
          {view.pools.collisions.join(" ")}
        </Callout>
      )}
      {machinesNeedingReview.length > 0 && (
        <Callout tone="warn" title="Runners to install">
          Saving a pool changes nothing on machines. Review each machine's changes:{" "}
          {machinesNeedingReview.map((mid, i) => (
            <span key={mid}>
              {i > 0 && ", "}
              <Link
                to="/machines/$id"
                params={{ id: mid }}
                hash="changes"
                className="font-medium text-accent hover:underline"
              >
                {view.machines.find((m) => m.id === mid)?.name ?? mid}
              </Link>
            </span>
          ))}
          .
        </Callout>
      )}
      <Section title="Runners" count={desired.length}>
        {desired.length === 0 ? (
          <Card>
            <EmptyLine>
              No runners: choose machines whose operating system Runyard has read.
            </EmptyLine>
          </Card>
        ) : (
          <LinkTable
            columns={[
              { label: "Runner" },
              { label: "Machine" },
              { label: "Serves" },
              { label: "Status" },
            ]}
            minWidth="min-w-[560px]"
          >
            {desired.map((d) => {
              const runner = runnerFor(view, d);
              const status = runner
                ? runnerStatus(runner)
                : { tone: "muted" as const, label: "Not installed", hollow: true };
              const open = () =>
                runner
                  ? void navigate({ to: "/runners/$key", params: { key: runner.key } })
                  : void navigate({ to: "/machines/$id", params: { id: d.machineId } });
              return (
                <LinkRow
                  key={d.key}
                  onOpen={open}
                  opener={<span className="font-mono text-[12.5px]">{d.name}</span>}
                >
                  <td className="px-3 py-2.5">
                    {view.machines.find((m) => m.id === d.machineId)?.name}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-ink-2">{d.scope.target}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <StatusDot tone={status.tone} hollow={status.hollow} />
                      {status.label}
                    </span>
                  </td>
                </LinkRow>
              );
            })}
          </LinkTable>
        )}
      </Section>
      {admin && repos.length > 0 && (
        <Section title="Public repositories">
          <p className="mb-3 max-w-2xl text-[12.5px] text-ink-2">
            Runyard won't register runners for a public repository until you allow it. A persistent
            runner runs whatever workflow a pull request brings, so lock the repository down first.
          </p>
          <div className="space-y-3">
            {repos.map((s) => (
              <PublicRepo key={s.target} scope={s} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

type Check = { public: boolean; forkApproval: string | null };

/** The guard for one repository: what GitHub confirms, what it can't, and the typed override. */
function PublicRepo({ scope }: { scope: Scope }) {
  const check = useQuery({
    queryKey: ["public-repo", scope.forgeId, scope.target],
    queryFn: async () =>
      (await call(
        api["public-repos"].check.$get({ query: { forgeId: scope.forgeId, repo: scope.target } }),
      )) as Check,
  });
  const [confirm, setConfirm] = useState("");
  const allow = useMutation({
    mutationFn: () =>
      call(
        api["public-repos"].$post({
          json: { forgeId: scope.forgeId, repo: scope.target, confirm },
        }),
      ),
    onSuccess: () => setConfirm(""),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    allow.mutate();
  };
  if (check.isPending) return null;
  if (check.error) return <ErrorText error={check.error} />;
  if (!check.data?.public) {
    return (
      <Card className="flex items-center gap-2 px-4 py-3 text-[12.5px]">
        <StatusDot tone="ok" />
        <span className="font-mono">{scope.target}</span> is private. No override needed.
      </Card>
    );
  }
  const strict = check.data.forkApproval === "all_external_contributors";
  const items: { ok: boolean | null; text: string }[] = [
    {
      ok: null,
      text: "Pull requests are turned off, or limited to collaborators (Settings ▸ General ▸ Pull requests). GitHub's API doesn't report this.",
    },
    {
      ok: check.data.forkApproval === null ? null : strict,
      text: `Fork pull request workflows need approval for all external contributors (Settings ▸ Actions ▸ General).${check.data.forkApproval && !strict ? ` Currently: ${check.data.forkApproval.replace(/_/g, " ")}.` : ""}`,
    },
    {
      ok: null,
      text: "No workflow that runs on these runners is triggered by issues, comments or pull_request_target.",
    },
  ];
  return (
    <Card className="px-4 py-3 text-[12.5px]">
      <div className="flex items-center gap-2 font-medium">
        <StatusDot tone="warn" />
        <span className="font-mono">{scope.target}</span> is public
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((i) => (
          <li key={i.text} className="flex items-start gap-2">
            <span className="mt-0.5 w-24 shrink-0">
              {i.ok === true ? (
                <Pill tone="ok">Confirmed</Pill>
              ) : i.ok === false ? (
                <Pill tone="bad">Not set</Pill>
              ) : (
                <Pill tone="muted" hollow>
                  Can't verify
                </Pill>
              )}
            </span>
            <span className="text-ink-2">{i.text}</span>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <TextField
            label={`Type ${scope.target} to allow runners for it`}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="danger"
          disabled={allow.isPending || confirm !== scope.target}
        >
          Allow runners
        </Button>
      </form>
      {allow.error && <ErrorText className="mt-2" error={allow.error} />}
      {allow.isSuccess && (
        <p className="mt-2 text-ink-2">
          Allowed. Review the machines' changes to install its runners.
        </p>
      )}
    </Card>
  );
}

function DeletePool({ pool, onDeleted }: { pool: Pool; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => call(api.pools[":id"].$delete({ param: { id: pool.id } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: fleetQuery.queryKey });
      onDeleted();
    },
  });
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={<Button small variant="danger" />}>Delete</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/30" />
        <AlertDialog.Popup className="panel fixed top-1/2 left-1/2 w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 p-5">
          <AlertDialog.Title className="text-[15px] font-semibold">
            Delete {pool.name}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-[13px] text-ink-2">
            Its runners keep running until you review each machine's changes, which then remove
            them. Directories are kept.
          </AlertDialog.Description>
          {remove.error && <ErrorText className="mt-2" error={remove.error} />}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button />}>Cancel</AlertDialog.Close>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Delete pool
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
