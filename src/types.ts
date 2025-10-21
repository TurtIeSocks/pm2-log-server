import type { IOConfig } from '@pm2/io/build/main/pmx'

export interface PluginConfig extends IOConfig {
  port: number
  host: string
  corsEnabled: boolean
  logBufferSize: number
  authToken: string
}

export interface ProcessInfo {
  name: string
  pm_id: number
  status: string
}

export interface LogEntry {
  timestamp: string
  type: 'out' | 'error'
  message: string
  process: string
}

export interface ClientOptions {
  filter: 'all' | 'out' | 'error'
  clean: boolean
  json: boolean
  timestamps: boolean
  log_type: boolean
}

export interface Packet {
  process: {
    name: string
    pm_id: number
    version?: string
    restart_time?: number
    unstable_restarts?: number
  }
  event?:
    | 'kill'
    | 'exception'
    | 'restart'
    | 'exit'
    | 'delete'
    | 'start'
    | 'stop'
    | 'online'
    | 'restart overlimit'
  data: string | object
  at: number
}

export interface WebSocketMessage {
  type: 'auth' | 'subscribe' | 'unsubscribe' | 'options' | 'ping'
  token?: string
  process?: string
  options?: Partial<ClientOptions>
}
