import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import * as dotenv from "dotenv";

dotenv.config();

class DockerInsightsAPIClient {
  private axiosInstance: AxiosInstance;
  private token: string;
  private baseURL: string;

  constructor() {
    this.token = process.env.BEARER_TOKEN || "";
    this.baseURL = process.env.DOCKER_INSIGHTS_API_HOST || "https://api.docker.com";

    // Add validation
    if (!this.token) {
      console.error("Warning: BEARER_TOKEN environment variable not set");
    }
    if (!this.baseURL) {
      console.error("Warning: DOCKER_INSIGHTS_API_HOST environment variable not set");
    }

    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        "User-Agent": "docker-insights-agent/1.0",
      },
    });
  }

  async getDesktopMetric(metric: string, timespan: string = "3m"): Promise<any> {
    const validMetrics = ["users", "images", "extensions", "builds", "runs", "usage"];

    if (!validMetrics.includes(metric)) {
      throw new Error(
        `Invalid metric: ${metric}. Valid metrics are: ${validMetrics.join(", ")}`
      );
    }

    const endpoint = `/v2/admin-insights/orgs/docker/desktop/${metric}/summary?timespan=${timespan}`;

    try {
      const response = await this.axiosInstance.get(endpoint);

      return {
        status: response.status,
        metric,
        timespan,
        data: response.data,
        timestamp: new Date().toISOString(),
        success: true,
      };
    } catch (error: any) {
      if (error.response) {
        return {
          status: error.response.status,
          metric,
          timespan,
          error: error.response.data,
          message: `API call failed: ${error.response.status} ${error.response.statusText}`,
          timestamp: new Date().toISOString(),
          success: false,
        };
      }
      throw error;
    }
  }

  async getAllDesktopMetrics(timespan: string = "3m"): Promise<any> {
    const metrics = ["users", "images", "extensions", "builds", "runs", "usage"];
    const results: any = {
      timespan,
      timestamp: new Date().toISOString(),
      metrics: {},
    };

    // Get all metrics sequentially to avoid rate limiting
    for (const metric of metrics) {
      try {
        const result = await this.getDesktopMetric(metric, timespan);
        results.metrics[metric] = result;
      } catch (error) {
        results.metrics[metric] = {
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
          success: false,
        };
      }
    }

    return results;
  }
}

// Initialize the API client
const apiClient = new DockerInsightsAPIClient();

// Create MCP server
const server = new Server(
  {
    name: "docker-insights-api-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
const tools: Tool[] = [
  {
    name: "get_desktop_metric",
    description: "Get a specific Docker Desktop metric",
    inputSchema: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: ["users", "images", "extensions", "builds", "runs", "usage"],
          description: "The metric to retrieve",
        },
        timespan: {
          type: "string",
          description: "Time span for the metric (default: 3m)",
          default: "3m",
        },
      },
      required: ["metric"],
    },
  },
  {
    name: "get_all_desktop_metrics",
    description: "Get all Docker Desktop metrics for the dashboard",
    inputSchema: {
      type: "object",
      properties: {
        timespan: {
          type: "string",
          description: "Time span for all metrics (default: 3m)",
          default: "3m",
        },
      },
    },
  },
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error("Tools requested:", tools.map(t => t.name)); // Debug logging
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const { name, arguments: args } = request.params;
  console.error(`Tool called: ${name}`, args); // Debug logging

  try {
    switch (name) {
      case "get_desktop_metric":
        const { metric, timespan = "3m" } = args as {
          metric: string;
          timespan?: string;
        };

        const result = await apiClient.getDesktopMetric(metric, timespan);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };

      case "get_all_desktop_metrics":
        const { timespan: allTimespan = "3m" } = args as {
          timespan?: string;
        };

        const allResults = await apiClient.getAllDesktopMetrics(allTimespan);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(allResults, null, 2),
            },
          ],
        };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`Tool error: ${error}`); // Debug logging
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Docker Insights API MCP server running on stdio"); // Fixed: use stderr
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});