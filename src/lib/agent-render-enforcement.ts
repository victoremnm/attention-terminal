// Extracted as a pure function (rather than inlined in attention-agent.ts's
// prepareStep) so it can be unit tested without mocking the full AI SDK
// streamText/multi-step machinery.

// Only tools that actually produce result ROWS count as "fetched data" here.
// listTables/describeTable are schema-inspection steps the model runs before
// a query, not the query itself -- counting them would force renderAnswer
// before a multi-table join/comparison ever executes its actual SQL.
const DATA_FETCH_TOOL_NAMES = new Set([
  "runReadOnlyQuery",
  "runDataRetrieval",
  "getDailyDigest",
  "getRealBuilders",
  "getRepoDrilldown",
]);

/**
 * Decides whether the NEXT step should be forced to call renderAnswer.
 * Only forces once the turn has already fetched real data (proving it's a
 * data question, not idle chit-chat) and renderAnswer still hasn't been
 * called after a few steps -- so simple conversational turns are never
 * forced to render anything.
 */
export function shouldForceRenderAnswer(
  toolNamesCalledSoFar: readonly string[],
  stepNumber: number
): boolean {
  if (toolNamesCalledSoFar.includes("renderAnswer")) return false;
  const fetchedData = toolNamesCalledSoFar.some((name) =>
    DATA_FETCH_TOOL_NAMES.has(name)
  );
  return fetchedData && stepNumber >= 3;
}
