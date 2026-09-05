# Connection runtime

Electron's renderer uses `packages/client-runtime` for local connection lifetimes, typed RPC,
retries, and cached environment state. `apps/web/src/connection/platform.ts` supplies desktop
bridge registrations. `apps/web` is the internal desktop renderer, not a standalone web product.

`LocalConnectionTarget` is the only target type. It contains environment identity, a label,
loopback HTTP and WebSocket URLs, and an optional desktop backendId for secondary WSL backends.
The resolver validates both URLs before opening a connection. There are no user-managed remote
registrations, credentials, connection profiles, or relay discovery services.

The registry reconciles the current desktop topology. It creates one scoped supervisor per
local environment and reuses the scope when an equivalent registration is repeated. Replacing
an endpoint closes its old connection; removing a backend closes its scope and clears its cache.
A transient desktop IPC failure retains the last successful topology. An explicit successful
empty topology removes its secondary entries.

A driver prepares an endpoint, opens one RPC session, and reports preparing, opening, and
synchronizing progress. The session owns one transport attempt; the supervisor owns reconnect
and backoff. Durable streams follow replacement supervisors. Per-environment lease locks
prevent state lookups from creating a second runtime during replacement or removal.

The IndexedDB cache stores shell, paginated thread, server configuration, and VCS snapshots.
Version 5 deletes the old remote catalog object store while retaining those caches. Cached data
survives connection failures; provider metadata remains usable while reconnecting.

A local renderer client ID persists across transport reconnects to route provider setup flows.
No T3 session cookies, bearer credentials, or periodic auth refreshes are required.
