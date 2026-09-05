import { WorkflowTask, WorkflowTemplate } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export class WorkflowStoreError extends Schema.TaggedErrorClass<WorkflowStoreError>()(
  "WorkflowStoreError",
  {
    message: Schema.String,
  },
) {}

// Tasks also contain every template field; decode the more specific shape first.
const StoredValue = Schema.Union([WorkflowTask, WorkflowTemplate]);
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredValue));
const encode = Schema.encodeEffect(Schema.fromJsonString(StoredValue));
type StoredValue = typeof StoredValue.Type;
const isStoreError = Schema.is(WorkflowStoreError);
type RecordKind = "template" | "task";

const makeWorkflowStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fail = (message: string) => new WorkflowStoreError({ message });

  const list = Effect.fn("WorkflowStore.list")(
    function* (projectId: string | undefined) {
      const rows =
        projectId === undefined
          ? yield* sql<{
              data_json: string;
            }>`SELECT data_json FROM workflow_records ORDER BY updated_at DESC, id`
          : yield* sql<{
              data_json: string;
            }>`SELECT data_json FROM workflow_records WHERE project_id = ${projectId} ORDER BY updated_at DESC, id`;
      return yield* Effect.forEach(rows, (row) => decode(row.data_json));
    },
    Effect.mapError((error) => fail(String(error))),
  );

  const get = Effect.fn("WorkflowStore.get")(
    function* (id: string) {
      const rows = yield* sql<{
        data_json: string;
      }>`SELECT data_json FROM workflow_records WHERE id = ${id}`;
      return rows[0] ? yield* decode(rows[0].data_json) : null;
    },
    Effect.mapError((error) => fail(String(error))),
  );

  const save = Effect.fn("WorkflowStore.save")(
    function* (
      value: StoredValue,
      expectedRevision: number,
      eventName: string,
      command?: { id: string; fingerprint: string },
    ) {
      const kind: RecordKind = "nodes" in value ? "task" : "template";
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          if (command) {
            const prior = yield* sql<{
              fingerprint: string;
              record_id: string;
            }>`SELECT fingerprint, record_id FROM workflow_command_keys WHERE command_id = ${command.id}`;
            if (prior[0]) {
              if (prior[0].fingerprint !== command.fingerprint || prior[0].record_id !== value.id)
                return yield* fail("This command ID was already used for a different request.");
              return yield* get(value.id);
            }
          }
          const projects =
            yield* sql`SELECT project_id FROM projection_projects WHERE project_id = ${value.projectId} AND deleted_at IS NULL`;
          if (!projects.length) return yield* fail("The workflow project is no longer available.");
          if (value.revision !== expectedRevision + 1)
            return yield* fail("Invalid workflow revision.");
          const data = yield* encode(value);
          const rows =
            expectedRevision === 0
              ? yield* sql`INSERT INTO workflow_records(id, project_id, kind, revision, data_json, event_name, updated_at)
            VALUES (${value.id}, ${value.projectId}, ${kind}, ${value.revision}, ${data}, ${eventName}, ${value.updatedAt})
            ON CONFLICT(id) DO NOTHING RETURNING id`
              : yield* sql`UPDATE workflow_records SET revision = ${value.revision}, data_json = ${data}, event_name = ${eventName}, updated_at = ${value.updatedAt}
            WHERE id = ${value.id} AND project_id = ${value.projectId} AND kind = ${kind} AND revision = ${expectedRevision} RETURNING id`;
          if (!rows.length)
            return yield* fail("This workflow changed in another window. Reload before saving.");
          if (command)
            yield* sql`INSERT INTO workflow_command_keys(command_id, fingerprint, record_id) VALUES (${command.id}, ${command.fingerprint}, ${value.id})`;
          return value;
        }),
      );
    },
    Effect.mapError((error) => (isStoreError(error) ? error : fail(String(error)))),
  );

  const remove = Effect.fn("WorkflowStore.remove")(
    function* (id: string, projectId: string, expectedRevision: number) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const value = yield* get(id);
          if (!value) return;
          if (value.projectId !== projectId || value.revision !== expectedRevision)
            return yield* fail("This workflow changed. Reload before removing it.");
          if (
            "nodes" in value &&
            ((value.status !== "complete" && value.status !== "cancelled") ||
              value.nodes.some(
                (node) => node.status === "running" || node.status === "dispatching",
              ))
          )
            return yield* fail("Stop active work before dismissing this task.");
          yield* sql`DELETE FROM workflow_records WHERE id = ${id} AND project_id = ${projectId} AND revision = ${expectedRevision}`;
        }),
      );
    },
    Effect.mapError((error) => (isStoreError(error) ? error : fail(String(error)))),
  );

  const replay = Effect.fn(
    function* (command: { id: string; fingerprint: string }) {
      const rows = yield* sql<{
        fingerprint: string;
        record_id: string;
      }>`SELECT fingerprint, record_id FROM workflow_command_keys WHERE command_id = ${command.id}`;
      if (!rows[0]) return { matched: false as const, value: null };
      if (rows[0].fingerprint !== command.fingerprint)
        return yield* fail("This command ID was already used for a different request.");
      return { matched: true as const, value: yield* get(rows[0].record_id) };
    },
    Effect.mapError((error) => (isStoreError(error) ? error : fail(String(error)))),
  );

  return { list, get, save, remove, replay };
});

export class WorkflowStore extends Context.Service<
  WorkflowStore,
  Effect.Success<typeof makeWorkflowStore>
>()("t3/workflows/WorkflowStore") {
  static readonly layer = Layer.effect(WorkflowStore, makeWorkflowStore);
}
