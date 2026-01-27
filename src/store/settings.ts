import { create } from 'zustand'

const API_KEY_STORAGE_KEY = 'apiKey'
const THEME_STORAGE_KEY = 'nexus-theme-v1'

type SettingsState = {
  apiKey: string
  dark: boolean
  setApiKey: (value: string) => void
  clearApiKey: () => void
  toggleDark: () => void
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
  }
}))

// Initialize theme once on import | 初始化主题（只做一次）
applyTheme(readDark())
