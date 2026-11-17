import { ConfirmDialog } from "../ConfirmDialog.tsx";
import type { Pool, Scope } from "@runyard/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, call } from "../../api.ts";
import { yardQuery } from "../../lib/yard.ts";
import { Chip, TtButton, ttButton } from "../tt.tsx";
import { ErrorText } from "../ui.tsx";

/** Stops one-job runners starting for the pool, or lets them start again. Running ones finish. */
export function PauseButton({ pool }: { pool: Pool }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      call(
        api.pools[":id"].paused.$put({ param: { id: pool.id }, json: { paused: !pool.paused } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  return (
    <TtButton
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      title={
        toggle.error?.message ??
        (pool.paused
          ? "Start one-job runners again for queued jobs"
          : "Start no new runners; running jobs finish")
      }
    >
      {pool.paused ? "Resume" : "Pause"}
    </TtButton>
  );
}

/** Delete, after asking: the pool goes; each machine's review then removes its runners. */
export function DeletePool({ pool, onDeleted }: { pool: Pool; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => call(api.pools[":id"].$delete({ param: { id: pool.id } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: yardQuery.queryKey });
      onDeleted();
    },
  });
  return (
    <ConfirmDialog
      trigger="Delete"
      triggerClassName={ttButton.danger}
      title={`Delete ${pool.name}?`}
      description="Its runners keep running until you review each machine's changes, which then remove them. Directories are kept."
      confirm={remove.isPending ? "Deleting…" : "Delete pool"}
      onConfirm={() => remove.mutate()}
      pending={remove.isPending}
      error={remove.error}
    />
  );
}

type Check = { public: boolean; forkApproval: string | null };

/** The typed override: type the name to allow runners for it. */
function Allow({ scope }: { scope: Scope }) {
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
  const id = `pub-${scope.forgeId}-${scope.target}`;
  return (
    <>
      <form
        onSubmit={submit}
        className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 max-sm:grid-cols-1"
      >
        <div className="grid gap-1.5">
          <label htmlFor={id} className="text-[12px] font-bold text-tt-ink-2">
            Type {scope.target} to allow runners for it
          </label>
          <input
            id={id}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border-[1.5px] border-tt-rule-2 bg-tt-card px-3 py-2 font-board text-[13.5px] text-tt-ink outline-none focus:border-tt-ink"
          />
        </div>
        <button
          type="submit"
          className={ttButton.danger}
          disabled={allow.isPending || confirm !== scope.target}
        >
          Allow runners
        </button>
      </form>
      {allow.error && <ErrorText className="mt-2" error={allow.error} />}
      {allow.isSuccess && (
        <p className="mt-2 text-[12.5px] text-tt-ink-2">
          Allowed. Review the machines' changes to install its runners.
        </p>
      )}
    </>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13.5px] text-tt-ink-2">
      <i className="size-2 flex-none rounded-full bg-[#e3a800]" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/** The guard for one GitHub repository: what GitHub confirms, what it can't, and the typed override. */
export function PublicRepo({ scope }: { scope: Scope }) {
  const check = useQuery({
    queryKey: ["public-repo", scope.forgeId, scope.target],
    queryFn: async () =>
      (await call(
        api["public-repos"].check.$get({ query: { forgeId: scope.forgeId, repo: scope.target } }),
      )) as Check,
  });
  if (check.isPending) return null;
  if (check.error)
    return <ErrorText className="border-t border-tt-rule px-4 py-3" error={check.error} />;
  if (!check.data?.public) {
    return (
      <div className="flex items-center gap-2 border-t border-tt-rule px-4 py-3 text-[13px] text-tt-ink-2">
        <i className="size-2 flex-none rounded-full bg-tt-ok" aria-hidden />
        <span>
          <b className="font-board font-semibold text-tt-ink">{scope.target}</b> is private. No
          override needed.
        </span>
      </div>
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
    <div className="border-t border-tt-rule px-4 pt-3 pb-3.5">
      <Heading>
        <b className="font-board font-semibold text-tt-ink">{scope.target}</b> is public
      </Heading>
      <ul className="mt-1">
        {items.map((i) => (
          <li key={i.text} className="flex items-start gap-3 py-2 text-[12.5px] text-tt-ink-2">
            <span className="w-[100px] flex-none">
              {i.ok === true ? (
                <Chip tone="ok">Confirmed</Chip>
              ) : i.ok === false ? (
                <Chip tone="error">Not set</Chip>
              ) : (
                <Chip tone="plain">Can't verify</Chip>
              )}
            </span>
            <span>{i.text}</span>
          </li>
        ))}
      </ul>
      <Allow scope={scope} />
    </div>
  );
}

/** The typed override for a Forgejo account or repository whose runners would serve public repositories. */
export function PublicAccount({ scope, publicRepos }: { scope: Scope; publicRepos: string[] }) {
  return (
    <div className="border-t border-tt-rule px-4 pt-3 pb-3.5">
      <Heading>
        <b className="font-board font-semibold text-tt-ink">{scope.target}</b>
        {scope.kind === "repo"
          ? " is public"
          : publicRepos.length === 1
            ? " owns a public repository"
            : ` owns ${publicRepos.length} public repositories`}
      </Heading>
      {scope.kind !== "repo" && (
        <p className="mt-1.5 font-board text-[12.5px] break-words text-tt-ink-2">
          {publicRepos.slice(0, 8).join(", ")}
          {publicRepos.length > 8 && ", …"}
        </p>
      )}
      <p className="mt-2 text-[12.5px] text-tt-ink-2">
        Before allowing it, turn off pull requests on these repositories or make them private, and
        make sure no workflow on these runners is triggered by issues, comments or
        pull_request_target. Runyard can't check these settings on Forgejo.
      </p>
      <Allow scope={scope} />
    </div>
  );
}
