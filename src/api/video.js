/**
 * Video API | 视频生成 API
 */

import { request } from '@/utils'

// 创建视频任务
export const createVideoTask = (data, options = {}) => {
  const { endpoint = '/videos', authMode, requestType = 'formdata' } = options
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData

  const headers = requestType === 'formdata' && !isFormData
    ? { 'Content-Type': 'multipart/form-data' }
    : {}

  return request({
    url: endpoint,
    method: 'post',
    data,
    authMode,
    headers
  })
}

// 查询视频任务状态
export const getVideoTaskStatus = (taskId, options = {}) => {
  const { statusEndpoint, authMode, params } = options
  const url = statusEndpoint
    ? (typeof statusEndpoint === 'function' ? statusEndpoint(taskId) : statusEndpoint)
    : `/videos/${taskId}`
  const query = { ...(params || {}) }
  if (statusEndpoint && typeof statusEndpoint === 'string' && query.id === undefined) {
    query.id = taskId
  }
  return request({
    url,
    method: 'get',
    params: Object.keys(query).length > 0 ? query : undefined,
    authMode
  })
}

// 轮询视频任务直到完成
export const pollVideoTask = async (taskId, maxAttempts = 120, interval = 5000) => {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await getVideoTaskStatus(taskId)

    if (result.status === 'completed' || result.data) {
      return result
    }

    if (result.status === 'failed') {
      throw new Error(result.error?.message || '视频生成失败')
    }

    await new Promise(resolve => setTimeout(resolve, interval))
  }

  throw new Error('视频生成超时')
}
