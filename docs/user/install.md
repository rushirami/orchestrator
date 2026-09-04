# Install the desktop app

Install a desktop package built from this fork, then open it to start the local backend.
Upstream T3 Code downloads and the public `npx t3` package do not contain this fork's privacy
changes. There is no standalone web or mobile app.

At least one provider runtime must be installed and authenticated. Provider setup in Settings
remains available, including managed Antigravity installation. See the provider list below.

Replace the desktop package manually when you want to update it. The app does not check for or
download T3 updates. If the app shows "T3 Code could not load", use **Reload** to retry the local
backend connection.

### Windows Subsystem for Linux

When the desktop app runs a WSL backend, it installs the matching server runtime into
`~/.t3/wsl-runtime` inside the selected distro. The first launch after installing or updating T3
Code may take a little longer while that release's runtime is extracted. Later launches reuse the
Linux-local copy so startup does not depend on reading application files through `/mnt/c`. After a
successful launch, T3 Code keeps the current runtime and one previous runtime for rollback and
removes older caches automatically. If a cached runtime stops working, T3 Code launches from the
application files under `/mnt/c` instead and reinstalls the runtime on the next launch.

## Providers

T3 Code uses provider runtimes but does not bundle them. Install and authenticate each
provider's CLI, or use T3 Code's managed setup for Antigravity.

| Provider    | CLI                                                                                                        | Default binary     | Log in with                        |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------- |
| Codex       | [Codex CLI](https://developers.openai.com/codex/cli)                                                       | `codex`            | `codex login`                      |
| Claude      | [Claude Code](https://claude.com/product/claude-code)                                                      | `claude`           | `claude auth login`                |
| Cursor      | [Cursor CLI](https://cursor.com/cli)                                                                       | `cursor-agent`     | `agent login`                      |
| Grok Build  | [Grok Build CLI](https://x.ai/cli)                                                                         | `grok`             | `grok login`                       |
| OpenCode    | [OpenCode](https://opencode.ai)                                                                            | `opencode`         | `opencode auth login`              |
| Antigravity | [Official ACP agent](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json) | Managed by T3 Code | **Sign in with Google** in T3 Code |

Codex and Claude are on by default. Cursor, Grok Build, OpenCode, and Antigravity are off by
default. Turn them on in **Settings** > **Providers** when you want to use them.

For Antigravity, select the environment in provider settings, then install and sign in there.
The runtime and credentials stay on that environment, even when you use a phone or remote
browser. See [Antigravity setup](./providers-antigravity.md) for Google sign-in, remote callback
steps, and supported hosts.

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
T3 Code looks for, but authenticate with `agent login`, not `cursor-agent login`.

Grok models that support adjustable reasoning show a **Reasoning** control beside the model picker.
The available levels and default come from the installed Grok Build CLI, so they can vary by model
and CLI version.

Run CLI login commands on the machine running the T3 Code server, not on the device you browse
from. Antigravity uses its sign-in controls in T3 Code instead of a CLI login command.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started T3 Code.

Antigravity can use its managed runtime without a `PATH` entry. Its optional **Binary path**
overrides the managed runtime and must point to the official ACP executable.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
T3 Code. You can install T3 Code, open it, and add providers afterwards. A provider that is not
authenticated shows its status and setup instructions in **Settings**.

For multi-account setups, see [Codex](./providers-codex.md), [Claude](./providers-claude.md), and
[Antigravity](./providers-antigravity.md#accounts-and-removal).

## Next Steps

- [Permission modes](./permission-modes.md): how much T3 Code asks before acting
- [Network access](./network-access.md): local operation and approved integrations
- [Updating](./updating.md): manually replace the desktop package
- [Local backend lifecycle](./background-service.md): desktop-managed backends
