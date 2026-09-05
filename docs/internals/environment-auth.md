# Local transport boundary

The desktop owns its backend processes and supplies loopback endpoints through Electron IPC.
HTTP, WebSocket, and built-in MCP requests do not use T3 accounts, pairing credentials,
session cookies, bearer tokens, DPoP, or authorization scopes. Provider and Git authentication
remain part of their respective integrations.

The backend binds to loopback and validates Host and Origin before serving requests. This
blocks remote exposure and requests from unrelated browser origins. Local processes have
access to the backend; this is a local application boundary, not isolation between OS users.

A renderer-generated `LocalClientId` routes provider setup responses to the initiating renderer.
The MCP context identifier routes tools to their provider session and thread. Neither is a
credential.

Local asset URLs carry validated resource metadata sealed with a random per-process HMAC key.
This lets opaque, sandboxed HTML previews read issued files and permitted sibling resources
without admitting their origin to the control API or upload endpoints. The seal is a scoped
file capability, not a T3 account or session credential; modifying the resource metadata
invalidates it. URLs expire after one hour and become invalid when the backend restarts.
Path, media-type, size, and file-identity checks still apply. Asset responses vary by Origin
so a cached document navigation cannot break a later sandboxed fetch's CORS response.

Electron permits loopback asset frames and preserves the backend's document sandbox policy.
HTML previews can run scripts and load local sibling resources, but their content policy
blocks external resources, forms, and popups. Their opaque origin cannot access control APIs.

Migration 048 drops obsolete T3 pairing and session tables. Historical migrations remain so
existing databases can upgrade in order. Project history and provider resume data are retained.
Local provider secrets and the stable environment identity use `secrets/ServerSecretStore`.

See [network access](../user/network-access.md) for the external integrations retained in this fork.
