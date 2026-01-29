import { create } from 'zustand'

const API_KEY_STORAGE_KEY = 'apiKey'
const THEME_STORAGE_KEY = 'nexus-theme-v1'
const DEFAULT_IMAGE_MODEL_KEY = 'nexus-default-image-model'
const DEFAULT_VIDEO_MODEL_KEY = 'nexus-default-video-model'

type SettingsState = {
  apiKey: string
  dark: boolean
  defaultImageModel: string
  defaultVideoModel: string
  setApiKey: (value: string) => void
  clearApiKey: () => void
  toggleDark: () => void
  setDefaultImageModel: (model: string) => void
  setDefaultVideoModel: (model: string) => void
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
  }
}))

// Initialize theme once on import | 初始化主题（只做一次）
applyTheme(readDark())
