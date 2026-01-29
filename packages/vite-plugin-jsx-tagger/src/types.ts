/**
 * JSX 元素的源码位置信息
 */
export interface JsxLocation {
  /** 唯一标识 ID */
  id: string;
  /** 源文件路径 */
  file: string;
  /** 行号 (1-based) */
  line: number;
  /** 列号 (0-based) */
  column: number;
  /** HTML 元素名称 */
  element: string;
}

/**
 * Vite 插件配置选项
 */
export interface JsxTaggerOptions {
  /** 是否在生产环境中移除标记 */
  removeInProduction?: boolean;
  /** 要排除的文件模式 (glob patterns) */
  exclude?: string[];
  /** 自定义 ID 前缀 */
  idPrefix?: string;
}

/**
 * Babel 插件配置选项
 */
export interface BabelPluginOptions {
  /** 源码映射管理器实例 */
  sourceMapManager: SourceMapManagerInterface;
  /** 当前处理的文件路径 */
  filePath: string;
  /** ID 前缀 */
  idPrefix?: string;
}

/**
 * 源码映射管理器接口
 */
export interface SourceMapManagerInterface {
  set(id: string, location: JsxLocation): void;
  get(id: string): JsxLocation | undefined;
  getAll(): Record<string, JsxLocation>;
  clear(): void;
  delete(id: string): boolean;
  getByFile(filePath: string): JsxLocation[];
  getByLineRange(filePath: string, startLine: number, endLine: number): JsxLocation[];
}

/**
 * API 响应格式
 */
export interface SourceMapApiResponse {
  success: boolean;
  data?: JsxLocation | Record<string, JsxLocation>;
  error?: string;
}
