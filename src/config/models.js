/**
 * Models Configuration | 模型配置
 * Centralized model configuration | 集中模型配置
 */

import { DEFAULT_API_BASE_URL } from '@/utils/constants'

const NEXUS_ORIGIN = new URL(DEFAULT_API_BASE_URL).origin
const toAbsoluteUrl = (path) => `${NEXUS_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`

// Backward-compatible aliases (old saved projects / old UI keys) | 兼容旧项目里保存的模型 key
// 说明：本项目最终会把 modelConfig.key 作为请求体的 model 值发送；这里仅做“旧 key → 新 key”兼容。
const MODEL_ALIASES = {
    // Images
    'gpt-image-1.5': 'gpt-image-1.5-all',
    // Videos
    'veo3.1-fast': 'veo3.1-4k',
    'veo3.1-pro': 'veo3.1-pro-4k',
    'sora-2': 'sora-2-all',
    'sora-2-pro': 'sora-2-all',
    // Tencent AIGC Video 兼容旧 key
    'aigc-video-vidu': 'vidu-q2-pro',
    'aigc-video-hailuo': 'hailuo-2.3-fast'
}

// Seedream image size options | 豆包图片尺寸选项
export const SEEDREAM_SIZE_OPTIONS = [
    { label: '21:9', key: '3024x1296' },
    { label: '16:9', key: '2560x1440' },
    { label: '4:3', key: '2304x1728' },
    { label: '3:2', key: '2496x1664' },
    { label: '1:1', key: '2048x2048' },
    { label: '2:3', key: '1664x2496' },
    { label: '3:4', key: '1728x2304' },
    { label: '9:16', key: '1440x2560' },
    { label: '9:21', key: '1296x3024' }
]

// Seedream 4K image size options | 豆包4K图片尺寸选项
export const SEEDREAM_4K_SIZE_OPTIONS = [
    { label: '21:9', key: '6198x2656' },
    { label: '16:9', key: '5404x3040' },
    { label: '4:3', key: '4694x3520' },
    { label: '3:2', key: '4992x3328' },
    { label: '1:1', key: '4096x4096' },
    { label: '2:3', key: '3328x4992' },
    { label: '3:4', key: '3520x4694' },
    { label: '9:16', key: '3040x5404' },
    { label: '9:21', key: '2656x6198' }
]

// Seedream quality options | 豆包画质选项
export const SEEDREAM_QUALITY_OPTIONS = [
    { label: '标准画质', key: 'standard' },
    { label: '4K 高清', key: '4k' }
]

// Image generation models | 图片生成模型
export const IMAGE_MODELS = [
    {
        label: 'nano-banana-pro',
        key: 'gemini-3-pro-image-preview',
        endpoint: toAbsoluteUrl('/v1beta/models/gemini-3-pro-image-preview:generateContent'),
        authMode: 'query',
        format: 'gemini-image',
        timeout: 240000,
        tips: '支持多张参考图 + 提示词（最多 14 张参考图）',
        sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        qualities: [
            { label: '1K', key: '1K' },
            { label: '2K', key: '2K' },
            { label: '4K', key: '4K' }
        ],
        defaultParams: {
            size: '3:4',
            quality: '2K'
        }
    },
    {
        label: 'Grok 4 Image（Chat Completions）',
        key: 'grok-4-image',
        endpoint: '/chat/completions',
        authMode: 'bearer',
        format: 'openai-chat-image',
        tips: '以 Chat 方式生图，建议在提示词里要求返回图片 URL 或 dataURI',
        sizes: [],
        defaultParams: {
            quality: 'standard'
        }
    },
    {
        label: 'Kling Image（kling-v2-1）',
        key: 'kling-image',
        endpoint: toAbsoluteUrl('/kling/v1/images/generations'),
        authMode: 'bearer',
        format: 'kling-image',
        tips: 'Kling 生图（支持参考图）；本项目固定 model_name=kling-v2-1',
        sizes: ['1:1', '2:3', '3:2', '4:3', '3:4', '16:9', '9:16', '21:9'],
        qualities: [
            { label: '1K（标清）', key: '1k' },
            { label: '2K（高清）', key: '2k' }
        ],
        defaultParams: {
            model_name: 'kling-v2-1',
            size: '1:1',
            quality: '1k',
            n: 1
        }
    },
    {
        label: 'Flux Pro 1.1 Ultra',
        key: 'flux-pro-1.1-ultra',
        endpoint: '/images/generations',
        authMode: 'bearer',
        format: 'openai-image',
        tips: 'OpenAI Images 兼容生图（返回 url 或 b64_json）',
        sizes: ['1024x1024', '1536x1024', '1024x1536'],
        defaultParams: {
            size: '1024x1024',
            quality: 'standard'
        }
    },
    {
        label: 'GPT Image 1.5 (All)',
        key: 'gpt-image-1.5-all',
        endpoint: '/images/generations',
        authMode: 'bearer',
        format: 'openai-image',
        tips: '不支持参考图输入（仅使用提示词生成）',
        sizes: ['1024x1024', '1536x1024', '1024x1536'],
        defaultParams: {
            size: '1024x1024',
            quality: 'standard'
        }
    },
    {
        label: '通义千问生图 (Chat)',
        key: 'qwen-image-max',
        endpoint: '/chat/completions',
        authMode: 'bearer',
        format: 'openai-chat-image',
        tips: '以 Chat 方式生图，建议在提示词里要求返回图片 URL 或 dataURI',
        sizes: [],
        defaultParams: {
            quality: 'standard'
        }
    },
    {
        label: '通义千问编辑',
        key: 'qwen-image-edit-2509',
        endpoint: '/images/generations',
        authMode: 'bearer',
        format: 'openai-image-edit',
        tips: '需要参考图 + 提示词（使用第一张参考图）',
        sizes: [],
        defaultParams: {
            quality: 'standard'
        }
    },
    {
        label: 'Tencent AIGC Gem',
        key: 'aigc-image-gem',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-image'),
        authMode: 'bearer',
        format: 'tencent-image',
        defaultParams: {
            version: '3.0',
            clarity: '2k'
        }
    },
    {
        label: 'Tencent AIGC Qwen',
        key: 'aigc-image-qwen',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-image'),
        authMode: 'bearer',
        format: 'tencent-image',
        defaultParams: {
            version: '0925',
            clarity: '2k'
        }
    }
]

