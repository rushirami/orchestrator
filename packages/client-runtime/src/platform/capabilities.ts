import { type OrchestrationClientOrigin } from "@t3tools/contracts";
import * as Context from "effect/Context";

export class ClientPresentation extends Context.Service<
  ClientPresentation,
  {
    readonly metadata: OrchestrationClientOrigin;
  }
>()("@t3tools/client-runtime/platform/capabilities/ClientPresentation") {}
