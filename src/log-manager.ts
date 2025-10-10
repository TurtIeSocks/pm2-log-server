import { EventEmitter } from 'events'
import { LogEntry, ProcessInfo } from './types'

export class LogManager extends EventEmitter {
  private watchedProcesses: Set<string> = new Set()
  private logBuffers: Map<string, LogEntry[]> = new Map()
  private bufferSize: number
  private processIdToName: Map<number, string> = new Map()

  constructor(bufferSize: number = 100) {
    super()
    this.bufferSize = bufferSize
  }

  registerProcess(processInfo: ProcessInfo): void {
    const { name, pm_id } = processInfo

    this.watchedProcesses.add(name)
    this.processIdToName.set(pm_id, name)

    // Initialize buffer for this process
    if (!this.logBuffers.has(name)) {
      this.logBuffers.set(name, [])
    }

    console.log(`Registered process: ${name} (PM2 ID: ${pm_id})`)
  }

  unregisterProcess(name: string, pm_id?: number): void {
    this.watchedProcesses.delete(name)
    if (pm_id !== undefined) {
      this.processIdToName.delete(pm_id)
    }
    console.log(`Unregistered process: ${name}`)
  }

  handleLog(pm_id: number, type: 'out' | 'error', data: string): void {
    const name = this.processIdToName.get(pm_id)

    if (!name || !this.watchedProcesses.has(name)) {
      return
    }

    // Split multi-line logs
    const lines = data
      .toString()
      .split('\n')
      .filter((line) => line.trim())

    lines.forEach((line) => {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        type,
        message: line,
        process: name,
      }

      this.addToBuffer(name, entry)
      this.emit('log', name, entry)
    })
  }

  private addToBuffer(name: string, entry: LogEntry): void {
    const buffer = this.logBuffers.get(name) || []
    buffer.push(entry)

    // Keep buffer size limited
    if (buffer.length > this.bufferSize) {
      buffer.shift()
    }

    this.logBuffers.set(name, buffer)
  }

  getRecentLogs(name: string, count?: number): LogEntry[] {
    const buffer = this.logBuffers.get(name) || []
    if (count) {
      return buffer.slice(-count)
    }
    return [...buffer]
  }

  getWatchedProcesses(): string[] {
    return Array.from(this.watchedProcesses)
  }

  getProcessByPmId(pm_id: number): string | undefined {
    return this.processIdToName.get(pm_id)
  }

  cleanup(): void {
    this.watchedProcesses.clear()
    this.processIdToName.clear()
    this.logBuffers.clear()
  }
}
