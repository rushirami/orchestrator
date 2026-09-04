import * as Encoding from "effect/Encoding";
import * as Result from "effect/Result";
import * as NodeCrypto from "node:crypto";

import { ATTACHMENT_UPLOAD_URL_TTL_MS, AttachmentCreateUploadUrlInput } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import {
  attachmentFileExtension,
  createPendingAttachmentId,
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  resolveAttachmentPathById,
  sweepStalePendingAttachments,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { inferImageExtension } from "../imageMime.ts";

export const ATTACHMENT_UPLOAD_ROUTE_PREFIX = "/api/attachments/upload";

const PENDING_ATTACHMENT_SWEEP_INTERVAL_MS = 15 * 60_000;
const lastPendingSweepByDirectory = new Map<string, number>();

const AttachmentUploadAddress = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("attachment-upload"),
  type: Schema.Literals(["image", "file"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("image" as const)),
  ),
  attachmentId: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  expiresAt: Schema.Number,
});
export type AttachmentUploadAddress = typeof AttachmentUploadAddress.Type;

const isValidUploadInput = Schema.is(AttachmentCreateUploadUrlInput);

const attachmentUploadClaimsJson = Schema.fromJsonString(AttachmentUploadAddress);
const decodeAttachmentUploadAddress = Schema.decodeUnknownOption(attachmentUploadClaimsJson);
const encodeAttachmentUploadAddress = Schema.encodeSync(attachmentUploadClaimsJson);

function decodeAddress(encodedPayload: string): AttachmentUploadAddress | null {
  try {
    return Option.getOrNull(
      decodeAttachmentUploadAddress(
        Result.getOrThrow(Encoding.decodeBase64UrlString(encodedPayload)),
      ),
    );
  } catch {
    return null;
  }
}

export const issueAttachmentUploadUrl = Effect.fn("AttachmentUpload.issueUrl")(function* (
  input: AttachmentCreateUploadUrlInput,
) {
  const config = yield* ServerConfig.ServerConfig;
  const nowMs = yield* Clock.currentTimeMillis;
  const previousSweep = lastPendingSweepByDirectory.get(config.attachmentsDir);
  if (
    previousSweep === undefined ||
    nowMs - previousSweep >= PENDING_ATTACHMENT_SWEEP_INTERVAL_MS
  ) {
    lastPendingSweepByDirectory.set(config.attachmentsDir, nowMs);
    const swept = sweepStalePendingAttachments({
      attachmentsDir: config.attachmentsDir,
      nowMs,
    });
    if (swept.deleted > 0) {
      yield* Effect.logInfo("Removed expired attachment uploads.", { deleted: swept.deleted });
    }
  }

  const attachmentType = input.type ?? "image";
  const attachmentId = createPendingAttachmentId(
    attachmentType === "file" ? attachmentFileExtension(input.name) : undefined,
  );
  const expiresAt = nowMs + ATTACHMENT_UPLOAD_URL_TTL_MS;
  const encodedPayload = Encoding.encodeBase64Url(
    new TextEncoder().encode(
      encodeAttachmentUploadAddress({
        version: 1,
        kind: "attachment-upload",
        type: attachmentType,
        attachmentId,
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        expiresAt,
      }),
    ),
  );

  return {
    attachmentId,
    relativeUrl: `${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/${encodedPayload}`,
    expiresAt,
  };
});

export const resolveAttachmentUploadAddress = Effect.fn("AttachmentUpload.resolveAddress")(
  function* (address: string) {
    const claims = decodeAddress(address);
    if (!claims || claims.expiresAt <= (yield* Clock.currentTimeMillis)) {
      return null;
    }
    if (
      !isValidUploadInput(claims) ||
      parseThreadSegmentFromAttachmentId(claims.attachmentId) !== PENDING_ATTACHMENT_THREAD_SEGMENT
    ) {
      return null;
    }
    return claims;
  },
);

export type StoreAttachmentUploadResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: number; readonly detail: string };

export const storeAttachmentUpload = Effect.fn("AttachmentUpload.store")(function* (
  claims: AttachmentUploadAddress,
  body: Uint8Array | HttpServerRequest.HttpServerRequest["stream"],
) {
  if (body instanceof Uint8Array && body.byteLength !== claims.sizeBytes) {
    return {
      ok: false,
      status: 400,
      detail: `Body was ${body.byteLength} bytes, expected ${claims.sizeBytes}.`,
    } satisfies StoreAttachmentUploadResult;
  }

  const config = yield* ServerConfig.ServerConfig;
  const extension =
    claims.type === "file"
      ? attachmentFileExtension(claims.name)
      : inferImageExtension({ mimeType: claims.mimeType, fileName: claims.name });
  const relativePath = `${claims.attachmentId}${extension}`;
  const finalPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath,
  });
  const partPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${relativePath}.${NodeCrypto.randomUUID()}.part`,
  });
  if (!finalPath || !partPath) {
    return { ok: false, status: 500, detail: "Failed to resolve attachment path." };
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let receivedBytes = 0;
  const bodyStream = body instanceof Uint8Array ? Stream.make(body) : body;
  return yield* Effect.gen(function* () {
    yield* fileSystem.makeDirectory(path.dirname(finalPath), { recursive: true });
    yield* Stream.run(
      bodyStream.pipe(
        Stream.takeWhile((chunk) => {
          receivedBytes += chunk.byteLength;
          return receivedBytes <= claims.sizeBytes;
        }),
      ),
      fileSystem.sink(partPath),
    );
    if (receivedBytes !== claims.sizeBytes) {
      return {
        ok: false,
        status: 400,
        detail: `Body was ${receivedBytes} bytes, expected ${claims.sizeBytes}.`,
      } satisfies StoreAttachmentUploadResult;
    }
    yield* fileSystem.rename(partPath, finalPath);
    return { ok: true } satisfies StoreAttachmentUploadResult;
  }).pipe(
    Effect.catch((cause) =>
      Effect.logError("Failed to persist attachment upload.", {
        attachmentId: claims.attachmentId,
        cause,
      }).pipe(
        Effect.as({
          ok: false,
          status: 500,
          detail: "Failed to persist upload.",
        } satisfies StoreAttachmentUploadResult),
      ),
    ),
    Effect.ensuring(
      fileSystem.remove(partPath, { force: true }).pipe(Effect.orElseSucceed(() => undefined)),
    ),
  );
});

export const deletePendingAttachment = Effect.fn("AttachmentUpload.deletePending")(function* (
  attachmentId: string,
) {
  if (parseThreadSegmentFromAttachmentId(attachmentId) !== PENDING_ATTACHMENT_THREAD_SEGMENT) {
    return;
  }

  const config = yield* ServerConfig.ServerConfig;
  const attachmentPath = resolveAttachmentPathById({
    attachmentsDir: config.attachmentsDir,
    attachmentId,
  });
  if (!attachmentPath) {
    return;
  }

  const fileSystem = yield* FileSystem.FileSystem;
  yield* fileSystem.remove(attachmentPath, { force: true }).pipe(Effect.orElseSucceed(() => {}));
});
