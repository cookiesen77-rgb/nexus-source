# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nexus 是一款基于 Vue 3 的可视化节点画布，用于搭建 AI 工作流。用户可以拖拽节点在无限画布上构建文生图、图生视频、音频生成、多场景分镜等自动化流程。

**Tech Stack**: Vue 3 + Vite + Vue Flow + Naive UI + Tailwind CSS

## Development Commands

```bash
npm install              # Install dependencies
npm run dev             # Start dev server at localhost:5173/nexus
npm run build           # Production build
npm run preview         # Preview production build

# Desktop builds (see ELECTRON_SETUP.md and TAURI_SETUP.md for details)
npm run dev:electron    # Start Electron app (requires concurrently & wait-on)
npm run build:electron  # Package Electron app → release/
npm run dev:tauri       # Start Tauri app (requires Rust toolchain)
npm run build:tauri     # Package Tauri app
```

**Deployment modes** (configured in vite.config.js):
- Web: `base: '/nexus'` with history routing
- Desktop (Electron/Tauri): `base: './'` with hash routing

## Architecture

### State Management Pattern

This project uses **Vue 3 refs/reactive directly** instead of Pinia:

- Store files in `/stores/*.js` export reactive refs (not Pinia stores)
- Watch patterns trigger auto-save and derived state updates
- Canvas state auto-saves to localStorage with 500ms debouncing
- Undo/redo implemented via state snapshots (max 50 history entries)

**Key stores**:
- `src/stores/canvas.js` - Nodes, edges, viewport, undo/redo, auto-save
- `src/stores/projects.js` - Project CRUD with localStorage persistence
- `src/stores/api.js` - API configuration (key, base URL)
- `src/stores/models.js` - Built-in model configurations and helpers
- `src/stores/assets.js` - Asset history tracking (IndexedDB storage)
- `src/stores/theme.js` - Theme management

### Workflow Orchestration System

The core feature is **automatic workflow execution** via `src/hooks/useWorkflowOrchestrator.js`:

1. User enters a prompt in "auto-execute" mode
2. LLM analyzes intent and determines workflow type
3. System creates node tree dynamically with connections
4. Nodes execute serially, waiting for dependencies to complete
5. Results displayed in output nodes

**Workflow types** (defined in `src/config/workflows.js`):
- `text_to_image` - Simple prompt → image
- `text_to_image_to_video` - Prompt → image → video pipeline
- `storyboard` - Multi-scene generation with character consistency
- `multi_angle_storyboard` - 4 camera angles × 4 scales (16 images total)

**Execution pattern**: Uses `waitForConfigComplete()` and `waitForOutputReady()` helpers to poll node status and handle async completion.

### Node/Edge System

Built on Vue Flow with 6 custom node types:

| Type | Component | Purpose |
|------|-----------|---------|
| `text` | TextNode.vue | User input for prompts |
| `imageConfig` | ImageConfigNode.vue | Image generation settings |
| `image` | ImageNode.vue | Display generated/uploaded images |
| `videoConfig` | VideoConfigNode.vue | Video generation settings |
| `video` | VideoNode.vue | Display generated videos |
| `audio` | AudioNode.vue | Display generated audio (Suno) |

**Custom edge**: `src/components/edges/ImageRoleEdge.vue` allows passing reference images between nodes for character consistency.

**Node structure**:
```javascript
{
  id: string,
  type: 'text' | 'imageConfig' | 'image' | 'videoConfig' | 'video' | 'audio',
  position: { x, y },
  data: { /* type-specific fields */ },
  // ...Vue Flow properties
}
```

**Extensibility**: To add new node types:
1. Create component in `/components/nodes/`
2. Add type to canvas store defaults
3. Register in Canvas.vue `nodeTypes` object
4. Add corresponding API service if needed

### API Layer Architecture

Three-layer pattern for API calls:

1. **Service layer** (`/api/*.js`) - Direct API endpoint wrappers
   - `src/api/image.js` - Image generation
   - `src/api/video.js` - Video generation with polling
   - `src/api/chat.js` - LLM completions with streaming
   - `src/api/audio.js` - Audio generation (Suno)

2. **Composition layer** (`src/hooks/useApi.js`) - Higher-level logic (error handling, retries, state updates)

3. **HTTP client** (`src/utils/request.js`) - Axios instance with auth interceptors

**API configuration**:
- Base URL proxied in `vite.config.js`: `/v1/*` → `https://nexusapi.cn`
- Supports any OpenAI-compatible endpoint
- API key stored in localStorage, injected via Authorization header
- Models defined in `src/config/models.js`

### Advanced Features

**Director Console** (`DirectorConsole.vue`):
- Storyboard planning interface with character management
- Multi-scene generation with reference image linking
- Camera angle and scale grid generation
- Integrated with workflow orchestrator for automatic node creation

**Sonic Studio** (`SonicStudio.vue`):
- Audio generation interface using Suno API
- Supports music generation and lyrics generation modes
- Polling mechanism for task completion
- Audio output integrated with canvas nodes

**Prompt Polish** (`src/hooks/usePolish.js`):
- Context-aware prompt optimization using canvas graph structure
- Retrieval-based enrichment from prompt libraries
- BFS-based node relationship scoring for relevance
- Supports image, video, and script polishing modes
- Uses camera move library (`src/assets/prompt-libraries/chos_camera_moves.json`)

**Smart Components**:
- `HistoryPanel.vue` - Asset history with IndexedDB storage
- `ImageCropper.vue` - Built-in image cropping tool
- `SketchEditor.vue` - Sketch-based input
- `SmartSequenceDock.vue` - Sequence management UI
- `PromptLibraryModal.vue` - Prompt template library

### Project Persistence

Projects metadata stored in **localStorage** under key `"ai-canvas-projects-meta"`, and large canvas data stored in **IndexedDB**:

```javascript
{
  id: string,
  name: string,
  thumbnail: string,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

**Storage strategy**:
- Metadata → localStorage (fast access for project list)
- Canvas data (nodes/edges/viewport) → IndexedDB (handles large data)
- Asset history → IndexedDB (`nexus-ai-assets` database)
- Auto-save on every change (debounced 500ms)
- No backend required

## Key Patterns

- **Reference linking**: ImageRoleEdge connects reference images to generation nodes for consistency
- **Serial execution**: Workflow orchestrator uses `await waitForConfigComplete()` to ensure dependencies finish before next step
- **Streaming responses**: Chat API uses fetch + SSE instead of Axios for streaming prompt optimization
- **Context-aware polish**: `usePolish` hook analyzes canvas graph topology to improve prompt quality
- **Hybrid storage**: localStorage for fast metadata, IndexedDB for large assets
- **Polling pattern**: Video and audio APIs use polling with exponential backoff for async task completion
- **No TypeScript**: Plain JavaScript with clear naming conventions
- **Mobile-aware**: Canvas component includes mobile detection for touch support

## Configuration

First-time setup requires API configuration via settings modal (⚙️ icon):
1. Enter API Base URL (default: uses vite.config.js proxy)
2. Enter API Key
3. Select models from dropdowns (populated from /config/models.js)

API credentials persist in localStorage across sessions.

## Desktop Packaging

**Electron** (see `ELECTRON_SETUP.md`):
- Main process: `electron/main.js`
- Output: `release/` directory
- macOS code signing requires `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

**Tauri** (see `TAURI_SETUP.md`):
- Rust core: `src-tauri/`
- Requires Rust toolchain + platform SDKs
- Custom command: `cache_image` for bypassing CORS

Both use hash routing and relative paths (`base: './'`) configured via Vite mode detection.