// Video ratio options | 视频比例选项
export const VIDEO_RATIO_LIST = [
    { label: '16:9 (横版)', key: '16:9' },
    { label: '4:3', key: '4:3' },
    { label: '1:1 (方形)', key: '1:1' },
    { label: '3:4', key: '3:4' },
    { label: '9:16 (竖版)', key: '9:16' }
]

// Video generation models | 视频生成模型
export const VIDEO_MODELS = [
    {
        label: 'Veo 3.1 Fast Components（统一视频格式）',
        key: 'veo3.1-fast-components',
        endpoint: '/video/create',
        statusEndpoint: '/video/query',
        authMode: 'bearer',
        format: 'veo-unified',
        // components 模型支持最多 3 张图片作为视频元素
        maxImages: 3,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8, enhancePrompt: true, enableUpsample: true }
    },
    {
        label: 'Veo 3.1 Fast Components 4K（统一视频格式）',
        key: 'veo_3_1-fast-components-4K',
        endpoint: '/video/create',
        statusEndpoint: '/video/query',
        authMode: 'bearer',
        format: 'veo-unified',
        // components 模型支持最多 3 张图片作为视频元素
        maxImages: 3,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8, enhancePrompt: true, enableUpsample: true }
    },
    {
        label: 'Veo3.1 4K（统一视频格式）',
        key: 'veo3.1-4k',
        endpoint: '/video/create',
        statusEndpoint: '/video/query',
        authMode: 'bearer',
        format: 'veo-unified',
        // Veo 首尾帧：通常 2 张（首/尾）；更多图片会触发上游校验或被忽略
        maxImages: 2,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8, enhancePrompt: true, enableUpsample: true }
    },
    {
        label: 'Veo3.1 Pro 4K（统一视频格式）',
        key: 'veo3.1-pro-4k',
        endpoint: '/video/create',
        statusEndpoint: '/video/query',
        authMode: 'bearer',
        format: 'veo-unified',
        maxImages: 2,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8, enhancePrompt: true, enableUpsample: true }
    },
    {
        label: 'Kling Video（kling-v2-6 · pro · 10s）',
        key: 'kling-video',
        // 注意：Kling 走 /kling/v1/...，不是 /v1/...（需用绝对 URL，避免多拼一个 /v1）
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 10, model_name: 'kling-v2-6', mode: 'pro', sound: 'off' },
        // 额外端点（图生视频）
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Sora 2 All（统一视频格式）',
        key: 'sora-2-all',
        endpoint: '/video/create',
        statusEndpoint: '/video/query',
        authMode: 'bearer',
        format: 'sora-unified',
        // Sora 参考图数量上游会限制，默认先按 2 张（首/尾）做安全上限
        maxImages: 2,
        // Sora 需要额外参数 size（small/large）| required by Apifox sora-2 docs
        sizes: [
            { label: 'small（约 720p）', key: 'small' },
            { label: 'large（约 1080p）', key: 'large' }
        ],
        ratios: ['16:9', '9:16'],
        durs: [{ label: '10 秒', key: 10 }, { label: '15 秒', key: 15 }, { label: '25 秒', key: 25 }],
        defaultParams: { ratio: '9:16', duration: 15, size: 'large', watermark: false, private: false }
    },
    // ========== Vidu 系列 ==========
    {
        label: 'Vidu q2-turbo（最快）',
        key: 'vidu-q2-turbo',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-video'),
        authMode: 'bearer',
        format: 'tencent-video',
        sizes: [
            { label: '720P', key: '720p' },
            { label: '1080P', key: '1080p' }
        ],
        durs: [
            { label: '4 秒', key: 4 },
            { label: '8 秒', key: 8 }
        ],
        ratios: ['16:9', '9:16', '1:1'],
        defaultParams: { version: 'q2-turbo', duration: 4 }
    },
    {
        label: 'Vidu q2',
        key: 'vidu-q2',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-video'),
        authMode: 'bearer',
        format: 'tencent-video',
        sizes: [
            { label: '720P', key: '720p' },
            { label: '1080P', key: '1080p' }
        ],
        durs: [
            { label: '4 秒', key: 4 },
            { label: '8 秒', key: 8 }
        ],
        ratios: ['16:9', '9:16', '1:1'],
        defaultParams: { version: 'q2', duration: 4 }
    },
    {
        label: 'Vidu q2-pro（高质量）',
        key: 'vidu-q2-pro',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-video'),
        authMode: 'bearer',
        format: 'tencent-video',
        sizes: [
            { label: '720P', key: '720p' },
            { label: '1080P', key: '1080p' }
        ],
        durs: [
            { label: '4 秒', key: 4 },
            { label: '8 秒', key: 8 }
        ],
        ratios: ['16:9', '9:16', '1:1'],
        defaultParams: { version: 'q2-pro', duration: 4 }
    },
    // ========== Hailuo 海螺系列 ==========
    {
        label: 'Hailuo 2.3-Fast（快速）',
        key: 'hailuo-2.3-fast',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-video'),
        authMode: 'bearer',
        format: 'tencent-video',
        sizes: [
            { label: '768P', key: '768p' },
            { label: '1080P', key: '1080p' }
        ],
        durs: [
            { label: '6 秒', key: 6 },
            { label: '10 秒', key: 10 }
        ],
        ratios: ['16:9', '9:16', '1:1'],
        defaultParams: { version: '2.3-Fast', duration: 6 }
    },
    {
        label: 'Hailuo 2.3',
        key: 'hailuo-2.3',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-video'),
        authMode: 'bearer',
        format: 'tencent-video',
        sizes: [
            { label: '768P', key: '768p' },
            { label: '1080P', key: '1080p' }
        ],
        durs: [
            { label: '6 秒', key: 6 },
            { label: '10 秒', key: 10 }
        ],
        ratios: ['16:9', '9:16', '1:1'],
        defaultParams: { version: '2.3', duration: 6 }
    },
    {
        label: 'Hailuo 02',
        key: 'hailuo-02',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-video'),
        authMode: 'bearer',
        format: 'tencent-video',
        sizes: [
            { label: '768P', key: '768p' },
            { label: '1080P', key: '1080p' }
        ],
        durs: [
            { label: '6 秒', key: 6 },
            { label: '10 秒', key: 10 }
        ],
        ratios: ['16:9', '9:16', '1:1'],
        defaultParams: { version: '02', duration: 6 }
    },
    // ========== Kling 可灵系列 ==========
    {
        label: 'Kling 2.5（推荐）',
        key: 'kling-2.5',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-video'),
        authMode: 'bearer',
        format: 'tencent-video',
        sizes: [
            { label: '720P', key: '720p' },
            { label: '1080P', key: '1080p' }
        ],
        durs: [
            { label: '5 秒', key: 5 },
            { label: '10 秒', key: 10 }
        ],
        ratios: ['16:9', '9:16', '1:1'],
        defaultParams: { version: '2.5', duration: 5 }
    },
    {
        label: 'Kling 2.1',
        key: 'kling-2.1',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-video'),
        authMode: 'bearer',
        format: 'tencent-video',
        sizes: [
            { label: '720P', key: '720p' },
            { label: '1080P', key: '1080p' }
        ],
        durs: [
            { label: '5 秒', key: 5 },
            { label: '10 秒', key: 10 }
        ],
        ratios: ['16:9', '9:16', '1:1'],
        defaultParams: { version: '2.1', duration: 5 }
    },
    {
        label: 'Kling 2.0',
        key: 'kling-2.0',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-video'),
        authMode: 'bearer',
        format: 'tencent-video',
        sizes: [
            { label: '720P', key: '720p' },
            { label: '1080P', key: '1080p' }
        ],
        durs: [
            { label: '5 秒', key: 5 },
            { label: '10 秒', key: 10 }
        ],
        ratios: ['16:9', '9:16', '1:1'],
        defaultParams: { version: '2.0', duration: 5 }
    },
    {
        label: 'Kling 1.6',
        key: 'kling-1.6',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-video'),
        authMode: 'bearer',
        format: 'tencent-video',
        sizes: [
            { label: '720P', key: '720p' },
            { label: '1080P', key: '1080p' }
        ],
        durs: [
            { label: '5 秒', key: 5 },
            { label: '10 秒', key: 10 }
        ],
        ratios: ['16:9', '9:16', '1:1'],
        defaultParams: { version: '1.6', duration: 5 }
    },
    {
        label: 'Kling O1（最新）',
        key: 'kling-o1',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-video'),
        authMode: 'bearer',
        format: 'tencent-video',
        sizes: [
            { label: '720P', key: '720p' },
            { label: '1080P', key: '1080p' }
        ],
        durs: [
            { label: '5 秒', key: 5 },
            { label: '10 秒', key: 10 }
        ],
        ratios: ['16:9', '9:16', '1:1'],
        defaultParams: { version: 'O1', duration: 5 }
    }
]

