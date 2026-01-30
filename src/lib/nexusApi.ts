/**
 * Nexus API Module | Nexus API 模块
 * 包含流式请求、重试机制、双阶段调用、错误处理
 */

import { DEFAULT_API_BASE_URL } from '@/utils/constants'
import { ERROR_MESSAGES, MODELS, NEXUS_SYSTEM_PROMPT } from '@/config/nexusPrompt'
import { resolveEndpointUrl } from '@/lib/workflow/request'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// 根据环境选择 fetch 实现（Windows Tauri 必须用插件 fetch）
const safeFetch = isTauri ? tauriFetch : globalThis.fetch

// ==================== 类型定义 ====================

export type ErrorType = 'network' | 'auth' | 'rate_limit' | 'server' | 'unknown'

export interface ClassifiedError {
  type: ErrorType
  message: string
  retryable: boolean
  status?: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TwoStageParams {
  input: ChatMessage[]
  useThinking: boolean
  useWebSearch: boolean
  signal?: AbortSignal
}

// ==================== 工具函数 ====================

const getApiKey = (): string => {
  try {
    return localStorage.getItem('apiKey') || ''
  } catch {
    return ''
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ==================== API Key 检查 ====================

export function checkApiKey(): { ok: boolean; message?: string } {
  const apiKey = getApiKey()
  if (!apiKey) {
    return { ok: false, message: '未配置 API Key，请先在设置中配置' }
  }
  if (apiKey.length < 10) {
    return { ok: false, message: 'API Key 格式不正确' }
  }
  return { ok: true }
}

// ==================== 错误分类 ====================

export function classifyError(error: unknown): ClassifiedError {
  const err = error as any
  const message = err?.message || String(error)
  const status = err?.status || err?.response?.status

  // 网络错误
  if (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('Network request failed') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('fetch')
  ) {
    return {
      type: 'network',
      message: ERROR_MESSAGES['Failed to fetch'] || '网络连接失败',
      retryable: true,
      status
    }
  }

  // 超时
  if (message.includes('timeout') || message.includes('Timeout')) {
    return {
      type: 'network',
      message: ERROR_MESSAGES['timeout'] || '请求超时',
      retryable: true,
      status
    }
  }

  // 认证错误
  if (
    status === 401 ||
    message.includes('Unauthorized') ||
    message.includes('Invalid API key') ||
    message.includes('API key')
  ) {
    return {
      type: 'auth',
      message: ERROR_MESSAGES['Unauthorized'] || 'API Key 无效',
      retryable: false,
      status: 401
    }
  }

  // 速率限制
  if (status === 429 || message.includes('Rate limit') || message.includes('Too Many')) {
    return {
      type: 'rate_limit',
      message: ERROR_MESSAGES['429'] || '请求过于频繁',
      retryable: true,
      status: 429
    }
  }

  // 服务端错误
  if (status >= 500 || message.includes('500') || message.includes('502') || message.includes('503')) {
    return {
      type: 'server',
      message: ERROR_MESSAGES[String(status)] || '服务器错误，请稍后重试',
      retryable: true,
      status
    }
  }

  // 内容策略
  if (message.includes('content_policy') || message.includes('content_filter')) {
    return {
      type: 'unknown',
      message: ERROR_MESSAGES['content_policy'] || '内容不符合安全策略',
      retryable: false
    }
  }

  // 默认
  return {
    type: 'unknown',
    message: ERROR_MESSAGES['default'] || '请求失败',
    retryable: false
  }
}

// ==================== 响应解析 ====================

const extractTextFromResponsesOutput = (output: unknown): string => {
  if (!Array.isArray(output)) return ''
  let text = ''
  for (const item of output as any[]) {
    const content = (item as any)?.content
    if (typeof content === 'string') {
      text += content
      continue
    }
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (typeof part === 'string') {
        text += part
        continue
      }
      if (typeof (part as any)?.text === 'string') text += (part as any).text
    }
  }
  return text
}

export const extractTextFromResponses = (resp: any): string => {
  if (!resp) return ''
  if (typeof resp.output_text === 'string') return resp.output_text
  const outputText = extractTextFromResponsesOutput(resp.output)
  if (outputText) return outputText
  const msg = resp?.choices?.[0]?.message?.content
  if (typeof msg === 'string') return msg
  if (Array.isArray(msg)) return msg.map((m: any) => m?.text || m).filter(Boolean).join('')
  return ''
}

const parseResponsesStreamEvent = (parsed: any): { kind: 'delta' | 'full' | 'unknown'; text: string } => {
  if (!parsed || typeof parsed !== 'object') return { kind: 'unknown', text: '' }
  if (typeof parsed.delta === 'string') return { kind: 'delta', text: parsed.delta }
  const chatDelta = parsed?.choices?.[0]?.delta?.content
  if (typeof chatDelta === 'string') return { kind: 'delta', text: chatDelta }
  if (typeof parsed.output_text === 'string') return { kind: 'full', text: parsed.output_text }
  if (typeof parsed?.response?.output_text === 'string') return { kind: 'full', text: parsed.response.output_text }
  const fullFromOutput = extractTextFromResponsesOutput(parsed.output || parsed?.response?.output)
  if (fullFromOutput) return { kind: 'full', text: fullFromOutput }
  return { kind: 'unknown', text: '' }
}

// ==================== 基础流式请求 ====================

export const streamResponses = async function* (data: any, signal?: AbortSignal): AsyncGenerator<string> {
  const apiKey = getApiKey()
  // Tauri 环境不使用 signal（Windows 兼容性问题）
  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...(data || {}), stream: true })
  }
  if (!isTauri && signal) {
    fetchOptions.signal = signal
  }
  const response = await safeFetch(resolveEndpointUrl('/responses'), fetchOptions)

  if (!response.ok) {
    const error = await response.json().catch(() => null)
    const errObj = new Error(error?.error?.message || error?.message || 'Responses stream request failed') as any
    errObj.status = response.status
    throw errObj
  }

  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  let iterations = 0
  const MAX_ITERATIONS = 10000

  while (true) {
    if (iterations++ > MAX_ITERATIONS) throw new Error('Stream timeout: exceeded maximum iterations')
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return

      try {
        const parsed = JSON.parse(payload)
        const { kind, text } = parseResponsesStreamEvent(parsed)
        if (!text) continue

        if (kind === 'delta') {
          accumulated += text
          yield text
          continue
        }

        if (kind === 'full') {
          if (text.startsWith(accumulated)) {
            const delta = text.slice(accumulated.length)
            accumulated = text
            if (delta) yield delta
          } else {
            accumulated = text
            yield text
          }
        }
      } catch {
        // ignore invalid json
      }
    }
  }
}

