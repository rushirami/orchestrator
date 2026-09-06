import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Workflow snapshots have their own retention boundary, separate from conversation replay.
  yield* sql`CREATE TABLE workflow_records (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('template', 'task')),
    revision INTEGER NOT NULL,
    data_json TEXT NOT NULL,
    event_name TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX workflow_records_project ON workflow_records(project_id, kind)`;
  // Only identifiers and fingerprints survive dismissal; no prompts or past results are retained.
  yield* sql`CREATE TABLE workflow_command_keys (
    command_id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    record_id TEXT NOT NULL
  )`;
});
