import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import type { LogManager } from './log-manager'
import type { PluginConfig, LogEntry, LogClient, LogFilter } from './types'

export class LogServer {
  private app: express.Application
  private logManager: LogManager
  private config: PluginConfig
  private clients: Map<string, Set<LogClient>> = new Map()

  constructor(logManager: LogManager, config: PluginConfig) {
    this.app = express()
    this.logManager = logManager
    this.config = config
    this.setupMiddleware()
    this.setupRoutes()
    this.setupLogHandlers()
  }

  private setupMiddleware(): void {
    if (this.config.corsEnabled) {
      this.app.use(cors())
    }

    this.app.use(express.json())

    // Auth middleware
    // if (this.config.authToken) {
    //   this.app.use((req: Request, res: Response, next: NextFunction) => {
    //     const token = req.headers.authorization?.replace('Bearer ', '')
    //     if (token !== this.config.authToken) {
    //       return res.status(401).json({ error: 'Unauthorized' })
    //     }
    //     next()
    //   })
    // }
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() })
    })

    // List all processes
    this.app.get('/processes', (req: Request, res: Response) => {
      const processes = this.logManager.getWatchedProcesses()
      res.json({ processes, count: processes.length })
    })

    // Get recent logs for a process
    this.app.get('/logs/:name/recent', (req: Request, res: Response) => {
      const { name } = req.params
      const count = req.query.count
        ? parseInt(req.query.count as string, 10)
        : undefined

      const logs = this.logManager.getRecentLogs(name, count)

      if (logs.length === 0) {
        return res.status(404).json({
          error: 'Process not found or no logs available',
          process: name,
        })
      }

      res.json({ process: name, logs, count: logs.length })
    })

    // Stream logs for a process (SSE)
    this.app.get('/logs/:name', (req, res) => this.handleSSE(req, res))
    this.app.get('/logs/:name/:filter', (req, res) => this.handleSSE(req, res))

    // Stream all logs (SSE)
    this.app.get('/logs', (req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const allProcesses = this.logManager.getWatchedProcesses()
      const clientEntry: LogClient = { res, filter: 'all' }
      // const clientId = Math.random().toString(36).substring(7)

      // Add to all process clients
      allProcesses.forEach((name) => {
        const processClients = this.clients.get(name) || new Set()
        processClients.add(clientEntry)
        this.clients.set(name, processClients)
      })

      req.on('close', () => {
        allProcesses.forEach((name) => {
          const processClients = this.clients.get(name)
          if (processClients) {
            processClients.delete(clientEntry)
            if (processClients.size === 0) {
              this.clients.delete(name)
            }
          }
        })
      })

      const keepAlive = setInterval(() => {
        res.write('ping:\n\n')
      }, 30000)

      req.on('close', () => {
        clearInterval(keepAlive)
      })
    })
  }

  private handleSSE(req: Request, res: Response) {
    const { name, filter: rawFilter } = req.params
    const processes = this.logManager.getWatchedProcesses()
    const filter = (rawFilter || 'all') as LogFilter
    const clientEntry = { res, filter }

    if (!processes.includes(name)) {
      return res.status(404).json({
        error: 'Process not found',
        process: name,
        available: processes,
      })
    }

    // Check max clients
    const processClients = this.clients.get(name) || new Set()
    if (processClients.size >= this.config.maxClients) {
      return res.status(503).json({
        error: 'Maximum clients reached for this process',
        maxClients: this.config.maxClients,
      })
    }

    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    // Send recent logs first
    const recentLogs = this.logManager.getRecentLogs(name, 50)
    recentLogs.forEach((log) => this.sendSSE(clientEntry, log))

    // Add client to set
    processClients.add(clientEntry)
    this.clients.set(name, processClients)

    // Handle client disconnect
    req.on('close', () => {
      processClients.delete(clientEntry)
      if (processClients.size === 0) {
        this.clients.delete(name)
      }
    })

    // Keep alive ping every 30 seconds
    const keepAlive = setInterval(() => {
      res.write(':ping\n\n')
    }, 30000)

    req.on('close', () => {
      clearInterval(keepAlive)
    })
  }

  private setupLogHandlers(): void {
    this.logManager.on('log', (name: string, entry: LogEntry) => {
      const clients = this.clients.get(name)
      if (clients) {
        clients.forEach((client) => {
          this.sendSSE(client, entry)
        })
      }
    })
  }

  private sendSSE(client: LogClient, entry: LogEntry): void {
    if (client.filter !== 'all' && client.filter !== entry.type) {
      return
    }

    const data = this.config.includeTimestamp
      ? `[${entry.timestamp}] [${entry.type}] ${entry.message}`
      : `[${entry.type}] ${entry.message}`

    client.res.write(
      `data: ${JSON.stringify({ ...entry, formatted: data })}\n\n`
    )
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.config.port, this.config.host, () => {
        console.log(
          `PM2 Log Streamer running on http://${this.config.host}:${this.config.port}`
        )
        console.log(`Endpoints:`)
        console.log(`  GET /health - Health check`)
        console.log(`  GET /processes - List watched processes`)
        console.log(`  GET /logs/:name - Stream logs for a process (SSE)`)
        console.log(
          `  GET /logs/:name/:filter - Stream logs for a process (SSE) with a filter ('all' | 'out' | 'error')`
        )
        console.log(`  GET /logs/:name/recent - Get recent logs (JSON)`)
        console.log(`  GET /logs - Stream all logs (SSE)`)
        resolve()
      })
    })
  }
}
