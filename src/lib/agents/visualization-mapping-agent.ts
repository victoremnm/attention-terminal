import { generateObject } from "ai";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { VisualizationTypeSchema } from "../render-payload";

export async function runVisualizationMappingAgent(intent: string, metadata: Record<string, any>) {
  const { object } = await generateObject({
    model: openai("gpt-4o"),
    system: `You are the Visualization Mapping Agent. Your sole objective is to map the statistical properties of the data and the semantic intent of the user's query against a codified taxonomy of visualization principles.
    You must output a configuration payload dictating the exact chart type, the data axes mappings, and specific stylistic overrides.

    The client can only render these chartTypes as an actual chart — never choose anything outside this list, no matter how well it fits the data conceptually, because it will only ever show a plain data table instead:
    - Line Graph: Continuous temporal data, trend analysis.
    - Area Chart: Cumulative volume/magnitude over time.
    - Waterfall Chart: Initial total + intermediate deltas + final total. Zero baseline.
    - Bar Chart: Magnitude comparison for discrete categories. Zero baseline.
    - Pie Chart: Part-to-whole, <= 5 categories.
    - Stacked Bar Chart: Part-to-whole composition across multiple periods/categories.
    - Treemap: Hierarchical data, proportional composition, > 10 categories; also the best available substitute for entity-profiling / multi-dimension comparisons (Spider/Radar-shaped intents) since the client has no radar chart.

    Every other taxonomy name (Spider Chart / Radar, Slopegraph, Gantt Chart, Dot Plot, Bullet Graph, Square Area Chart/Waffle, Unit Chart, Boxplot, Scatterplot, Bubble Chart, Sankey Diagram, Flow Chart, Choropleth Map, Data Table) is a real analytical concept but not a real client chart — if the data's shape matches one of these, pick the closest chart from the supported list above (Stacked Bar Chart or Treemap for multi-dimension/entity-profiling comparisons that would otherwise be a spider chart; Bar Chart for a ranked single metric that would otherwise be a bullet graph or dot plot) rather than the conceptually "purest" but unsupported type.
    `,
    prompt: `Intent: ${intent}\nData Metadata: ${JSON.stringify(metadata, null, 2)}`,
    schema: z.object({
      chartType: VisualizationTypeSchema,
      axesMapping: z.record(z.string(), z.string()).describe("Maps dataset columns to visual axes (e.g. x, y, color, size)"),
      stylisticOverrides: z.object({
        zeroBaseline: z.boolean().optional(),
        colorblindFriendly: z.boolean().optional(),
        other: z.record(z.string(), z.string()).optional(),
      }).optional(),
    }),
  });

  return object;
}
