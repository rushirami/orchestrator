import type {
  BrowserNavigationTarget,
  EnvironmentId,
  PreviewUrlResolution,
} from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";

import { readPreparedConnection } from "~/state/session";

export const normalizeHostname = (host: string): string =>
  host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/u, "");

const parseIpv4Address = (host: string): readonly number[] | null => {
  const parts = normalizeHostname(host).split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
};

export const isLocalLoopbackHost = (host: string): boolean => {
  const normalized = normalizeHostname(host);
  if (normalized === "localhost" || normalized === "::1") return true;
  return parseIpv4Address(normalized)?.[0] === 127;
};

export function resolveBrowserNavigationTarget(
  environmentId: EnvironmentId,
  target: BrowserNavigationTarget,
): PreviewUrlResolution {
  const requestedUrl =
    target.kind === "url"
      ? target.url
      : `${target.protocol ?? "http"}://localhost:${target.port}${target.path?.startsWith("/") ? target.path : `/${target.path ?? ""}`}`;
  if (target.kind === "environment-port") {
    const connection = readPreparedConnection(environmentId);
    if (!connection) throw new Error(`Environment ${environmentId} is not connected.`);
    normalizePreviewUrl(connection.httpBaseUrl);
  }
  return {
    requestedUrl,
    resolvedUrl: normalizePreviewUrl(requestedUrl),
    resolutionKind: "direct",
    environmentId,
  };
}

export function resolveDiscoveredServerUrl(_environmentId: EnvironmentId, rawUrl: string): string {
  return normalizePreviewUrl(rawUrl);
}
