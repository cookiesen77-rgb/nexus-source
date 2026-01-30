import { create } from 'zustand'

const API_KEY_STORAGE_KEY = 'apiKey'
const THEME_STORAGE_KEY = 'nexus-theme-v1'
const DEFAULT_IMAGE_MODEL_KEY = 'nexus-default-image-model'
const DEFAULT_VIDEO_MODEL_KEY = 'nexus-default-video-model'
const AI_ASSISTANT_MODEL_KEY = 'nexus-ai-assistant-model'
const REGENERATE_MODE_KEY = 'nexus-regenerate-mode'

// AI 助手模型配置（通过代理统一使用 OpenAI 兼容格式）
export const AI_ASSISTANT_MODELS = [
  { key: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { key: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { key: 'doubao-seed-1-8-251228-thinking', label: 'Doubao Seed (思考)' },
] as const

export type RegenerateMode = 'replace' | 'create'

type SettingsState = {
  apiKey: string
  dark: boolean
  defaultImageModel: string
  defaultVideoModel: string
  aiAssistantModel: string
  regenerateMode: RegenerateMode
  setApiKey: (value: string) => void
  clearApiKey: () => void
  toggleDark: () => void
  setDefaultImageModel: (model: string) => void
  setDefaultVideoModel: (model: string) => void
  setAiAssistantModel: (model: string) => void
  setRegenerateMode: (mode: RegenerateMode) => void
}

const readApiKey = () => {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

const readDark = () => {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (raw === 'dark') return true
    if (raw === 'light') return false
    // 默认浅色模式
    return false
  } catch {
    return false
  }
}

const readDefaultImageModel = () => {
  try {
    return localStorage.getItem(DEFAULT_IMAGE_MODEL_KEY) || ''
  } catch {
    return ''
  }
}

const readDefaultVideoModel = () => {
  try {
    return localStorage.getItem(DEFAULT_VIDEO_MODEL_KEY) || ''
  } catch {
    return ''
  }
}

const readAiAssistantModel = () => {
  try {
    return localStorage.getItem(AI_ASSISTANT_MODEL_KEY) || 'gpt-5-mini'
  } catch {
    return 'gpt-5-mini'
  }
}

const readRegenerateMode = (): RegenerateMode => {
  try {
    const raw = localStorage.getItem(REGENERATE_MODE_KEY)
    if (raw === 'replace' || raw === 'create') return raw
    return 'create' // 默认新建模式
  } catch {
    return 'create'
  }
}

const applyTheme = (dark: boolean) => {
  try {
    document.documentElement.classList.toggle('dark', dark)
  } catch {
    // ignore
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  apiKey: readApiKey(),
  dark: readDark(),
  defaultImageModel: readDefaultImageModel(),
  defaultVideoModel: readDefaultVideoModel(),
  aiAssistantModel: readAiAssistantModel(),
  regenerateMode: readRegenerateMode(),
  setApiKey: (value) => {
    const next = String(value || '')
    try {
      localStorage.setItem(API_KEY_STORAGE_KEY, next)
    } catch {
      // ignore
    }
    set({ apiKey: next })
  },
  clearApiKey: () => {
    try {
      localStorage.removeItem(API_KEY_STORAGE_KEY)
    } catch {
      // ignore
    }
    set({ apiKey: '' })
  },
  toggleDark: () => {
    const next = !get().dark
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light')
    } catch {
      // ignore
    }
    applyTheme(next)
    set({ dark: next })
  },
  setDefaultImageModel: (model) => {
    const next = String(model || '')
    try {
      localStorage.setItem(DEFAULT_IMAGE_MODEL_KEY, next)
    } catch {
      // ignore
    }
    set({ defaultImageModel: next })
  },
  setDefaultVideoModel: (model) => {
    const next = String(model || '')
    try {
      localStorage.setItem(DEFAULT_VIDEO_MODEL_KEY, next)
    } catch {
      // ignore
    }
    set({ defaultVideoModel: next })
  },
  setAiAssistantModel: (model) => {
    const next = String(model || 'gpt-5-mini')
    try {
      localStorage.setItem(AI_ASSISTANT_MODEL_KEY, next)
    } catch {
      // ignore
    }
    set({ aiAssistantModel: next })
  },
  setRegenerateMode: (mode) => {
    const next = mode === 'replace' ? 'replace' : 'create'
    try {
      localStorage.setItem(REGENERATE_MODE_KEY, next)
    } catch {
      // ignore
    }
    set({ regenerateMode: next })
  }
}))

// Initialize theme once on import | 初始化主题（只做一次）
applyTheme(readDark())
