import ansiRegex from 'ansi-regex'
import type {
  ClientFilterOptions,
  ClientFormatOptions,
  LogEntry,
} from './types'

const ansiPattern = ansiRegex()

export function stripAnsi(text: string): string {
  return text.replace(ansiPattern, '')
}

export function formatLog(
  entry: LogEntry,
  options: ClientFormatOptions,
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
    prefix += `[${entry.timestamp}] `
  }
  if (options.log_type) {
    prefix += `[${entry.type}] `
  }

  return `${prefix}${message}`
}

export function shouldIncludeLog(
  entry: LogEntry,
  filter: ClientFilterOptions<true>,
): boolean {
  if (filter.log_type !== 'all' && filter.log_type !== entry.type) {
    return false
  }
  if (
    filter.text &&
    !entry.message.toLowerCase().includes(filter.text.toLowerCase())
  ) {
    return false
  }
  if (filter.regex && !filter.regex.test(entry.message)) {
    return false
  }
  return true
}

export function parseRegexString(regexStr?: string): RegExp | null {
  if (regexStr) {
    const regexMatch = regexStr.match(/^\/(.*)\/([gimsuvy]*)$/)

    if (regexMatch) {
      const [, pattern, flags] = regexMatch

      return new RegExp(pattern, flags)
    }

    return new RegExp(regexStr)
  }

  return null
}
