type Invoke = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>

let cached: null | { isTauri: boolean; invoke: Invoke | null; convertFileSrc?: any } = null

export const getTauri = async () => {
  if (cached) return cached
  try {
    const core = await import('@tauri-apps/api/core')
    const isTauri = !!core?.isTauri?.()
    cached = { isTauri, invoke: (core?.invoke as Invoke) || null, convertFileSrc: core?.convertFileSrc }
    return cached
  } catch {
    cached = { isTauri: false, invoke: null }
    return cached
  }
}

export const tauriInvoke = async <T,>(command: string, payload?: Record<string, unknown>): Promise<T | null> => {
  const t = await getTauri()
  if (!t.isTauri || typeof t.invoke !== 'function') return null
  try {
    return await t.invoke(command, payload)
  } catch {
    return null
  }
}
