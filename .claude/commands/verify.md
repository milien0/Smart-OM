---
description: Dispatch the verifier subagent against the current diff and goal spec.
---

Invoke the `verifier` subagent (`.claude/agents/verifier.md`) to check the
current `git diff` against `PROMPT.md`'s "Done when" criteria and
`IMPLEMENTATION_PLAN.md`'s claimed progress. Print its JSON verdict. Exit
non-zero (fail this command) if `passes` is `false`.
