import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WORKFLOW_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";

const changes = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "workflows:changes",
  tag: WORKFLOW_METHODS.changes,
});

export const workflowEnvironment = {
  snapshot: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "workflows:snapshot",
    tag: WORKFLOW_METHODS.snapshot,
    refreshTrigger: ({ environmentId }) => changes({ environmentId, input: {} }),
  }),
  saveTemplate: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "workflows:save-template",
    tag: WORKFLOW_METHODS.saveTemplate,
  }),
  remove: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "workflows:remove",
    tag: WORKFLOW_METHODS.remove,
  }),
};
