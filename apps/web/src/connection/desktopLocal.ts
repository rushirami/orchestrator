import type { ConnectionTarget } from "@t3tools/client-runtime/connection";
import {
  type DesktopBridge,
  type DesktopEnvironmentBootstrap,
  PRIMARY_LOCAL_ENVIRONMENT_ID,
} from "@t3tools/contracts";

/** The desktop pool id routes operations such as the WSL folder picker. */
export function isDesktopLocalConnectionTarget(target: ConnectionTarget): target is Extract<
  ConnectionTarget,
  { readonly _tag: "LocalConnectionTarget" }
> & {
  readonly backendId: string;
} {
  return target._tag === "LocalConnectionTarget" && target.backendId !== undefined;
}

export function desktopLocalBackendId(target: ConnectionTarget): string | null {
  return isDesktopLocalConnectionTarget(target) ? target.backendId : null;
}

export type DesktopSecondaryBootstrapsRead =
  | {
      readonly _tag: "Success";
      readonly bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>;
    }
  | {
      readonly _tag: "Failure";
      readonly cause: unknown;
    };

export interface DesktopSecondaryBootstrapsReader {
  readonly readResult: () => DesktopSecondaryBootstrapsRead;
  readonly readSnapshot: () => ReadonlyArray<DesktopEnvironmentBootstrap>;
}

/**
 * Build a topology reader whose snapshot advances only after successful bridge
 * reads. A successful empty read is authoritative; a thrown read preserves the
 * previous snapshot so UI consumers cannot temporarily disagree with the
 * platform's retained registrations.
 */
export function createDesktopSecondaryBootstrapsReader(
  resolveBridge: () => Pick<DesktopBridge, "getLocalEnvironmentBootstraps"> | undefined,
): DesktopSecondaryBootstrapsReader {
  let snapshot: ReadonlyArray<DesktopEnvironmentBootstrap> = [];

  const readResult = (): DesktopSecondaryBootstrapsRead => {
    const bridge = resolveBridge();
    if (bridge === undefined) {
      snapshot = [];
      return { _tag: "Success", bootstraps: snapshot };
    }
    try {
      snapshot = bridge
        .getLocalEnvironmentBootstraps()
        .filter((entry) => entry.id !== PRIMARY_LOCAL_ENVIRONMENT_ID);
      return { _tag: "Success", bootstraps: snapshot };
    } catch (cause) {
      return { _tag: "Failure", cause };
    }
  };

  return {
    readResult,
    readSnapshot: () => {
      const result = readResult();
      return result._tag === "Success" ? result.bootstraps : snapshot;
    },
  };
}

const desktopSecondaryBootstrapsReader = createDesktopSecondaryBootstrapsReader(
  () => window.desktopBridge,
);

/** Read the topology while preserving failures for platform cache policy. */
export function readDesktopSecondaryBootstrapsResult(): DesktopSecondaryBootstrapsRead {
  return desktopSecondaryBootstrapsReader.readResult();
}

/** Read the latest successful topology snapshot for renderer consumers. */
export function readDesktopSecondaryBootstraps(): ReadonlyArray<DesktopEnvironmentBootstrap> {
  return desktopSecondaryBootstrapsReader.readSnapshot();
}
