import { ensureAiSdkTelemetry } from "./src/lib/ai-telemetry";

export function register() {
  ensureAiSdkTelemetry("next");
}
