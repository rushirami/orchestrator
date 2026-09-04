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
