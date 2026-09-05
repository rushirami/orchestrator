import type { ServerConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveEnvironmentIconPickerLock } from "./EnvironmentIconPicker";

const config = (environmentIcon: boolean | undefined) =>
  ({
    environment: { capabilities: environmentIcon === undefined ? {} : { environmentIcon } },
  }) as unknown as ServerConfig;

describe("resolveEnvironmentIconPickerLock", () => {
  it("locks until the environment is connected", () => {
    expect(resolveEnvironmentIconPickerLock({ serverConfig: null })).toMatch(/Connect/);
  });

  it("locks on servers that predate the setting, without the icon capability", () => {
    expect(
      resolveEnvironmentIconPickerLock({
        serverConfig: config(undefined),
      }),
    ).toMatch(/too old/);
  });

  it("allows icon settings on a connected local backend", () => {
    expect(resolveEnvironmentIconPickerLock({ serverConfig: config(true) })).toBeNull();
  });
});
