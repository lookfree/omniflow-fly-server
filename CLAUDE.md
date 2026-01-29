# AI Site Generator - Fly Server

Dynamic build server on Fly.io, providing project preview and HMR hot reload capabilities for AI Site Generator.

## Project Structure

```
fly-server/
├── src/
│   ├── index.ts              # Hono server entry, route registration
│   ├── routes/
│   │   ├── health.ts         # Health check route
│   │   └── projects.ts       # Project file CRUD routes
│   ├── services/
│   │   ├── index.ts          # Service exports
│   │   ├── project-manager.ts # Project lifecycle management
│   │   ├── scaffolder.ts     # Project scaffolding (package.json, vite.config.ts)
│   │   ├── vite-manager.ts   # Vite process management
│   │   ├── hmr-proxy.ts      # HMR WebSocket proxy
│   │   └── dependency-manager.ts # Dependency installation management
│   └── types/
│       └── index.ts          # TypeScript type definitions
├── fly.toml                  # Fly.io deployment config
├── Dockerfile                # Container build config
└── package.json              # Bun dependency config
```

## Tech Stack

- **Runtime**: Bun (high-performance JavaScript/TypeScript runtime)
- **Framework**: Hono (lightweight web framework)
- **Build Tool**: Vite (dynamic build and HMR)
- **Deployment**: Fly.io (edge computing platform)
- **WebSocket**: ws (HMR hot reload)

## Workspace Package Dependencies

The visual editing feature depends on two core packages in the `packages/` directory:

```
packages/
├── vite-plugin-jsx-tagger/           # JSX element tagging plugin
│   └── src/index.ts                  # Vite plugin, adds data-jsx-* attributes to JSX
└── visual-editor/                    # Visual editor core
    ├── src/injection/
    │   └── visual-edit-script.ts     # TypeScript source
    └── dist/injection/
        └── visual-edit-script.js     # Built script injected into preview pages
```

### vite-plugin-jsx-tagger
**Used in**: `src/services/scaffolder.ts`

- Generated project `package.json` includes this dependency
- Generated `vite.config.ts` imports and uses this plugin
- **Purpose**: Adds location attributes to each JSX element at build time:
  - `data-jsx-id` - Unique element identifier
  - `data-jsx-file` - Source file path
  - `data-jsx-line` - Source line number
  - `data-jsx-col` - Source column number

### visual-editor
**Used in**: `src/index.ts`

- Static files served from `packages/visual-editor/dist/injection/`
- Available via `/static/injection/*` route
- **Purpose**: `visual-edit-script.js` implements:
  - Element selection highlighting
  - Click event interception
  - Reading `data-jsx-*` attributes for source location
  - postMessage communication with parent window

### Visual Editing Data Flow

```
User clicks element in preview
        ↓
visual-edit-script.js captures click
        ↓
Reads data-jsx-* attributes (from jsx-tagger)
        ↓
postMessage sent to frontend
        ↓
frontend calls backend API to update code
        ↓
fly-server writes file → Vite HMR updates
```

## Core Features

### 1. Project Scaffolding (scaffolder.ts)
- Generates React + TypeScript + Tailwind project template
- Integrates `vite-plugin-jsx-tagger` for visual editing
- Generates `vite.config.ts` and `package.json`

### 2. Vite Process Management (vite-manager.ts)
- Dynamically starts/stops Vite dev server
- Manages build processes for multiple projects
- Handles process lifecycle and error recovery

### 3. HMR Proxy (hmr-proxy.ts)
- WebSocket proxy with cross-origin HMR support
- Forwards file update notifications from backend to browser
- Path: `/hmr`

### 4. Visual Edit Script Injection (index.ts)
- Injects `visual-edit-script.js` into HTML responses
- Script sourced from `packages/visual-editor/dist/injection/`
- Supports element selection, highlighting, drag-and-drop visual editing

## API Endpoints

### Health Check
- `GET /health` - Service health status

### Project Management
- `GET /p/:projectId` - Get project preview page
- `GET /p/:projectId/*` - Proxy static resources
- `POST /api/projects/:projectId/files` - Create/update files
- `DELETE /api/projects/:projectId` - Delete project

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Service port | 3000 |
| `DATA_DIR` | Project data directory | /data/sites |

## Local Development

```bash
# Install dependencies
bun install

# Start dev server (requires DATA_DIR)
DATA_DIR=./data/sites bun run dev

# Type check
bun run typecheck
```

## Deployment

```bash
# Deploy to Fly.io (automatically builds visual-editor and copies to static/injection)
bun run deploy

# Or manually:
# 1. Build visual-editor package
cd packages/visual-editor && bun install && bun run build && cd ../..

# 2. Copy built script to static/injection
mkdir -p static/injection && cp packages/visual-editor/dist/injection/visual-edit-script.js static/injection/

# 3. Deploy
fly deploy --remote-only
```

**Note**: The `bun run deploy` command handles all build steps automatically.

## Architecture

### Request Flow
1. User visits `/p/{projectId}`
2. fly-server looks up project directory
3. If project doesn't exist, create scaffold
4. Start/reuse Vite dev server
5. Proxy request to Vite, inject visual-edit-script
6. HMR updates pushed via WebSocket

### Backend Interaction
- Backend writes files via `POST /api/projects/:projectId/files`
- After file write, Vite HMR automatically triggers browser update
- Backend proxy (`/api/proxy/:projectId`) proxies to fly-server

## Code Style

### Language Policy
- All project files MUST be written in English
- Code comments, documentation, and commit messages should be in English

### General Guidelines
- Write MINIMAL code needed - avoid verbose implementations
- Functions are verbs/verb phrases; use descriptive variable names (no 1-2 letter abbreviations)
- Prefer early returns; avoid deep nesting
- Use try/catch only when necessary; never swallow errors
- Comments only for non-obvious intent/constraints/edge cases
- Explicit types for exported/public APIs; avoid `any` and unsafe assertions
- Match existing project formatting; avoid mass reformatting

### Quality Requirements
- Changes must pass type checks and build
- Do not introduce new linter errors
- Keep type definitions in sync for API changes

### Important Notes
- Review related directories before adding features to maintain consistency
- New code should adhere to these rules
- NEVER auto-generate summary docs, documentation files, or test files unless explicitly requested

## Debugging

- For frontend display issues, check Chrome DevTools and console logs first to quickly locate specific problems

## Development Notes

- **Package dependency builds**: Build workspace packages before local development:
  ```bash
  cd packages/vite-plugin-jsx-tagger && bun install && bun run build
  cd ../visual-editor && bun install && bun run build
  ```
- Project directories are located at `/data/sites/{projectId}` in container
- Vite process starts on first project access
- HMR WebSocket requires proper cross-origin configuration
- Logs use `[Server]`, `[Vite]`, `[HMR]` prefixes
- After modifying `visual-editor` package, run `bun run deploy` to rebuild and redeploy
