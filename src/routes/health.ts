/**
 * Health Check and Monitoring Routes
 */

import { Hono } from 'hono';
import { viteManager } from '../services/vite-manager';
import type { ApiResponse } from '../types';

const app = new Hono();

/**
 * GET /health - Basic health check
 */
app.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ready - Readiness check
 */
app.get('/ready', (c) => {
  return c.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/live - Liveness check
 */
app.get('/live', (c) => {
  return c.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /metrics - Service metrics
 */
app.get('/metrics', (c) => {
  const instances = viteManager.getAllInstances();

  const metrics = {
    vite: {
      running: instances.filter(i => i.status === 'running').length,
      starting: instances.filter(i => i.status === 'starting').length,
      error: instances.filter(i => i.status === 'error').length,
      total: instances.length,
    },
    instances: instances.map(i => ({
      projectId: i.projectId,
      port: i.port,
      status: i.status,
      lastActive: i.lastActive.toISOString(),
    })),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  };

  return c.json(metrics);
});

/**
 * GET /debug/instances - Debug: View all instances
 */
app.get('/debug/instances', (c) => {
  const instances = viteManager.getAllInstances();

  return c.json<ApiResponse>({
    success: true,
    data: {
      count: instances.length,
      instances,
    },
  });
});

export default app;
