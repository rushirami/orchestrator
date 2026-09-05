import { describe, expect, it } from "vite-plus/test";
import { localClientIdentity } from "./localClientIdentity.ts";
const id = "11111111-1111-4111-8111-111111111111";
const fallback = "22222222-2222-4222-8222-222222222222";
describe("local renderer identity", () => {
  it("preserves a renderer identity across connections", () => {
    expect(localClientIdentity(`/ws?clientId=${id}`, fallback)).toBe(id);
    expect(localClientIdentity(`/ws?clientId=${id}`, "33333333-3333-4333-8333-333333333333")).toBe(
      id,
    );
  });
  it.each(["/ws", "/ws?clientId=bad", "/ws?token=secret", "/ws?wsTicket=secret"])(
    "uses a fresh identity for %s",
    (url) => {
      expect(localClientIdentity(url, fallback)).toBe(fallback);
    },
  );
});
