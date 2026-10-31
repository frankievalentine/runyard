# Taking over existing runners

Runners you registered before Runyard, or by hand, show under **Unassigned runners** in the
sidebar. **Needs attention** lists them until you say which machine each runs on. Runyard never
changes a runner it didn't install until you move it into a pool.

A runner's page has **Take over this runner**, in three steps:

1. **Choose the machine it runs on.** The runner then shows on that machine's page. You can stop
   here: Runyard shows it but never changes it.
2. **Move it into a pool:** a persistent pool on that machine that serves the runner's scope, or
   **Create a pool from this runner** with its labels. The pool's own runner is installed through
   the machine's usual review.
3. **Review and retire it.** Once the pool's runner is online, idle, labeled and running, the
   machine's review offers **Retire**. It deregisters the old runner on the forge and shows the
   steps to remove its service. The old runner stops on its own when it notices; Runyard never
   changes its folder.
