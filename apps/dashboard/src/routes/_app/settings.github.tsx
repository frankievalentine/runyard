import type { GithubAppView } from "@runyard/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Webhooks } from "../../components/Webhooks.tsx";
import { Icon } from "../../components/icons.tsx";
import { ErrorText } from "../../components/ui.tsx";
import { Chip, PageHead, Panel, ttButton } from "../../components/tt.tsx";
import {
  Note,
  Notice,
  RowText,
  SIcon,
  TtConfirm,
  TtField,
  rowButton,
} from "../../components/settings/parts.tsx";
import { yardQuery, useYard } from "../../lib/yard.ts";
import { plural, timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { healthQuery, sessionQuery } from "../../lib/queries.ts";
import { InfoTip, RowTip, TipText } from "../../components/InfoTip.tsx";

type Search = { created?: string; error?: string };

export const Route = createFileRoute("/_app/settings/github")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    created: typeof search.created === "string" ? search.created : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/" });
  },
  component: GithubSettings,
});

const DOT = (problem: unknown, read: unknown) =>
  `mt-[7px] size-2 flex-none rounded-full ${problem ? "bg-tt-bad" : read ? "bg-tt-ok" : "border-[1.5px] border-tt-off"}`;

function GithubSettings() {
  const { github } = useYard();
  const { created, error } = Route.useSearch();
  const justCreated = github.apps.find((a) => a.forgeId === created);
  return (
    <div>
      <PageHead
        back={{ to: "/settings/connections", label: "Settings" }}
        sign={<SIcon name="link" size={26} />}
        title="GitHub"
        lede="Runyard reads runners and jobs through its own GitHub App, installed on the accounts whose repositories your runners serve."
      />
      {error && (
        <Notice tone="bad" title="The GitHub App wasn't set up">
          {error === "expired"
            ? "The setup link expired or was already used. Start again below."
            : "GitHub didn't accept the setup code. Start again below."}
        </Notice>
      )}
      {justCreated && justCreated.installations.length === 0 && (
        <Notice tone="warn" title={`${justCreated.name} is ready to install`}>
          Install it on {justCreated.owner} and choose which repositories its runners serve.{" "}
          <a href={justCreated.installUrl} className="font-semibold underline">
            Install on GitHub
          </a>
        </Notice>
      )}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 lg:gap-[18px] 3xl:grid-cols-[minmax(0,1fr)_480px]">
        <div className="flex min-w-0 flex-col gap-3 lg:gap-[18px]">
          <Panel
            title="Apps"
            meta={github.apps.length ? plural(github.apps.length, "app") : "None yet"}
          >
            {github.apps.length === 0 ? (
              <Note>No GitHub App yet. Create one below; GitHub asks you to confirm it.</Note>
            ) : (
              github.apps.map((app) => <AppRows key={app.forgeId} app={app} />)
            )}
          </Panel>
          <CreateApp />
        </div>
        {/* Optional, and only useful once an app exists. */}
        <Webhooks />
      </div>
    </div>
  );
}

