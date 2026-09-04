import { createFileRoute } from "@tanstack/react-router";

import { LocalEnvironmentSettings } from "../components/settings/LocalEnvironmentSettings";

export const Route = createFileRoute("/settings/connections")({
  component: LocalEnvironmentSettings,
});
