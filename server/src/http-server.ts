import express, { Request, Response } from "express";
import cors from "cors";
import axios from "axios";

// Function to communicate with AI agent via cagent API server
async function communicateWithAgent(data: any): Promise<any> {
  try {
    // Convert the received data to a JSON string for the agent prompt
    const dataString = JSON.stringify(data, null, 2);
    const prompt = `I received the following data from the UI: ${dataString}. Please analyze this data and provide insights.`;

    // Communicate with cagent API server on localhost:8080
    const response = await axios.post('http://localhost:8080/api/chat', {
      message: prompt,
      agent: 'root'
    }, {
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return {
      agentResponse: response.data.response || response.data.message || JSON.stringify(response.data),
      success: true
    };
  } catch (error: any) {
    console.error("Error communicating with agent:", error);
    let errorMessage = "Unknown error";

    if (error.code === 'ECONNREFUSED') {
      errorMessage = "Cannot connect to cagent API server. Make sure it's running on localhost:8080";
    } else if (error.response) {
      errorMessage = `API server responded with ${error.response.status}: ${error.response.data}`;
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