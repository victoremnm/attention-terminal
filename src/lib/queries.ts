// Server-side query layer entry point. ClickHouse credentials never reach client bundle.
// Re-exports modularized query files from ./queries/index for backwards compatibility.
export * from "./queries/index";
