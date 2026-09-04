import { LocalClientId } from "@t3tools/contracts";

/** A routing identity for reconnecting renderer windows, never an access credential. */
export function localClientIdentity(rawUrl: string, fallback: string): LocalClientId {
  const value = new URL(rawUrl, "http://127.0.0.1").searchParams.get("clientId");
  return LocalClientId.make(
    value !== null &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      ? value
      : fallback,
  );
}
