# Workflow persistence and execution state

Workflow definitions are typed in `packages/contracts/src/workflows.ts`. Forward edges describe dependencies; canvas positions do not determine order. Graph validation in `packages/shared/src/workflowGraph.ts` rejects cycles, unreachable stages, concurrent writers, and concurrent stages assigned to one thread. Skills within a node execute sequentially. All incoming dependencies must complete before a node becomes eligible.

Workflow storage uses the environment's existing SQLite connection. Migration 49 introduces `workflow_records`, indexed by project and kind, and `workflow_command_keys`. A template and a launched task have independent IDs and revisions. Tasks carry their own frozen definition so saving or removing a template does not mutate active work.

The workflow retention boundary is independent of the permanent project/thread event log. `workflow_records` holds the latest compacted state and transition name for each workflow aggregate. A transition replaces that state atomically using a revision comparison. Old template definitions and dismissed task payloads are not appended to the ordinary conversation event store. `workflow_command_keys` retains only command IDs, fingerprints, and record IDs to prevent a retried launch from resurrecting a dismissed task; it contains no prompts, graph definitions, or results.

`WorkflowStore` rejects stale writes, cross-project moves, and writes for deleted projects. Dismissal is restricted to terminal tasks without unsettled dispatches. Existing thread histories and worktree files are not removed by workflow dismissal.

The pure decider in `apps/server/src/workflows/decider.ts` handles stage reservation, skill results, revision-bound approval, parallel joins, pause/resume, cancellation, retry, and bounded review rework. Each dispatched skill has an operation identity. Results from old or superseded operations cannot change current state. Rework resets the target and descendants, preserving its findings as handoff context. The caller must persist the new state before performing the corresponding side effect.

Interrupted dispatches are uncertain outcomes, not proof of failure or success. Recovery must reconcile them against provider state and persisted outputs; if that cannot establish the result, the task pauses for inspection. It must not silently repeat an external action. Runtime and UI integration build on these contracts; this persistence layer alone does not launch providers.
