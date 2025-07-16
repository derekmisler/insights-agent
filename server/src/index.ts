import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import * as dotenv from "dotenv";
import NodeCache from "node-cache";
import picocolors from "picocolors";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";

import { logo } from "./logo";

dotenv.config();

interface AuthConfig {
  type: "bearer" | "apikey" | "oauth2";
  token?: string;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
}

interface RateLimitConfig {
  points: number; // Number of requests
  duration: number; // Time window in seconds
  blockDuration: number; // Block duration in seconds after limit exceeded
}

// Custom error type for rate limiting
class RateLimitError extends Error {
  constructor(
    message: string,
    public remainingPoints: number,
    public msBeforeNext: number,
    public totalHits: number
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

class AuthenticatedAPIClient {
  private axiosInstance: AxiosInstance;
  private authConfig: AuthConfig;
  private baseURL: string;
  private rateLimiter: RateLimiterMemory;
  private cache: NodeCache;

  constructor(
    baseURL: string,
    authConfig: AuthConfig,
    rateLimitConfig?: RateLimitConfig
  ) {
    this.baseURL = baseURL;
    this.authConfig = authConfig;

    // Initialize rate limiter
    const defaultRateLimit = {
      points: parseInt(process.env.RATE_LIMIT_POINTS || "100"),
      duration: parseInt(process.env.RATE_LIMIT_DURATION || "60"),
      blockDuration: parseInt(process.env.RATE_LIMIT_BLOCK_DURATION || "60"),
    };

    this.rateLimiter = new RateLimiterMemory({
      keyPrefix: "api_calls",
      points: rateLimitConfig?.points || defaultRateLimit.points,
      duration: rateLimitConfig?.duration || defaultRateLimit.duration,
      blockDuration:
        rateLimitConfig?.blockDuration || defaultRateLimit.blockDuration,
    });

    // Initialize cache
    this.cache = new NodeCache({
      stdTTL: parseInt(process.env.CACHE_TTL || "300"), // 5 minutes default
      checkperiod: 60, // Check for expired keys every 60 seconds
    });

    this.axiosInstance = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "cagent-mcp-server/1.0",
      },
    });