// Chat/LLM models | 对话模型
export const CHAT_MODELS = [
    {
        label: 'GPT-5.1 Thinking All',
        key: 'gpt-5.1-thinking-all',
        endpoint: '/chat/completions',
        authMode: 'bearer',
        format: 'openai-chat'
    },
    {
        label: 'GPT-5 mini（Responses）',
        key: 'gpt-5-mini',
        endpoint: '/responses',
        authMode: 'bearer',
        format: 'openai-responses'
    },
    {
        label: 'Gemini 3 Pro',
        key: 'gemini-3-pro-preview',
        endpoint: toAbsoluteUrl('/v1beta/models/gemini-3-pro-preview:generateContent'),
        authMode: 'query',
        format: 'gemini-chat'
    }
]

// Image size options | 图片尺寸选项
export const IMAGE_SIZE_OPTIONS = [
    { label: '1024x1024', key: '1024x1024' },
    { label: '1536x1024 (横版)', key: '1536x1024' },
    { label: '1024x1536 (竖版)', key: '1024x1536' }
]

// Image quality options | 图片质量选项
export const IMAGE_QUALITY_OPTIONS = [
    { label: '标准', key: 'standard' },
    { label: '高清', key: 'hd' }
]

// Image style options | 图片风格选项
export const IMAGE_STYLE_OPTIONS = [
    { label: '生动', key: 'vivid' },
    { label: '自然', key: 'natural' }
]