// ==================== 流式 Chat Completions ====================

export const streamChatCompletions = async function* (
  data: { model: string; messages: ChatMessage[]; tools?: any[] },
  signal?: AbortSignal
): AsyncGenerator<string> {
  const apiKey = getApiKey()
  // Tauri 环境不使用 signal（Windows 兼容性问题）
  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...data, stream: true })
  }
  if (!isTauri && signal) {
    fetchOptions.signal = signal
  }
  const response = await safeFetch(resolveEndpointUrl('/chat/completions'), fetchOptions)

  if (!response.ok) {
    let errorText = ''
    try {
      errorText = await response.text()
    } catch {
      errorText = ''
    }
    let errorJson: any = null
    if (errorText) {
      try {
        errorJson = JSON.parse(errorText)
      } catch {
        errorJson = null
      }
    }
    const message =
      errorJson?.error?.message || errorJson?.message || errorText || `Request failed (${response.status})`
    const errObj = new Error(message) as any
    errObj.status = response.status
    throw errObj
  }

  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  let iterations = 0
  const MAX_ITERATIONS = 10000

  while (true) {
    if (iterations++ > MAX_ITERATIONS) throw new Error('Stream timeout: exceeded maximum iterations')
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return

      try {
        const parsed = JSON.parse(payload)
        const content = parsed.choices?.[0]?.delta?.content
        if (content) yield content
      } catch {
        // ignore invalid json
      }
    }
  }
}

// ==================== 带重试的流式请求 ====================

export async function* streamWithRetry(
  endpoint: 'responses' | 'chat/completions',
  data: any,
  options: { maxRetries?: number; signal?: AbortSignal } = {}
): AsyncGenerator<string> {
  const { maxRetries = 2, signal } = options
  let lastError: any = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (endpoint === 'responses') {
        yield* streamResponses(data, signal)
      } else {
        yield* streamChatCompletions(data, signal)
      }
      return // 成功则退出
    } catch (error: any) {
      lastError = error

      // 检查是否被中止
      if (signal?.aborted || error?.name === 'AbortError') {
        throw error
      }

      // 分类错误
      const classified = classifyError(error)

      // 不可重试的错误直接抛出
      if (!classified.retryable) {
        throw new Error(classified.message)
      }

      // 最后一次尝试失败
      if (attempt >= maxRetries) {
        throw new Error(classified.message)
      }

      // 等待后重试（指数退避：1s, 2s）
      const delay = (attempt + 1) * 1000
      console.log(`[NexusAPI] 重试 ${attempt + 1}/${maxRetries}，等待 ${delay}ms...`)
      await sleep(delay)
    }
  }

  // 不应该到达这里
  throw lastError || new Error('请求失败')
}

