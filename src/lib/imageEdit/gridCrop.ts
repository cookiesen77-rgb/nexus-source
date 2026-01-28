/**
 * Grid Crop | 宫格裁剪算法
 * 支持四宫格（2x2）和九宫格（3x3）无损裁剪
 */

export interface GridCropResult {
  dataUrl: string
  row: number
  col: number
  width: number
  height: number
}

/**
 * 将图片裁剪为宫格
 * @param imageUrl 图片 URL（data URL 或 HTTP URL）
 * @param gridSize 宫格大小（2 = 四宫格，3 = 九宫格）
 * @returns 裁剪后的图片数组
 */
export async function cropToGrid(
  imageUrl: string,
  gridSize: 2 | 3
): Promise<GridCropResult[]> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      try {
        const results: GridCropResult[] = []
        
        // 计算每个格子的尺寸（取整，避免浮点数导致的边缘问题）
        const cellWidth = Math.floor(img.width / gridSize)
        const cellHeight = Math.floor(img.height / gridSize)
        
        // 遍历每个格子
        for (let row = 0; row < gridSize; row++) {
          for (let col = 0; col < gridSize; col++) {
            // 创建 canvas
            const canvas = document.createElement('canvas')
            canvas.width = cellWidth
            canvas.height = cellHeight
            
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              throw new Error('无法创建 canvas context')
            }
            
            // 禁用图像平滑，保持像素精确
            ctx.imageSmoothingEnabled = false
            
            // 计算裁剪坐标
            const sx = col * cellWidth
            const sy = row * cellHeight
            
            // 绘制裁剪区域
            ctx.drawImage(
              img,
              sx, sy, cellWidth, cellHeight,  // 源坐标和尺寸
              0, 0, cellWidth, cellHeight      // 目标坐标和尺寸
            )
            
            // 导出为 PNG（无损）
            const dataUrl = canvas.toDataURL('image/png')
            
            results.push({
              dataUrl,
              row,
              col,
              width: cellWidth,
              height: cellHeight
            })
          }
        }
        
        resolve(results)
      } catch (error) {
        reject(error)
      }
    }
    
    img.onerror = () => {
      reject(new Error('图片加载失败'))
    }
    
    img.src = imageUrl
  })
}

/**
 * 四宫格裁剪
 */
export async function cropToFourGrid(imageUrl: string): Promise<GridCropResult[]> {
  return cropToGrid(imageUrl, 2)
}

/**
 * 九宫格裁剪
 */
export async function cropToNineGrid(imageUrl: string): Promise<GridCropResult[]> {
  return cropToGrid(imageUrl, 3)
}

/**
 * 计算新节点在画布上的位置（避免重叠）
 * @param baseX 基准 X 坐标
 * @param baseY 基准 Y 坐标
 * @param index 节点索引
 * @param gridSize 宫格大小
 * @param spacing 节点间距
 */
export function calculateNodePosition(
  baseX: number,
  baseY: number,
  index: number,
  gridSize: 2 | 3,
  spacing: number = 320
): { x: number; y: number } {
  const row = Math.floor(index / gridSize)
  const col = index % gridSize
  
  return {
    x: baseX + col * spacing + 100,  // 向右偏移
    y: baseY + row * spacing
  }
}
