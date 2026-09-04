# Local desktop connections

The desktop app owns the backend lifecycle. The Electron main process starts the local server and
publishes its loopback HTTP and WebSocket endpoints through the preload bridge. The renderer uses
only those endpoints; environment variables and the current page origin cannot supply an alternate
server. Both endpoint schemes and loopback addresses are validated before discovery requests.

The backend listener is restricted to loopback. Its HTTP and WebSocket ingress validates Host and
Origin, and accepts the desktop application origins plus the configured loopback development origin.
These checks keep unrelated websites from controlling the local filesystem or terminal.

Production renderer files live at `apps/web/dist` inside the Electron application. Electron's local
protocol loads those files directly. The backend serves local APIs and assets, without a browser
application shell. Vite serves internal renderer development assets on loopback.

On Windows, the desktop pool can run a WSL backend alongside the primary backend. WSL uses Windows
localhost forwarding. The renderer reconciles the pool's topology and preserves its last successful
snapshot if reading that topology fails. Internet connectivity events do not suspend loopback
connections.

Remote endpoint discovery, SSH server installation and forwarding, relay tunnels, Tailscale
exposure, and pairing forms are removed. Startup deletes the obsolete `connection-catalog.json`
and `saved-environments.json` documents from the desktop state directory. The renderer's IndexedDB
version 5 migration drops only the connection catalog store, preserving conversation and configuration
caches. Temporary local connection credentials remain in memory while the backend manages its local
session lifecycle.

Provider and source-control authentication belong to their integrations. Git may still use SSH;
removing T3 remote environments does not alter the user's SSH configuration or agent socket.

The standalone boot service, its installer, launcher IPC, runtime downloader, and trial-update
protocol are removed. The backend runs under the desktop pool rather than an independently installed
service. Startup still restores persisted provider sessions and local conversation state.

The backend no longer opens a browser, prints pairing URLs or QR codes, or exposes `auth`
and `serve` CLI commands. Desktop startup uses its local IPC readiness signal. The remaining
local bootstrap/session handshake is internal and is being removed separately.
