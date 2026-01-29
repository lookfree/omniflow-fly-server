/**
 * 项目 API 路由
 */

import { Hono } from 'hono';
import { projectManager } from '../services/project-manager';
import { viteManager } from '../services/vite-manager';
import type { ProjectConfig, FileUpdate, ApiResponse } from '../types';

const app = new Hono();

/**
 * POST /projects - 创建项目
 */
app.post('/', async (c) => {
  try {
    const config = await c.req.json<ProjectConfig>();

    if (!config.projectId || !config.projectName) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Missing required fields: projectId, projectName',
      }, 400);
    }

    const result = await projectManager.createProject(config);

    return c.json<ApiResponse>({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[API] Create project error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * GET /projects/:id - 获取项目状态
 */
app.get('/:id', async (c) => {
  try {
    const projectId = c.req.param('id');
    const status = await projectManager.getStatus(projectId);

    return c.json<ApiResponse>({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('[API] Get project error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * DELETE /projects/:id - 删除项目
 */
app.delete('/:id', async (c) => {
  try {
    const projectId = c.req.param('id');
    await projectManager.deleteProject(projectId);

    return c.json<ApiResponse>({
      success: true,
    });
  } catch (error) {
    console.error('[API] Delete project error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * PUT /projects/:id/files - 更新项目文件
 */
app.put('/:id/files', async (c) => {
  try {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ updates: FileUpdate[] }>();

    if (!body.updates || !Array.isArray(body.updates)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Missing or invalid updates array',
      }, 400);
    }

    await projectManager.updateFiles(projectId, body.updates);

    return c.json<ApiResponse>({
      success: true,
    });
  } catch (error) {
    console.error('[API] Update files error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * GET /projects/:id/files - 列出项目文件
 */
app.get('/:id/files', async (c) => {
  try {
    const projectId = c.req.param('id');
    const files = await projectManager.listFiles(projectId);

    return c.json<ApiResponse>({
      success: true,
      data: { files },
    });
  } catch (error) {
    console.error('[API] List files error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * GET /projects/:id/files/:path - 读取单个文件
 */
app.get('/:id/files/*', async (c) => {
  try {
    const projectId = c.req.param('id');
    const filePath = c.req.path.replace(`/projects/${projectId}/files/`, '');

    if (!filePath) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Missing file path',
      }, 400);
    }

    const content = await projectManager.readFile(projectId, filePath);

    if (content === null) {
      return c.json<ApiResponse>({
        success: false,
        error: 'File not found',
      }, 404);
    }

    return c.json<ApiResponse>({
      success: true,
      data: { path: filePath, content },
    });
  } catch (error) {
    console.error('[API] Read file error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /projects/:id/preview/start - 启动预览
 */
app.post('/:id/preview/start', async (c) => {
  try {
    const projectId = c.req.param('id');
    const result = await projectManager.startPreview(projectId);

    return c.json<ApiResponse>({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[API] Start preview error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /projects/:id/preview/stop - 停止预览
 */
app.post('/:id/preview/stop', async (c) => {
  try {
    const projectId = c.req.param('id');
    await projectManager.stopPreview(projectId);

    return c.json<ApiResponse>({
      success: true,
    });
  } catch (error) {
    console.error('[API] Stop preview error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /projects/:id/reinstall - Force reinstall dependencies
 */
app.post('/:id/reinstall', async (c) => {
  try {
    const projectId = c.req.param('id');
    await projectManager.reinstallDependencies(projectId);

    return c.json<ApiResponse>({
      success: true,
    });
  } catch (error) {
    console.error('[API] Reinstall error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /projects/:id/dependencies - 添加依赖
 */
app.post('/:id/dependencies', async (c) => {
  try {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ package: string; dev?: boolean }>();

    if (!body.package) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Missing package name',
      }, 400);
    }

    await projectManager.addDependency(projectId, body.package, body.dev ?? false);

    return c.json<ApiResponse>({
      success: true,
    });
  } catch (error) {
    console.error('[API] Add dependency error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * DELETE /projects/:id/dependencies/:package - 移除依赖
 */
app.delete('/:id/dependencies/:package', async (c) => {
  try {
    const projectId = c.req.param('id');
    const packageName = c.req.param('package');

    await projectManager.removeDependency(projectId, packageName);

    return c.json<ApiResponse>({
      success: true,
    });
  } catch (error) {
    console.error('[API] Remove dependency error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default app;
