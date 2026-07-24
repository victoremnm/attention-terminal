import { defineConfig } from "@trigger.dev/sdk";
import { syncVercelEnvVars } from "@trigger.dev/build/extensions/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter as OTLPMetricProtoExporter } from "@opentelemetry/exporter-metrics-otlp-proto";

function resolveSignalUrl(rawUrl: string, signal: "logs" | "traces" | "metrics"): string {
  const cleanBase = rawUrl
    .replace(/\/+$/, "")
    .replace(/\/v1\/(traces|logs|metrics)$/, "")
    .replace(/\/v1$/, "");
  return `${cleanBase}/v1/${signal}`;
}

function getTelemetryExporters() {
  const logExporters: any[] = [];
  const traceExporters: any[] = [];
  const metricExporters: any[] = [];

  // ClickHouse OTLP Endpoint (targeting internal telemetry database)
  const chOtlpUrl = process.env.CLICKHOUSE_OTLP_URL || process.env.TRIGGER_OTLP_URL;
  if (chOtlpUrl) {
    const chHeaders = process.env.CLICKHOUSE_OTLP_AUTH_TOKEN
      ? { Authorization: `Bearer ${process.env.CLICKHOUSE_OTLP_AUTH_TOKEN}` }
      : undefined;

    logExporters.push(
      new OTLPLogExporter({
        url: process.env.CLICKHOUSE_OTLP_LOGS_URL || resolveSignalUrl(chOtlpUrl, "logs"),
        headers: chHeaders,
      })
    );

    traceExporters.push(
      new OTLPTraceExporter({
        url: process.env.CLICKHOUSE_OTLP_TRACES_URL || resolveSignalUrl(chOtlpUrl, "traces"),
        headers: chHeaders,
      })
    );

    metricExporters.push(
      new OTLPMetricProtoExporter({
        url: process.env.CLICKHOUSE_OTLP_METRICS_URL || resolveSignalUrl(chOtlpUrl, "metrics"),
        headers: chHeaders,
      })
    );
  }

  return { logExporters, traceExporters, metricExporters };
}

const { logExporters, traceExporters, metricExporters } = getTelemetryExporters();

export default defineConfig({
  project: "proj_inafrgiuiixqgirbqbww",
  runtime: "node",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  telemetry: {
    logExporters,
    exporters: traceExporters,
    metricExporters,
  },
  build: {
    extensions: [
      syncVercelEnvVars({
        projectId: "prj_iKvXQd1qKJ8sAq7RdvDtxETdjtHz",
        vercelTeamId: "team_WHTSdbMyJgw0eLjd0OhVGlHf",
      }),
    ],
  },
  dirs: ["./src/trigger"],
});
