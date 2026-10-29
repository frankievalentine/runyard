import { describe, expect, test } from "bun:test";
import type { YardView } from "@runyard/core";
import { setup } from "../pools/test-helpers.ts";

describe("polling only repositories with CI", () => {
  test("a personal account's repositories without workflows aren't polled", async () => {
    const s = await setup({
      account: "frankie",
      type: "User",
      repos: ["frankie/app", "frankie/notes", "frankie/site"],
    });
    s.fakeGithub.reposWithoutWorkflows.add("frankie/notes");
    await s.github.refreshAll();
    s.fakeGithub.requests.length = 0;
    await s.github.pollRunners();
    await s.github.pollJobs();
    const asked = s.fakeGithub.requests.join("\n");
    expect(asked).toContain("/repos/frankie/app/actions/runners");
    expect(asked).toContain("/repos/frankie/site/actions/runs");
    expect(asked).not.toContain("/repos/frankie/notes/");
    const view = await s.call<YardView>("GET", "/api/yard");
    expect(view.github.apps[0]?.installations[0]).toMatchObject({ repoCount: 3, ciRepoCount: 2 });
  });
});
