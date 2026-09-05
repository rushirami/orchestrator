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
credential. Local asset URLs encode validated resource metadata instead of an access signature.
Path, media-type, size, expiry, and file-identity checks still apply.

Migration 048 drops obsolete T3 pairing and session tables. Historical migrations remain so
existing databases can upgrade in order. Project history and provider resume data are retained.
Local provider secrets and the stable environment identity use `secrets/ServerSecretStore`.

See [network access](../user/network-access.md) for the external integrations retained in this fork.
