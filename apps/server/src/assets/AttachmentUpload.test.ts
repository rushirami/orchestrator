// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Schema from "effect/Schema";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { parseThreadSegmentFromAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import {
  ATTACHMENT_UPLOAD_ROUTE_PREFIX,
  deletePendingAttachment,
  issueAttachmentUploadUrl,
  resolveAttachmentUploadAddress,
  storeAttachmentUpload,
} from "./AttachmentUpload.ts";

const testLayer = ServerConfig.layerTest(process.cwd(), { prefix: "t3-attachment-upload-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);

const encodeAddressJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const uploadInput = {
  name: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 6,
} as const;

describe("AttachmentUpload", () => {
  it.effect("encodes and validates local attachment metadata without a signing key", () =>
    Effect.gen(function* () {
      const issued = yield* issueAttachmentUploadUrl(uploadInput);
      expect(parseThreadSegmentFromAttachmentId(issued.attachmentId)).toBe("pending");

      const token = issued.relativeUrl.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);
      expect(yield* resolveAttachmentUploadAddress(token)).toMatchObject({
        kind: "attachment-upload",
        attachmentId: issued.attachmentId,
        name: "screenshot.png",
        mimeType: "image/png",
        sizeBytes: 6,
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects malformed upload addresses", () =>
    Effect.gen(function* () {
      const issued = yield* issueAttachmentUploadUrl(uploadInput);
      const token = issued.relativeUrl.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);

      expect(yield* resolveAttachmentUploadAddress(`${token}invalid`)).toBeNull();
      expect(yield* resolveAttachmentUploadAddress(`${token}.extra`)).toBeNull();
      expect(yield* resolveAttachmentUploadAddress("garbage")).toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects invalid metadata and uploads outside pending attachments", () =>
    Effect.gen(function* () {
      const issued = yield* issueAttachmentUploadUrl(uploadInput);
      const address = issued.relativeUrl.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);
      const valid = yield* resolveAttachmentUploadAddress(address);
      expect(valid).not.toBeNull();
      for (const patch of [
        { mimeType: "text/html" },
        { sizeBytes: -1 },
        { sizeBytes: 0 },
        { sizeBytes: Number.MAX_SAFE_INTEGER },
        { attachmentId: "../outside" },
        { attachmentId: "thread-00000000-0000-4000-8000-0000000000cc" },
      ]) {
        const invalid = Encoding.encodeBase64Url(
          new TextEncoder().encode(encodeAddressJson({ ...valid, ...patch })),
        );
        expect(yield* resolveAttachmentUploadAddress(invalid)).toBeNull();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects expired upload addresses", () =>
    Effect.gen(function* () {
      const issued = yield* issueAttachmentUploadUrl(uploadInput);
      const token = issued.relativeUrl.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);

      yield* TestClock.adjust("11 minutes");
      expect(yield* resolveAttachmentUploadAddress(token)).toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes expired pending uploads while issuing a new upload URL", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const staleId = "pending-00000000-0000-4000-8000-0000000000cc";
      const stalePath = NodePath.join(config.attachmentsDir, `${staleId}.png`);
      NodeFS.writeFileSync(stalePath, Buffer.from("pixels"));
      NodeFS.utimesSync(stalePath, 0, 0);

      yield* TestClock.adjust("25 hours");
      yield* issueAttachmentUploadUrl(uploadInput);

      expect(NodeFS.existsSync(stalePath)).toBe(false);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("stores the expected bytes without leaving temporary files", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const issued = yield* issueAttachmentUploadUrl(uploadInput);
      const token = issued.relativeUrl.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);
      const claims = yield* resolveAttachmentUploadAddress(token);
      if (!claims) {
        throw new Error("Expected valid upload claims.");
      }

      expect(yield* storeAttachmentUpload(claims, new Uint8Array([1, 2, 3]))).toMatchObject({
        ok: false,
        status: 400,
      });
      expect(yield* storeAttachmentUpload(claims, new Uint8Array(6))).toEqual({ ok: true });
      expect(
        NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${issued.attachmentId}.png`)),
      ).toBe(true);
      expect(
        NodeFS.readdirSync(config.attachmentsDir).filter((entry) => entry.endsWith(".part")),
      ).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("streams generic files to a path with their original extension", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const issued = yield* issueAttachmentUploadUrl({
        type: "file",
        name: "report.PDF",
        mimeType: "application/pdf",
        sizeBytes: 6,
      });
      const token = issued.relativeUrl.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);
      const claims = yield* resolveAttachmentUploadAddress(token);
      if (!claims) {
        throw new Error("Expected valid upload claims.");
      }

      expect(
        yield* storeAttachmentUpload(
          claims,
          Stream.make(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])),
        ),
      ).toEqual({ ok: true });
      expect(issued.attachmentId).toMatch(/-pdf$/);
      expect(
        NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${issued.attachmentId}.pdf`)),
      ).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));

      yield* deletePendingAttachment(issued.attachmentId);
      expect(NodeFS.readdirSync(config.attachmentsDir)).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes partial streamed uploads that exceed their declared size", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const issued = yield* issueAttachmentUploadUrl(uploadInput);
      const token = issued.relativeUrl.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);
      const claims = yield* resolveAttachmentUploadAddress(token);
      if (!claims) {
        throw new Error("Expected valid upload claims.");
      }

      expect(yield* storeAttachmentUpload(claims, Stream.make(new Uint8Array(7)))).toMatchObject({
        ok: false,
        status: 400,
      });
      expect(NodeFS.readdirSync(config.attachmentsDir)).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes partial streamed uploads when the upload is interrupted", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const issued = yield* issueAttachmentUploadUrl(uploadInput);
      const token = issued.relativeUrl.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);
      const claims = yield* resolveAttachmentUploadAddress(token);
      if (!claims) {
        throw new Error("Expected valid upload claims.");
      }

      const nextChunkRequested = yield* Deferred.make<void>();
      const body = Stream.make(new Uint8Array([1, 2, 3])).pipe(
        Stream.concat(
          Stream.fromEffect(
            Deferred.succeed(nextChunkRequested, undefined).pipe(Effect.andThen(Effect.never)),
          ),
        ),
      );
      const upload = yield* storeAttachmentUpload(claims, body).pipe(Effect.forkScoped);

      yield* Deferred.await(nextChunkRequested);
      expect(
        NodeFS.readdirSync(config.attachmentsDir).filter((entry) => entry.endsWith(".part")),
      ).toHaveLength(1);

      yield* Fiber.interrupt(upload);
      expect(NodeFS.readdirSync(config.attachmentsDir)).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("deletes pending uploads without deleting thread-owned copies", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const uuid = "00000000-0000-4000-8000-0000000000dd";
      const pendingPath = NodePath.join(config.attachmentsDir, `pending-${uuid}.png`);
      const claimedPath = NodePath.join(config.attachmentsDir, `thread-1-${uuid}.png`);
      NodeFS.writeFileSync(pendingPath, Buffer.from("pixels"));
      NodeFS.writeFileSync(claimedPath, Buffer.from("pixels"));

      yield* deletePendingAttachment(`pending-${uuid}`);
      yield* deletePendingAttachment(`pending-${uuid}`);
      yield* deletePendingAttachment(`thread-1-${uuid}`);

      expect(NodeFS.existsSync(pendingPath)).toBe(false);
      expect(NodeFS.existsSync(claimedPath)).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );
});
