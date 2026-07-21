import { generateObject } from "ai";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { VisualizationTypeSchema } from "../render-payload";

export async function runVisualizationMappingAgent(intent: string, metadata: Record<string, any>) {
  const { object } = await generateObject({
    model: openai("gpt-4o"),
    system: `You are the Visualization Mapping Agent. Your sole objective is to map the statistical properties of the data and the semantic intent of the user's query against a codified taxonomy of visualization principles. 
    You must output a configuration payload dictating the exact chart type, the data axes mappings, and specific stylistic overrides.
    
    Visualization Taxonomy:
    - Line Graph: Continuous temporal data, trend analysis.
    - Area Chart: Cumulative volume/magnitude over time.
    - Slopegraph: Exactly 2 chronological points across multiple categories, relative rate of change.
    - Waterfall Chart: Initial total + intermediate deltas + final total. Zero baseline.
    - Gantt Chart: Start timestamps, end timestamps, task entities.
    - Bar Chart: Magnitude comparison for discrete categories. Zero baseline.
    - Dot Plot: Discrete categories, values tightly clustered far from zero.
    - Bullet Graph: Compare single metric vs target/benchmark.
    - Data Table: Absolute precision or mixed/incompatible units.
    - Pie Chart: Part-to-whole, <= 5 categories.
    - Stacked Bar Chart: Part-to-whole composition across multiple periods/categories.
    - Square Area Chart (Waffle): Precise part-to-whole percentage distribution.
    - Treemap: Hierarchical data, proportional composition, > 10 categories.
    - Unit Chart: Humanize data, discrete populations.
    - Boxplot: Statistical distribution, technical audience.
    - Scatterplot: Two continuous numerical columns, correlation identification.
    - Bubble Chart: Three continuous numerical columns, multivariate correlation (map value to Area).
    - Spider Chart (Radar): Entity profiling across multiple distinct quantitative dimensions.
    - Sankey Diagram: Tracking resource flow, division, or pipeline conversion.
    - Flow Chart: Documenting logical decision trees or qualitative procedures.
    - Choropleth Map: Geospatial data, normalized rate/percentage.
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
