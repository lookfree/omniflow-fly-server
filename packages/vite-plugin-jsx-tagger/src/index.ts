import type { Plugin, ViteDevServer } from 'vite';
import { transformSync } from '@babel/core';
import { jsxTaggerBabelPlugin } from './babel-plugin';
import { SourceMapManager } from './source-map';
import type { JsxTaggerOptions } from './types';

// 导出类型
export type { JsxTaggerOptions, JsxLocation } from './types';
export { SourceMapManager } from './source-map';
export { generateStableId, parseJsxId, isValidJsxId } from './id-generator';

/**
 * 检查文件是否应该被处理
 */
function shouldTransform(id: string, exclude?: string[]): boolean {
  // 仅处理 JSX/TSX
  if (!/\.[jt]sx$/.test(id)) return false;

  // 排除 node_modules
  if (id.includes('node_modules')) return false;

  // 检查排除模式
  if (exclude) {
    for (const pattern of exclude) {
      if (id.includes(pattern)) return false;
    }
  }

  return true;
}

/**
 * 处理源码映射查询请求
 */
function handleSourceMapRequest(
  _req: { url?: string; headers: { host?: string } },
  res: {
    setHeader: (name: string, value: string) => void;
    statusCode?: number;
    end: (data: string) => void;
  },
  sourceMapManager: SourceMapManager
): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify({
    success: true,
    data: sourceMapManager.getAll(),
    count: sourceMapManager.size
  }));
}

/**
 * 处理单个 JSX ID 定位请求
 */
function handleLocateRequest(
  req: { url?: string; headers: { host?: string } },
  res: {
    setHeader: (name: string, value: string) => void;
    statusCode?: number;
    end: (data: string) => void;
  },
  sourceMapManager: SourceMapManager
): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const jsxId = url.searchParams.get('id');

  if (!jsxId) {
    res.statusCode = 400;
    res.end(JSON.stringify({ success: false, error: 'Missing id parameter' }));
    return;
  }

  const location = sourceMapManager.get(jsxId);
  if (location) {
    res.end(JSON.stringify({ success: true, data: location }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, error: 'JSX ID not found' }));
  }
}

/**
 * 处理按文件查询请求
 */
function handleFileRequest(
  req: { url?: string; headers: { host?: string } },
  res: {
    setHeader: (name: string, value: string) => void;
    statusCode?: number;
    end: (data: string) => void;
  },
  sourceMapManager: SourceMapManager
): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const filePath = url.searchParams.get('file');

  if (!filePath) {
    res.statusCode = 400;
    res.end(JSON.stringify({ success: false, error: 'Missing file parameter' }));
    return;
  }

  const locations = sourceMapManager.getByFile(filePath);
  res.end(JSON.stringify({
    success: true,
    data: locations,
    count: locations.length
  }));
}

/**
 * Vite JSX Tagger 插件
 *
 * 在编译时为所有原生 HTML 元素注入 data-jsx-* 属性，
 * 用于实现 Lovable 风格的 Visual Edit 功能。
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { jsxTaggerPlugin } from 'vite-plugin-jsx-tagger';
 *
 * export default defineConfig({
 *   plugins: [
 *     jsxTaggerPlugin({
 *       idPrefix: 'myapp',
 *       removeInProduction: false
 *     }),
 *     react()
 *   ]
 * });
 * ```
 */
export function jsxTaggerPlugin(options: JsxTaggerOptions = {}): Plugin {
  const sourceMapManager = new SourceMapManager();
  const isDev = process.env.NODE_ENV !== 'production';

  return {
    name: 'vite-plugin-jsx-tagger',
    enforce: 'pre',

    transform(code: string, id: string) {
      // 检查是否应该处理
      if (!shouldTransform(id, options.exclude)) return null;

      // 生产环境可选跳过
      if (!isDev && options.removeInProduction) return null;

      // 文件更新时清除旧的映射
      sourceMapManager.clearFile(id);

      try {
        const result = transformSync(code, {
          filename: id,
          plugins: [
            ['@babel/plugin-syntax-typescript', { isTSX: true }],
            [jsxTaggerBabelPlugin, {
              sourceMapManager,
              filePath: id,
              idPrefix: options.idPrefix
            }],
          ],
          sourceMaps: true,
          configFile: false,
          babelrc: false,
        });

        if (!result || !result.code) return null;

        return {
          code: result.code,
          map: result.map,
        };
      } catch (error) {
        console.error(`[vite-plugin-jsx-tagger] Error transforming ${id}:`, error);
        return null;
      }
    },

    configureServer(server: ViteDevServer) {
      // 源码映射查询 API - 获取所有映射
      server.middlewares.use('/__jsx-source-map', (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          next();
          return;
        }
        handleSourceMapRequest(req, res, sourceMapManager);
      });

      // 单个 JSX ID 定位 API
      server.middlewares.use('/__jsx-locate', (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          next();
          return;
        }
        handleLocateRequest(req, res, sourceMapManager);
      });

      // 按文件查询 API
      server.middlewares.use('/__jsx-by-file', (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          next();
          return;
        }
        handleFileRequest(req, res, sourceMapManager);
      });
    },

    // 暴露 sourceMapManager 供其他插件使用
    api: {
      getSourceMapManager: () => sourceMapManager,
    },
  };
}

// 默认导出
export default jsxTaggerPlugin;