// ==================== 非流式 Chat Completions ====================

export async function chatCompletions(data: {
  model: string
  messages: ChatMessage[]
  tools?: any[]
}): Promise<string> {
  const apiKey = getApiKey()
  const response = await safeFetch(resolveEndpointUrl('/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(data)
  })

  if (!response.ok) {
    const error = await response.json().catch(() => null)
    const errObj = new Error(error?.error?.message || error?.message || 'Request failed') as any
    errObj.status = response.status
    throw errObj
  }

  const result = await response.json()
  return result?.choices?.[0]?.message?.content || ''
}

// ==================== 双阶段调用（思考模型 → 主模型）====================

export async function* twoStageStream(params: TwoStageParams): AsyncGenerator<string> {
  const { input, useThinking, useWebSearch, signal } = params

  // 检查 API Key
  const keyCheck = checkApiKey()
  if (!keyCheck.ok) {
    throw new Error(keyCheck.message)
  }

  // 如果不需要思考/联网，直接走主模型
  if (!useThinking && !useWebSearch) {
    // 直接使用调用方构建好的 messages（包含：系统提示词 + 记忆/画布上下文 + 历史）
    // 之前丢弃 system messages 会导致“记忆/检索/上下文工程失效”
    const messagesWithContext: ChatMessage[] = Array.isArray(input) ? input : []

    yield* streamWithRetry('chat/completions', {
      model: MODELS.CHAT,
      messages: messagesWithContext
    }, { maxRetries: 2, signal })
    return
  }

  // ========== 阶段 1：思考模型 ==========
  yield '🤔 正在深度思考'
  if (useWebSearch) yield '并搜索网络'
  yield '...\n\n'

  let thinkingResult = ''
  try {
    // 构建思考阶段的消息
    const thinkingMessages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个深度思考助手。请对用户的问题进行深入分析和思考。
${useWebSearch ? '如果需要，可以搜索网络获取最新信息。' : ''}
请返回你的分析结果，包括：
1. 问题理解
2. 关键信息
3. 推理过程
4. 建议回答方向`
      },
      // 保留 system blocks（记忆/画布上下文/系统提示词），否则思考阶段会“无上下文”
      ...(Array.isArray(input) ? input : [])
    ]

    for await (const chunk of streamWithRetry('chat/completions', {
      model: MODELS.THINKING,
      messages: thinkingMessages
    }, { maxRetries: 1, signal })) {
      thinkingResult += chunk
    }
  } catch (error) {
    // 思考阶段失败，降级到直接主模型回答
    console.warn('[NexusAPI] 思考阶段失败，降级处理:', error)
    yield '（深度思考暂不可用，直接回答）\n\n'
    
    const messagesWithIdentity: ChatMessage[] = [
      { role: 'system', content: NEXUS_SYSTEM_PROMPT },
      ...input.filter((m) => m.role !== 'system')
    ]
    
    yield* streamWithRetry('chat/completions', {
      model: MODELS.CHAT,
      messages: messagesWithIdentity
    }, { maxRetries: 2, signal })
    return
  }

  // ========== 阶段 2：主模型过滤和格式化 ==========
  yield '---\n\n'

  // 构建主模型消息：保留原始上下文（system + 记忆/画布 + 历史），并注入思考结果
  const original = Array.isArray(input) ? input : []
  const sys = original.filter((m) => m?.role === 'system')
  const rest = original.filter((m) => m?.role && m.role !== 'system')

  const finalMessages: ChatMessage[] = [
    ...sys,
    {
      role: 'system',
      content: `【深度思考结果】
${thinkingResult}

请基于以上思考结果，在不丢失【长期记忆】与【当前项目上下文】的前提下，给用户一个清晰、结构化的回答。
注意：
1. 不要提及"思考结果"或"分析"，直接回答用户
2. 保持 Nexus 的专业创意助手形象
3. 如有工具调用需求，按规范返回 JSON`
    },
    ...rest
  ]

  yield* streamWithRetry('chat/completions', {
    model: MODELS.CHAT,
    messages: finalMessages
  }, { maxRetries: 2, signal })
}

// ==================== AI 助手模型调用 ====================

/**
 * 过滤思考内容（如 <think>...</think> 或 ```thinking...```）
 */
export function filterThinkingContent(text: string): string {
  if (!text) return ''
  
  // 过滤 <think>...</think> 标签
  let result = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  
  // 过滤 <thinking>...</thinking> 标签
  result = result.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
  
  // 过滤 ```thinking...``` 代码块
  result = result.replace(/```thinking[\s\S]*?```/gi, '')
  
  // 过滤以 "思考过程：" 或 "思考：" 开头的段落
  result = result.replace(/^(思考过程|思考|Thinking|思维链)[:：][\s\S]*?(\n\n|\n(?=[^思\n]))/gim, '')
  
  // 清理多余的空行
  result = result.replace(/\n{3,}/g, '\n\n').trim()
  
  return result
}

/**
 * 调用 AI 助手模型（支持多种模型类型）
 * @param modelKey 模型标识符
 * @param messages 消息列表
 * @param options 可选参数
 */
export async function callAiAssistant(
  modelKey: string,
  messages: ChatMessage[],
  options: { signal?: AbortSignal; filterThinking?: boolean } = {}
): Promise<string> {
  const { signal, filterThinking = true } = options
  const apiKey = getApiKey()
  
  if (!apiKey) {
    throw new Error('未配置 API Key')
  }

  // 所有模型都通过代理统一使用 OpenAI 兼容格式
  const endpoint = resolveEndpointUrl('/chat/completions')
  
  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelKey,
      messages,
      stream: false
    })
  }
  
  if (!isTauri && signal) {
    fetchOptions.signal = signal
  }

  const response = await safeFetch(endpoint, fetchOptions)
  
  if (!response.ok) {
    let errorText = ''
    try {
      errorText = await response.text()
    } catch {
      errorText = ''
    }
    let errorJson: any = null
    if (errorText) {
      try {
        errorJson = JSON.parse(errorText)
      } catch {
        errorJson = null
      }
    }
    const message = errorJson?.error?.message || errorJson?.message || errorText || `Request failed (${response.status})`
    throw new Error(message)
  }

  const data = await response.json()
  let content = data?.choices?.[0]?.message?.content || ''
  
  // 过滤思考内容
  if (filterThinking && content) {
    content = filterThinkingContent(content)
  }
  
  return content
}

/**
 * 流式调用 AI 助手模型
 */
export async function* streamAiAssistant(
  modelKey: string,
  messages: ChatMessage[],
  options: { signal?: AbortSignal; filterThinking?: boolean } = {}
): AsyncGenerator<string> {
  const { signal, filterThinking = true } = options
  const apiKey = getApiKey()
  
  if (!apiKey) {
    throw new Error('未配置 API Key')
  }

  const endpoint = resolveEndpointUrl('/chat/completions')
  
  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelKey,
      messages,
      stream: true
    })
  }
  
  if (!isTauri && signal) {
    fetchOptions.signal = signal
  }

  const response = await safeFetch(endpoint, fetchOptions)
  
  if (!response.ok) {
    let errorText = ''
    try {
      errorText = await response.text()
    } catch {
      errorText = ''
    }
    throw new Error(errorText || `Request failed (${response.status})`)
  }

  const reader = response.body?.getReader()
  if (!reader) return
  
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let inThinkingBlock = false
  
  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') {
        // 流结束，如果需要过滤，对完整内容进行处理
        if (filterThinking && fullContent) {
          const filtered = filterThinkingContent(fullContent)
          // 如果过滤后内容不同，说明有思考内容被过滤
          // 这里我们已经实时过滤了，所以不需要额外处理
        }
        return
      }

      try {
        const parsed = JSON.parse(payload)
        const content = parsed.choices?.[0]?.delta?.content
        if (content) {
          // 实时检测并过滤思考标签
          if (filterThinking) {
            // 检测思考块的开始和结束
            if (content.includes('<think>') || content.includes('<thinking>')) {
              inThinkingBlock = true
            }
            if (content.includes('</think>') || content.includes('</thinking>')) {
              inThinkingBlock = false
              continue // 跳过结束标签
            }
            if (inThinkingBlock) {
              continue // 跳过思考内容
            }
          }
          fullContent += content
          yield content
        }
      } catch {
        // ignore invalid json
      }
    }
  }
}