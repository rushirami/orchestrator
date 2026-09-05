# Local workflow pipeline verification

The deterministic provider at `apps/server/integration/fixtures/local-workflow-codex.mjs` speaks the Codex app-server protocol. It verifies orchestration through the normal provider adapter, engine, checkpointing, SQLite, and Electron UI. It does not call a model, a tracker, or a remote Git service.

Prepare a test-owned directory outside the repository and keep its path for the whole pass. Create `.fixture-owner` in that directory. Initialize a Git repository at `<test-root>/project` with branch `main`, a README, and a committed `.orchestrator-local-fixture` marker. Use repository-local test commit identity. No remote is needed.

Create an isolated Electron profile at `<test-root>/electron`. Use the existing test-app skill to initialize the test database; if copying real data, use its read-only snapshot/pruning procedure. Never point this server at the installed application's data.

In the isolated server settings, add an enabled Codex provider instance with:

- `config.binaryPath`: the absolute path of the fixture script.
- An `environment` entry with `name: "ORCHESTRATOR_FIXTURE_ROOT"`, `value: "<test-root>"`, and `sensitive: false`.
- An `environment` entry with `name: "ORCHESTRATOR_FIXTURE_REVIEW_GATES"`, `value: "1"`, and `sensitive: false` to hold independent reviews for inspection.

Use the settings schema's existing provider-instance structure. Disable other test-profile provider instances when the pass must use only the local fixture. The fixture advertises model `local-workflow` and requires no authentication. It refuses worktrees outside the marked test root.

Build with `vp run build:desktop`. Launch the local Electron binary with `T3CODE_HOME=<test-root>`, `T3CODE_DESKTOP_USER_DATA_DIR=<test-root>/electron`, and an unused `T3CODE_PORT`. Leave `VITE_DEV_SERVER_URL` unset to test built renderer assets. Record the spawned PID or command session and stop only that process. Do not launch a second server against the same test database.

## Desktop journey

1. Add the test repository as a project. Switch to Workflows, open Configure workflows, and choose that project.
2. Create the default local feature-delivery template. Assign the local fixture to Builder and both reviewers. Preview the `TASK` variable, validate, save, reopen, and launch with a new workspace and branch.
3. Confirm the worktree and three threads exist. Open `spec.md`; implementation must remain pending until approval.
4. Approve. The fixture writes a greeting module and test file and actually runs two Node tests. Both read-only reviewers must start in separate threads in that worktree.
5. The fixture writes `review-a.waiting` and `review-b.waiting` outside the worktree. Creating `<test-root>/review-a.release` releases only the first report. The combine stage must still wait. Create `review-b.release` to complete both branches.
6. Inspect the combined report and completion state. Dismissal removes workflow-only state; the worktree and conversations remain.
7. Repeat using a fresh task and remove only the test-owned release markers first. Quit while reviews are held, relaunch with the same database/profile, and verify interrupted stages pause. Prepare each failed review for retry, resume, and release their gates. Completed Builder skills must not rerun.
8. To exercise bounded rework, create `<test-root>/request-rework` before a fresh launch. The combine stage requests one return to Builder on iteration one and completes on iteration two. Remove that test-owned marker afterward.

The gate uses filesystem events, not timing assumptions. Provider requests are recorded in `<test-root>/provider-wire.ndjson`; fixture conversation state stays under `provider-state`. These files may contain the test prompts. Keep evidence outside source control.

For assertions, inspect the isolated database read-only, capture the task graph and approval UI, check distinct reviewer thread IDs, verify one shared worktree, and run the produced Node test file. Focused automated tests cover the same scheduling, stale-review, cancellation, recovery, and retention rules. Report live-provider and WSL coverage separately; this fixture proves neither remote model quality nor a Windows environment.
