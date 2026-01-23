/**
 * Workflow Orchestrator Hook | 工作流编排 Hook
 * 使用回调串行结构编排节点执行
 * 
 * 依赖关系：
 * - imageConfig 执行后产生 image 节点
 * - videoConfig 依赖 image 节点作为输入
 * - 串行执行：等待上一步完成后再执行下一步
 */

import { ref, watch } from 'vue'
import { streamChatCompletions, streamResponses } from '@/api'
import { request } from '@/utils'
import { getModelByName, DEFAULT_CHAT_MODEL } from '@/config/models'
import { 
  nodes, 
  getNodeById,
  addNode, 
  addEdge, 
  updateNode,
  withBatchUpdates
} from '@/stores/canvas'

// Workflow types | 工作流类型
const WORKFLOW_TYPES = {
  TEXT_TO_IMAGE: 'text_to_image',
  TEXT_TO_IMAGE_TO_VIDEO: 'text_to_image_to_video',
  STORYBOARD: 'storyboard', // 分镜工作流
  MULTI_ANGLE_STORYBOARD: 'multi_angle_storyboard', // 多角度分镜工作流
}

// Multi-angle prompts | 多角度提示词模板
const MULTI_ANGLE_PROMPTS = {
  front: {
    label: '正视',
    english: 'Front View',
    prompt: (character) => `使用提供的图片，生成四宫格分镜，每张四宫格包括人物正面对着镜头的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`
  },
  side: {
    label: '侧视',
    english: 'Side View', 
    prompt: (character) => `使用提供的图片，分别生成四宫格分镜，每张四宫格包括人物侧面角度的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`
  },
  back: {
    label: '后视',
    english: 'Back View',
    prompt: (character) => `使用提供的图片，分别生成四宫格分镜，每张四宫格包括人物背影角度的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`
  },
  top: {
    label: '俯视',
    english: 'Top/Bird\'s Eye View',
    prompt: (character) => `使用提供的图片，分别生成四宫格分镜，每张四宫格包括俯视角度的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`
  }
}

const normalizeText = (text) => String(text || '').replace(/\r\n/g, '\n').trim()

const buildIntentContext = (nodesList, maxNodes = 6, maxChars = 1400) => {
  const textNodes = (nodesList || []).filter(n => n?.type === 'text')
  if (textNodes.length === 0) return ''

  const memoryNodes = textNodes.filter(n => {
    const label = normalizeText(n.data?.label)
    const content = normalizeText(n.data?.content)
    const hay = `${label}\n${content}`
    return /角色|人物|设定|世界观|画风|风格|禁忌|剧情|大纲|分镜|脚本|镜头/i.test(hay)
  })

  const recentNodes = [...textNodes]
    .map(n => ({ node: n, t: Number(n.data?.updatedAt || n.data?.createdAt || 0) }))
    .sort((a, b) => b.t - a.t)
    .map(x => x.node)

  const merged = []
  const seen = new Set()
  for (const n of [...memoryNodes, ...recentNodes]) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    merged.push(n)
    if (merged.length >= maxNodes) break
  }

  const lines = []
  let total = 0
  for (const n of merged) {
    const label = normalizeText(n.data?.label) || '文本节点'
    const content = normalizeText(n.data?.content)
    if (!content) continue
    const snippet = content.length > 360 ? `${content.slice(0, 360)}…` : content
    const next = `- ${label}: ${snippet}`
    if (total + next.length > maxChars) break
    lines.push(next)
    total += next.length
  }

  return lines.join('\n')
}

const classifyIntentHeuristic = (text) => {
  const t = normalizeText(text)
  const wantsMultiAngle = /多角度|四宫格|正视|侧视|后视|俯视/i.test(t)
  const wantsStoryboard = /分镜|镜头脚本|镜头|场景一|场景1|storyboard|shot\s*list/i.test(t)
  const wantsScript = /剧本|脚本|剧情|设定|对白|旁白|故事|大纲/i.test(t)
  const wantsVideo = /视频|运镜|动起来|动画|vlog|mv/i.test(t)
  const wantsImage = /生图|图片|图像|插画|画面|海报/i.test(t)
  const wantsPolishOnly = /润色|改写|优化|扩写|精炼/i.test(t) && !wantsImage && !wantsVideo && !wantsStoryboard
  const textOnly = /只要|只需|不要生成|不生成|不要出图|纯文字/i.test(t) || wantsPolishOnly

  let workflow_type = null
  if (wantsMultiAngle) workflow_type = WORKFLOW_TYPES.MULTI_ANGLE_STORYBOARD
  else if (wantsStoryboard || wantsScript) workflow_type = WORKFLOW_TYPES.STORYBOARD
  else if (wantsVideo) workflow_type = WORKFLOW_TYPES.TEXT_TO_IMAGE_TO_VIDEO
  else if (wantsImage) workflow_type = WORKFLOW_TYPES.TEXT_TO_IMAGE

  return {
    workflow_type,
    output_mode: textOnly ? 'text_only' : null,
    wantsScript
  }
}

const STYLE_HINT_RE = /写实|摄影|真实|电影感|胶片|动漫|二次元|日漫|国漫|美漫|插画|手绘|水彩|油画|国风|古风|赛博朋克|蒸汽朋克|像素|3d|3D|渲染|建模|低多边|极简|霓虹|未来|卡通|童话|厚涂|赛璐璐/i
const SCENE_HINT_RE = /室内|室外|城市|街道|森林|海边|夜晚|白天|黄昏|雨|雪|晴|阴|办公室|房间|教室|舞台|太空|山|湖|沙漠|草原|地铁|咖啡馆|商店|校园/i
const CHARACTER_HINT_RE = /人物|角色|主角|女孩|男孩|少年|少女|老人|小孩|女性|男性|猫|狗|动物|机器人|怪物|天使|恶魔|产品|商品|logo|建筑|车辆/i
const RATIO_HINT_RE = /16:9|9:16|4:3|3:4|1:1|横版|竖版|方形|宽屏|竖屏/i
const DURATION_HINT_RE = /(\d+(?:\.\d+)?)\s*(秒|s|sec|secs|分钟|min)/i
const SHOT_COUNT_RE = /(\d+)\s*(镜|分镜|shot|场景|条)/i

