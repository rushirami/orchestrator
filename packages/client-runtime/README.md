# Client runtime

Connection management and domain state for the Electron renderer. This package has no root
export; import the narrowest relevant subpath.

- `connection`: local desktop targets, registry, supervision, and reconnects.
- `environment`: identities, descriptors, endpoints, and scoped keys.
- `errors`: error inspection.
- `operations` and `operations/projects`: application workflows.
- `platform`: desktop capabilities, topology, and local cache contracts.
- `rpc`: typed protocol sessions and subscriptions.
- `state/<domain>`: focused state and Atom constructors.
- `voice-input`: recording lifecycle and provider transcription contracts.

The platform supplies local backend registrations and cache storage. Connection services compose
those capabilities with RPC; domain state consumes the registry. No authorization broker, token
store, remote profile catalog, or relay API remains. Voice transcription uses the selected
provider integration.
