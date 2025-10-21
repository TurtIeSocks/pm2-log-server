import io from '@pm2/io'
import pm2 from 'pm2'
import { name } from '../package.json'
import { LogManager } from './log-manager'
import { LogServer } from './server'
import type { Packet, PluginConfig, ProcessInfo } from './types'

class PM2LogServerPlugin {
  private logManager: LogManager
  private server: LogServer
  private config = io.getConfig() as PluginConfig
  private bus: any

  constructor() {
    this.logManager = new LogManager(this.config.logBufferSize)
    this.server = new LogServer(this.logManager, this.config)
  }

  async start(): Promise<void> {
    console.log('Starting PM2 Log Server Plugin...')
    console.log('Configuration:', JSON.stringify(this.config, null, 2))

    // Get list of processes and register them
    await this.refreshProcesses()

    // Launch PM2 bus to listen for logs
    await this.setupBusListeners()

    // Start web server
    await this.server.start()

    // Graceful shutdown
    process.on('SIGINT', () => this.shutdown())
    process.on('SIGTERM', () => this.shutdown())
  }

  private async setupBusListeners(): Promise<void> {
    return new Promise((resolve, reject) => {
      pm2.launchBus((err, bus) => {
        if (err) {
          reject(err)
          return
        }

        this.bus = bus

        // Listen for stdout logs
        bus.on('log:out', (packet: Packet) => {
          if (packet.process.name === name) {
            return // Skip our own logs
          }

          this.logManager.handleLog(packet.process.pm_id, 'out', packet.data)
        })

        // Listen for stderr logs
        bus.on('log:err', (packet: Packet) => {
          if (packet.process.name === name) {
            return // Skip our own logs
          }

          this.logManager.handleLog(packet.process.pm_id, 'error', packet.data)
        })

        // Listen for process events
        bus.on('process:event', (packet: Packet) => {
          const { event, process } = packet

          if (process.name === name) {
            return // Skip our own process
          }

          switch (event) {
            case 'start':
            case 'restart':
            case 'online':
            case 'exception':
              // Register the process when it starts
              setTimeout(() => this.refreshProcesses(), 500)
              break

            case 'stop':
            case 'delete':
            case 'exit':
            case 'kill':
              // Unregister the process when it stops
              this.logManager.unregisterProcess(process.name, process.pm_id)
              break
          }
        })

        console.log('PM2 bus listeners configured')
        resolve()
      })
    })
  }

  private async refreshProcesses(): Promise<void> {
    return new Promise((resolve, reject) => {
      pm2.list((err, processes) => {
        if (err) {
          console.error('Failed to list PM2 processes:', err)
          reject(err)
          return
        }

        processes.forEach((proc, i) => {
          // Skip this plugin itself
          if (proc.name === name) {
            return
          }

          // Only register running processes
          if (proc.pm2_env && proc.pm2_env.status === 'online') {
            const processInfo: ProcessInfo = {
              name: proc.name || `Unknown Process ${i}`,
              pm_id: proc.pm_id || i,
              status: proc.pm2_env.status,
            }

            this.logManager.registerProcess(processInfo)
          }
        })

        resolve()
      })
    })
  }

  private shutdown(): void {
    console.log('\nShutting down PM2 Log Server...')

    if (this.bus) {
      this.bus.close()
    }

    this.logManager.cleanup()
    pm2.disconnect()
    process.exit(0)
  }
}

io.initModule({}, async (err: Error) => {
  if (err) {
    console.error('Failed to init plugin:', err)
    process.exit(1)
  }

  try {
    const plugin = new PM2LogServerPlugin()
    await plugin.start()
  } catch (err) {
    console.error('Failed to start plugin:', err)
    process.exit(1)
  }
})