    this.setupAuthInterceptor();
  }

  private setupAuthInterceptor() {
    this.axiosInstance.interceptors.request.use(
      async (config) => {
        await this.addAuthHeaders(config);
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          if (this.authConfig.type === "oauth2") {
            await this.refreshOAuth2Token();
            return this.axiosInstance.request(error.config);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private async addAuthHeaders(config: any) {
    switch (this.authConfig.type) {
      case "bearer":
        if (this.authConfig.token) {
          config.headers["Authorization"] = `Bearer ${this.authConfig.token}`;
        }
        break;
      case "apikey":
        if (this.authConfig.apiKey) {
          config.headers["X-API-Key"] = this.authConfig.apiKey;
        }
        break;
      case "oauth2":
        const token = await this.getOAuth2Token();
        if (token) {
          config.headers["Authorization"] = `Bearer ${token}`;
        }
        break;
    }
  }

  private async getOAuth2Token(): Promise<string | null> {
    return process.env.OAUTH2_ACCESS_TOKEN || null;
  }

  private async refreshOAuth2Token(): Promise<void> {
    if (
      !this.authConfig.tokenUrl ||
      !this.authConfig.clientId ||
      !this.authConfig.clientSecret
    ) {
      throw new Error("OAuth2 configuration incomplete");
    }

    try {
      const response = await axios.post(this.authConfig.tokenUrl, {
        grant_type: "client_credentials",
        client_id: this.authConfig.clientId,
        client_secret: this.authConfig.clientSecret,
      });

      process.env.OAUTH2_ACCESS_TOKEN = response.data.access_token;
    } catch (error) {
      throw new Error(`OAuth2 token refresh failed: ${error}`);
    }
  }

  private generateCacheKey(
    method: string,
    endpoint: string,
    data?: any
  ): string {
    const dataHash = data ? JSON.stringify(data) : "";
    return `${method}:${endpoint}:${dataHash}`;
  }

  async makeRequest(
    method: string,
    endpoint: string,
    data?: any,
    useCache = true
  ): Promise<any> {
    const requestKey = `${this.baseURL}:${endpoint}`;

    try {
      // Check rate limit
      await this.rateLimiter.consume(requestKey);

      // Check cache for GET requests
      if (useCache && method.toUpperCase() === "GET") {
        const cacheKey = this.generateCacheKey(method, endpoint, data);
        const cachedResult = this.cache.get(cacheKey);
        if (cachedResult) {
          return {
            ...cachedResult,
            cached: true,
            timestamp: new Date().toISOString(),
          };
        }
      }

      // Make the actual request
      const response: AxiosResponse = await this.axiosInstance.request({
        method: method.toUpperCase(),
        url: endpoint,
        data,
      });

      const result = {
        status: response.status,
        headers: response.headers,
        data: response.data,
        cached: false,
        timestamp: new Date().toISOString(),
      };

      // Cache successful GET requests
      if (
        useCache &&
        method.toUpperCase() === "GET" &&
        response.status === 200
      ) {
        const cacheKey = this.generateCacheKey(method, endpoint, data);
        this.cache.set(cacheKey, result);
      }

      return result;
    } catch (error: unknown) {
      // Handle rate limit errors
      if (error && typeof error === "object" && "remainingPoints" in error) {
        const rateLimitError = error as any; // Type assertion for rate limiter error
        const resetTime = new Date(Date.now() + rateLimitError.msBeforeNext);
        return {
          status: 429,
          error: "Rate limit exceeded",
          message: `Rate limit exceeded. Try again at ${resetTime.toISOString()}`,
          retryAfter: rateLimitError.msBeforeNext,
          remainingPoints: rateLimitError.remainingPoints,
        };
      }

      // Handle Axios errors
      if (axios.isAxiosError(error) && error.response) {
        return {
          status: error.response.status,
          error: error.response.data,
          message: `API call failed: ${error.response.status} ${error.response.statusText}`,
        };
      }

      // Handle other errors
      throw error;
    }
  }

  async getRateLimitStatus(): Promise<any> {
    const requestKey = `${this.baseURL}:status`;

    // Get rate limit info without making an actual request
    const rateLimiterInfo = this.rateLimiter.points;

    try {
      const res: RateLimiterRes | null = await this.rateLimiter.get(requestKey);

      return {
        remainingPoints: res ? res.remainingPoints : rateLimiterInfo,
        msBeforeNext: res ? res.msBeforeNext : 0,
        totalHits: res ? rateLimiterInfo - res.remainingPoints : 0,
        maxPoints: rateLimiterInfo,
        resetTime: res
          ? new Date(Date.now() + res.msBeforeNext).toISOString()
          : null,
      };
    } catch (error) {
      // Return default values immediately if there's an error
      return {
        remainingPoints: rateLimiterInfo,
        msBeforeNext: 0,
        totalHits: 0,
        maxPoints: rateLimiterInfo,
        resetTime: null,
      };
    }
  }

  clearCache(pattern?: string): number {
    if (pattern) {
      const keys = this.cache.keys();
      const matchingKeys = keys.filter((key) => key.includes(pattern));
      let deletedCount = 0;
      matchingKeys.forEach((key) => {
        if (this.cache.del(key)) deletedCount++;
      });
      return deletedCount;
    } else {
      this.cache.flushAll();
      return -1; // Indicate all cache cleared
    }
  }
}

// Initialize the API client
const authConfig: AuthConfig = {
  type: (process.env.AUTH_TYPE as "bearer" | "apikey" | "oauth2") || "bearer",
  token: process.env.DOCKER_ACCESS_TOKEN || process.env.API_TOKEN,
  apiKey: process.env.API_KEY,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  tokenUrl: process.env.TOKEN_URL,
};
if (!process.env.DOCKER_HUB_ORIGIN) {
  throw new Error("DOCKER_HUB_ORIGIN is not set");
}
const apiClient = new AuthenticatedAPIClient(
  process.env.DOCKER_HUB_ORIGIN,
  authConfig
);

// Create MCP server
const server = new Server(
  {
    name: "authenticated-api-server",
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
    name: "api_call",
    description: "Make authenticated API calls with rate limiting and caching",
    inputSchema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
          description: "HTTP method",
        },
        endpoint: {
          type: "string",
          description: "API endpoint (e.g., /users, /orders/123)",
        },
        data: {
          type: "object",
          description: "Request payload for POST/PUT/PATCH requests",
        },
        useCache: {
          type: "boolean",
          description:
            "Whether to use caching for GET requests (default: true)",
          default: true,
        },
      },
      required: ["method", "endpoint"],
    },
  },
  {
    name: "validate_auth",
    description: "Validate current authentication status",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "rate_limit_status",
    description: "Check current rate limit status",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "clear_cache",
    description: "Clear cached responses",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Optional pattern to match cache keys (clears all if not provided)",
        },
      },
    },
  },
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "api_call":
        const {
          method,
          endpoint,
          data,
          useCache = true,
        } = args as {
          method: string;
          endpoint: string;
          data?: any;
          useCache?: boolean;
        };

        const result = await apiClient.makeRequest(
          method,
          endpoint,
          data,
          useCache
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };

      case "validate_auth":
        const testResult = await apiClient.makeRequest("GET", "/health");

        return {
          content: [
            {
              type: "text",
              text:
                testResult.status === 200
                  ? "Authentication is valid"
                  : `Authentication failed: ${testResult.message}`,
            },
          ],
        };

      case "rate_limit_status":
        const rateLimitStatus = await apiClient.getRateLimitStatus();

        return {
          content: [
            {
              type: "text",
              text: `Rate Limit Status:
      - Remaining: ${rateLimitStatus.remainingPoints}/${
                rateLimitStatus.maxPoints
              } requests
      - Reset: ${rateLimitStatus.resetTime || "No reset needed"}
      - Current usage: ${rateLimitStatus.totalHits} requests used`,
            },
          ],
        };

      case "clear_cache":
        const { pattern } = args as { pattern?: string };
        const clearedCount = apiClient.clearCache(pattern);

        return {
          content: [
            {
              type: "text",
              text:
                clearedCount === -1
                  ? "All cache cleared"
                  : `Cleared ${clearedCount} cache entries`,
            },
          ],
        };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
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
  console.log(picocolors.cyan(logo));
}

main().catch((error) => {
  console.error(picocolors.bold(picocolors.red("Server error:")), error);
  process.exit(1);
});
