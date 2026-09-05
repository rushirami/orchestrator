import * as Schema from "effect/Schema";
import { type ConnectionTarget, LocalConnectionTarget } from "./model.ts";

export interface ConnectionCatalogEntry {
  readonly target: ConnectionTarget;
}

/** Local backends discovered through the desktop bridge, including WSL. */
export class LocalConnectionRegistration extends Schema.TaggedClass<LocalConnectionRegistration>()(
  "LocalConnectionRegistration",
  { target: LocalConnectionTarget },
) {}

export const PlatformConnectionRegistration = LocalConnectionRegistration;
export type PlatformConnectionRegistration = LocalConnectionRegistration;

export function connectionRegistrationCatalogEntry(
  registration: LocalConnectionRegistration,
): ConnectionCatalogEntry {
  return { target: registration.target };
}
