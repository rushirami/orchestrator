import { describe, expect, it } from "@effect/vitest";
import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";

import {
  canReuseCachedPlatformRegistration,
  primaryRegistrationToRetainAfterTopologyRead,
  readPrimaryEnvironmentTargetResult,
  secondaryRegistrationsToRetainAfterTopologyRead,
} from "./platform.ts";

describe("desktop-local topology cache", () => {
  const registration = {} as never;
  const primary = { signature: "primary", registration };
  const secondary = { signature: "wsl", registration };
  const previous = new Map([
    [PRIMARY_LOCAL_ENVIRONMENT_ID, primary],
    ["wsl:Ubuntu", secondary],
  ]);

  it("reuses only unchanged endpoints", () => {
    expect(canReuseCachedPlatformRegistration(secondary, "wsl")).toBe(true);
    expect(canReuseCachedPlatformRegistration(secondary, "changed")).toBe(false);
  });

  it("retains secondaries after a topology read failure without duplicating the primary", () => {
    expect(
      secondaryRegistrationsToRetainAfterTopologyRead(previous, {
        _tag: "Failure",
        cause: new Error("IPC unavailable"),
      }),
    ).toEqual(new Map([["wsl:Ubuntu", secondary]]));
  });

  it("treats a successful empty topology as authoritative removal", () => {
    expect(
      secondaryRegistrationsToRetainAfterTopologyRead(previous, {
        _tag: "Success",
        bootstraps: [],
      }),
    ).toEqual(new Map());
  });
});

describe("primary topology cache", () => {
  const registration = {} as never;
  const cached = {
    signature: "primary|http://127.0.0.1:3773/|ws://127.0.0.1:3773/",
    registration,
  };
  const previous = new Map([[PRIMARY_LOCAL_ENVIRONMENT_ID, cached]]);

  it("captures synchronous primary target read failures", () => {
    const cause = new Error("invalid primary target");

    expect(
      readPrimaryEnvironmentTargetResult(() => {
        throw cause;
      }),
    ).toEqual({ _tag: "Failure", cause });
  });

  it("retains the cached primary after a transient topology read failure", () => {
    expect(
      primaryRegistrationToRetainAfterTopologyRead(previous, {
        _tag: "Failure",
        cause: new Error("IPC unavailable"),
      }),
    ).toBe(cached);
  });

  it("treats a successful primary absence as authoritative removal", () => {
    expect(
      primaryRegistrationToRetainAfterTopologyRead(previous, {
        _tag: "Success",
        target: null,
      }),
    ).toBeUndefined();
  });
});
