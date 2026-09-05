# Local desktop environments

This fork has no SSH, LAN, Tailscale, relay, or hosted-client connection mode. The desktop
supervises local backend processes, including optional WSL backends on Windows. Each endpoint
must be loopback. The primary environment has no backendId; secondary entries carry the desktop
pool identifier used for operations such as the WSL folder picker.

See [connection runtime](./connection-runtime.md) and [local transport boundary](./environment-auth.md).
