import ansiRegex from 'ansi-regex'
import type { ClientOptions, LogEntry } from './types'

const ansiPattern = ansiRegex()

export function stripAnsi(text: string): string {
  return text.replace(ansiPattern, '')
}

export function formatLog(
  entry: LogEntry,
  options: ClientOptions,
): string {
  const message = options.clean ? stripAnsi(entry.message) : entry.message

  if (options.json) {
    return JSON.stringify({
      timestamp: entry.timestamp,
      type: entry.type,
      message,
      process: entry.process,
    })
  }

  let prefix = ''
  if (options.timestamps) {
    prefix+= `[${entry.timestamp}] `
  }
  if (options.log_type) {
    prefix += `[${entry.type}] `
  }

  return `${prefix}${message}`
}

export function shouldIncludeLog(
  entry: LogEntry,
  filter: 'all' | 'out' | 'error',
): boolean {
  if (filter === 'all') {
    return true
  }
  return entry.type === filter
}
