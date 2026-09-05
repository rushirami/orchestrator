# Development and packaging

Use Node 24 and `vp i` to install the workspace dependencies. Dependency installation and
artifact tooling may download build dependencies; they are separate from application runtime.

`vp run dev` and `vp run dev:desktop` launch the local desktop development stack. There is no
browser-opening, sharing, pairing, or remote-host mode. Read actual ports from `[dev-runner]`
output because occupied ports can shift the preferred values. Vite serves the internal renderer
on loopback and proxies local backend routes.

In a linked worktree, development state defaults to its gitignored `.t3` directory even if an
ambient T3CODE_HOME is set. An explicit `--home-dir` wins. From the main checkout, use a dedicated
development home; never point development servers at a live installed application's userdata.

`vp run start` launches the built desktop app. `vp run build:desktop` builds its local pipeline.
For verification, use focused `vp test run <files>`, targeted lint, and package-scoped typechecks.
The repository-wide CI suite is separate from local task verification.

Artifact commands include `vp run dist:desktop:dmg`, `vp run dist:desktop:linux`, and
`vp run dist:desktop:win`. The generic `dist:desktop:artifact` command accepts platform, target,
and architecture options. Artifacts include the renderer, backend, and resource monitor. The
browser-secret helper and its keyring-import dependencies are no longer built.

Linux packaging needs Rust, the requested Rust target, C/C++ tools, Make, and ImageMagick.
Platform signing and native toolchains may require additional local setup. Keep provider
maintenance separate from replacing this fork's application build; there is no T3 auto-updater.
