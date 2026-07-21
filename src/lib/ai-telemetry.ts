import { OpenTelemetry } from "@ai-sdk/otel";
import { registerTelemetry, type Telemetry } from "ai";

type RegistrationSurface = "next" | "trigger";
type ChatPhase = "head-start" | "worker";

export const attentionAgentFunctionId = "attention-agent";

let initialized = false;

export function ensureAiSdkTelemetry(surface: RegistrationSurface) {
  if (initialized || hasOpenTelemetryIntegration()) {
    initialized = true;
    return;
  }

  registerTelemetry(
    new OpenTelemetry({
      usage: true,
      providerMetadata: true,
      runtimeContext: true,
      enrichSpan: ({
        spanType,
        operationId,
        callId,
        runtimeContext,
      }: {
        spanType: string;
        operationId: string;
        callId: string;
        runtimeContext?: { surface?: string };
      }) => ({
        "app.name": "attention-terminal",
        "app.surface":
          typeof runtimeContext?.surface === "string"
            ? runtimeContext.surface
            : surface,
        "app.span_type": spanType,
        "app.operation_id": operationId,
        "app.call_id": callId,
      }),
    }) as unknown as Telemetry,
  );

  initialized = true;
}

export function attentionTelemetry(surface: ChatPhase) {
  return {
    telemetry: {
      functionId: attentionAgentFunctionId,
      includeRuntimeContext: {
        surface: true,
      },
    },
    runtimeContext: {
      surface,
    },
  };
}

function hasOpenTelemetryIntegration() {
  const integrations = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS as
    | Telemetry[]
    | undefined;

  if (!Array.isArray(integrations)) {
    return false;
  }

  return integrations.some(
    (integration) =>
      integration?.constructor?.name === "OpenTelemetry" ||
      integration?.constructor?.name === "LegacyOpenTelemetry",
  );
}
