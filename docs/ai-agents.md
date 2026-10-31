# AI agents

Runyard serves an [MCP](https://modelcontextprotocol.io) server at `/api/mcp`, so an agent such
as Claude Code can read your CI and prepare changes for you to run.

## Connect an agent

Create a token under **Settings ▸ Account ▸ Access tokens**, then, for Claude Code:

```sh
claude mcp add --scope user --transport http runyard https://<runyard>/api/mcp \
  --header "Authorization: Bearer <token>"
```

`--scope user` makes Runyard available wherever you start Claude Code; without it, only in the
folder where you ran the command. Use the dashboard's HTTPS address, so the token travels
encrypted.

## What a token can do

- **Read only:** `yard_summary`, `list_machines`, `get_machine` (health, readiness, the steps to
  connect it, recent history), `list_runners`, `list_queued_jobs` (with why each one waits),
  `list_pools` and `list_test_jobs`.
- **Read and prepare** (admins only): also `add_machine`, `save_pool`, `prepare_review`,
  `machine_setup_command` and `start_test_job`.

No tool runs a review or deletes anything. `prepare_review` returns the plan and a link to the
machine's page with that review open, for you to check and **Run**. Everything a token prepares is
recorded in the machine's history as yours, through that token.

A token never has more access than its user. It's shown once, stored hashed, can expire, and
works only on `/api/mcp`. Change its access with the menu beside **Revoke**.
