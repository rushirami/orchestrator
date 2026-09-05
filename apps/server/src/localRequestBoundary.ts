import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { isIssuedAssetPath } from "./assets/AssetAccess.ts";
import {
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import * as ServerConfig from "./config.ts";
import { browserApiCorsAllowedHeaders, browserApiCorsAllowedMethods } from "./httpCors.ts";

const DESKTOP_ORIGINS = ["t3code://app", "t3code-dev://app"];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function localClientOrigins(devUrl?: URL): ReadonlyArray<string> {
  return devUrl &&
    LOOPBACK_HOSTS.has(devUrl.hostname) &&
    ["http:", "https:"].includes(devUrl.protocol)
    ? [...DESKTOP_ORIGINS, devUrl.origin]
    : DESKTOP_ORIGINS;
}

export function hasLocalRequestHost(
  headers: Readonly<Record<string, string | undefined>>,
  port: number,
): boolean {
  const authority = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::([0-9]+))?$/i.exec(headers.host ?? "");
  return authority !== null && Number(authority[1] || 80) === port;
}

/** An origin check keeps project previews and unrelated websites out of the local control API. */
export function isTrustedLocalRequest(
  headers: Readonly<Record<string, string | undefined>>,
  port: number,
  allowedOrigins: ReadonlyArray<string>,
): boolean {
  if (!hasLocalRequestHost(headers, port)) return false;

  const origin = headers.origin;
  if (origin !== undefined) return allowedOrigins.includes(origin);

  const referer = headers.referer;
  if (referer !== undefined) {
    try {
      const url = new URL(referer);
      return allowedOrigins.includes(`${url.protocol}//${url.host}`);
    } catch {
      return false;
    }
  }
  // Native local clients do not have browser fetch metadata. A browser request
  // with its referrer suppressed must not gain access through this native path.
  return headers["sec-fetch-site"] === undefined || headers["sec-fetch-site"] === "none";
}

export const localRequestBoundaryLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const server = yield* HttpServer.HttpServer;
    const allowedOrigins = localClientOrigins(config.devUrl);
    const cors = HttpMiddleware.cors({
      allowedOrigins: [...allowedOrigins],
      credentials: false,
      allowedMethods: browserApiCorsAllowedMethods,
      allowedHeaders: browserApiCorsAllowedHeaders,
      maxAge: 600,
    });
    const assetCors = HttpMiddleware.cors({
      allowedOrigins: [...allowedOrigins, "null"],
      credentials: false,
      allowedMethods: ["GET", "HEAD"],
    });
    return HttpRouter.middleware(
      (httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (
            server.address._tag !== "TcpAddress" ||
            !hasLocalRequestHost(request.headers, server.address.port)
          ) {
            return HttpServerResponse.text("Only local desktop requests are accepted.", {
              status: 403,
            });
          }
          if (isTrustedLocalRequest(request.headers, server.address.port, allowedOrigins)) {
            return yield* cors(httpEffect);
          }
          const url = HttpServerRequest.toURL(request);
          if (
            (request.method === "GET" || request.method === "HEAD") &&
            Option.isSome(url) &&
            (yield* isIssuedAssetPath(url.value.pathname))
          ) {
            return yield* assetCors(httpEffect);
          }
          return HttpServerResponse.text("Only local desktop requests are accepted.", {
            status: 403,
          });
        }),
      { global: true },
    );
  }),
);
