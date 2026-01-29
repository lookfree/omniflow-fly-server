/**
 * 服务模块统一导出
 */

export { viteManager, ViteDevServerManager } from './vite-manager';
export { dependencyManager, DependencyManager } from './dependency-manager';
export { projectManager, ProjectManager } from './project-manager';
export { HmrWebSocketProxy } from './hmr-proxy';
export { generateScaffold, generateDefaultAppTsx } from './scaffolder';
