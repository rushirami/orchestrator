import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { WorkflowService } from "./WorkflowService.ts";
import { templateFixture } from "./testFixtures.ts";

const layer = WorkflowService.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory));
it.effect("validates template graphs and variables before persisting a saved definition", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO projection_projects(project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-a', 'Project', '/tmp/project', '[]', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`;
    const service = yield* WorkflowService;
    const template = templateFixture();
    const input = {
      id: template.id,
      projectId: template.projectId,
      expectedRevision: 0,
      definition: template.definition,
    };
    const malformed = yield* service
      .saveTemplate({ ...input, definition: { ...input.definition, prompt: "{{TASK.bad}}" } })
      .pipe(Effect.flip);
    assert.include(malformed.message, "VARIABLE_NAME");
    assert.equal((yield* service.snapshot()).templates.length, 0);
    const saved = yield* service.saveTemplate(input);
    assert.equal(saved.templates[0]?.definition.name, "Local delivery");
    yield* service.remove({ id: input.id, projectId: input.projectId, expectedRevision: 1 });
    assert.equal((yield* service.snapshot()).templates.length, 0);
  }).pipe(Effect.provide(layer)),
);
