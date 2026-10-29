import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { GithubAppView } from "@runyard/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, call } from "../../api.ts";
import { Button, TextField } from "../../components/form.tsx";
import { Webhooks } from "../../components/Webhooks.tsx";
import { Icon } from "../../components/icons.tsx";
import {
  Callout,
  Card,
  EmptyLine,
  ErrorText,
  Pill,
  Section,
  StatusDot,
  SubHeader,
} from "../../components/ui.tsx";
import { yardQuery, useYard } from "../../lib/yard.ts";
import { plural, timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { healthQuery, sessionQuery } from "../../lib/queries.ts";

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

function GithubSettings() {
  const { github } = useYard();
  const { created, error } = Route.useSearch();
  const justCreated = github.apps.find((a) => a.forgeId === created);
  return (
    <div>
      <SubHeader
        back={
          <Link to="/settings/connections" className="text-accent hover:underline">
            ← Connections
          </Link>
        }
        title="GitHub"
        subtitle="Runyard reads runners and jobs through its own GitHub App, installed on the accounts whose repositories your runners serve."
      />
      {error && (
        <Callout tone="bad" title="The GitHub App wasn't set up">
          {error === "expired"
            ? "The setup link expired or was already used. Start again below."
            : "GitHub didn't accept the setup code. Start again below."}
        </Callout>
      )}
      {justCreated && justCreated.installations.length === 0 && (
        <Callout tone="warn" title={`${justCreated.name} is ready to install`}>
          Install it on {justCreated.owner} and choose which repositories its runners serve.{" "}
          <a href={justCreated.installUrl} className="font-medium text-accent hover:underline">
            Install on GitHub
          </a>
        </Callout>
      )}
      <Section title="Apps" count={github.apps.length}>
        {github.apps.length === 0 ? (
          <Card>
            <EmptyLine>
              No GitHub App yet. Create one below; GitHub asks you to confirm it.
            </EmptyLine>
          </Card>
        ) : (
          <div className="space-y-3">
            {github.apps.map((app) => (
              <AppCard key={app.forgeId} app={app} />
            ))}
          </div>
        )}
      </Section>
      <Section title="Create a GitHub App">
        <CreateApp />
      </Section>
      {/* Optional, and only useful once an app exists. */}
      <Section title="Webhooks">
        <Webhooks />
      </Section>
    </div>
  );
}

function AppCard({ app }: { app: GithubAppView }) {
  const now = useNow();
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={app.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline"
            >
              {app.name}
            </a>
            <Pill tone={app.error ? "bad" : "ok"}>{app.error ? "Error" : "Connected"}</Pill>
          </div>
          <div className="text-[12px] text-ink-2">
            Owned by {app.owner} · installable only there
            {app.rateLimit &&
              ` · ${app.rateLimit.remaining.toLocaleString()} of ${app.rateLimit.limit.toLocaleString()} API requests left`}
          </div>
        </div>
        <a
          href={app.installUrl}
          className="inline-flex h-[28px] items-center gap-1.5 rounded-[6px] border border-line bg-card px-2.5 text-[12.5px] font-medium hover:bg-hover"
        >
          {app.installations.length ? "Change repositories" : "Install"}
          <Icon name="external" size={12} />
        </a>
        <RemoveApp app={app} />
      </div>
      {app.error && <ErrorText className="px-4 py-2" error={app.error} />}
      {app.installations.length === 0 ? (
        <EmptyLine>Not installed yet. Install it on {app.owner} to read its runners.</EmptyLine>
      ) : (
        <ul className="divide-y divide-line">
          {app.installations.map((i) => {
            const problem = i.runnersError ?? i.jobsError;
            return (
              <li key={i.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-[12.5px]">
                <span className="mt-1.5">
                  <StatusDot
                    tone={problem ? "bad" : i.runnersAt ? "ok" : "muted"}
                    hollow={!i.runnersAt && !problem}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {i.account}{" "}
                    <span className="font-normal text-ink-2">
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
                  <div className="text-ink-2">
                    Runners {i.runnersAt ? `read ${timeAgo(i.runnersAt, now)}` : "not read yet"} ·
                    jobs {i.jobsAt ? `scanned ${timeAgo(i.jobsAt, now)}` : "not scanned yet"}
                    {i.jobsTruncated && " (partial)"}
                  </div>
                  {problem && <ErrorText className="mt-1" error={problem} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
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
  return (
    <Card className="max-w-xl px-4 py-4">
      <form onSubmit={submit} className="flex flex-col gap-4 text-[13px]">
        <p className="text-ink-2">
          A private app can only be installed on the account that owns it, so create one for each
          account whose runners Runyard should see. It asks for{" "}
          <b className="font-medium text-ink">Actions: read</b>,{" "}
          <b className="font-medium text-ink">Administration</b> and{" "}
          <b className="font-medium text-ink">Self-hosted runners: read and write</b> (runner
          registration needs write), and <b className="font-medium text-ink">Metadata: read</b>.
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[12px] font-medium text-ink-2">Owner</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="owner"
              checked={owner === "personal"}
              onChange={() => setOwner("personal")}
            />
            My personal account (runners for my repositories)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="owner"
              checked={owner === "org"}
              onChange={() => setOwner("org")}
            />
            An organization I own (organization runners)
          </label>
        </fieldset>
        {owner === "org" && (
          <TextField
            label="Organization"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="acme"
            required
          />
        )}
        {start.error && <ErrorText error={start.error} />}
        <div>
          <Button type="submit" variant="primary" disabled={start.isPending || demo}>
            Create GitHub App
          </Button>
        </div>
        <p className="text-[12px] text-ink-3">
          {demo
            ? "Not available with demo data: this would create a real app on GitHub."
            : "You'll confirm on GitHub, then come back here to install it and pick repositories."}
        </p>
      </form>
    </Card>
  );
}

function RemoveApp({ app }: { app: GithubAppView }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => call(api.github.apps[":id"].$delete({ param: { id: app.forgeId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey }),
  });
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={<Button small variant="danger" />}>Remove</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/30" />
        <AlertDialog.Popup className="panel fixed top-1/2 left-1/2 w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 p-5">
          <AlertDialog.Title className="text-[15px] font-semibold">
            Remove {app.name} from Runyard?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-[13px] text-ink-2">
            Runyard forgets the app and its key. The app stays on GitHub until you delete it in its{" "}
            <a
              href={app.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              settings
            </a>
            .
          </AlertDialog.Description>
          {remove.error && <ErrorText className="mt-2" error={remove.error} />}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button />}>Cancel</AlertDialog.Close>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Remove
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
