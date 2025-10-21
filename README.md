# PM2 Log Server Plugin

A PM2 plugin that streams application logs via WebSocket using the native PM2 bus API.

## Features

- 🔄 Real-time log streaming via WebSocket
- 🔐 Built-in authentication support
- 📊 Dynamic process subscriptions
- 🎯 Advanced filtering options:
  - Filter by log level (all/out/error)
  - Strip ANSI color codes
  - JSON or plain text output
- 💾 Configurable log buffering
- 🌐 CORS support for REST endpoints
- 📝 Both stdout and stderr streaming
- ⚡ Zero file I/O - uses PM2's in-memory event bus
- 🔌 Automatic process detection and registration

## Advantages of Using PM2 Bus API + WebSocket

### PM2 Bus Benefits:
- **Real-time performance**: Direct event stream from PM2, no file I/O latency
- **Lower resource usage**: No file watchers, no disk reads
- **Reliable**: Works even if log files are rotated, deleted, or disabled
- **Simpler**: No need to handle file paths, permissions, or rotation
- **Consistent**: Gets logs exactly as PM2 processes them

### WebSocket Benefits:
- **Bidirectional**: Clients can send filtering options and receive logs
- **Authentication**: Built-in token authentication in the protocol
- **Dynamic filtering**: Change filters without reconnecting
- **Efficient**: Lower overhead than SSE for high-frequency updates
- **Flexible**: Subscribe/unsubscribe to specific processes on demand

## Installation

```bash
npm install
npm run build
```

## Usage

### Start with PM2

```bash
pm2 start ecosystem.config.js
```

## Configuration

This plugin has several configurable values that you must set using PM2's build in commands.

```bash
  pm2 set pm2-log-server:authToken some-secure-token
  pm2 set pm2-log-server:corsEnabled false
  pm2 set pm2-log-server:host 0.0.0.0
  pm2 set pm2-log-server:logBufferSize 100
  pm2 set pm2-log-server:port 9615
```


## WebSocket Protocol

Connect to: `ws://localhost:9615/ws`

### Message Types

#### 1. Authentication (if token is configured)
```json
{
  "type": "auth",
  "token": "your-secret-token"
}
```

Response:
```json
{
  "type": "authenticated",
  "message": "Authentication successful"
}
```

#### 2. Subscribe to Process
```json
{
  "type": "subscribe",
  "process": "my-app"
}
```

Subscribe to all processes:
```json
{
  "type": "subscribe",
  "process": "*"
}
```

Response:
```json
{
  "type": "subscribed",
  "process": "my-app",
  "subscriptions": ["my-app"]
}
```

#### 3. Set Options
```json
{
  "type": "options",
  "options": {
    "filter": "error",
    "clean": true,
    "json": false
  }
}
```

Options:
- `filter`: `"all"` | `"out"` | `"error"` - Filter logs by type (default: "all")
- `clean`: `boolean` - Strip ANSI color codes (default: false)
- `json`: `boolean` - Return logs as JSON objects (default: true)
- `timestamps`: `boolean` - Prefixes the raw log message with a timestamp
- `log_type`: `boolean` - Prefixes the raw log with the log type (`error` | `out`)

Response:
```json
{
  "type": "options_updated",
  "options": {
    "filter": "error",
    "clean": true,
    "json": false,
    "timestamps": false,
    "log_type": false
  }
}
```

#### 4. Unsubscribe from Process
```json
{
  "type": "unsubscribe",
  "process": "my-app"
}
```

Unsubscribe from all:
```json
{
  "type": "unsubscribe"
}
```

#### 5. Ping/Pong
```json
{
  "type": "ping"
}
```

Response:
```json
{
  "type": "pong"
}
```

### Receiving Logs

When `json: true` (default):
```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "type": "out",
  "message": "Server started on port 3000",
  "process": "my-app"
}
```

When `json: false`:
```
Server started on port 3000
```

Or with timestamp (if `includeTimestamp` is enabled):
```
[2025-01-15T10:30:00.000Z] [out] Server started on port 3000
```

## REST API Endpoints

### GET /health
Health check endpoint

```bash
curl http://localhost:9615/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "clients": 3
}
```

### GET /processes
List all watched PM2 processes

```bash
curl -H "Authorization: Bearer your-token" http://localhost:9615/processes
```

Response:
```json
{
  "processes": ["my-app", "worker", "api"],
  "count": 3
}
```

### GET /logs/:name/recent
Get recent logs as JSON

```bash
curl -H "Authorization: Bearer your-token" \
  "http://localhost:9615/logs/my-app/recent?count=10&filter=error&clean=true"
```

Query parameters:
- `count`: Number of recent logs to retrieve
- `filter`: `all` | `out` | `error`
- `clean`: `true` | `false` - Strip ANSI codes

Response:
```json
{
  "process": "my-app",
  "logs": [
    {
      "timestamp": "2025-01-15T10:30:00.000Z",
      "type": "error",
      "message": "Connection failed",
      "process": "my-app"
    }
  ],
  "count": 1
}
```

## Client Examples

### Node.js Client

```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:9615/ws');

ws.on('open', () => {
  console.log('Connected to PM2 Log Server');
  
  // Authenticate (if required)
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'your-secret-token'
  }));
  
  // Set filter
  ws.send(
    JSON.stringify({
      type: 'filter',
      filter: { log_type: 'all',  text: '', regex: '/abc/gi' },
    })
  )

  // Set format
  ws.send(
    JSON.stringify({
      type: 'format',
      format: { clean: false, json: false, timestamps: false, log_type: false },
    })
  )
  
  // Subscribe to a process
  ws.send(JSON.stringify({
    type: 'subscribe',
    process: 'my-app'
  }));
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data);
    
    if (message.type) {
      // Control message
      console.log('Control:', message);
    } else {
      // Log entry
      console.log('Log:', message);
    }
  } catch (e) {
    // Plain text log
    console.log('Log:', data.toString());
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', () => {
  console.log('Disconnected from PM2 Log Server');
});
```

### Browser Client

```javascript
const ws = new WebSocket('ws://localhost:9615/ws');

ws.addEventListener('open', () => {
  console.log('Connected');
  
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'your-secret-token'
  }));
  
  // Subscribe to all processes
  ws.send(JSON.stringify({
    type: 'subscribe',
    process: '*'
  }));
});

ws.addEventListener('message', (event) => {
  try {
    const message = JSON.parse(event.data);
    console.log('Message:', message);
  } catch (e) {
    // Plain text log
    console.log('Log:', event.data);
  }
});

ws.addEventListener('error', (error) => {
  console.error('Error:', error);
});

ws.addEventListener('close', () => {
  console.log('Disconnected');
});
```

## License

MIT