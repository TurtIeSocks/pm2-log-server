import type { IOConfig } from '@pm2/io/build/main/pmx'
import type { Response } from 'express'

export interface PluginConfig extends IOConfig {
  port: number
  host: string
  corsEnabled: boolean
  maxClients: number
  logBufferSize: number
  includeTimestamp: boolean
  // authToken?: string
}

export interface ProcessInfo {
  name: string
  pm_id: number
  status?: string
  pm_out_log_path?: string
  pm_err_log_path?: string
}

export interface LogEntry {
  timestamp: string
  type: 'out' | 'error'
  message: string
  process: string
}

export interface Data {
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

export interface Message extends Data {
  buffer?: string[]
  data: string
}

export type LogFilter = LogEntry['type'] | 'all'

export type LogClient = { res: Response; filter: LogFilter }
