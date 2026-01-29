# AI Site Generator - Fly Server

Fly.io 动态构建服务器，为 AI Site Generator 提供项目预览和 HMR 热更新能力。

## 项目结构

```
fly-server/
├── src/
│   ├── index.ts              # Hono 服务器入口，路由注册
│   ├── routes/
│   │   ├── health.ts         # 健康检查路由
│   │   └── projects.ts       # 项目文件 CRUD 路由
│   ├── services/
│   │   ├── index.ts          # 服务统一导出
│   │   ├── project-manager.ts # 项目生命周期管理
│   │   ├── scaffolder.ts     # 项目脚手架生成（package.json, vite.config.ts）
│   │   ├── vite-manager.ts   # Vite 进程管理
│   │   ├── hmr-proxy.ts      # HMR WebSocket 代理
│   │   └── dependency-manager.ts # 依赖安装管理
│   └── types/
│       └── index.ts          # TypeScript 类型定义
├── fly.toml                  # Fly.io 部署配置
├── Dockerfile                # 容器构建配置
└── package.json              # Bun 依赖配置
```

## 技术栈

- **运行时**: Bun (高性能 JavaScript/TypeScript 运行时)
- **框架**: Hono (轻量级 Web 框架)
- **构建工具**: Vite (动态构建和 HMR)
- **部署**: Fly.io (边缘计算平台)
- **WebSocket**: ws (HMR 热更新)

## Workspace 包依赖

fly-server 的可视化编辑功能依赖 `packages/` 目录下的两个核心包：

```
packages/
├── vite-plugin-jsx-tagger/   # JSX 元素标记插件
│   └── src/index.ts          # Vite 插件，为 JSX 添加 data-jsx-* 属性
└── visual-editor/            # 可视化编辑器核心
    └── dist/injection/
        └── visual-edit-script.js  # 注入到预览页面的脚本
```

### vite-plugin-jsx-tagger
**使用位置**: `src/services/scaffolder.ts`

- 生成的项目 `package.json` 包含此依赖
- 生成的 `vite.config.ts` 导入并使用此插件
- **作用**: 在构建时为每个 JSX 元素添加定位属性：
  - `data-jsx-id` - 元素唯一标识
  - `data-jsx-file` - 源文件路径
  - `data-jsx-line` - 源码行号
  - `data-jsx-col` - 源码列号

### visual-editor
**使用位置**: `src/index.ts`

- 静态文件服务从 `packages/visual-editor/dist/injection/` 加载
- 通过 `/static/injection/*` 路由提供
- **作用**: `visual-edit-script.js` 实现：
  - 元素选中高亮
  - 点击事件拦截
  - 读取 `data-jsx-*` 属性获取源码位置
  - 与父窗口 postMessage 通信

### 可视化编辑数据流

```
用户点击预览中的元素
        ↓
visual-edit-script.js 捕获点击
        ↓
读取 data-jsx-* 属性（来自 jsx-tagger）
        ↓
postMessage 发送到 frontend
        ↓
frontend 调用 backend API 更新代码
        ↓
fly-server 写入文件 → Vite HMR 更新
```

## 核心功能

### 1. 项目脚手架 (scaffolder.ts)
- 生成 React + TypeScript + Tailwind 项目模板
- 集成 `vite-plugin-jsx-tagger` 用于可视化编辑
- 生成 `vite.config.ts` 和 `package.json`

### 2. Vite 进程管理 (vite-manager.ts)
- 动态启动/停止 Vite dev server
- 管理多个项目的构建进程
- 处理进程生命周期和错误恢复

### 3. HMR 代理 (hmr-proxy.ts)
- WebSocket 代理，支持跨域 HMR
- 将 backend 的文件更新通知转发给浏览器
- 路径: `/hmr`

### 4. Visual Edit 脚本注入 (index.ts)
- 在 HTML 响应中注入 `visual-edit-script.js`
- 脚本来自 `packages/visual-editor/dist/injection/`
- 支持元素选中、高亮、拖拽等可视化编辑功能

## API 端点

### 健康检查
- `GET /health` - 服务健康状态

### 项目管理
- `GET /p/:projectId` - 获取项目预览页面
- `GET /p/:projectId/*` - 代理静态资源
- `POST /api/projects/:projectId/files` - 创建/更新文件
- `DELETE /api/projects/:projectId` - 删除项目

## 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 3000 |
| `DATA_DIR` | 项目数据目录 | /data/sites |

## 本地开发

```bash
# 安装依赖
bun install

# 启动开发服务器（需要设置 DATA_DIR）
DATA_DIR=./data/sites bun run dev

# 类型检查
bun run typecheck
```

## 部署

```bash
# 1. 如果修改了 packages/visual-editor，先构建并复制注入脚本
cd ../packages/visual-editor && bun run build
cp dist/injection/visual-edit-script.js ../fly-server/static/injection/

# 2. 部署到 Fly.io
cd ../fly-server && fly deploy
```

**重要**: 修改 `packages/visual-editor/injection/visual-edit-script.ts` 后，必须手动复制到 `fly-server/static/injection/` 再部署。

## 架构说明

### 请求流程
1. 用户访问 `/p/{projectId}`
2. fly-server 查找项目目录
3. 如果项目不存在，创建脚手架
4. 启动/复用 Vite dev server
5. 代理请求到 Vite，注入 visual-edit-script
6. HMR 更新通过 WebSocket 推送

### 与 Backend 的交互
- Backend 通过 `POST /api/projects/:projectId/files` 写入文件
- 文件写入后，Vite HMR 自动触发浏览器更新
- Backend proxy (`/api/proxy/:projectId`) 代理到 fly-server

## 开发注意事项

- **包依赖构建**: 本地开发前需先构建 workspace 包：
  ```bash
  cd ../packages/vite-plugin-jsx-tagger && bun run build
  cd ../packages/visual-editor && bun run build
  ```
- 项目目录在容器中位于 `/data/sites/{projectId}`
- Vite 进程会在项目首次访问时启动
- HMR WebSocket 需要正确的跨域配置
- 日志使用 `[Server]`、`[Vite]`、`[HMR]` 等前缀
- 修改 `visual-editor` 包后需重新构建并部署 fly-server
