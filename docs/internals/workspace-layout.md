# Workspace layout

The pnpm workspace uses Vite+ (`vp`) and Node 24.

- `apps/desktop`: Electron shell, local backend supervision, WSL integration, local previews,
  OS integration, and packaging.
- `apps/web`: Electron's React/Vite renderer. It is packaged into the desktop application and
  loaded through the `t3code://` protocol. Its loopback Vite server is a development tool.
- `apps/server`: local HTTP/WebSocket backend, orchestration, provider adapters, checkpoints,
  projects, terminals, local diagnostics, and the retained provider/Git integrations.
- `packages/contracts`: shared schemas for RPC, events, settings, providers, and desktop IPC.
- `packages/client-runtime`: connection lifecycle, RPC sessions, and domain state for the renderer.
- `packages/shared`: utilities exposed through explicit subpath exports.
- `packages/effect-acp` and `packages/effect-codex-app-server`: provider protocol clients.
- `native/resource-monitor`: local resource sampling; no telemetry exporter.
- `scripts`: development, artifact packaging, and repository maintenance tools.
- `.repos`: read-only dependency references.

Mobile, marketing, hosted web delivery, SSH, T3 accounts, and relay infrastructure have been
removed. The backend does not serve a standalone browser UI. Provider and source-control
credentials remain local to their respective integrations.

Use narrow package subpaths. Contracts expose the root and `./settings`; the removed relay
protocol is no longer exported. See [scripts](./scripts.md) and [network access](../user/network-access.md).
