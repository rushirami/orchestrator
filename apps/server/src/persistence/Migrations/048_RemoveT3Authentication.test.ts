import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())("048_RemoveT3Authentication", (it) => {
  it.effect(
    "drops retired credentials while preserving projects, history, and provider resume state",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 47 });
        yield* sql`INSERT INTO auth_pairing_links (id, credential, method, scopes, subject, created_at, expires_at)
      VALUES ('pairing', 'obsolete-secret', 'desktop-bootstrap', '[]', 'desktop', '2026-01-01', '2027-01-01')`;
        yield* sql`INSERT INTO auth_sessions (session_id, subject, scopes, method, issued_at, expires_at)
      VALUES ('session', 'desktop', '[]', 'browser-session-cookie', '2026-01-01', '2027-01-01')`;
        yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES ('project', 'Local project', '/tmp/local-work', '[]', '2026-01-01', '2026-01-01')`;
        yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json)
      VALUES ('event', 'project', 'project', 1, 'project.created', '2026-01-01', 'client', '{"title":"Local project"}', '{}')`;
        yield* sql`INSERT INTO provider_session_runtime (thread_id, provider_name, adapter_key, status, last_seen_at, resume_cursor_json)
      VALUES ('thread', 'codex', 'adapter', 'stopped', '2026-01-01', '{"sessionId":"provider-session"}')`;
        const projects = yield* sql`SELECT * FROM projection_projects`;
        const events = yield* sql`SELECT * FROM orchestration_events`;
        const providers = yield* sql`SELECT * FROM provider_session_runtime`;

        yield* runMigrations();
        const retired =
          yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('auth_pairing_links', 'auth_sessions')`;
        assert.deepEqual(retired, []);
        assert.deepEqual(yield* sql`SELECT * FROM projection_projects`, projects);
        assert.deepEqual(yield* sql`SELECT * FROM orchestration_events`, events);
        assert.deepEqual(yield* sql`SELECT * FROM provider_session_runtime`, providers);
        assert.deepEqual(yield* runMigrations(), []);
      }),
  );
});
