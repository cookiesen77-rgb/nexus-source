import type { ShortDramaStyle } from '@/lib/shortDrama/types'

export interface ShortDramaStylePreset {
  id: string
  name: string
  description: string
  baseStyleText: string
  baseNegativeText: string
}

export const SHORT_DRAMA_STYLE_PRESETS: ShortDramaStylePreset[] = [
  {
    id: 'cinematic_realism',
    name: '电影写实',
    description: '电影级写实质感，稳定的光比与镜头语言，适合短剧主流风格',
    baseStyleText: [
      'cinematic realism, film still, professional cinematography',
      'consistent character identity across shots (same face, hair, clothing, body type)',
      'natural skin texture, realistic materials, accurate anatomy',
      'soft film grain, subtle depth of field, clean composition',
      'consistent color grading (single LUT), controlled lighting (key/fill/rim)',
    ].join(', '),
    baseNegativeText: [
      'watermark, logo, signature, text, subtitles',
      'extra limbs, extra fingers, deformed hands, bad anatomy',
      'inconsistent character, different face, different outfit, different hairstyle',
      'low quality, blurry, overexposed, underexposed',
    ].join(', '),
  },
  {
    id: 'studio_portrait',
    name: '写真棚拍',
    description: '棚拍商业写真风格，干净背景与可控灯光，适合角色设定图',
    baseStyleText: [
      'studio portrait photography, clean backdrop, softbox lighting',
      'sharp focus on face, accurate facial features, consistent identity',
      'high-end fashion editorial, clean skin tones, controlled highlights',
    ].join(', '),
    baseNegativeText: [
      'busy background, clutter, harsh shadows, blown highlights',
      'watermark, text, logo',
      'inconsistent face, different makeup, different hairstyle',
    ].join(', '),
  },
  {
    id: 'k_webtoon_vertical',
    name: '韩漫竖屏',
    description: '韩漫条漫质感，适合竖屏短剧分镜关键帧',
    baseStyleText: [
      'korean webtoon style, clean lineart, soft shading, vibrant but controlled colors',
      'vertical composition friendly, readable silhouettes, consistent character design',
    ].join(', '),
    baseNegativeText: [
      'watermark, text, speech bubbles',
      'messy lineart, inconsistent style across panels',
    ].join(', '),
  },
  {
    id: 'anime_cel_shaded',
    name: '日漫赛璐璐',
    description: '经典赛璐璐动漫画风，线条明确、块面上色稳定',
    baseStyleText: [
      'anime cel shading, clean lineart, flat shading with crisp edges',
      'consistent character model sheet design, consistent costume details',
      'high quality illustration, keyframe-friendly',
    ].join(', '),
    baseNegativeText: ['watermark, text, noisy gradients', 'inconsistent face, inconsistent outfit'].join(', '),
  },
  {
    id: 'chinese_costume_drama',
    name: '国风古装',
    description: '国风古装短剧适配：衣料纹理、发饰细节、氛围光',
    baseStyleText: [
      'chinese costume drama aesthetic, traditional styling, elegant fabrics and ornaments',
      'cinematic lighting, atmospheric haze, refined color palette',
      'consistent costume details and accessories across shots',
    ].join(', '),
    baseNegativeText: ['modern clothing, watermark, text', 'inconsistent costume, inconsistent accessories'].join(', '),
  },
  {
    id: 'watercolor_illustration',
    name: '水彩插画',
    description: '水彩与纸张肌理，柔和色块，适合氛围感场景与情绪表达',
    baseStyleText: ['watercolor illustration, paper texture, soft edges, gentle lighting', 'consistent palette'].join(', '),
    baseNegativeText: ['watermark, text', 'muddy colors, over-saturated, noisy'].join(', '),
  },
  {
    id: 'cyberpunk_neon',
    name: '赛博朋克霓虹',
    description: '夜景霓虹、雨反光、强对比，适合都市科幻类短剧',
    baseStyleText: [
      'cyberpunk neon city, night rain, reflective wet streets, volumetric light',
      'high contrast but controlled exposure, cinematic composition',
      'consistent character identity and outfit',
    ].join(', '),
    baseNegativeText: ['daylight, pastel tone', 'watermark, text', 'inconsistent character'].join(', '),
  },
  {
    id: 'pixar_3d_animation',
    name: '3D 动画',
    description: '3D 动画质感，稳定的模型一致性与材质表现',
    baseStyleText: [
      '3d animation style, high quality render, subsurface scattering, clean shaders',
      'consistent character model, consistent proportions, consistent outfit',
      'soft global illumination, cinematic framing',
    ].join(', '),
    baseNegativeText: ['photorealism, live action', 'watermark, text', 'inconsistent model'].join(', '),
  },
  {
    id: 'film_noir',
    name: '黑色电影悬疑',
    description: '黑白或低饱和，高反差、硬光阴影，适合悬疑短剧',
    baseStyleText: ['film noir, high contrast lighting, chiaroscuro shadows, dramatic composition', 'consistent identity'].join(', '),
    baseNegativeText: ['watermark, text', 'flat lighting, low contrast'].join(', '),
  },
  {
    id: 'warm_minimal_illustration',
    name: '清新治愈插画',
    description: '暖色、极简、干净背景，适合轻喜剧/治愈短剧',
    baseStyleText: ['warm minimal illustration, clean background, soft lighting, simple shapes', 'consistent palette'].join(', '),
    baseNegativeText: ['watermark, text', 'over-detailed, noisy background'].join(', '),
  },
]

export const getShortDramaStylePresetById = (id: string): ShortDramaStylePreset => {
  const key = String(id || '').trim()
  return SHORT_DRAMA_STYLE_PRESETS.find((p) => p.id === key) || SHORT_DRAMA_STYLE_PRESETS[0]
}

export const buildEffectiveStyle = (style: ShortDramaStyle): { styleText: string; negativeText: string } => {
  const preset = getShortDramaStylePresetById(style?.presetId)
  const custom = String(style?.customText || '').trim()
  const negative = String(style?.negativeText || '').trim()

  const styleText = [preset.baseStyleText, custom].map((s) => String(s || '').trim()).filter(Boolean).join('\n')
  const negativeText = [preset.baseNegativeText, negative].map((s) => String(s || '').trim()).filter(Boolean).join(', ')
  return { styleText, negativeText }
}

