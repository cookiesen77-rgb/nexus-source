import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from '@/config/models'
import { postJson } from '@/lib/workflow/request'
import { SHORT_DRAMA_STYLE_PRESETS } from '@/lib/shortDrama/stylePresets'
import { createEmptyImageSlot, createEmptyShot } from '@/lib/shortDrama/draftStorage'
import type { ShortDramaDraftV2 } from '@/lib/shortDrama/types'

type ChatRole = 'system' | 'user' | 'assistant'
type ChatMessage = { role: ChatRole; content: string }

type ModelCfg = {
  key: string
  label?: string
  endpoint: string
  authMode?: any
  format: string
}

const normalizeText = (t: unknown) => String(t || '').replace(/\r\n/g, '\n').trim()

const pickModel = (key: string): ModelCfg => {
  const k = String(key || '').trim() || DEFAULT_CHAT_MODEL
  const cfg = (CHAT_MODELS as any[]).find((m) => String(m?.key || '') === k) || (CHAT_MODELS as any[])[0]
  if (!cfg) throw new Error('未找到对话模型配置')
  return cfg as any
}

const extractTextFromResponsesOutput = (output: any) => {
  if (!Array.isArray(output)) return ''
  let text = ''
  for (const item of output) {
    const content = item?.content
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
      if (typeof part?.text === 'string') text += part.text
    }
  }
  return text
}

const extractTextFromResponses = (resp: any) => {
  if (!resp) return ''
  if (typeof resp.output_text === 'string') return resp.output_text
  const outputText = extractTextFromResponsesOutput(resp.output)
  if (outputText) return outputText
  const msg = resp?.choices?.[0]?.message?.content
  if (typeof msg === 'string') return msg
  if (Array.isArray(msg)) return msg.map((m) => m?.text || m).filter(Boolean).join('')
  return ''
}

const callChatModel = async (modelKey: string, messages: ChatMessage[]): Promise<string> => {
  const modelCfg = pickModel(modelKey)
  const format = String(modelCfg.format || '').trim()

  // Gemini native chat
  if (format === 'gemini-chat') {
    const system = messages.find((m) => m.role === 'system')?.content || ''
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))
    const payload: any = { contents }
    if (system) payload.systemInstruction = { parts: [{ text: system }] }
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
    const parts = rsp?.candidates?.[0]?.content?.parts || []
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text).filter(Boolean).join('') : ''
    return normalizeText(text)
  }

  // OpenAI Responses API
  if (format === 'openai-responses') {
    const payload: any = { model: modelCfg.key, input: messages }
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
    return normalizeText(extractTextFromResponses(rsp))
  }

  // Default: OpenAI Chat Completions-like
  const payload: any = { model: modelCfg.key, messages, temperature: 0.2 }
  const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
  const content = rsp?.choices?.[0]?.message?.content
  if (typeof content === 'string') return normalizeText(content)
  if (Array.isArray(content)) return normalizeText(content.map((c: any) => c?.text || c).filter(Boolean).join(''))
  return normalizeText(String(content || ''))
}

const stripCodeFences = (raw: string) => {
  const t = String(raw || '').trim()
  return t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
}

const extractJsonBlock = (raw: string) => {
  const t = stripCodeFences(raw)
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return ''
  return t.slice(start, end + 1)
}

