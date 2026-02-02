export type NodeType =
  | 'text'
  | 'image'
  | 'video'
  | 'imageConfig'
  | 'videoConfig'
  | 'audio'
  | 'localSave'
  | 'klingVideoTool'
  | 'klingImageTool'
  | 'klingAudioTool'

export type GraphNode = {
  id: string
  type: NodeType
  x: number
  y: number
  zIndex: number
  data: Record<string, unknown>
}

export type EdgeType = 'imageRole' | 'promptOrder' | 'imageOrder' | 'default'

export type GraphEdge = {
  id: string
  source: string
  target: string
  type?: EdgeType
  data?: Record<string, unknown>
}

export type Viewport = { x: number; y: number; zoom: number }
