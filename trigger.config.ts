import { defineConfig } from "@trigger.dev/sdk";
import { syncVercelEnvVars } from "@trigger.dev/build/extensions/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter as OTLPMetricProtoExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPMetricExporter as OTLPMetricHttpExporter } from "@opentelemetry/exporter-metrics-otlp-http";

function getTelemetryExporters() {
  const logExporters: any[] = [];
  const traceExporters: any[] = [];
  const metricExporters: any[] = [];

  // 1. ClickHouse OTLP Endpoint (targeting internal telemetry database)
  const chOtlpUrl = process.env.CLICKHOUSE_OTLP_URL || process.env.TRIGGER_OTLP_URL;
  if (chOtlpUrl) {
    const chHeaders = process.env.CLICKHOUSE_OTLP_AUTH_TOKEN
      ? { Authorization: `Bearer ${process.env.CLICKHOUSE_OTLP_AUTH_TOKEN}` }
      : undefined;

    logExporters.push(
      new OTLPLogExporter({
        url: process.env.CLICKHOUSE_OTLP_LOGS_URL || `${chOtlpUrl}/v1/logs`,
        headers: chHeaders,
      })
    );

    traceExporters.push(
      new OTLPTraceExporter({
        url: process.env.CLICKHOUSE_OTLP_TRACES_URL || `${chOtlpUrl}/v1/traces`,
        headers: chHeaders,
      })
    );

    metricExporters.push(
      new OTLPMetricProtoExporter({
        url: process.env.CLICKHOUSE_OTLP_METRICS_URL || `${chOtlpUrl}/v1/metrics`,
        headers: chHeaders,
      })
    );
  }

  // 2. Axiom Telemetry Provider (Optional)
  if (process.env.AXIOM_API_TOKEN && process.env.AXIOM_DATASET) {
    const axiomHeaders = {
      Authorization: `Bearer ${process.env.AXIOM_API_TOKEN}`,
      "X-Axiom-Dataset": process.env.AXIOM_DATASET,
    };

    logExporters.push(
      new OTLPLogExporter({
        url: process.env.AXIOM_LOGS_URL || "https://api.axiom.co/v1/logs",
        headers: axiomHeaders,
      })
    );

    traceExporters.push(
      new OTLPTraceExporter({
        url: process.env.AXIOM_TRACES_URL || "https://api.axiom.co/v1/traces",
        headers: axiomHeaders,
      })
    );

    if (process.env.AXIOM_METRICS_DATASET) {
      metricExporters.push(
        new OTLPMetricProtoExporter({
          url: process.env.AXIOM_METRICS_URL || "https://api.axiom.co/v1/metrics",
          headers: {
            Authorization: `Bearer ${process.env.AXIOM_API_TOKEN}`,
            "x-axiom-metrics-dataset": process.env.AXIOM_METRICS_DATASET,
          },
        })
      );
    }
  }

  // 3. Honeycomb Telemetry Provider (Optional)
  if (process.env.HONEYCOMB_API_KEY && process.env.HONEYCOMB_DATASET) {
    const honeycombHeaders = {
      "x-honeycomb-team": process.env.HONEYCOMB_API_KEY,
      "x-honeycomb-dataset": process.env.HONEYCOMB_DATASET,
    };

    logExporters.push(
      new OTLPLogExporter({
        url: process.env.HONEYCOMB_LOGS_URL || "https://api.honeycomb.io/v1/logs",
        headers: honeycombHeaders,
      })
    );

    traceExporters.push(
      new OTLPTraceExporter({
        url: process.env.HONEYCOMB_TRACES_URL || "https://api.honeycomb.io/v1/traces",
        headers: honeycombHeaders,
      })
    );

    metricExporters.push(
      new OTLPMetricHttpExporter({
        url: process.env.HONEYCOMB_METRICS_URL || "https://api.honeycomb.io/v1/metrics",
        headers: honeycombHeaders,
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
