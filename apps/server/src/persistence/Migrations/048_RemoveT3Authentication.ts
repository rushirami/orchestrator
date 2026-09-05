import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Retired T3 client credentials are unrelated to provider credentials and work history. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TABLE IF EXISTS auth_pairing_links`;
  yield* sql`DROP TABLE IF EXISTS auth_sessions`;
});
