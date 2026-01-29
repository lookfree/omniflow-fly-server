/**
 * Fly-Server Type Definitions
 */

import type { ChildProcess } from 'child_process';

/** Vite instance status */
export type ViteStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

/** Vite Dev Server instance */
export interface ViteInstance {
  projectId: string;
  port: number;
  process: ChildProcess;
  startedAt: Date;
  lastActive: Date;
  status: ViteStatus;
}

/** Vite manager configuration */
export interface ViteManagerConfig {
  basePort: number;
  maxInstances: number;
  idleTimeout: number;
  startupTimeout: number;
}

/** Project configuration */
export interface ProjectConfig {
  projectId: string;
  projectName: string;
  description?: string;
  /** User's source code files (optional, used to override template) */
  files?: ProjectFile[];
}

/** Project file */
export interface ProjectFile {
  path: string;
  content: string;
  language?: 'tsx' | 'ts' | 'css' | 'json' | 'html';
}

/** Project status */
export interface ProjectStatus {
  exists: boolean;
  devServerRunning: boolean;
  port?: number;
  fileCount: number;
  lastModified?: Date;
}

/** File update operation */
export interface FileUpdate {
  path: string;
  content: string;
  operation: 'create' | 'update' | 'delete';
}

/** Dependency installation result */
export interface InstallResult {
  success: boolean;
  duration: number;
  logs: string[];
}

/** HMR message */
export interface HmrMessage {
  type: string;
  [key: string]: unknown;
}

/** Log event */
export interface LogEvent {
  projectId: string;
  type: 'stdout' | 'stderr';
  message: string;
}

/** Exit event */
export interface ExitEvent {
  projectId: string;
  code: number | null;
}

/** Scaffold generation result */
export interface ScaffoldResult {
  success: boolean;
  files: Array<{ path: string; content: string }>;
}

/** API response */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Project creation result */
export interface CreateProjectResult {
  projectPath: string;
  port: number;
  previewUrl: string;
  hmrUrl: string;
}
