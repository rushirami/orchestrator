import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  getPrimaryKnownEnvironment,
  isDesktopEnvironmentBootstrapIncompleteError,
  readPrimaryEnvironmentTarget,
  resetPrimaryEnvironmentDescriptorForTests,
  resolveInitialPrimaryEnvironmentDescriptor,
  writePrimaryEnvironmentDescriptor,
} from ".";
import { installEnvironmentHttpTest } from "../../../test/environmentHttpTest";

const BASE_ENVIRONMENT = {
  environmentId: EnvironmentId.make("environment-local"),
  label: "Local environment",
  platform: {
    os: "darwin",
    arch: "arm64",
  },
  serverVersion: "0.0.0-test",
  capabilities: {
    repositoryIdentity: true,
  },
} satisfies ExecutionEnvironmentDescriptor;

let disposeHttpTest: (() => Promise<void>) | undefined;

async function installDescriptorApi() {
  const testApi = await installEnvironmentHttpTest({
    descriptor: () => Effect.succeed(BASE_ENVIRONMENT),
  });
  disposeHttpTest = testApi.dispose;
  return testApi;
}

function installTestBrowser(url: string) {
  vi.stubGlobal("window", {
    location: new URL(url),
    desktopBridge: {
      getLocalEnvironmentBootstraps: () => [
        { id: "primary", httpBaseUrl: "http://localhost:3773", wsBaseUrl: "ws://localhost:3773" },
      ],
    },
    history: {
      replaceState: vi.fn(),
    },
  });
}

function captureThrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to throw.");
}

describe("environmentBootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    installTestBrowser("http://localhost/");
  });

  afterEach(async () => {
    await disposeHttpTest?.();
    disposeHttpTest = undefined;
    resetPrimaryEnvironmentDescriptorForTests();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("attaches the bootstrapped environment descriptor to the primary environment", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://localhost:3773",
      },
      desktopBridge: {
        getLocalEnvironmentBootstraps: () => [
          { id: "primary", httpBaseUrl: "http://localhost:3773", wsBaseUrl: "ws://localhost:3773" },
        ],
      },
    });
    writePrimaryEnvironmentDescriptor({
      environmentId: EnvironmentId.make("environment-local"),
      label: "Bootstrapped environment",
      platform: {
        os: "darwin",
        arch: "arm64",
      },
      serverVersion: "0.0.0-test",
      capabilities: {
        repositoryIdentity: true,
      },
    });

    expect(getPrimaryKnownEnvironment()).toEqual({
      id: "environment-local",
      label: "Bootstrapped environment",
      source: "desktop-managed",
      environmentId: "environment-local",
      target: {
        httpBaseUrl: "http://localhost:3773/",
        wsBaseUrl: "ws://localhost:3773/",
      },
    });
  });

  it("reuses an in-flight descriptor bootstrap request", async () => {
    const testApi = await installDescriptorApi();

    await Promise.all([
      resolveInitialPrimaryEnvironmentDescriptor(),
      resolveInitialPrimaryEnvironmentDescriptor(),
    ]);

    expect(testApi.calls.descriptor).toBe(1);
  });

  it("describes which desktop bootstrap endpoint is missing", () => {
    vi.stubGlobal("window", {
      location: new URL("http://127.0.0.1:5733/"),
      history: { replaceState: vi.fn() },
      desktopBridge: {
        getLocalEnvironmentBootstraps: () => [
          {
            id: "primary",
            label: "Local environment",
            httpBaseUrl: "http://127.0.0.1:3773",
          },
        ],
      },
    });

    const error = captureThrown(readPrimaryEnvironmentTarget);

    expect(isDesktopEnvironmentBootstrapIncompleteError(error)).toBe(true);
    if (!isDesktopEnvironmentBootstrapIncompleteError(error)) {
      throw new Error("Expected a structured desktop bootstrap error.");
    }
    expect(error).toMatchObject({
      hasHttpBaseUrl: true,
      hasWsBaseUrl: false,
      message: "Desktop bootstrap is missing wsBaseUrl for the local environment.",
    });
  });
  it("does not fall back to a website or configured remote endpoint without the desktop bridge", () => {
    vi.stubGlobal("window", { location: new URL("https://example.test") });
    vi.stubEnv("VITE_HTTP_URL", "https://remote.example.test");
    vi.stubEnv("VITE_WS_URL", "wss://remote.example.test");
    expect(() => readPrimaryEnvironmentTarget()).toThrow("Desktop bootstrap is missing");
  });

  it("rejects a remote endpoint in a desktop bootstrap", () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        getLocalEnvironmentBootstraps: () => [
          {
            id: "primary",
            httpBaseUrl: "http://192.168.1.10:3773",
            wsBaseUrl: "ws://192.168.1.10:3773",
          },
        ],
      },
    });
    expect(() => readPrimaryEnvironmentTarget()).toThrow("Could not parse http-base-url");
  });
});
