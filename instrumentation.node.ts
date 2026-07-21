import { OpenTelemetry } from "@ai-sdk/otel";
import { registerTelemetry, type Telemetry } from "ai";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const tracerProvider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "attention-terminal",
  }),
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url:
          process.env.CLICKHOUSE_OTLP_TRACES_URL ??
          process.env.CLICKHOUSE_OTLP_URL ??
          "http://localhost:4318/v1/traces",
        headers: process.env.CLICKHOUSE_OTLP_AUTH_TOKEN
          ? {
              Authorization: `Bearer ${process.env.CLICKHOUSE_OTLP_AUTH_TOKEN}`,
            }
          : undefined,
      }),
    ),
  ],
});

tracerProvider.register();

registerTelemetry(
  new OpenTelemetry({
    tracer: tracerProvider.getTracer("gen_ai"),
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
          : "next",
      "app.span_type": spanType,
      "app.operation_id": operationId,
      "app.call_id": callId,
    }),
  }) as unknown as Telemetry,
);
