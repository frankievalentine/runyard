# Planned: narrow screens

Status: **built** on 2026-10-29. Decided with the user: below 1024px the sidebar is a drawer
opened from a menu button in the top bar (it closes on navigation, Escape or a tap outside, and
is out of the tab order while closed); below 768px tables' rows become cards, each cell under
its column's name. Also at phone width: only the current breadcrumb, queued jobs and review
steps stacked, the pool form naming only its current step, and dots that never end a line.
Checked page by page at 390px and 820px in the demo; passkey rows keep their old date style.

## Why

At phone width the sidebar keeps its full 256px, so pages squeeze into a thin column (seen on
Settings ▸ Account at 390px). The dashboard is reachable from any device on the tailnet, phones
included.

## To review

- The sidebar below a breakpoint: a drawer behind a menu button, or a top bar.
- Every page at 390px: headers with actions, stat strips, tables (machines, runners, queued
  jobs), the review list, terminal panels, the pool form's cards, dialogs.
- Touch targets and the breadcrumb at that width.
- Passkey rows use the old date style (10/29/2026); give them the access tokens' details line.
