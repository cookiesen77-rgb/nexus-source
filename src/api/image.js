/**
 * Image API | 图片生成 API
 */

import { request, DEFAULT_API_BASE_URL } from '@/utils'

// 不需要 /v1 前缀的路径
const noV1Prefixes = ['/tencent-vod', '/kling', '/v1beta', '/v1/', '/video/']

// 构建完整 URL（处理特殊前缀）
const buildUrl = (endpoint) => {
  if (!endpoint) return ''
  if (/^https?:\/\//i.test(endpoint)) return endpoint
  
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  
  // 如果路径以特殊前缀开头，使用 origin 而不是带 /v1 的 base
  if (noV1Prefixes.some(p => path.startsWith(p))) {
    try {
      const origin = new URL(DEFAULT_API_BASE_URL).origin
      return `${origin}${path}`
    } catch {
      // fallback
    }
  }
  
  // 其他路径使用默认 base URL
  return endpoint
}

// 生成图片
export const generateImage = (data, options = {}) => {
  const { requestType = 'json', endpoint = '/images/generations', authMode, timeout } = options
  const url = buildUrl(endpoint)
  
  return request({
    url,
    method: 'post',
    data,
    authMode,
    timeout,
    headers: requestType === 'formdata' ? { 'Content-Type': 'multipart/form-data' } : {}
  })
}
