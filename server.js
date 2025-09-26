const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Store active SSE connections for real-time progress updates
const activeConnections = new Map();

// Map executionId -> workflowId
const executionToWorkflow = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// CORS middleware for ngrok and external requests
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    next();
});

// Hardcoded users (use consistent "email" field)
const users = [
  { email: process.env.user1_email, password: process.env.user1_pass },
  { email: process.env.user2_email, password: process.env.user2_pass },
  { email: process.env.user3_email, password: process.env.user3_pass },
  { email: process.env.user4_email, password: process.env.user4_pass },
  { email: process.env.user5_email, password: process.env.user5_pass }
];

// Login route
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  const user = users.find(
    (u) => u.email === email && u.password === password
  );

  if (user) {
    res.json({ success: true, message: "Login successful", email });
  } else {
    res.status(401).json({ success: false, message: "Invalid email or password" });
  }
});

// SSE endpoint for real-time progress updates
app.get('/progress/:workflowId', (req, res) => {
    const workflowId = req.params.workflowId;
    
    console.log(`🔗 New SSE connection for workflow: ${workflowId}`);
    
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Store the connection
    activeConnections.set(workflowId, res);
    
    // Send initial connection confirmation
    res.write(`data: ${JSON.stringify({
        type: 'connection',
        message: 'Connected to workflow progress stream',
        workflowId: workflowId,
        timestamp: new Date().toISOString()
    })}\n\n`);

    // Handle client disconnect
    req.on('close', () => {
        console.log(`❌ Client disconnected from workflow ${workflowId}`);
        activeConnections.delete(workflowId);
    });

    req.on('error', (err) => {
        console.error(`💥 SSE error for workflow ${workflowId}:`, err);
        activeConnections.delete(workflowId);
    });
});

app.post('/api/register-execution', (req, res) => {
    const { executionId, workflowId } = req.body;

    if (!executionId || !workflowId) {
        return res.status(400).json({ success: false, message: 'executionId and workflowId are required' });
    }

    executionToWorkflow.set(executionId, workflowId);
    console.log(`🔗 Registered executionId ${executionId} → workflowId ${workflowId}`);

    res.json({ success: true });
});

// Endpoint to receive progress updates from n8n
app.post('/api/workflow-progress', (req, res) => {
    let { workflowId, executionId, message, step, newMessage, status, progress } = req.body;

    // If only executionId is provided, map it to workflowId
    if (!workflowId && executionId) {
        workflowId = executionToWorkflow.get(executionId);
        console.log(`🔎 Mapped executionId ${executionId} → workflowId ${workflowId}`);
    }

    if (!workflowId) {
        console.warn(`⚠️ Could not resolve workflowId (executionId=${executionId || 'none'})`);
        return res.status(400).json({ success: false, message: 'workflowId could not be determined' });
    }    

    console.log(`📊 Progress update for ${workflowId}:`, { 
        step, 
        message: message?.substring(0, 50) + (message?.length > 50 ? '...' : ''), 
        status, 
        progress 
    });
    
    // Find the SSE connection for this workflow
    const connection = activeConnections.get(workflowId);
    
    if (connection) {
        try {
            let progressData = {
                type: status === 'completed' ? 'complete' : status === 'error' ? 'error' : 'progress',
                workflowId,
                message,
                step,
                newMessage,
                status,
                progress
            };
            
            if(status === 'error'){
                progressData.error_body = req.body.error_body
            }
            connection.write(`data: ${JSON.stringify(progressData)}\n\n`);
            
            console.log(`✅ Progress update sent to client for workflow ${workflowId}`);
            
            // If workflow is completed or errored, clean up connection after a delay
            if (status === 'completed' || status === 'error') {
                console.log(`🏁 Workflow ${workflowId} finished with status: ${status}`);
                setTimeout(() => {
                    try {
                        connection.end();
                        activeConnections.delete(workflowId);
                        console.log(`🧹 Connection cleaned up for workflow ${workflowId}`);
                    } catch (err) {
                        console.error(`Error cleaning up connection: ${err}`);
                    }
                }, 5000); // Give client time to process final message
            }
            
        } catch (error) {
            console.error('❌ Error sending SSE message:', error);
            activeConnections.delete(workflowId);
        }
    } else {
        console.log(`⚠️ No active connection found for workflow ${workflowId}`);
        console.log(`📍 Active connections: ${Array.from(activeConnections.keys()).join(', ') || 'None'}`);
    }
    
    res.status(200).json({ 
        received: true, 
        activeConnections: activeConnections.size,
        timestamp: new Date().toISOString(),
        workflowId: workflowId
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        server: 'Jobs Scraper Backend',
        activeConnections: activeConnections.size,
        activeWorkflows: Array.from(activeConnections.keys()),
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Debug endpoint to see active connections
app.get('/debug/connections', (req, res) => {
    res.json({
        activeConnections: activeConnections.size,
        workflowIds: Array.from(activeConnections.keys()),
        timestamp: new Date().toISOString()
    });
});

// Test endpoint to simulate progress updates (for testing without n8n)
app.post('/test/progress/:workflowId', (req, res) => {
    const workflowId = req.params.workflowId;
    const { step, message, status = 'running', progress = 0 } = req.body;
    
    console.log(`🧪 Test progress update for ${workflowId}`);
    
    // Forward to the main progress handler
    req.body.workflowId = workflowId;
    
    // Call the main progress endpoint logic
    const connection = activeConnections.get(workflowId);
    if (connection) {
        const progressData = {
            type: status === 'completed' ? 'complete' : status === 'error' ? 'error' : 'progress',
            workflowId,
            step: step || 'Test Step',
            message: message || 'Test progress message',
            status,
            progress,
            timestamp: new Date().toISOString()
        };
        
        connection.write(`data: ${JSON.stringify(progressData)}\n\n`);
        res.json({ sent: true, data: progressData });
    } else {
        res.json({ sent: false, reason: 'No active connection' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('💥 Server error:', err);
    res.status(500).json({ error: 'Internal server error', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Jobs Scraper Server running at http://localhost:${PORT}`);
    console.log(`📡 Ready to receive n8n progress updates at /api/workflow-progress`);
    console.log(`🔄 SSE endpoint available at /progress/:workflowId`);
    console.log(`🏥 Health check available at /health`);
    console.log(`🔧 Debug connections at /debug/connections`);
    console.log(`🧪 Test progress updates at POST /test/progress/:workflowId`);
    console.log(`📁 Serving static files from ./public/`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    
    // Close all active SSE connections
    for (const [workflowId, connection] of activeConnections) {
        try {
            connection.write(`data: ${JSON.stringify({
                type: 'error',
                message: 'Server shutting down',
                timestamp: new Date().toISOString()
            })}\n\n`);
            connection.end();
        } catch (err) {
            console.error(`Error closing connection for ${workflowId}:`, err);
        }
    }
    
    activeConnections.clear();
    console.log('✅ All connections closed. Goodbye!');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    
    // Close all active SSE connections
    for (const [workflowId, connection] of activeConnections) {
        try {
            connection.write(`data: ${JSON.stringify({
                type: 'error',
                message: 'Server shutting down',
                timestamp: new Date().toISOString()
            })}\n\n`);
            connection.end();
        } catch (err) {
            console.error(`Error closing connection for ${workflowId}:`, err);
        }
    }
    
    activeConnections.clear();
    console.log('✅ All connections closed. Goodbye!');
    process.exit(0);
});