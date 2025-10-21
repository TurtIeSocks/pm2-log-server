import cors from 'cors'
import express, { type Request, type Response } from 'express'
import { createServer, type Server as HTTPServer } from 'http'
import { WebSocket, WebSocketServer } from 'ws'
import type { LogManager } from './log-manager'
import type {
  ClientOptions,
  LogEntry,
  PluginConfig,
  WebSocketMessage,
} from './types'
import { formatLog, shouldIncludeLog, stripAnsi } from './utils'

interface ClientConnection {
  ws: WebSocket
  authenticated: boolean
  subscriptions: Set<string>
  options: ClientOptions
}

export class LogServer {
  private app: express.Application
  private httpServer: HTTPServer
  private wss: WebSocketServer
  private logManager: LogManager
  private config: PluginConfig
  private clients: Map<WebSocket, ClientConnection> = new Map()

  constructor(logManager: LogManager, config: PluginConfig) {
    this.app = express()
    this.httpServer = createServer(this.app)
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' })
    this.logManager = logManager
    this.config = config

    this.setupMiddleware()
    this.setupRoutes()
    this.setupWebSocket()
    this.setupLogHandlers()
  }

  private setupMiddleware(): void {
    if (this.config.corsEnabled) {
      this.app.use(cors())
    }
    this.app.use(express.json())

    this.app.use((req, res, next) => {
      if (this.config.authToken) {
        const token = req.headers.authorization?.replace('Bearer ', '')
        if (token !== this.config.authToken) {
          return res.status(401).json({ error: 'Unauthorized' })
        }
      }
      next()
    })
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        clients: this.clients.size,
      })
    })

    // List all processes
    this.app.get('/processes', (_req: Request, res: Response) => {
      const processes = this.logManager.getWatchedProcesses()
      res.json({ processes, count: processes.length })
    })

    // Get recent logs for a process
    this.app.get('/logs/:name/recent', (req: Request, res: Response) => {
      const { name } = req.params
      const count = req.query.count
        ? parseInt(req.query.count as string, 10)
        : undefined
      const filter = (req.query.filter as 'all' | 'out' | 'error') || 'all'
      const clean = req.query.clean === 'true'

      let logs = this.logManager.getRecentLogs(name, count)

      if (logs.length === 0) {
        return res.status(404).json({
          error: 'Process not found or no logs available',
          process: name,
        })
      }

      // Apply filter
      if (filter !== 'all') {
        logs = logs.filter((log) => shouldIncludeLog(log, filter))
      }

      // Apply clean
      if (clean) {
        logs = logs.map((log) => ({
          ...log,
          message: stripAnsi(log.message),
        }))
      }

      res.json({ process: name, logs, count: logs.length })
    })
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New WebSocket connection')

      const client: ClientConnection = {
        ws,
        authenticated: !this.config.authToken, // Auto-auth if no token required
        subscriptions: new Set(),
        options: {
          filter: 'all',
          clean: false,
          json: true,
          log_type: false,
          timestamps: false,
        },
      }

      this.clients.set(ws, client)

      // Send welcome message
      this.sendMessage(ws, {
        type: 'connected',
        message: 'Connected to PM2 Log Server',
        authRequired: !!this.config.authToken,
        processes: this.logManager.getWatchedProcesses(),
      })

      ws.on('message', (data: Buffer) => {
        this.handleMessage(ws, client, data)
      })

      ws.on('close', () => {
        console.log('WebSocket connection closed')
        this.clients.delete(ws)
      })

      ws.on('error', (error: Error) => {
        console.error('WebSocket error:', error)
        this.clients.delete(ws)
      })
    })
  }

  private handleMessage(
    ws: WebSocket,
    client: ClientConnection,
    data: Buffer,
  ): void {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString())

      switch (message.type) {
        case 'auth':
          this.handleAuth(ws, client, message)
          break

        case 'subscribe':
          this.handleSubscribe(ws, client, message)
          break

        case 'unsubscribe':
          this.handleUnsubscribe(ws, client, message)
          break

        case 'options':
          this.handleOptions(ws, client, message)
          break

        case 'ping':
          this.sendMessage(ws, { type: 'pong' })
          break

        default:
          this.sendMessage(ws, {
            type: 'error',
            message: 'Unknown message type',
          })
      }
    } catch (error) {
      console.error(error)
      this.sendMessage(ws, {
        type: 'error',
        message: 'Invalid message format',
      })
    }
  }

  private handleAuth(
    ws: WebSocket,
    client: ClientConnection,
    message: WebSocketMessage,
  ): void {
    if (!this.config.authToken) {
      this.sendMessage(ws, {
        type: 'error',
        message: 'Authentication not required',
      })
      return
    }

    if (message.token === this.config.authToken) {
      client.authenticated = true
      this.sendMessage(ws, {
        type: 'authenticated',
        message: 'Authentication successful',
      })
    } else {
      this.sendMessage(ws, {
        type: 'error',
        message: 'Invalid authentication token',
      })
      ws.close(1008, 'Unauthorized')
    }
  }

  private handleSubscribe(
    ws: WebSocket,
    client: ClientConnection,
    message: WebSocketMessage,
  ): void {
    if (!client.authenticated) {
      this.sendMessage(ws, {
        type: 'error',
        message: 'Not authenticated',
      })
      return
    }

    const processName = message.process

    if (!processName) {
      this.sendMessage(ws, {
        type: 'error',
        message: 'Process name required',
      })
      return
    }

    // Check if process exists
    const processes = this.logManager.getWatchedProcesses()

    if (processName !== '*' && !processes.includes(processName)) {
      this.sendMessage(ws, {
        type: 'error',
        message: `Process "${processName}" not found`,
        available: processes,
      })
      return
    }

    // Subscribe to process or all processes
    if (processName === '*') {
      processes.forEach((p) => client.subscriptions.add(p))
    } else {
      client.subscriptions.add(processName)
    }

    this.sendMessage(ws, {
      type: 'subscribed',
      process: processName,
      subscriptions: Array.from(client.subscriptions),
    })

    // Send recent logs for subscribed process(es)
    const targets = processName === '*' ? processes : [processName]
    targets.forEach((target) => {
      const recentLogs = this.logManager.getRecentLogs(target, 20)
      recentLogs.forEach((log) => {
        this.sendLog(ws, client, log)
      })
    })
  }

  private handleUnsubscribe(
    ws: WebSocket,
    client: ClientConnection,
    message: WebSocketMessage,
  ): void {
    if (!client.authenticated) {
      this.sendMessage(ws, {
        type: 'error',
        message: 'Not authenticated',
      })
      return
    }

    const processName = message.process

    if (!processName) {
      // Unsubscribe from all
      client.subscriptions.clear()
      this.sendMessage(ws, {
        type: 'unsubscribed',
        message: 'Unsubscribed from all processes',
      })
      return
    }

    if (processName === '*') {
      client.subscriptions.clear()
    } else {
      client.subscriptions.delete(processName)
    }

    this.sendMessage(ws, {
      type: 'unsubscribed',
      process: processName,
      subscriptions: Array.from(client.subscriptions),
    })
  }

  private handleOptions(
    ws: WebSocket,
    client: ClientConnection,
    message: WebSocketMessage,
  ): void {
    if (!client.authenticated) {
      this.sendMessage(ws, {
        type: 'error',
        message: 'Not authenticated',
      })
      return
    }

    if (message.options) {
      client.options = { ...client.options, ...message.options }
      this.sendMessage(ws, {
        type: 'options_updated',
        options: client.options,
      })
    }
  }

  private setupLogHandlers(): void {
    this.logManager.on('log', (name: string, entry: LogEntry) => {
      this.clients.forEach((client, ws) => {
        if (client.authenticated && client.subscriptions.has(name)) {
          this.sendLog(ws, client, entry)
        }
      })
    })
  }

  private sendLog(
    ws: WebSocket,
    client: ClientConnection,
    entry: LogEntry,
  ): void {
    if (!shouldIncludeLog(entry, client.options.filter)) {
      return
    }

    const formatted = formatLog(entry, client.options)

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(formatted)
    }
  }

  private sendMessage<T extends { type: string }>(
    ws: WebSocket,
    message: T,
  ): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, this.config.host, () => {
        console.log(
          `PM2 Log Server running on http://${this.config.host}:${this.config.port}`,
        )
        console.log(
          `WebSocket endpoint: ws://${this.config.host}:${this.config.port}/ws`,
        )
        console.log(`HTTP Endpoints:`)
        console.log(`  GET /health - Health check`)
        console.log(`  GET /processes - List watched processes`)
        console.log(`  GET /logs/:name/recent - Get recent logs (JSON)`)
        resolve()
      })
    })
  }
}
