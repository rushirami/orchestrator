# Building this fork for distribution

Build application artifacts locally with `vp run dist:desktop:artifact` or the platform-specific
DMG, AppImage, and Windows installer commands documented in [scripts](../internals/scripts.md).
Packaging includes the internal renderer, backend, and native resource monitor. Provider clients
remain separate integrations. Application self-update feeds and manifest merging are removed.

Inherited stable/nightly publication, AUR publication, PR desktop preview publication, and the
Cursor hygiene webhook have been removed. Building does not publish an artifact. If distribution
is wanted later, configure a destination owned by this fork explicitly.

The existing CI workflows run against source deliberately sent to the Git host. Local builds may
fetch dependency and toolchain packages unless their caches are already populated. Code signing
and notarization, when explicitly configured for a build, use the platform's services.

Check the final packaged app on its target platform before distributing it. Keep test data in
an isolated application home and never start test backends against live installed userdata.
