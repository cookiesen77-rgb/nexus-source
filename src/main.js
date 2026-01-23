/**
 * Main entry point | 主入口
 */
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'

const app = createApp(App)

const MAX_LOG_CHARS = 4000
const MAX_ARG_CHARS = 1200
const MAX_CONTEXT_CHARS = 1600
const MAX_STRING_CHARS = 500
const DATA_URL_RE = /data:image\/[^;]+;base64,[a-z0-9+/=]+/gi

const sanitizeText = (text, maxLen = MAX_LOG_CHARS) => {
  let output = typeof text === 'string' ? text : String(text || '')
  if (output.includes('data:image') || output.includes('base64,')) {
    output = output.replace(DATA_URL_RE, '[data-url omitted]')
  }
  if (output.length > maxLen) {
    const extra = output.length - maxLen
    output = `${output.slice(0, maxLen)}...[truncated ${extra} chars]`
  }
  return output
}

const safeStringify = (value, maxLen = MAX_ARG_CHARS) => {
  if (typeof value !== 'object' || value === null) {
    return sanitizeText(String(value), maxLen)
  }

  const seen = new WeakSet()
  const depthMap = new WeakMap()
  const maxDepth = 2

  const replacer = function (key, val) {
    if (typeof val === 'string') {
      return val.length > MAX_STRING_CHARS ? `${val.slice(0, MAX_STRING_CHARS)}...` : val
    }
    if (val && typeof val === 'object') {
      if (seen.has(val)) return '[Circular]'
      seen.add(val)
      const parentDepth = depthMap.get(this) || 0
      const nextDepth = parentDepth + 1
      depthMap.set(val, nextDepth)
      if (nextDepth > maxDepth) return '[Object]'
    }
    return val
  }

  try {
    return sanitizeText(JSON.stringify(value, replacer), maxLen)
  } catch {
    return sanitizeText(String(value), maxLen)
  }
}

const reportFrontendLog = async (level, message, context) => {
  try {
    const { isTauri, invoke } = await import('@tauri-apps/api/core')
    if (!isTauri()) return
    const safeMessage = sanitizeText(message, MAX_LOG_CHARS)
    const safeContext = context ? safeStringify(context, MAX_CONTEXT_CHARS) : null
    const payload = {
      level,
      message: safeMessage,
      context: safeContext
    }
    await invoke('log_frontend', payload)
  } catch {
    // ignore logging failures
  }
}

const formatLogArgs = (args) => {
  const parts = args
    .map((arg) => {
      if (typeof arg === 'string') return sanitizeText(arg, MAX_ARG_CHARS)
      if (arg instanceof Error) return sanitizeText(arg.message || 'Error', MAX_ARG_CHARS)
      if (arg && typeof arg === 'object') return safeStringify(arg, MAX_ARG_CHARS)
      return sanitizeText(String(arg), MAX_ARG_CHARS)
    })
    .filter(Boolean)

  return sanitizeText(parts.join(' '), MAX_LOG_CHARS)
}

const originalConsoleError = console.error
console.error = (...args) => {
  originalConsoleError(...args)
  const message = formatLogArgs(args)
  if (message) reportFrontendLog('error', message)
}

const originalConsoleWarn = console.warn
console.warn = (...args) => {
  originalConsoleWarn(...args)
  const message = formatLogArgs(args)
  if (message) reportFrontendLog('warn', message)
}

// Global error handlers | 全局错误兜底（避免页面“白屏/崩溃”无提示）
let hasNotifiedGlobalError = false
const notifyGlobalError = (message) => {
  if (hasNotifiedGlobalError) return
  hasNotifiedGlobalError = true
  try {
    window.$message?.error(message)
  } catch {
    // ignore
  }
}

app.config.errorHandler = (err, instance, info) => {
  console.error('Vue error:', err, info)
  reportFrontendLog('error', err?.message || 'Vue error', { info, stack: err?.stack })
  notifyGlobalError('页面发生异常（建议刷新页面后重试）')
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason)
  reportFrontendLog('error', event.reason?.message || String(event.reason || 'Unhandled rejection'), {
    stack: event.reason?.stack
  })
  notifyGlobalError('请求发生异常（建议稍后重试或刷新页面）')
})

window.addEventListener('error', (event) => {
  // Some errors are noisy; keep only console here to avoid spam
  console.error('Global error:', event.error || event.message)
  reportFrontendLog('error', event.message || 'Global error', {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack
  })
})

app.use(router)
app.mount('#app')