// Video ratio options | 视频比例选项
export const VIDEO_RATIO_OPTIONS = VIDEO_RATIO_LIST

// Video duration options | 视频时长选项
export const VIDEO_DURATION_OPTIONS = [
    { label: '5 秒', key: 5 },
    { label: '10 秒', key: 10 }
]

// Default values | 默认值
export const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview'
export const DEFAULT_VIDEO_MODEL = 'sora-2-all'
export const DEFAULT_CHAT_MODEL = 'gpt-5.1-thinking-all'
export const DEFAULT_IMAGE_SIZE = '1024x1024'
export const DEFAULT_VIDEO_RATIO = '16:9'
export const DEFAULT_VIDEO_DURATION = 5

// Get model by key | 根据 key 获取模型
export const getModelByName = (key) => {
    const resolvedKey = MODEL_ALIASES[key] || key
    const allModels = [...IMAGE_MODELS, ...VIDEO_MODELS, ...CHAT_MODELS]
    const found = allModels.find(m => m.key === resolvedKey)
    if (found) return found

    // Fallback for legacy/unknown keys saved in old projects | 旧项目兼容：未知 key 回落默认模型
    // 说明：删除模型后，旧项目可能仍保存旧 key；这里做“按大类回落”避免请求发送未知 model。
    const isVideoLike = typeof key === 'string' && /video|sora|veo|kling-video/i.test(key)
    const isChatLike = typeof key === 'string' && /chat|gpt|claude|qwen|deepseek/i.test(key)
    if (isVideoLike) return allModels.find(m => m.key === DEFAULT_VIDEO_MODEL)
    if (isChatLike) return allModels.find(m => m.key === DEFAULT_CHAT_MODEL)
    return allModels.find(m => m.key === DEFAULT_IMAGE_MODEL)
}
