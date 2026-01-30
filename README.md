# Omniflow Fly Server

Dynamic build server on Fly.io, providing project preview and HMR hot reload capabilities for AI Site Generator.

## Features

- **Dynamic Project Preview**: Instant preview for AI-generated React projects
- **HMR Hot Reload**: Real-time updates via Vite dev server
- **Visual Editing**: Click-to-select elements with source code location tracking
- **Multi-Project Support**: Manage multiple projects simultaneously

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/) - High-performance JavaScript/TypeScript runtime
- **Framework**: [Hono](https://hono.dev/) - Lightweight web framework
- **Build Tool**: [Vite](https://vitejs.dev/) - Dynamic build and HMR
- **Deployment**: [Fly.io](https://fly.io/) - Edge computing platform

## Project Structure

```
├── src/
│   ├── index.ts              # Server entry point
│   ├── routes/               # API routes
│   ├── services/             # Core services
│   └── types/                # TypeScript definitions
├── packages/
│   ├── vite-plugin-jsx-tagger/   # JSX element tagging plugin
│   └── visual-editor/            # Visual editor injection script
├── static/                   # Static files
├── Dockerfile               # Container build config
└── fly.toml                 # Fly.io deployment config
```

## Workspace Packages

### vite-plugin-jsx-tagger

Vite plugin that injects `data-jsx-*` attributes into JSX elements at compile time:

- `data-jsx-id` - Unique element identifier
- `data-jsx-file` - Source file path
- `data-jsx-line` - Line number
- `data-jsx-col` - Column number

### visual-editor

Injection script for preview pages that enables:

- Element selection and highlighting
- Click event interception
- Source location extraction
- Parent window communication via postMessage

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/p/:projectId` | Project preview page |
| GET | `/p/:projectId/*` | Proxy static resources |
| POST | `/api/projects/:projectId/files` | Create/update files |
| DELETE | `/api/projects/:projectId` | Delete project |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Service port | 3000 |
| `DATA_DIR` | Project data directory | /data/sites |

## Local Development

```bash
# Install dependencies
bun install

# Build workspace packages
cd packages/vite-plugin-jsx-tagger && bun install && bun run build
cd ../visual-editor && bun install && bun run build
cd ../..

# Start dev server
DATA_DIR=./data/sites bun run dev

# Type check
bun run typecheck

# Run tests
bun test
```

## Deployment

```bash
# Deploy to Fly.io (builds packages automatically)
bun run deploy

# Or manually
fly deploy --remote-only
```

## Architecture

### Port Architecture

| Port | Service | Purpose |
|------|---------|---------|
| `3000` | Hono Server | Main API, routing, and proxy |
| `5200-5219` | Vite Dev Servers | One per project preview (up to 20 concurrent) |

Each project preview runs its own Vite dev server on a dedicated port:

```
Project A → Vite on port 5200
Project B → Vite on port 5201
Project C → Vite on port 5202
...
```

This enables **up to 20 concurrent project previews** with independent HMR hot reload.

### Request Flow

1. User visits `/p/{projectId}`
2. Server looks up project directory
3. If project doesn't exist, creates scaffold
4. Starts/reuses Vite dev server on next available port (5200-5219)
5. Proxies request to Vite, injects visual-edit-script
6. HMR updates pushed via WebSocket

### Visual Editing Data Flow

```
User clicks element in preview
        ↓
visual-edit-script.js captures click
        ↓
Reads data-jsx-* attributes (file, line, column)
        ↓
postMessage sent to parent window
        ↓
Parent updates source code via API
        ↓
fly-server writes file to disk
        ↓
Vite HMR detects change and refreshes preview
```

### Scaffold Generation

When a new project is created, the server generates:

- `package.json` - Dependencies including React, Vite, Tailwind
- `vite.config.ts` - Vite config with jsx-tagger plugin
- `index.html` - Entry HTML file
- `src/` - Source directory with initial components

## Docker Configuration

```dockerfile
EXPOSE 3000        # Main Hono server
EXPOSE 5200-5219   # Vite dev server port range
```

The container exposes 21 ports total to support concurrent project previews.

## License

MIT
