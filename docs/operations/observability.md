# Local diagnostics

The desktop application and its backend keep diagnostic output locally. General
OTLP trace and metric exporters are removed. Old `T3CODE_OTLP_*` environment
variables and persisted exporter URLs are ignored.

## Logs and traces

The desktop writes rotating logs and `desktop.trace.ndjson` below its local log
directory. The backend writes its configured server trace file and ordinary
logs. Settings exposes local diagnostics and resource usage.

The renderer can send diagnostic spans to the local backend at
`/api/observability/v1/traces`. The backend records them locally and never
forwards them to a collector. The OTLP wire format on this local route does not
indicate external export.

Local trace records include span names, timings, attributes and error details.
Treat these files as potentially sensitive. Reading them does not require
uploading them to a service.

Server metrics remain in memory for local instrumentation. Removing external
exporters does not remove counters or change provider execution.

## Configuration

Local server diagnostic controls remain available:

- `T3CODE_LOG_LEVEL`
- `T3CODE_TRACE_MIN_LEVEL`
- `T3CODE_TRACE_TIMING_ENABLED`
- `T3CODE_TRACE_FILE`
- `T3CODE_TRACE_MAX_BYTES`
- `T3CODE_TRACE_MAX_FILES`
- `T3CODE_TRACE_BATCH_WINDOW_MS`

Use an isolated application data directory when reproducing problems. Do not
start another backend against a running installation's live database.
