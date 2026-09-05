import type { EnvironmentId } from "@t3tools/contracts";
import type { RemoteEnvironmentRequestError } from "../rpc/http.ts";
import {
  type ConnectionAttemptError,
  ConnectionBlockedError,
  ConnectionTransientError,
} from "./model.ts";

export function environmentMismatchError(input: {
  readonly expected: EnvironmentId;
  readonly actual: EnvironmentId;
}): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connected environment ${input.actual} does not match ${input.expected}.`,
  });
}

export function mapRemoteEnvironmentError(
  error: RemoteEnvironmentRequestError,
): ConnectionAttemptError {
  switch (error._tag) {
    case "EnvironmentRequestInvalidError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment rejected the request.",
        traceId: error.traceId,
      });
    case "EnvironmentResourceNotFoundError":
      // A missing metadata endpoint indicates a local backend configuration issue.
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment endpoint could not be found.",
        traceId: error.traceId,
      });
    case "EnvironmentHttpTimeoutError":
      return new ConnectionTransientError({
        reason: "timeout",
        detail: error.message,
      });
    case "EnvironmentHttpFetchError":
      return new ConnectionTransientError({
        reason: "network",
        detail: error.message,
      });
    case "EnvironmentInternalError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "The environment could not answer the connection request.",
        traceId: error.traceId,
      });
    case "EnvironmentHttpInvalidJsonError":
    case "EnvironmentHttpUndeclaredStatusError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: error.message,
      });
  }
}
