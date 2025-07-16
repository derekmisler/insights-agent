// src/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

interface AuthConfig {
  type: 'bearer' | 'apikey' | 'oauth2';
  token?: string;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
}

class AuthenticatedAPIClient {
  private axiosInstance: AxiosInstance;
  private authConfig: AuthConfig;
  private baseURL: string;

  constructor(baseURL: string, authConfig: AuthConfig) {
    this.baseURL = baseURL;
    this.authConfig = authConfig;
    this.axiosInstance = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'cagent-mcp-server/1.0',
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

    // Handle auth errors
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          // Attempt token refresh for OAuth2
          if (this.authConfig.type === 'oauth2') {
            await this.refreshOAuth2Token();
            // Retry the original request
            return this.axiosInstance.request(error.config);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private async addAuthHeaders(config: any) {
    switch (this.authConfig.type) {
      case 'bearer':
        if (this.authConfig.token) {
          config.headers['Authorization'] = `Bearer ${this.authConfig.token}`;
        }
        break;
      case 'apikey':
        if (this.authConfig.apiKey) {
          config.headers['X-API-Key'] = this.authConfig.apiKey;
        }
        break;
      case 'oauth2':
        // OAuth2 token would be managed separately
        const token = await this.getOAuth2Token();
        if (token) {
          config.headers['Authorization'] = `Bearer ${token}`;
        }
        break;
    }
  }

  private async getOAuth2Token(): Promise<string | null> {
    // Implementation depends on your OAuth2 flow
    // This is a simplified example
    return process.env.OAUTH2_ACCESS_TOKEN || null;
  }

  private async refreshOAuth2Token(): Promise<void> {
    if (!this.authConfig.tokenUrl || !this.authConfig.clientId || !this.authConfig.clientSecret) {
      throw new Error('OAuth2 configuration incomplete');
    }

    try {
      const response = await axios.post(this.authConfig.tokenUrl, {
        grant_type: 'client_credentials',
        client_id: this.authConfig.clientId,
        client_secret: this.authConfig.clientSecret,
      });

      // Store the new token (in a real app, you'd persist this)
      process.env.OAUTH2_ACCESS_TOKEN = response.data.access_token;
    } catch (error) {
      throw new Error(`OAuth2 token refresh failed: ${error}`);
    }
  }

  async makeRequest(method: string, endpoint: string, data?: any): Promise<any> {
    try {
      const response: AxiosResponse = await this.axiosInstance.request({
        method: method.toUpperCase(),
        url: endpoint,
        data,
      });

      return {
        status: response.status,
        headers: response.headers,
        data: response.data,
      };
    } catch (error: any) {
      if (error.response) {
        return {
          status: error.response.status,
          error: error.response.data,
          message: `API call failed: ${error.response.status} ${error.response.statusText}`,
        };
      }
      throw error;
    }
  }
}

// Initialize the API client
const authConfig: AuthConfig = {
  type: (process.env.AUTH_TYPE as 'bearer' | 'apikey' | 'oauth2') || 'bearer',
  token: process.env.BEARER_TOKEN || process.env.API_TOKEN,
  apiKey: process.env.API_KEY,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  tokenUrl: process.env.TOKEN_URL,
};

const apiClient = new AuthenticatedAPIClient(
  process.env.API_BASE_URL || 'https://api.example.com',
  authConfig
);

// Create MCP server
const server = new Server(
  {
    name: 'authenticated-api-server',
    version: '1.0.0',
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
    name: 'api_call',
    description: 'Make authenticated API calls to external services',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          description: 'HTTP method',
        },
        endpoint: {
          type: 'string',
          description: 'API endpoint (e.g., /users, /orders/123)',
        },
        data: {
          type: 'object',
          description: 'Request payload for POST/PUT/PATCH requests',
        },
      },
      required: ['method', 'endpoint'],
    },
  },
  {
    name: 'validate_auth',
    description: 'Validate current authentication status',
    inputSchema: {
      type: 'object',
      properties: {},
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
      case 'api_call':
        const { method, endpoint, data } = args as {
          method: string;
          endpoint: string;
          data?: any;
        };

        const result = await apiClient.makeRequest(method, endpoint, data);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };

      case 'validate_auth':
        // Make a simple test call to validate auth
        const testResult = await apiClient.makeRequest('GET', '/health');

        return {
          content: [
            {
              type: 'text',
              text: testResult.status === 200
                ? 'Authentication is valid'
                : `Authentication failed: ${testResult.message}`,
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
          type: 'text',
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
  console.error('Authenticated API MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});