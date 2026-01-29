/**
 * Fly-Server 类型定义
 */

import type { ChildProcess } from 'child_process';

/** Vite 实例状态 */
export type ViteStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

/** Vite Dev Server 实例 */
export interface ViteInstance {
  projectId: string;
  port: number;
  process: ChildProcess;
  startedAt: Date;
  lastActive: Date;
  status: ViteStatus;
}

/** Vite 管理器配置 */
export interface ViteManagerConfig {
  basePort: number;
  maxInstances: number;
  idleTimeout: number;
  startupTimeout: number;
}

/** 项目配置 */
export interface ProjectConfig {
  projectId: string;
  projectName: string;
  description: string;
}

/** 项目文件 */
export interface ProjectFile {
  path: string;
  content: string;
  language?: 'tsx' | 'ts' | 'css' | 'json' | 'html';
}

/** 项目状态 */
export interface ProjectStatus {
  exists: boolean;
  devServerRunning: boolean;
  port?: number;
  fileCount: number;
  lastModified?: Date;
}

/** 文件更新操作 */
export interface FileUpdate {
  path: string;
  content: string;
  operation: 'create' | 'update' | 'delete';
}

/** 依赖安装结果 */
export interface InstallResult {
  success: boolean;
  duration: number;
  logs: string[];
}

/** HMR 消息 */
export interface HmrMessage {
  type: string;
  [key: string]: unknown;
}

/** 日志事件 */
export interface LogEvent {
  projectId: string;
  type: 'stdout' | 'stderr';
  message: string;
}

/** 退出事件 */
export interface ExitEvent {
  projectId: string;
  code: number | null;
}

/** 脚手架生成结果 */
export interface ScaffoldResult {
  success: boolean;
  files: Array<{ path: string; content: string }>;
}

/** API 响应 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 项目创建结果 */
export interface CreateProjectResult {
  projectPath: string;
  port: number;
  previewUrl: string;
  hmrUrl: string;
}
