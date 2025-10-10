
# PM2 Log Streamer Plugin

A PM2 plugin that streams application logs via HTTP Server-Sent Events (SSE).

## Features

- 🔄 Real-time log streaming via SSE
- 📊 Dynamic endpoints for each PM2 process
- 💾 Configurable log buffering
- 🔒 Optional authentication
- 🌐 CORS support
- 📝 Both stdout and stderr streaming
- 🎯 Filter logs by process name
- 📦 Recent logs API

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

### Environment Variables

- `PM2_LOG_STREAMER_PORT` - Server port (default: 9615)
- `PM2_LOG_STREAMER_HOST` - Server host (default: 0.0.0.0)
- `PM2_LOG_STREAMER_CORS` - Enable CORS (default: true)
- `PM2_LOG_STREAMER_MAX_CLIENTS` - Max concurrent clients per process (default: 50)
- `PM2_LOG_STREAMER_BUFFER_SIZE` - Log buffer size (default: 100)
- `PM2_LOG_STREAMER_AUTH_TOKEN` - Optional bearer token for authentication
- `PM2_LOG_STREAMER_LOG_LEVEL` - Log level: all, out, or error (default: all)

### API Endpoints

#### GET /health
Health check endpoint

#### GET /processes
List all watched PM2 processes

#### GET /logs/:name
Stream logs for a specific process (SSE)

Example:
```bash
curl -N http://localhost:9615/logs/my-app
```

#### GET /logs/:name/recent
Get recent logs as JSON

Example:
```bash
curl http://localhost:9615/logs/my-app/recent?count=10
```

#### GET /logs
Stream logs from all processes (SSE)

### Client Example (JavaScript)

```javascript
const eventSource = new EventSource('http://localhost:9615/logs/my-app');

eventSource.onmessage = (event) => {
  const log = JSON.parse(event.data);
  console.log(log.formatted);
};

eventSource.onerror = (error) => {
  console.error('Connection error:', error);
};
```

## License

MIT