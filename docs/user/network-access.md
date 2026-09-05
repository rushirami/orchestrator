# Network access

This desktop fork keeps the integrations you configure for model providers, Git hosting,
pricing, theme downloads, and usage limits. Those integrations can contact external servers;
this is not an air-gapped application.

Conversation images and videos that point to network URLs are not loaded automatically.
Local files and attachments still work. Link icons use a built-in globe, and pull-request
avatars use initials. The application does not send link hostnames to a favicon service.

T3 telemetry exporters, cloud accounts, relay tunnels, remote environments, and automatic
application updates have been removed. Diagnostics remain on the local machine. Provider
commands and tools can still access the network as part of work you request.

The built-in preview opens local development servers only. It blocks remote navigation,
redirects, and HTTP/WebSocket subresources, including external fonts and scripts. Pages that
rely on a CDN need local copies of those assets. Remote browser-history entries are discarded.
Location permission is disabled for previews.

Provider diagnostics uploads are removed, including the former Codex `/feedback` command.

The app has no T3 login, pairing, or access-token flow. Local files and built-in tools use the
same local boundary. Browser-account importing and the upstream support-issue helper are removed.
Local diagnostics are available for inspection without an upload action.

The retained integrations cover five categories: model providers (including transcription and
provider maintenance), Git hosting, pricing, theme downloads, and usage limits. Their endpoints
can vary with your configuration. Running code or tools through a provider can itself make
network requests. Loopback binding and preview HTTP filtering are not an OS-level network sandbox.
