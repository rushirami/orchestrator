---
name: test-t3-app
description: Prepare and test an isolated T3 Code desktop instance, preserve its process and test state across iterations, and inspect or seed local SQLite fixtures. The internal apps/web renderer is part of Electron; pairing, remote sharing, and standalone browser testing are removed.
---

# Test the local desktop app

Follow AGENTS.md: ask permission before launching a browser or doing computer use unless the
user already authorized it. This skill does not grant that permission. Reading source, building,
and running focused non-UI tests can proceed independently.

## Prepare isolated state

Work from the repository root. Choose a test-owned base directory, such as a fresh directory from
`mktemp -d /tmp/t3code-test.XXXXXX`, and record its absolute path. A linked worktree's ignored `.t3`
is suitable for reusable development state. Never start a test server against live `~/.t3/userdata`.
Never delete or seed state whose ownership is uncertain.

Use a read-only SQLite `VACUUM INTO` snapshot when copying a live database. Copy in, never symlink.
A plain live database copy without its WAL is unsafe. Bring settings or secrets only when the test
needs them. Clear or prune active provider runtime records in the copy before launching the app so
it cannot resume live work. `node apps/server/scripts/migrate-dev-db.ts --help` documents the
isolated fixture helper, which keeps stopped threads and removes runtime bindings.

Read [SQLite fixtures](references/sqlite-fixtures.md) before directly changing a database.

## Launch after approval

Run `vp run dev --home-dir <base-dir>` to launch the desktop development stack. Record the tool
session or spawned PID and read actual ports from `[dev-runner]`; occupied ports can shift them.
The dev runner starts the backend, the internal Vite renderer, and Electron. There is no `--share`,
`--browser`, pairing token, or authentication exchange. Do not invent an alternate remote origin.
Do not set `VITE_HTTP_URL` or `VITE_WS_URL`; the desktop bridge supplies loopback backend endpoints.

For a production-bundle smoke test, build the desktop pipeline first and launch with an explicit
isolated `T3CODE_HOME`. This isolates backend state, but does not override Electron's `userData`
or `sessionData` paths. Set `T3CODE_DESKTOP_USER_DATA_DIR` to a directory inside the test base
to isolate both Electron paths in development or production. Create that directory before launch.
Verify those paths are also redirected into the test-owned directory
before launch, including any later `app.setPath` calls in the desktop startup code.
Inspect the launcher's environment handling before invoking it; a script
without a home override may select installed user data. Inspect the actual Electron renderer with
the available approved automation surface. A standalone browser tab cannot prove desktop IPC,
packaged renderer loading, WSL integration, or preview behavior.

Verify the behavior through its real entry points: chat, Settings, command palette, and keyboard
shortcuts where applicable. Use controlled provider and Git fixtures for tests that should not
make real integration requests. For privacy checks, distinguish the app's own network requests
from the explicitly retained provider, pricing, theme, usage, and source-control integrations.
Do not claim an OS-level network sandbox from loopback binding or preview HTTP filtering.

## Preserve or stop the test instance

Keep the process, base directory, ports, and seeded fixtures while the user is reviewing the
result or requesting further iteration. Before reusing an instance on a later turn, verify its
captured process/session is still alive. A polling timeout alone does not prove it stopped.

When testing and review are finished, stop only the process or tool session captured at launch.
Never use pattern-based process killing. Preserve useful isolated reproduction data; remove only
an exact path created for this test. Do not restart unrelated servers or touch installed state.

## Troubleshooting

A pairing page means an old build or the wrong instance is running. Check the captured process,
current checkout, build artifacts, base directory, and desktop URL; do not recreate pairing tokens.
If data or ports differ from expectations, use the current launch output as the authority.