function AppRows({ app }: { app: GithubAppView }) {
  const now = useNow();
  return (
    <div className="border-t border-tt-rule">
      <div className="flex flex-wrap items-center gap-3 px-4 py-[11px]">
        <SIcon name="link" />
        <RowText
          className="basis-60"
          title={
            <a href={app.htmlUrl} target="_blank" rel="noreferrer" className="hover:underline">
              {app.name}
            </a>
          }
          detail={
            <>
              Owned by {app.owner} ·{" "}
              <RowTip
                content={
                  <TipText what="A private GitHub App can only be installed on the account that owns it." />
                }
              >
                <span tabIndex={0}>installable only there</span>
              </RowTip>
              {app.rateLimit && (
                <>
                  {" · "}
                  <RowTip
                    content={
                      <TipText what="GitHub's hourly allowance of API requests for this app." />
                    }
                  >
                    <span tabIndex={0}>
                      {app.rateLimit.remaining.toLocaleString()} of{" "}
                      {app.rateLimit.limit.toLocaleString()} API requests left
                    </span>
                  </RowTip>
                </>
              )}
            </>
          }
        />
        <Chip tone={app.error ? "error" : app.installations.length ? "ok" : "warn"}>
          {app.error ? "Error" : app.installations.length ? "Connected" : "Not installed"}
        </Chip>
        <span className="flex gap-2">
          <a href={app.installUrl} className={rowButton.secondary}>
            {app.installations.length ? "Change repositories" : "Install"}
            <Icon name="external" size={12} />
          </a>
          <RemoveApp app={app} />
        </span>
      </div>
      {app.error && <ErrorText className="px-4 pb-2" error={app.error} />}
      {app.installations.length === 0 ? (
        <Note>Not installed yet. Install it on {app.owner} to read its runners.</Note>
      ) : (
        <ul className="pb-1.5">
          {app.installations.map((i) => {
            const problem = i.runnersError ?? i.jobsError;
            return (
              <li key={i.id} className="flex items-start gap-3 py-2 pr-4 pl-[46px] text-[12.5px]">
                <span
                  role="img"
                  aria-label={problem ? "Error" : i.runnersAt ? "Read" : "Not read yet"}
                  className={DOT(problem, i.runnersAt)}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {i.account}{" "}
                    <span className="font-normal text-tt-ink-3">
                      ·{" "}
                      {i.accountType === "Organization"
                        ? "organization runners"
                        : "repository runners"}{" "}
                      ·{" "}
                      {i.repositorySelection === "all"
                        ? `all ${plural(i.repoCount, "repository", "repositories")}`
                        : plural(i.repoCount, "selected repository", "selected repositories")}
                    </span>
                  </div>
                  <div className="text-tt-ink-2">
                    Runners {i.runnersAt ? `read ${timeAgo(i.runnersAt, now)}` : "not read yet"} ·
                    jobs {i.jobsAt ? `scanned ${timeAgo(i.jobsAt, now)}` : "not scanned yet"}
                    {i.jobsTruncated && (
                      <>
                        {" "}
                        <RowTip
                          content={
                            <TipText what="The job scan stopped at its limit, the 30 most recently pushed repositories, so some queued jobs may be missing." />
                          }
                        >
                          <span
                            tabIndex={0}
                            className="underline decoration-dotted underline-offset-2"
                          >
                            (partial)
                          </span>
                        </RowTip>
                      </>
                    )}
                  </div>
                  {i.ciRepoCount !== null && (
                    <div className="text-tt-ink-2">
                      {i.ciRepoCount === 0
                        ? "None has Actions workflows yet, so none is polled; one that gets a workflow is picked up within 5 minutes."
                        : `Watching the ${plural(i.ciRepoCount, "repository", "repositories")} with Actions workflows${i.ciRepoCount < i.repoCount ? ` · ${i.repoCount - i.ciRepoCount} skipped` : ""}.`}
                    </div>
                  )}
                  {problem && <ErrorText className="mt-1" error={problem} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Posts Runyard's manifest to GitHub, which creates the app after the admin confirms. */
function CreateApp() {
  const demo = useQuery(healthQuery).data?.demo === true;
  const [owner, setOwner] = useState<"personal" | "org">("personal");
  const [org, setOrg] = useState("");
  const start = useMutation({
    mutationFn: () =>
      call(api.github.manifest.$post({ json: { org: owner === "org" ? org : null } })),
    onSuccess: ({ action, manifest }) => {
      // GitHub takes the manifest as a form POST, so leave the page with a real form.
      const form = document.createElement("form");
      form.method = "post";
      form.action = action;
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = "manifest";
      field.value = manifest;
      form.append(field);
      document.body.append(form);
      form.submit();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    start.mutate();
  };
  const option = (value: "personal" | "org", title: string, detail: string) => (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border-[1.5px] bg-tt-card px-3 py-2.5 ${
        owner === value
          ? "border-tt-ink shadow-[inset_0_0_0_1px_var(--tt-ink)]"
          : "border-tt-rule-2"
      }`}
    >
      <input
        type="radio"
        name="owner"
        className="mt-[3px] shrink-0 accent-[var(--tt-ink)]"
        checked={owner === value}
        onChange={() => setOwner(value)}
      />
      <span>
        <b className="block text-[13.5px]">{title}</b>
        <small className="block text-[12px] text-tt-ink-2">{detail}</small>
      </span>
    </label>
  );
  return (
    <Panel title="Create a GitHub App">
      <form onSubmit={submit} className="flex flex-col gap-4 px-4 pb-4 text-[13px]">
        <p className="flex items-center gap-1.5 text-tt-ink-2">
          Create one for each account whose runners Runyard should see.
          <InfoTip label="the GitHub App">
            <TipText
              what="A private GitHub App can only be installed on the account that owns it."
              details="It asks for Actions: read, Administration, Self-hosted runners: read and write (registering runners needs write), and Metadata: read. GitHub shows these again before you confirm."
            />
          </InfoTip>
        </p>
        <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <legend className="mb-1.5 text-[12.5px] font-semibold text-tt-ink-2">Owner</legend>
          {option("personal", "My personal account", "Runners for my repositories")}
          {option("org", "An organization I own", "Organization runners")}
        </fieldset>
        {owner === "org" && (
          <TtField
            label="Organization"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="acme"
            required
          />
        )}
        {start.error && <ErrorText error={start.error} />}
        <div>
          <button type="submit" className={ttButton.primary} disabled={start.isPending || demo}>
            Create GitHub App
          </button>
        </div>
        <p className="text-[12px] text-tt-ink-3">
          {demo
            ? "Not available with demo data: this would create a real app on GitHub."
            : "You'll confirm on GitHub, then come back here to install it and pick repositories."}
        </p>
      </form>
    </Panel>
  );
}

function RemoveApp({ app }: { app: GithubAppView }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => call(api.github.apps[":id"].$delete({ param: { id: app.forgeId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  return (
    <TtConfirm
      trigger="Remove"
      title={`Remove ${app.name} from Runyard?`}
      description={
        <>
          Runyard forgets the app and its key. The app stays on GitHub until you delete it in its{" "}
          <a
            href={app.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline"
          >
            settings
          </a>
          .
        </>
      }
      confirm="Remove"
      onConfirm={() => remove.mutate()}
      pending={remove.isPending}
      error={remove.error}
    />
  );
}