const detectClarificationFallback = ({ userInput, contextText, workflowType, outputMode }) => {
  const combined = normalizeText([userInput, contextText].filter(Boolean).join('\n'))
  const low = combined.toLowerCase()

  const hasStyle = STYLE_HINT_RE.test(combined)
  const hasScene = SCENE_HINT_RE.test(combined)
  const hasCharacter = CHARACTER_HINT_RE.test(combined)
  const hasRatio = RATIO_HINT_RE.test(combined)
  const hasDuration = DURATION_HINT_RE.test(combined)
  const hasShotCount = SHOT_COUNT_RE.test(combined)
  const mentionsOutput = /图片|图像|生图|画面|海报|视频|动画|分镜|剧本|脚本|文字/.test(combined)
  const isGeneric = combined.length < 10 || /帮我生成|帮我做|来一个|给我一个/.test(combined)

  const questions = []
  const pushQuestion = (q) => {
    if (questions.length >= 3) return
    questions.push(q)
  }

  if (!mentionsOutput && isGeneric) {
    pushQuestion({
      key: 'output_type',
      question: '你希望产出是什么？',
      options: ['图片', '视频', '剧本/分镜']
    })
  }

  if (outputMode === 'text_only') {
    if (!/题材|类型|风格|基调|氛围|情绪|喜剧|悬疑|科幻|爱情|热血/i.test(combined)) {
      pushQuestion({
        key: 'genre',
        question: '剧本风格偏好是什么？',
        options: ['现实/治愈', '热血/战斗', '悬疑/惊悚', '科幻/未来', '爱情/校园', '其他（自定义）']
      })
    }
    if (!/字|段|分钟|时长|短篇|长篇/i.test(combined)) {
      pushQuestion({
        key: 'script_length',
        question: '希望剧本长度大概是多少？',
        options: ['短（200-400字）', '中（500-800字）', '长（1000字以上）', '其他（自定义）']
      })
    }
    if (!hasCharacter) {
      pushQuestion({
        key: 'character',
        question: '主角是谁？请简单描述性格/身份/外观'
      })
    }
  } else if (workflowType === WORKFLOW_TYPES.MULTI_ANGLE_STORYBOARD) {
    if (!hasCharacter || combined.length < 20) {
      pushQuestion({
        key: 'character',
        question: '请补充角色外观（发型、服装、体型、年龄等），以保证多角度一致'
      })
    }
    if (!hasStyle) {
      pushQuestion({
        key: 'style',
        question: '请选择画风',
        options: ['写实摄影', '日系动漫', '美式插画', '3D渲染', '水彩/油画', '其他（自定义）']
      })
    }
  } else if (workflowType === WORKFLOW_TYPES.STORYBOARD) {
    if (!hasShotCount) {
      pushQuestion({
        key: 'count',
        question: '希望生成多少条分镜？',
        options: ['4', '6', '8', '12', '其他（自定义）']
      })
    }
    if (!hasStyle) {
      pushQuestion({
        key: 'style',
        question: '请选择画风',
        options: ['写实摄影', '日系动漫', '美式插画', '3D渲染', '国风水墨', '其他（自定义）']
      })
    }
    if (!hasScene) {
      pushQuestion({
        key: 'scene',
        question: '主要场景/氛围是什么？例如：夜晚城市/雨天街道/森林晨雾'
      })
    }
  } else if (workflowType === WORKFLOW_TYPES.TEXT_TO_IMAGE) {
    if (!hasStyle) {
      pushQuestion({
        key: 'style',
        question: '请选择画风',
        options: ['写实摄影', '日系动漫', '美式插画', '3D渲染', '水彩/油画', '其他（自定义）']
      })
    }
    if (!hasCharacter) {
      pushQuestion({
        key: 'character',
        question: '主体是谁/是什么？请补充外观或核心特征'
      })
    }
    if (!hasScene) {
      pushQuestion({
        key: 'scene',
        question: '场景/氛围是怎样的？例如：黄昏海边/霓虹雨夜/室内暖光'
      })
    }
  } else if (workflowType === WORKFLOW_TYPES.TEXT_TO_IMAGE_TO_VIDEO) {
    if (!hasDuration) {
      pushQuestion({
        key: 'duration',
        question: '希望视频时长？',
        options: ['5 秒', '8 秒', '10 秒', '15 秒', '其他（自定义）']
      })
    }
    if (!hasRatio) {
      pushQuestion({
        key: 'ratio',
        question: '画幅比例偏好？',
        options: ['16:9 横版', '9:16 竖版', '1:1 方形', '其他（自定义）']
      })
    }
    if (!hasStyle) {
      pushQuestion({
        key: 'style',
        question: '请选择画风',
        options: ['写实电影', '动漫风格', '插画风格', '3D渲染', '其他（自定义）']
      })
    }
  }

  if (!questions.length) {
    return { context: '', questions: [] }
  }

  return {
    context: '为了更准确理解你的意图，需要补充以下关键信息：',
    questions
  }
}

