/**
 * Project API Routes
 *
 * All routes in this file require authentication via API Key + HMAC signature.
 * The auth middleware stores the raw request body in context after verification.
 */

import { Hono } from 'hono';
import { projectManager } from '../services/project-manager';
import type { ProjectConfig, FileUpdate, ApiResponse } from '../types';

const app = new Hono();

/**
 * Helper to get parsed JSON body from context
 * Auth middleware consumes the body for signature verification,
 * so we retrieve it from the stored rawBody in context.
 */
function getBody<T>(c: { get: (key: string) => unknown }): T | null {
  const rawBody = c.get('rawBody') as string | undefined;
  if (!rawBody) return null;
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    return null;
  }
}

/**
 * POST /projects - Create project
 */
app.post('/', async (c) => {
  try {
    const config = getBody<ProjectConfig>(c);

    if (!config || !config.projectId || !config.projectName) {
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
 * GET /projects/:id - Get project status
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
 * DELETE /projects/:id - Delete project
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
 * PUT /projects/:id/files - Update project files
 */
app.put('/:id/files', async (c) => {
  try {
    const projectId = c.req.param('id');
    const body = getBody<{ updates: FileUpdate[] }>(c);

    if (!body || !body.updates || !Array.isArray(body.updates)) {
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
 * GET /projects/:id/files - List project files
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
 * GET /projects/:id/files/:path - Read single file
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
 * POST /projects/:id/preview/start - Start preview
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
 * POST /projects/:id/preview/stop - Stop preview
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
 * POST /projects/:id/dependencies - Add dependency
 */
app.post('/:id/dependencies', async (c) => {
  try {
    const projectId = c.req.param('id');
    const body = getBody<{ package: string; dev?: boolean }>(c);

    if (!body || !body.package) {
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
 * DELETE /projects/:id/dependencies/:package - Remove dependency
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
