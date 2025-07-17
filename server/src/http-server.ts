import express, { Request, Response } from "express";
import cors from "cors";
import axios from "axios";

// Session cache for reusing sessions (speeds up subsequent requests)
let cachedSessionId: string | null = null;
let sessionCreatedAt: number = 0;
const SESSION_REUSE_TIME = 5 * 60 * 1000; // Reuse session for 5 minutes

// Function to communicate with AI agent via cagent API server
async function communicateWithAgent(data: any): Promise<any> {
  try {
        // Convert the received data to a JSON string for the agent prompt (optimized for speed)
    const dataString = JSON.stringify(data);
    let prompt: string;

    if (!data || Object.keys(data).length === 0 || dataString === '{}') {
      prompt = "Provide Docker Desktop insights and recommendations.";
    } else {
      prompt = `Analyze this data and provide Docker insights: ${dataString}`;
    }

        const selectedAgent = 'agent.yaml'; // Use the actual agent name from the API

    // Step 1: Get or create a session (with caching for speed)
    let sessionId: string;
    const now = Date.now();

    if (cachedSessionId && (now - sessionCreatedAt) < SESSION_REUSE_TIME) {
      // Reuse existing session
      sessionId = cachedSessionId;
      console.log(`Reusing session: ${sessionId}`);
    } else {
      // Create new session
      const sessionResponse = await axios.post('http://localhost:8080/api/sessions', {}, {
        timeout: 5000, // Reduced from 10s to 5s
        headers: {
          'Content-Type': 'application/json'
        }
      });

      sessionId = sessionResponse.data.id;
      cachedSessionId = sessionId;
      sessionCreatedAt = now;
      console.log(`Created new session: ${sessionId}`);
    }

    // Step 2: Send message to the session and handle streaming response
    const response = await axios.post(`http://localhost:8080/api/sessions/${sessionId}/agent/${selectedAgent}`, [
      {
        role: "user",
        content: prompt,
      },
    ], {
      timeout: 15000, // Reduced from 30s to 15s for faster failure detection
      headers: {
        'Content-Type': 'application/json'
      },
      responseType: 'text' // Handle as text to parse SSE manually
    });

    // Parse the SSE response to extract the content
    const sseData = response.data;
    let fullResponse = '';

    // Extract content from SSE data lines
    const lines = sseData.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const jsonData = JSON.parse(line.substring(6));
          if (jsonData.choice && jsonData.choice.delta && jsonData.choice.delta.content) {
            fullResponse += jsonData.choice.delta.content;
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    }

    return {
      agentResponse: fullResponse.trim() || "Agent responded but no content was extracted",
      success: true
    };
  } catch (error: any) {
    console.error("Error communicating with agent:", error);
    let errorMessage = "Unknown error";

    if (error.code === 'ECONNREFUSED') {
      errorMessage = "Cannot connect to cagent API server. Make sure it's running on localhost:8080";
    } else if (error.response) {
      errorMessage = `API server responded with ${error.response.status}: ${error.response.statusText}`;
    } else {
      errorMessage = error.message || String(error);
    }

    return {
      agentResponse: `Error communicating with agent: ${errorMessage}`,
      success: false
    };
  }
}

// Create Express app
const app = express();
const PORT = process.env.HTTP_PORT || 3001;

// Middleware
app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:5173", "http://localhost:8080"], // Common dev server ports
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "docker-insights-api-server"
  });
});

// Captain Insights endpoint that receives POST data and communicates with AI agent
app.post("/api/captain-insights", async (req: Request, res: Response) => {
  try {
    console.log("Received request:", JSON.stringify(req.body, null, 2));

    // Communicate with AI agent via cagent
    console.log("Communicating with AI agent...");
    const agentResult = await communicateWithAgent(req.body);

    const response = {
      received: req.body,
      agentAnalysis: agentResult.agentResponse,
      timestamp: new Date().toISOString(),
      success: agentResult.success,
      message: agentResult.success ? "Request processed by AI agent" : "AI agent communication failed"
    };

    res.json(response);

  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
      success: false
    });
  }
});

// Start the server
function startHttpServer(): void {
  app.listen(PORT, () => {
    console.log(`Docker Insights HTTP server running on http://localhost:${PORT}`);
    console.log(`\nIMPORTANT: Make sure to start the cagent API server first:`);
    console.log(`  ./cagent api agent.yaml`);
    console.log(`  (This should start the agent API on localhost:8080)`);
    console.log(`\nAvailable endpoints:`);
    console.log(`  GET /health - Health check`);
    console.log(`  POST /api/captain-insights - Receives POST data and communicates with AI agent`);
    console.log(`\nExample usage:`);
    console.log(`  curl -X POST -H "Content-Type: application/json" -d '{"message":"hello"}' "http://localhost:${PORT}/api/captain-insights"`);
    console.log(`  curl -X POST -H "Content-Type: application/json" -d '{"metric":"users","timespan":"1h","token":"abc123"}' "http://localhost:${PORT}/api/captain-insights"`);
  });
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Gracefully shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Gracefully shutting down...');
  process.exit(0);
});

// Start the server
startHttpServer();