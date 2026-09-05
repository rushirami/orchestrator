# Application replacement and recovery

T3 self-update RPC methods, their progress streams, the desktop updater, and update feed metadata are
removed in this fork. The renderer does not offer update actions or persist update-channel settings.
A desktop build ships its renderer and backend together; replacing the application is a manual step.

The local resource telemetry pipe carries resource samples and sampling controls only. It cannot
request, commit, cancel, or report a desktop update.

Startup still recognizes historical `continueAfterServerUpdate` markers in provider runtime bindings.
This preserves recovery of work interrupted by an older build. The app no longer creates these
markers or offers a setting to resume threads after automatic updates. Ordinary provider session
reconciliation and orphan recovery remain active.

Provider maintenance has its own settings, adapters, and RPC methods. It remains available as an
explicitly retained integration.