const normalizeIntentResult = (result, heuristic, userInput) => {
  const fallback = { workflow_type: WORKFLOW_TYPES.TEXT_TO_IMAGE }
  const next = result && typeof result === 'object' ? { ...result } : { ...fallback }

  if (heuristic?.workflow_type) next.workflow_type = heuristic.workflow_type
  if (!next.workflow_type) next.workflow_type = WORKFLOW_TYPES.TEXT_TO_IMAGE

  if (heuristic?.output_mode) next.output_mode = heuristic.output_mode
  if (!next.output_mode) next.output_mode = next.output_mode || 'workflow'

  const isStoryboard = next.workflow_type === WORKFLOW_TYPES.STORYBOARD || next.workflow_type === WORKFLOW_TYPES.MULTI_ANGLE_STORYBOARD
  if (!next.image_prompt && !isStoryboard) next.image_prompt = userInput
  if (!next.video_prompt && next.workflow_type === WORKFLOW_TYPES.TEXT_TO_IMAGE_TO_VIDEO) next.video_prompt = userInput

  if (heuristic?.wantsScript && next.output_mode !== 'text_only') {
    next.output_mode = 'text_only'
  }

  return next
}

const parseIntentJson = (rawText) => {
  const match = String(rawText || '').match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

// System prompt for intent analysis | 意图分析系统提示词
const INTENT_ANALYSIS_PROMPT = `你是一个工作流分析助手。根据用户输入判断需要的工作流类型，并生成对应的提示词或脚本。

## 核心原则：主动澄清模糊需求

当用户需求存在以下情况时，**必须**设置 needs_clarification=true 并提出追问：

1. **画风/风格未明确**：用户没有指定画风（写实、动漫、插画、3D、赛博朋克等）
2. **角色外观模糊**：分镜/多角度工作流中角色描述不够具体（缺少发型、服装、体型、年龄等）
3. **场景/氛围不清**：缺少场景描述（室内/室外、时间、天气、光影氛围）
4. **输出意图不明**：无法判断用户想要图片、视频、还是文字脚本
5. **数量/规模未定**：分镜数量、视频时长等关键参数未指定
6. **比例/尺寸未说明**：用户未指定横竖版或特定比例

追问原则：
- 每次最多提出 2-3 个最关键的问题
- 问题要具体、给出选项（如"请选择画风：写实/动漫/插画/3D"）
- 如果用户输入足够详细，可以直接执行，无需追问

## 工作流类型

1. text_to_image - 用户想要生成单张图片（默认）
2. text_to_image_to_video - 用户想要生成图片并转成视频（包含"视频"、"动画"、"动起来"等关键词）
3. storyboard - 用户想要生成分镜/多场景图片（包含"分镜"、"场景一"、"镜头"等关键词，或描述多个连续场景；也包括"写剧本/分镜脚本/镜头脚本"这类需求）
4. multi_angle_storyboard - 用户想要生成多角度分镜（包含"多角度"、"正视"、"侧视"、"后视"、"俯视"、"四宫格"、"景别"等关键词）

## 返回 JSON 格式

{
  "needs_clarification": false,
  "clarification_questions": [],
  "clarification_context": "",

  "workflow_type": "text_to_image | text_to_image_to_video | storyboard | multi_angle_storyboard",
  "output_mode": "workflow | text_only",
  "description": "简短描述",

  // text_to_image 和 text_to_image_to_video 使用:
  "image_prompt": "优化后的图片生成提示词",
  "video_prompt": "视频生成提示词（仅 text_to_image_to_video）",

  // script/剧本（当用户要脚本/分镜脚本时使用）
  "script": "剧本正文（2-8 段），包含故事梗概、人物、场景与镜头语言",

  // storyboard 分镜工作流使用:
  "character": {
    "name": "角色名称",
    "description": "角色外观描述，用于生成参考图"
  },
  "shots": [
    {
      "title": "分镜标题",
      "prompt": "该分镜的详细画面描述，包含角色动作、场景、光影等"
    }
  ],

  // multi_angle_storyboard 多角度分镜工作流使用:
  "multi_angle": {
    "character_description": "角色的详细外观描述，包括服装、发型、体型、特征等"
  }
}

## 澄清字段说明

- needs_clarification: 是否需要追问（true/false）
- clarification_questions: 追问问题数组，每个问题包含：
  - question: 问题内容
  - key: 问题标识（style/character/scene/format/count/ratio）
  - options: 可选答案数组（可选，提供则显示为选择题）
- clarification_context: 简短说明为什么需要这些信息

## 提示词优化要求

- image_prompt: 使用"主体→光影→氛围"的顺序组织，补充镜头语言（机位/景别/焦段/构图）
- video_prompt: 描述画面如何动起来，包含镜头移动、主体动作、节奏/转场、氛围变化
- character.description: 详细描述角色外观特征，便于后续分镜保持一致性
- shots[].prompt: 每个分镜的完整画面描述，需包含角色名以保持一致性
- multi_angle.character_description: 详细描述角色外观，用于生成多角度四宫格分镜

## 补充要求

- 如果用户需求更偏"剧本/镜头脚本"，请 output_mode="text_only"，仍返回 storyboard，并在 shots 中给出 3-8 条可执行分镜（信息密度高、镜头语言清晰）。
- 如果用户明确"不要生成图/只要文字"，必须 output_mode="text_only"。
- 不要输出冗长解释，不要输出 Markdown，只返回纯 JSON。

## 示例

### 示例1 - 需要澄清（输入模糊）
输入: "帮我生成一个女孩的图片"
输出:
{
  "needs_clarification": true,
  "clarification_questions": [
    {
      "question": "请选择画风",
      "key": "style",
      "options": ["写实摄影", "日系动漫", "美式插画", "3D渲染", "水彩风格"]
    },
    {
      "question": "请描述女孩的外观特征（年龄、发型、服装等）",
      "key": "character"
    },
    {
      "question": "请选择场景氛围",
      "key": "scene",
      "options": ["室内温馨", "户外自然", "城市街头", "奇幻梦境", "其他（请描述）"]
    }
  ],
  "clarification_context": "为了生成符合预期的图片，需要了解画风偏好、角色细节和场景氛围",
  "workflow_type": "text_to_image",
  "description": "待澄清：女孩图片"
}

### 示例2 - 无需澄清（输入详细）
输入: "日系动漫风格，一个穿白色连衣裙的长发少女站在樱花树下，春日午后，柔和光影，浅景深"
输出:
{
  "needs_clarification": false,
  "clarification_questions": [],
  "workflow_type": "text_to_image",
  "output_mode": "workflow",
  "description": "樱花树下的少女",
  "image_prompt": "日系动漫风格，一位长发少女身穿白色飘逸连衣裙，站在盛开的樱花树下，花瓣轻轻飘落，春日午后的柔和阳光透过枝叶洒落，背景虚化，浅景深，中景构图，温柔治愈的氛围"
}

### 示例3 - 分镜工作流
输入: "蜡笔小新去上学。分镜一：清晨的战争；分镜二：出发的风姿"
输出:
{
  "needs_clarification": false,
  "clarification_questions": [],
  "workflow_type": "storyboard",
  "description": "蜡笔小新上学分镜",
  "character": {
    "name": "蜡笔小新",
    "description": "5岁男孩，黑色蘑菇头发型，粗眉毛，穿红色T恤和黄色短裤，卡通动漫风格"
  },
  "shots": [
    {"title": "清晨的战争", "prompt": "蜡笔小新在卧室赖床，妈妈美伢在旁边生气催促..."},
    {"title": "出发的风姿", "prompt": "蜡笔小新背着黄色书包，在阳光下昂首阔步走出家门..."}
  ]
}

### 示例4 - 多角度分镜工作流
输入: "生成一个穿红裙子的女孩的多角度分镜"
输出:
{
  "needs_clarification": true,
  "clarification_questions": [
    {
      "question": "请选择画风",
      "key": "style",
      "options": ["写实摄影", "日系动漫", "3D渲染", "时尚插画"]
    },
    {
      "question": "请补充女孩的外观细节（年龄、发型、体型、五官特征等）",
      "key": "character"
    }
  ],
  "clarification_context": "多角度分镜需要保持角色一致性，请提供更详细的角色描述",
  "workflow_type": "multi_angle_storyboard",
  "description": "红裙女孩多角度分镜",
  "multi_angle": {
    "character_description": "年轻女孩，穿着红色连衣裙"
  }
}

返回纯 JSON，不要其他内容。`

/**
 * Workflow Orchestrator Composable
 */
export const useWorkflowOrchestrator = () => {
  // State | 状态
  const isAnalyzing = ref(false)
  const isExecuting = ref(false)
  const currentStep = ref(0)
  const totalSteps = ref(0)
  const executionLog = ref([])
  
  // Active watchers | 活跃的监听器
  const activeWatchers = []
  
  /**
   * Add log entry | 添加日志
   */
  const addLog = (type, message) => {
    executionLog.value.push({ type, message, timestamp: Date.now() })
    console.log(`[Workflow ${type}] ${message}`)
  }
  
  /**
   * Clear all watchers | 清除所有监听器
   */
  const clearWatchers = () => {
    activeWatchers.forEach(stop => stop())
    activeWatchers.length = 0
  }
  
  /**
   * Wait for config node to complete and return output node ID
   * 等待配置节点完成并返回输出节点 ID
   */
  const waitForConfigComplete = (configNodeId) => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('执行超时'))
      }, 5 * 60 * 1000)
      
      let stopWatcher = null
      
      const checkNode = (node) => {
        if (!node) return false
        
        // Check for error | 检查错误
        if (node.data?.error) {
          clearTimeout(timeout)
          if (stopWatcher) stopWatcher()
          reject(new Error(node.data.error))
          return true
        }
        
        // Config node completed with output node ID | 配置节点完成并返回输出节点 ID
        if (node.data?.executed && node.data?.outputNodeId) {
          clearTimeout(timeout)
          if (stopWatcher) stopWatcher()
          addLog('success', `节点 ${configNodeId} 完成，输出节点: ${node.data.outputNodeId}`)
          resolve(node.data.outputNodeId)
          return true
        }
        return false
      }
      
      const getSnapshot = () => {
        const node = getNodeById(configNodeId)
        if (!node) return null
        return {
          executed: !!node.data?.executed,
          outputNodeId: node.data?.outputNodeId || null,
          error: node.data?.error || null
        }
      }

      // Check immediately first | 先立即检查一次
      const node = getNodeById(configNodeId)
      if (checkNode(node)) return
      
      // Then watch for changes | 然后监听变化（避免 nodes.find 扫描）
      stopWatcher = watch(
        () => getSnapshot(),
        () => checkNode(getNodeById(configNodeId))
      )
      
      activeWatchers.push(stopWatcher)
    })
  }
  
  /**
   * Wait for output node (image/video) to be ready
   * 等待输出节点准备好
   */
  const waitForOutputReady = (outputNodeId) => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('输出节点超时'))
      }, 5 * 60 * 1000)
      
      let stopWatcher = null
      
      const checkNode = (node) => {
        if (!node) return false
        
        if (node.data?.error) {
          clearTimeout(timeout)
          if (stopWatcher) stopWatcher()
          reject(new Error(node.data.error))
          return true
        }
        
        // Output node ready when has URL and not loading
        if (node.data?.url && !node.data?.loading) {
          clearTimeout(timeout)
          if (stopWatcher) stopWatcher()
          addLog('success', `输出节点 ${outputNodeId} 已就绪`)
          resolve(node)
          return true
        }
        return false
      }
      
      const getSnapshot = () => {
        const node = getNodeById(outputNodeId)
        if (!node) return null
        return {
          url: node.data?.url || null,
          loading: !!node.data?.loading,
          error: node.data?.error || null
        }
      }

      // Check immediately first | 先立即检查一次
      const node = getNodeById(outputNodeId)
      if (checkNode(node)) return
      
      // Then watch for changes | 然后监听变化（避免 nodes.find 扫描）
      stopWatcher = watch(
        () => getSnapshot(),
        () => checkNode(getNodeById(outputNodeId))
      )
      
      activeWatchers.push(stopWatcher)
    })
  }
  
  /**
   * Analyze user intent | 分析用户意图
   */
  const analyzeIntent = async (userInput) => {
    isAnalyzing.value = true
    
    try {
      const modelConfig = getModelByName(DEFAULT_CHAT_MODEL)
      let response = ''
      const contextText = buildIntentContext(nodes.value)
      const inputText = contextText ? `${userInput}\n\n【画布上下文】\n${contextText}` : userInput

      // Gemini 原生
      if (modelConfig?.format === 'gemini-chat') {
        const payload = {
          contents: [
            { role: 'user', parts: [{ text: INTENT_ANALYSIS_PROMPT }] },
            { role: 'user', parts: [{ text: inputText }] }
          ]
        }
        const rsp = await request({
          url: modelConfig.endpoint,
          method: 'post',
          data: payload,
          authMode: modelConfig.authMode
        })
        const parts = rsp?.candidates?.[0]?.content?.parts || []
        response = parts.map(p => p.text).filter(Boolean).join('')
      } else {
        if (modelConfig?.format === 'openai-responses') {
          for await (const chunk of streamResponses({
            model: DEFAULT_CHAT_MODEL,
            input: [
              { role: 'system', content: INTENT_ANALYSIS_PROMPT },
              { role: 'user', content: inputText }
            ]
          })) {
            response += chunk
          }
        } else {
          for await (const chunk of streamChatCompletions({
            model: DEFAULT_CHAT_MODEL,
            messages: [
              { role: 'system', content: INTENT_ANALYSIS_PROMPT },
              { role: 'user', content: inputText }
            ]
          })) {
            response += chunk
          }
        }
      }
      
      const parsed = parseIntentJson(response)
      const heuristic = classifyIntentHeuristic(userInput)
      const normalized = parsed
        ? normalizeIntentResult(parsed, heuristic, userInput)
        : normalizeIntentResult(null, heuristic, userInput)

      const fallback = detectClarificationFallback({
        userInput,
        contextText,
        workflowType: normalized.workflow_type,
        outputMode: normalized.output_mode
      })

      const hasQuestions = Array.isArray(normalized?.clarification_questions) && normalized.clarification_questions.length > 0
      if (normalized?.needs_clarification && hasQuestions) {
        return normalized
      }

      if (fallback.questions.length > 0) {
        return {
          ...normalized,
          needs_clarification: true,
          clarification_questions: fallback.questions,
          clarification_context: normalized?.clarification_context || fallback.context
        }
      }

      return {
        ...normalized,
        needs_clarification: false,
        clarification_questions: normalized?.clarification_questions || []
      }
    } catch (err) {
      addLog('error', `分析失败: ${err.message}`)
      const heuristic = classifyIntentHeuristic(userInput)
      const normalized = normalizeIntentResult(null, heuristic, userInput)
      const fallback = detectClarificationFallback({
        userInput,
        contextText: buildIntentContext(nodes.value),
        workflowType: normalized.workflow_type,
        outputMode: normalized.output_mode
      })

      if (fallback.questions.length > 0) {
        return {
          ...normalized,
          needs_clarification: true,
          clarification_questions: fallback.questions,
          clarification_context: fallback.context
        }
      }

      return {
        ...normalized,
        needs_clarification: false,
        clarification_questions: []
      }
    } finally {
      isAnalyzing.value = false
    }
  }
  
  /**
   * Execute text-only workflow | 仅输出文字节点（不触发生成）
   */
  const executeTextOnly = async (params, position) => {
    const nodeSpacing = 360
    const rowSpacing = 220
    let x = position.x
    let y = position.y

    const created = {
      characterId: null,
      scriptId: null,
      promptIds: [],
      shotIds: []
    }

    const character = params?.character
    const shots = Array.isArray(params?.shots) ? params.shots : []
    const scriptText = normalizeText(params?.script)
    const multiAngleText = normalizeText(params?.multi_angle?.character_description)

    withBatchUpdates(() => {
      if (character?.name || character?.description) {
        const content = `${character?.name || '角色'}: ${character?.description || ''}`.trim()
        created.characterId = addNode('text', { x, y }, {
          content,
          label: '角色设定'
        })
        x += nodeSpacing
      }

      if (scriptText) {
        created.scriptId = addNode('text', { x, y }, {
          content: scriptText,
          label: '剧本/脚本'
        })
        x += nodeSpacing
      }

      if (multiAngleText && !created.characterId && !created.scriptId) {
        created.characterId = addNode('text', { x, y }, {
          content: multiAngleText,
          label: '多角度角色描述'
        })
        x += nodeSpacing
      }

      const imagePrompt = normalizeText(params?.image_prompt)
      if (imagePrompt) {
        const nodeId = addNode('text', { x, y }, {
          content: imagePrompt,
          label: '图片提示词'
        })
        created.promptIds.push(nodeId)
        x += nodeSpacing
      }

      const videoPrompt = normalizeText(params?.video_prompt)
      if (videoPrompt) {
        const nodeId = addNode('text', { x, y }, {
          content: videoPrompt,
          label: '视频提示词'
        })
        created.promptIds.push(nodeId)
        x += nodeSpacing
      }

      const hasAny = created.characterId || created.scriptId || created.promptIds.length > 0 || shots.length > 0
      if (!hasAny) {
        const rawInput = normalizeText(params?.raw_input)
        if (rawInput) {
          created.scriptId = addNode('text', { x, y }, {
            content: rawInput,
            label: '原始需求'
          })
        }
      }

      const anchorId = created.scriptId || created.characterId || created.promptIds[0] || null
      if (shots.length > 0) {
        shots.forEach((shot, index) => {
          const title = normalizeText(shot?.title) || `镜头${index + 1}`
          const prompt = normalizeText(shot?.prompt) || title
          const nodeId = addNode('text', { x: position.x, y: y + (index + 1) * rowSpacing }, {
            content: prompt,
            label: `分镜${index + 1}: ${title}`
          })
          created.shotIds.push(nodeId)
          if (anchorId) {
            addEdge({
              source: anchorId,
              target: nodeId,
              sourceHandle: 'right',
              targetHandle: 'left'
            })
          }
        })
      }
    })

    return created
  }

  /**
   * Execute text-to-image workflow | 执行文生图工作流
   * text → imageConfig (autoExecute) → image
   */
  const executeTextToImage = async (imagePrompt, position, referenceNodeIds = []) => {
    const nodeSpacing = 400
    let x = position.x
    
    addLog('info', '开始执行文生图工作流')
    currentStep.value = 1
    totalSteps.value = 2
    
    let textNodeId = null
    let imageConfigId = null
    withBatchUpdates(() => {
      // Step 1: Create text node for image | 创建图片提示词节点
      textNodeId = addNode('text', { x, y: position.y }, {
        content: imagePrompt,
        label: '图片提示词'
      })
      addLog('info', `创建图片提示词节点: ${textNodeId}`)
      x += nodeSpacing
      
      // Step 2: Create imageConfig with autoExecute | 创建图片配置节点并自动执行
      currentStep.value = 2
      imageConfigId = addNode('imageConfig', { x, y: position.y }, {
        label: '文生图',
        autoExecute: true
      })
      addLog('info', `创建图片配置节点: ${imageConfigId}`)
      
      // Connect text → imageConfig
      addEdge({
        source: textNodeId,
        target: imageConfigId,
        sourceHandle: 'right',
        targetHandle: 'left'
      })

      // Connect reference images → imageConfig | 参考图输入（图生图/风格参考）
      if (Array.isArray(referenceNodeIds) && referenceNodeIds.length > 0) {
        referenceNodeIds.forEach((refId) => {
          if (!refId) return
          addEdge({
            source: refId,
            target: imageConfigId,
            sourceHandle: 'right',
            targetHandle: 'left',
            type: 'imageRole',
            data: { imageRole: 'input_reference' }
          })
        })
      }
    })
    
    addLog('success', '文生图工作流已启动')
    return { textNodeId, imageConfigId }
  }
  
  /**
   * Execute text-to-image-to-video workflow | 执行文生图生视频工作流
   * imageText → imageConfig → image
   * videoText → videoConfig → video
   *              image → videoConfig
   */
  const executeTextToImageToVideo = async (imagePrompt, videoPrompt, position, referenceNodeIds = []) => {
    const nodeSpacing = 400
    const rowSpacing = 200
    let x = position.x
    
    addLog('info', '开始执行文生图生视频工作流')
    currentStep.value = 1
    totalSteps.value = 5
    
    let imageTextNodeId = null
    let videoTextNodeId = null
    let imageConfigId = null
    withBatchUpdates(() => {
      // Step 1: Create image prompt text node | 创建图片提示词节点
      imageTextNodeId = addNode('text', { x, y: position.y }, {
        content: imagePrompt,
        label: '图片提示词'
      })
      addLog('info', `创建图片提示词节点: ${imageTextNodeId}`)
      
      // Step 2: Create video prompt text node (below image prompt) | 创建视频提示词节点
      currentStep.value = 2
      videoTextNodeId = addNode('text', { x, y: position.y + rowSpacing }, {
        content: videoPrompt,
        label: '视频提示词'
      })
      addLog('info', `创建视频提示词节点: ${videoTextNodeId}`)
      x += nodeSpacing
      
      // Step 3: Create imageConfig with autoExecute | 创建图片配置节点
      currentStep.value = 3
      imageConfigId = addNode('imageConfig', { x, y: position.y }, {
        label: '文生图',
        autoExecute: true
      })
      addLog('info', `创建图片配置节点: ${imageConfigId}`)
      
      // Connect imageText → imageConfig
      addEdge({
        source: imageTextNodeId,
        target: imageConfigId,
        sourceHandle: 'right',
        targetHandle: 'left'
      })

      // Connect reference images → imageConfig | 参考图输入（作用于首帧/风格）
      if (Array.isArray(referenceNodeIds) && referenceNodeIds.length > 0) {
        referenceNodeIds.forEach((refId) => {
          if (!refId) return
          addEdge({
            source: refId,
            target: imageConfigId,
            sourceHandle: 'right',
            targetHandle: 'left',
            type: 'imageRole',
            data: { imageRole: 'input_reference' }
          })
        })
      }
    })
    
    // Step 3: Wait for imageConfig to complete and get image node ID
    // 等待图片配置完成并获取图片节点 ID
    currentStep.value = 3
    addLog('info', '等待图片生成完成...')
    
    try {
      const imageNodeId = await waitForConfigComplete(imageConfigId)
      
      // Wait for image to be ready | 等待图片准备好
      await waitForOutputReady(imageNodeId)
      
      // Get image node position | 获取图片节点位置
      const imageNode = getNodeById(imageNodeId)
      x = (imageNode?.position?.x || x) + nodeSpacing
      
      // Step 4: Create videoConfig connected to videoText and image nodes
      // 创建视频配置节点，连接视频提示词和图片节点
      currentStep.value = 4
      let videoConfigId = null
      withBatchUpdates(() => {
        videoConfigId = addNode('videoConfig', { x, y: position.y + rowSpacing }, {
          label: '图生视频',
          autoExecute: true
        })
        addLog('info', `创建视频配置节点: ${videoConfigId}`)
        
        // Connect videoText → videoConfig (for video prompt)
        addEdge({
          source: videoTextNodeId,
          target: videoConfigId,
          sourceHandle: 'right',
          targetHandle: 'left'
        })
        
        // Connect image → videoConfig (for image input)
        addEdge({
          source: imageNodeId,
          target: videoConfigId,
          sourceHandle: 'right',
          targetHandle: 'left'
        })
      })
      
      addLog('success', '文生图生视频工作流已启动')
      return { imageTextNodeId, videoTextNodeId, imageConfigId, imageNodeId, videoConfigId }
    } catch (err) {
      addLog('error', `工作流执行失败: ${err.message}`)
      throw err
    }
  }
  
  /**
   * Execute storyboard workflow | 执行分镜工作流
   * 
   * 布局结构:
   * [角色描述] → [imageConfig] → [角色参考图]
   *                                    ↓
   * [分镜1文本] → [imageConfig] → [分镜1图片]
   * [分镜2文本] → [imageConfig] → [分镜2图片]
   * ...
   */
  const executeStoryboard = async (character, shots, position) => {
    const nodeSpacing = 400
    const rowSpacing = 250
    let x = position.x
    let y = position.y
    
    const shotCount = shots?.length || 0
    addLog('info', `开始执行分镜工作流: ${character?.name || '未知角色'}, ${shotCount} 个分镜`)
    currentStep.value = 1
    totalSteps.value = 2 + shotCount * 2 // 角色生成 + 每个分镜(文本+生成)
    
    const createdNodes = {
      characterTextId: null,
      characterConfigId: null,
      characterImageId: null,
      shots: []
    }
    
    try {
      // Step 1: Create character description text node | 创建角色描述文本节点
      const characterDesc = `${character?.name || '角色'}: ${character?.description || ''}`
      withBatchUpdates(() => {
        createdNodes.characterTextId = addNode('text', { x, y }, {
          content: characterDesc,
          label: `角色: ${character?.name || '参考'}`
        })
        addLog('info', `创建角色描述节点: ${createdNodes.characterTextId}`)
        x += nodeSpacing
        
        // Step 2: Create character imageConfig with autoExecute | 创建角色参考图配置
        currentStep.value = 2
        createdNodes.characterConfigId = addNode('imageConfig', { x, y }, {
          label: '角色参考图',
          autoExecute: true
        })
        addLog('info', `创建角色配置节点: ${createdNodes.characterConfigId}`)
        
        // Connect character text → imageConfig
        addEdge({
          source: createdNodes.characterTextId,
          target: createdNodes.characterConfigId,
          sourceHandle: 'right',
          targetHandle: 'left'
        })
      })
      
      // Wait for character image to complete | 等待角色参考图完成
      addLog('info', '等待角色参考图生成...')
      createdNodes.characterImageId = await waitForConfigComplete(createdNodes.characterConfigId)
      await waitForOutputReady(createdNodes.characterImageId)
      addLog('success', '角色参考图已生成')
      
      // Get character image position for layout | 获取角色图位置用于布局
      const charImageNode = getNodeById(createdNodes.characterImageId)
      x = (charImageNode?.position?.x || x) + nodeSpacing
      
      // Step 3+: Create each shot | 创建每个分镜
      for (let i = 0; i < shotCount; i++) {
        const shot = shots[i]
        const shotY = y + (i + 1) * rowSpacing
        let shotX = position.x
        
        currentStep.value = 3 + i * 2
        
        let shotTextId = null
        let shotConfigId = null
        withBatchUpdates(() => {
          // Create shot text node | 创建分镜文本节点
          shotTextId = addNode('text', { x: shotX, y: shotY }, {
            content: shot.prompt,
            label: `分镜${i + 1}: ${shot.title}`
          })
          addLog('info', `创建分镜${i + 1}文本节点: ${shotTextId}`)
          shotX += nodeSpacing
          
          // Create shot imageConfig | 创建分镜配置节点
          currentStep.value = 4 + i * 2
          shotConfigId = addNode('imageConfig', { x: shotX, y: shotY }, {
            label: `分镜${i + 1}`,
            autoExecute: true
          })
          addLog('info', `创建分镜${i + 1}配置节点: ${shotConfigId}`)
          
          // Connect shot text → imageConfig
          addEdge({
            source: shotTextId,
            target: shotConfigId,
            sourceHandle: 'right',
            targetHandle: 'left'
          })
          
          // Connect character image → shot imageConfig (as reference)
          addEdge({
            source: createdNodes.characterImageId,
            target: shotConfigId,
            sourceHandle: 'right',
            targetHandle: 'left'
          })
        })
        
        // Wait for this shot to complete before next | 等待当前分镜完成
        addLog('info', `等待分镜${i + 1}生成...`)
        const shotImageId = await waitForConfigComplete(shotConfigId)
        await waitForOutputReady(shotImageId)
        addLog('success', `分镜${i + 1}已生成`)
        
        createdNodes.shots.push({
          textId: shotTextId,
          configId: shotConfigId,
          imageId: shotImageId,
          title: shot.title
        })
      }
      
      addLog('success', `分镜工作流完成，共生成 ${shotCount} 个分镜`)
      return createdNodes
    } catch (err) {
      addLog('error', `分镜工作流执行失败: ${err.message}`)
      throw err
    }
  }
  
  /**
   * Execute multi-angle storyboard workflow | 执行多角度分镜工作流
   * 
   * 布局结构:
   * [主角色图] ──┬──> [正视提示词] → [imageConfig] → [正视四宫格]
   *              ├──> [侧视提示词] → [imageConfig] → [侧视四宫格]
   *              ├──> [后视提示词] → [imageConfig] → [后视四宫格]
   *              └──> [俯视提示词] → [imageConfig] → [俯视四宫格]
   * 
   * @param {object} multiAngle - 多角度参数 { character_description }
   * @param {object} position - 起始位置
   */
  const executeMultiAngleStoryboard = async (multiAngle, position) => {
    const nodeSpacing = 400
    const rowSpacing = 300
    let x = position.x
    let y = position.y
    
    const characterDesc = multiAngle?.character_description || ''
    const angles = ['front', 'side', 'back', 'top']
    
    addLog('info', `开始执行多角度分镜工作流: ${characterDesc.slice(0, 30)}...`)
    currentStep.value = 1
    totalSteps.value = 2 + angles.length * 2 // 角色图 + 每个角度(提示词+生成)
    
    const createdNodes = {
      characterImageId: null,
      angles: []
    }
    
    try {
      // Step 1: Create character image node (user uploads or existing)
      // 创建角色图节点（用户上传或已有）
      let characterImageId = null
      withBatchUpdates(() => {
        characterImageId = addNode('image', { x, y }, {
          url: '',
          label: '主角色图（请上传）',
          isCharacterRef: true
        })
      })
      createdNodes.characterImageId = characterImageId
      addLog('info', `创建主角色图节点: ${characterImageId}`)
      
      // Step 2: Create 4 angle nodes in parallel layout
      // 创建4个角度的节点（并行布局）
      const angleX = x + nodeSpacing + 100
      
      for (let i = 0; i < angles.length; i++) {
        const angleKey = angles[i]
        const angleConfig = MULTI_ANGLE_PROMPTS[angleKey]
        const angleY = y + i * rowSpacing
        let currentX = angleX
        
        currentStep.value = 2 + i * 2
        
        let textNodeId = null
        let configNodeId = null
        withBatchUpdates(() => {
          // Create angle prompt text node | 创建角度提示词节点
          const promptContent = angleConfig.prompt(characterDesc)
          textNodeId = addNode('text', { x: currentX, y: angleY }, {
            content: promptContent,
            label: `${angleConfig.label}提示词`
          })
          addLog('info', `创建${angleConfig.label}提示词节点: ${textNodeId}`)
          currentX += nodeSpacing
          
          // Create imageConfig node | 创建图片配置节点
          currentStep.value = 3 + i * 2
          configNodeId = addNode('imageConfig', { x: currentX, y: angleY }, {
            label: `${angleConfig.label} (${angleConfig.english})`,
            autoExecute: false // 不自动执行，等待用户上传角色图
          })
          addLog('info', `创建${angleConfig.label}配置节点: ${configNodeId}`)
          
          // Connect text → imageConfig
          addEdge({
            source: textNodeId,
            target: configNodeId,
            sourceHandle: 'right',
            targetHandle: 'left'
          })
          
          // Connect character image → imageConfig (as reference)
          addEdge({
            source: characterImageId,
            target: configNodeId,
            sourceHandle: 'right',
            targetHandle: 'left'
          })
        })
        
        createdNodes.angles.push({
          key: angleKey,
          label: angleConfig.label,
          english: angleConfig.english,
          textId: textNodeId,
          configId: configNodeId,
          imageId: null
        })
      }
      
      addLog('success', `多角度分镜工作流已创建，请上传主角色图后点击各节点的"立即生成"按钮`)
      window.$message?.info('请先上传主角色图，然后点击各角度节点的"立即生成"按钮')
      
      return createdNodes
    } catch (err) {
      addLog('error', `多角度分镜工作流执行失败: ${err.message}`)
      throw err
    }
  }
  
  /**
   * Main execute function based on workflow type
   * 根据工作流类型执行
   * @param {object} params - 工作流参数
   * @param {object} position - 起始位置
   */
  const executeWorkflow = async (params, position) => {
    isExecuting.value = true
    clearWatchers()
    executionLog.value = []
    
    const { workflow_type, image_prompt, video_prompt, character, shots, multi_angle, output_mode, reference_node_ids } = params
    
    try {
      if (output_mode === 'text_only') {
        return await executeTextOnly(params, position)
      }
      switch (workflow_type) {
        case WORKFLOW_TYPES.MULTI_ANGLE_STORYBOARD:
          return await executeMultiAngleStoryboard(multi_angle, position)
        case WORKFLOW_TYPES.STORYBOARD:
          return await executeStoryboard(character, shots, position)
        case WORKFLOW_TYPES.TEXT_TO_IMAGE_TO_VIDEO:
          return await executeTextToImageToVideo(image_prompt, video_prompt, position, reference_node_ids)
        case WORKFLOW_TYPES.TEXT_TO_IMAGE:
        default:
          return await executeTextToImage(image_prompt, position, reference_node_ids)
      }
    } finally {
      isExecuting.value = false
      clearWatchers()
    }
  }
  
  /**
   * Convenience method for simple text-to-image | 简便方法
   */
  const createTextToImageWorkflow = (imagePrompt, position) => {
    return executeWorkflow({ 
      workflow_type: WORKFLOW_TYPES.TEXT_TO_IMAGE, 
      image_prompt: imagePrompt 
    }, position)
  }
  
  /**
   * Convenience method for multi-angle storyboard | 多角度分镜简便方法
   */
  const createMultiAngleStoryboard = (characterDescription, position) => {
    return executeWorkflow({
      workflow_type: WORKFLOW_TYPES.MULTI_ANGLE_STORYBOARD,
      multi_angle: { character_description: characterDescription }
    }, position)
  }
  
  /**
   * Reset state | 重置状态
   */
  const reset = () => {
    isAnalyzing.value = false
    isExecuting.value = false
    currentStep.value = 0
    totalSteps.value = 0
    executionLog.value = []
    clearWatchers()
  }
  
  return {
    // State
    isAnalyzing,
    isExecuting,
    currentStep,
    totalSteps,
    executionLog,
    
    // Methods
    analyzeIntent,
    executeWorkflow,
    createTextToImageWorkflow,
    createMultiAngleStoryboard,
    reset,
    
    // Constants
    WORKFLOW_TYPES,
    MULTI_ANGLE_PROMPTS
  }
}

export default useWorkflowOrchestrator
