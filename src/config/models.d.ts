export type AnyModel = {
  label: string
  key: string
  endpoint: string
  authMode?: 'bearer' | 'query'
  format?: string
  tips?: string
  sizes?: any[]
  qualities?: any[]
  ratios?: any[]
  durs?: any[]
  defaultParams?: Record<string, any>
  maxImages?: number
  statusEndpoint?: any
  endpointImage?: string
  statusEndpointImage?: any
}

export const IMAGE_MODELS: AnyModel[]
export const VIDEO_MODELS: AnyModel[]
export const CHAT_MODELS: AnyModel[]

export const DEFAULT_IMAGE_MODEL: string
export const DEFAULT_VIDEO_MODEL: string
export const DEFAULT_CHAT_MODEL: string

