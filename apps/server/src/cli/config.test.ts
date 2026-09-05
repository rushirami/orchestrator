// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";

import { assert, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DesktopBackendBootstrap,
  type DesktopBackendBootstrap as DesktopBackendBootstrapValue,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import { deriveServerPaths } from "../config.ts";
import { resolveServerConfig } from "./config.ts";

const deriveExplicitServerPaths = (baseDir: string, devUrl: URL | undefined) =>
  deriveServerPaths(baseDir, devUrl, { baseDirIsExplicit: true });

const encodeDesktopBootstrap = Schema.encodeEffect(Schema.fromJsonString(DesktopBackendBootstrap));

const makeDesktopBootstrap = (
  overrides: Partial<DesktopBackendBootstrapValue> = {},
): DesktopBackendBootstrapValue => ({
  mode: "desktop",
  port: 4888,
  t3Home: "/tmp/t3-bootstrap-home",
  host: "127.0.0.1",
  ...overrides,
});

it.layer(NodeServices.layer)("cli config resolution", (it) => {
  const defaultObservabilityConfig = {
    traceMinLevel: "Info",
    traceTimingEnabled: true,
    traceBatchWindowMs: 1_000,
    traceMaxBytes: 10 * 1024 * 1024,
    traceMaxFiles: 10,
  } as const;

  const openBootstrapFd = Effect.fn(function* (payload: DesktopBackendBootstrapValue) {
    const fs = yield* FileSystem.FileSystem;
    const filePath = yield* fs.makeTempFileScoped({ prefix: "t3-bootstrap-", suffix: ".ndjson" });
    const encoded = yield* encodeDesktopBootstrap(payload);
    yield* fs.writeFileString(filePath, `${encoded}\n`);
    return yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.openSync(filePath, "r")),
      (fd) => Effect.sync(() => NodeFS.closeSync(fd)),
    );
  });

  it.effect("rejects remote bind hosts from flags, environment, and desktop bootstrap", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-local-host-test-" });
      for (const source of ["flag", "environment", "bootstrap"] as const) {
        const bootstrapFd =
          source === "bootstrap"
            ? Option.some(
                yield* openBootstrapFd(makeDesktopBootstrap({ host: "0.0.0.0", t3Home: baseDir })),
              )
            : Option.none<number>();
        const error = yield* resolveServerConfig(
          {
            mode: Option.some("desktop"),
            port: Option.some(4888),
            host: source === "flag" ? Option.some("0.0.0.0") : Option.none(),
            baseDir: Option.some(baseDir),
            cwd: Option.some(baseDir),
            devUrl: Option.none(),
            bootstrapFd,
            autoBootstrapProjectFromCwd: Option.none(),
            logWebSocketEvents: Option.none(),
          },
          Option.none(),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              NetService.layer,
              ConfigProvider.layer(
                ConfigProvider.fromEnv({
                  env: source === "environment" ? { T3CODE_HOST: "192.168.1.2" } : {},
                }),
              ),
            ),
          ),
          Effect.flip,
        );
        assert.equal(error._tag, "NonLoopbackListenHostError", source);
      }
    }),
  );

  it.effect("falls back to effect/config values when flags are omitted", () =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir = join(NodeOS.tmpdir(), "t3-cli-config-env-base");
      const derivedPaths = yield* deriveExplicitServerPaths(
        baseDir,
        new URL("http://127.0.0.1:5173"),
      );
      const resolved = yield* resolveServerConfig(
        {
          mode: Option.none(),
          port: Option.none(),
          host: Option.none(),
          baseDir: Option.none(),
          cwd: Option.none(),
          devUrl: Option.none(),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.none(),
          logWebSocketEvents: Option.none(),
        },
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  T3CODE_LOG_LEVEL: "Warn",
                  T3CODE_MODE: "desktop",
                  T3CODE_PORT: "4001",
                  T3CODE_HOST: "localhost",
                  T3CODE_HOME: baseDir,
                  VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
                  T3CODE_NO_BROWSER: "true",
                  T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
                  T3CODE_LOG_WS_EVENTS: "true",
                },
              }),
            ),
            NetService.layer,
          ),
        ),
      );

      expect(resolved).toEqual({
        logLevel: "Warn",
        ...defaultObservabilityConfig,
        mode: "desktop",
        port: 4001,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "127.0.0.1",
        devUrl: new URL("http://127.0.0.1:5173"),
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: true,
      });
      assert.equal(resolved.stateDir, join(baseDir, "userdata"));
    }),
  );

  it.effect("uses CLI flags when provided", () =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir = join(NodeOS.tmpdir(), "t3-cli-config-flags-base");
      const derivedPaths = yield* deriveExplicitServerPaths(
        baseDir,
        new URL("http://127.0.0.1:4173"),
      );
      const resolved = yield* resolveServerConfig(
        {
          mode: Option.some("web"),
          port: Option.some(8788),
          host: Option.some("127.0.0.1"),
          baseDir: Option.some(baseDir),
          cwd: Option.none(),
          devUrl: Option.some(new URL("http://127.0.0.1:4173")),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.some(true),
          logWebSocketEvents: Option.some(true),
        },
        Option.some("Debug"),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  T3CODE_LOG_LEVEL: "Warn",
                  T3CODE_MODE: "desktop",
                  T3CODE_PORT: "4001",
                  T3CODE_HOST: "localhost",
                  T3CODE_HOME: join(NodeOS.tmpdir(), "ignored-base"),
                  VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
                  T3CODE_NO_BROWSER: "false",
                  T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
                  T3CODE_LOG_WS_EVENTS: "false",
                },
              }),
            ),
            NetService.layer,
          ),
        ),
      );

      expect(resolved).toEqual({
        logLevel: "Debug",
        ...defaultObservabilityConfig,
        mode: "web",
        port: 8788,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "127.0.0.1",
        devUrl: new URL("http://127.0.0.1:4173"),
        autoBootstrapProjectFromCwd: true,
        logWebSocketEvents: true,
      });
      assert.equal(resolved.dbPath, join(baseDir, "userdata", "state.sqlite"));
    }),
  );

  it.effect("preserves explicit false CLI boolean flags over env and bootstrap values", () =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir = join(NodeOS.tmpdir(), "t3-cli-config-false-flags");
      const fd = yield* openBootstrapFd(makeDesktopBootstrap({}));
      const derivedPaths = yield* deriveExplicitServerPaths(
        baseDir,
        new URL("http://127.0.0.1:4173"),
      );

      const resolved = yield* resolveServerConfig(
        {
          mode: Option.some("web"),
          port: Option.some(8788),
          host: Option.some("127.0.0.1"),
          baseDir: Option.some(baseDir),
          cwd: Option.none(),
          devUrl: Option.some(new URL("http://127.0.0.1:4173")),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.some(false),
          logWebSocketEvents: Option.some(false),
        },
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  T3CODE_BOOTSTRAP_FD: String(fd),
                  T3CODE_NO_BROWSER: "true",
                  T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "true",
                  T3CODE_LOG_WS_EVENTS: "true",
                },
              }),
            ),
            NetService.layer,
          ),
        ),
      );

      expect(resolved).toEqual({
        logLevel: "Info",
        ...defaultObservabilityConfig,
        mode: "web",
        port: 8788,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "127.0.0.1",
        devUrl: new URL("http://127.0.0.1:4173"),
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: false,
      });
    }),
  );

  it.effect("uses bootstrap envelope values as fallbacks when flags and env are absent", () =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir = "/tmp/t3-bootstrap-home";
      const fd = yield* openBootstrapFd(
        makeDesktopBootstrap({
          port: 4888,
          host: "::1",
          t3Home: baseDir,
          desktopTelemetryFd: 4,
          desktopTelemetryControlFd: 5,
        }),
      );
      const derivedPaths = yield* deriveServerPaths(baseDir, undefined);

      const resolved = yield* resolveServerConfig(
        {
          mode: Option.none(),
          port: Option.none(),
          host: Option.none(),
          baseDir: Option.none(),
          cwd: Option.none(),
          devUrl: Option.none(),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.none(),
          logWebSocketEvents: Option.none(),
        },
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  T3CODE_BOOTSTRAP_FD: String(fd),
                },
              }),
            ),
            NetService.layer,
          ),
        ),
      );

      expect(resolved).toEqual({
        logLevel: "Info",
        ...defaultObservabilityConfig,
        mode: "desktop",
        port: 4888,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "::1",
        devUrl: undefined,
        desktopTelemetryFd: 4,
        desktopTelemetryControlFd: 5,
        resourceMonitorPath: undefined,
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: false,
      });
      assert.equal(join(baseDir, "userdata"), resolved.stateDir);
      assert.equal(resolved.desktopTelemetryFd, 4);
      assert.equal(resolved.desktopTelemetryControlFd, 5);
    }),
  );

  it.effect("creates derived runtime directories during config resolution", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cli-config-dirs-" });
      const customCwd = path.join(baseDir, "nested", "project");

      const resolved = yield* resolveServerConfig(
        {
          mode: Option.some("desktop"),
          port: Option.some(4888),
          host: Option.none(),
          baseDir: Option.some(baseDir),
          cwd: Option.some(customCwd),
          devUrl: Option.some(new URL("http://127.0.0.1:5173")),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.none(),
          logWebSocketEvents: Option.none(),
        },
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
            NetService.layer,
          ),
        ),
      );

      for (const directory of [
        customCwd,
        resolved.stateDir,
        resolved.logsDir,
        resolved.providerLogsDir,
        resolved.terminalLogsDir,
        resolved.attachmentsDir,
        resolved.worktreesDir,
        path.dirname(resolved.serverLogPath),
        path.dirname(resolved.serverTracePath),
      ]) {
        expect(yield* fs.exists(directory)).toBe(true);
      }
      expect(resolved.cwd).toBe(path.resolve(customCwd));
    }),
  );

  it.effect("applies flag then env precedence over bootstrap envelope values", () =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir = join(NodeOS.tmpdir(), "t3-cli-config-env-wins");
      const fd = yield* openBootstrapFd(
        makeDesktopBootstrap({
          port: 4888,
          host: "::1",
          t3Home: "/tmp/t3-bootstrap-home",
        }),
      );
      const derivedPaths = yield* deriveExplicitServerPaths(
        baseDir,
        new URL("http://127.0.0.1:4173"),
      );

      const resolved = yield* resolveServerConfig(
        {
          mode: Option.none(),
          port: Option.some(8788),
          host: Option.some("127.0.0.1"),
          baseDir: Option.none(),
          cwd: Option.none(),
          devUrl: Option.some(new URL("http://127.0.0.1:4173")),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.none(),
          logWebSocketEvents: Option.none(),
        },
        Option.some("Debug"),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  T3CODE_MODE: "web",
                  T3CODE_BOOTSTRAP_FD: String(fd),
                  T3CODE_HOME: baseDir,
                  T3CODE_NO_BROWSER: "true",
                  T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "true",
                  T3CODE_LOG_WS_EVENTS: "true",
                },
              }),
            ),
            NetService.layer,
          ),
        ),
      );

      expect(resolved).toEqual({
        logLevel: "Debug",
        ...defaultObservabilityConfig,
        mode: "web",
        port: 8788,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "127.0.0.1",
        devUrl: new URL("http://127.0.0.1:4173"),
        autoBootstrapProjectFromCwd: true,
        logWebSocketEvents: true,
      });
    }),
  );

  it.effect("ignores obsolete exporter settings on disk", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cli-config-settings-" });
      const derivedPaths = yield* deriveExplicitServerPaths(baseDir, undefined);
      yield* fs.makeDirectory(path.dirname(derivedPaths.settingsPath), { recursive: true });
      yield* fs.writeFileString(
        derivedPaths.settingsPath,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        `${JSON.stringify({
          observability: {
            otlpTracesUrl: "https://collector.example/v1/traces",
            otlpMetricsUrl: "https://collector.example/v1/metrics",
          },
        })}\n`,
      );

      const resolved = yield* resolveServerConfig(
        {
          mode: Option.some("desktop"),
          port: Option.some(4888),
          host: Option.none(),
          baseDir: Option.some(baseDir),
          cwd: Option.none(),
          devUrl: Option.none(),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.none(),
          logWebSocketEvents: Option.none(),
        },
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
            NetService.layer,
          ),
        ),
      );
      expect(resolved).toEqual({
        logLevel: "Info",
        ...defaultObservabilityConfig,
        mode: "desktop",
        port: 4888,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "127.0.0.1",
        devUrl: undefined,
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: false,
      });
    }),
  );
});