const parseJsonLoose = (raw: string) => {
  const json = extractJsonBlock(raw)
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

const normalizePresetId = (id: unknown) => {
  const v = String(id || '').trim()
  const allowed = new Set(SHORT_DRAMA_STYLE_PRESETS.map((p) => p.id))
  return allowed.has(v) ? v : ''
}

export type ShortDramaScriptAnalysis = {
  title?: string
  logline?: string
  styleSuggestion?: { presetId?: string; customText?: string; negativeText?: string }
  characters?: { name: string; description: string }[]
  scenes?: { name: string; description: string }[]
  shots?: {
    title: string
    beat?: string
    scene?: string
    characters?: string[]
    startPrompt: string
    endPrompt: string
    videoPrompt?: string
  }[]
}

export async function analyzeShortDramaScriptToDraftV2(opts: {
  draft: ShortDramaDraftV2
  modelKey?: string
  scriptText: string
}): Promise<{ draft: ShortDramaDraftV2; analysis: ShortDramaScriptAnalysis; rawText: string }> {
  const script = normalizeText(opts.scriptText)
  if (!script) throw new Error('剧本为空')

  const presetHints = SHORT_DRAMA_STYLE_PRESETS.map((p) => `- ${p.id}: ${p.name}`).join('\n')

  const system = [
    '你是专业短剧/漫剧分镜制作助手。',
    '你必须输出严格的 JSON，不要输出任何解释、Markdown 或多余文字。',
    '目标：从剧本中提取角色、场景、镜头列表，并为每个镜头生成首帧/尾帧提示词，以及可选的视频动作/运镜提示词。',
    '最重要：人物一致性与场景一致性。',
    '',
    '输出 JSON schema（键名必须使用英文）：',
    '{',
    '  "title": "string",',
    '  "logline": "string",',
    '  "styleSuggestion": { "presetId": "string", "customText": "string", "negativeText": "string" },',
    '  "characters": [{ "name": "string", "description": "string" }],',
    '  "scenes": [{ "name": "string", "description": "string" }],',
    '  "shots": [{',
    '    "title": "string",',
    '    "beat": "string",',
    '    "scene": "string",',
    '    "characters": ["string"],',
    '    "startPrompt": "string",',
    '    "endPrompt": "string",',
    '    "videoPrompt": "string"',
    '  }]',
    '}',
    '',
    '约束：',
    '- characters.description 要包含可用于一致性的“固定细节”（发型/服装/配饰/体型/脸部特征等），避免含糊。',
    '- scenes.description 要包含场景固定元素（空间布局/关键道具/时间天气/色板/光线氛围等）。',
    '- shots.startPrompt / endPrompt 必须是可直接用于生成图片的画面描述，包含：场景、人物动作表情、镜头、光线、构图等。',
    '- 如果 scene 或 characters 不确定，可以留空字符串/空数组，但不要省略字段。',
    '- styleSuggestion.presetId 必须从下列列表中选择一个，否则填空字符串：',
    presetHints,
  ].join('\n')

  const user = [
    '请分析下面的短剧剧本，并输出 JSON（只输出 JSON）。',
    '',
    '【剧本】',
    script,
  ].join('\n')

  const modelKey = String(opts.modelKey || opts.draft.models.analysisModelKey || DEFAULT_CHAT_MODEL).trim()
  const rawText = await callChatModel(modelKey, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])

  const parsed = parseJsonLoose(rawText) as ShortDramaScriptAnalysis | null
  if (!parsed) {
    throw new Error(`剧本解析失败：模型未返回可解析 JSON（返回片段：${rawText.slice(0, 200)}）`)
  }

  const analysis: ShortDramaScriptAnalysis = {
    title: normalizeText((parsed as any).title),
    logline: normalizeText((parsed as any).logline),
    styleSuggestion: (parsed as any).styleSuggestion || undefined,
    characters: Array.isArray((parsed as any).characters) ? (parsed as any).characters : [],
    scenes: Array.isArray((parsed as any).scenes) ? (parsed as any).scenes : [],
    shots: Array.isArray((parsed as any).shots) ? (parsed as any).shots : [],
  }

  const next: ShortDramaDraftV2 = { ...opts.draft }
  next.script = { ...next.script, text: script, importedAt: Date.now(), source: { type: 'paste' } as any }
  next.title = analysis.title || next.title
  next.logline = analysis.logline || next.logline

  // Apply style suggestion (only if not locked and user hasn't set custom fields)
  if (!next.style.locked) {
    const presetId = normalizePresetId(analysis.styleSuggestion?.presetId)
    const canApplyPreset = presetId && (!next.style.presetId || next.style.presetId === SHORT_DRAMA_STYLE_PRESETS[0].id)
    if (canApplyPreset) next.style.presetId = presetId
    if (!next.style.customText && analysis.styleSuggestion?.customText) next.style.customText = normalizeText(analysis.styleSuggestion.customText)
    if (!next.style.negativeText && analysis.styleSuggestion?.negativeText) next.style.negativeText = normalizeText(analysis.styleSuggestion.negativeText)
  }

  // Merge characters by name
  const existingCharsByName = new Map<string, (typeof next.characters)[number]>()
  for (const c of next.characters || []) existingCharsByName.set(String(c.name || '').trim(), c)
  const mergedChars: typeof next.characters = []
  for (const c of analysis.characters || []) {
    const name = normalizeText((c as any)?.name)
    if (!name) continue
    const desc = normalizeText((c as any)?.description)
    const existing = existingCharsByName.get(name)
    if (existing) {
      mergedChars.push({ ...existing, description: existing.description ? existing.description : desc })
    } else {
      mergedChars.push({
        id: globalThis.crypto?.randomUUID?.() || `sd_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name,
        description: desc,
        sheet: createEmptyImageSlot('角色设定图'),
        refs: [createEmptyImageSlot('参考图 1')],
        primaryRefSlotId: undefined,
      })
    }
  }
  // Keep any pre-existing characters not mentioned (non-destructive)
  for (const c of next.characters || []) {
    const name = String(c.name || '').trim()
    if (!name) continue
    if (!mergedChars.some((x) => x.name === name)) mergedChars.push(c)
  }
  next.characters = mergedChars

  // Merge scenes by name
  const existingScenesByName = new Map<string, (typeof next.scenes)[number]>()
  for (const s of next.scenes || []) existingScenesByName.set(String(s.name || '').trim(), s)
  const mergedScenes: typeof next.scenes = []
  for (const s of analysis.scenes || []) {
    const name = normalizeText((s as any)?.name)
    if (!name) continue
    const desc = normalizeText((s as any)?.description)
    const existing = existingScenesByName.get(name)
    if (existing) {
      mergedScenes.push({ ...existing, description: existing.description ? existing.description : desc })
    } else {
      mergedScenes.push({
        id: globalThis.crypto?.randomUUID?.() || `sd_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name,
        description: desc,
        ref: createEmptyImageSlot('场景主参考'),
        refs: [],
      })
    }
  }
  for (const s of next.scenes || []) {
    const name = String(s.name || '').trim()
    if (!name) continue
    if (!mergedScenes.some((x) => x.name === name)) mergedScenes.push(s)
  }
  next.scenes = mergedScenes

  const charIdByName = new Map(next.characters.map((c) => [String(c.name || '').trim(), c.id]))
  const sceneIdByName = new Map(next.scenes.map((s) => [String(s.name || '').trim(), s.id]))

  // Merge shots by index (non-destructive for existing media slots)
  const existingShots = Array.isArray(next.shots) ? next.shots.slice() : []
  const aiShots = Array.isArray(analysis.shots) ? analysis.shots : []
  const mergedShots = existingShots.slice()

  for (let i = 0; i < aiShots.length; i++) {
    const ai = aiShots[i] as any
    const title = normalizeText(ai?.title) || `镜头 ${i + 1}`
    const beat = normalizeText(ai?.beat)
    const sceneName = normalizeText(ai?.scene)
    const charNames = Array.isArray(ai?.characters) ? ai.characters.map((x: any) => normalizeText(x)).filter(Boolean) : []
    const startPrompt = normalizeText(ai?.startPrompt)
    const endPrompt = normalizeText(ai?.endPrompt)
    const videoPrompt = normalizeText(ai?.videoPrompt)

    const existing = mergedShots[i]
    if (existing) {
      const nextShot = { ...existing }
      if (!nextShot.title || /^镜头\s+\d+$/.test(nextShot.title)) nextShot.title = title
      if (!nextShot.beat && beat) nextShot.beat = beat
      if (!nextShot.videoPrompt && videoPrompt) nextShot.videoPrompt = videoPrompt
      if (!nextShot.sceneId && sceneName && sceneIdByName.get(sceneName)) nextShot.sceneId = sceneIdByName.get(sceneName)
      if ((!nextShot.characterIds || nextShot.characterIds.length === 0) && charNames.length > 0) {
        nextShot.characterIds = charNames.map((n) => charIdByName.get(n)).filter(Boolean) as string[]
      }
      if (!nextShot.frames.start.prompt && startPrompt) nextShot.frames.start.prompt = startPrompt
      if (!nextShot.frames.end.prompt && endPrompt) nextShot.frames.end.prompt = endPrompt
      mergedShots[i] = nextShot
    } else {
      const shot = createEmptyShot(title)
      shot.beat = beat
      shot.videoPrompt = videoPrompt
      shot.sceneId = sceneName && sceneIdByName.get(sceneName) ? sceneIdByName.get(sceneName) : undefined
      shot.characterIds = charNames.map((n) => charIdByName.get(n)).filter(Boolean) as string[]
      shot.frames.start.prompt = startPrompt
      shot.frames.end.prompt = endPrompt
      mergedShots.push(shot)
    }
  }

  next.shots = mergedShots
  next.updatedAt = Date.now()

  return { draft: next, analysis, rawText }
}

