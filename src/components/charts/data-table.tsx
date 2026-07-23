"use client";

import { formatNumber, humanizeKey } from "./shared";

export type DataTableColumn = {
  key: string;
  label?: string;
  type?: "number" | "string" | "date" | "link";
};

function cellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map(cellValue).join(", ");
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DataTable({
  rows,
  columns,
  title,
  summary,
}: {
  rows: Array<Record<string, unknown>>;
  columns?: DataTableColumn[];
  title?: string;
  summary?: string;
}) {
  if (!rows.length) return null;

  const resolvedColumns: DataTableColumn[] = (columns?.length
    ? columns
    : Object.keys(rows[0]).map((key) => ({ key, label: humanizeKey(key), type: "string" as const }))
  ).slice(0, 12);

  return (
    <figure className="chart data-table">
      <figcaption className="mono" style={{ marginBottom: 8 }}>
        {title || "DATA TABLE"}
        {summary ? <span style={{ marginLeft: 8, color: "var(--text-secondary)" }}>{summary}</span> : null}
      </figcaption>
      <div className="table-responsive">
        <table className="telemetry-table" role="table">
          <thead>
            <tr>
              {resolvedColumns.map((column) => (
                <th key={column.key} style={{ textAlign: column.type === "number" ? "right" : "left" }}>
                  {column.label || humanizeKey(column.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {resolvedColumns.map((column) => {
                  const value = row[column.key];
                  const isLink = column.type === "link" && typeof value === "string" && value.trim().length > 0;
                  return (
                    <td key={column.key} style={{ textAlign: column.type === "number" ? "right" : "left" }}>
                      {isLink ? (
                        <a href={value} target="_blank" rel="noreferrer">
                          {value}
                        </a>
                      ) : (
                        cellValue(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
