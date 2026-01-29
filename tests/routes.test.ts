/**
 * API 路由测试
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import healthRoutes from '../src/routes/health';

describe('Health Routes', () => {
  const app = new Hono();
  app.route('/health', healthRoutes);

  test('GET /health should return ok status', async () => {
    const res = await app.request('/health');

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });

  test('GET /health/ready should return ready status', async () => {
    const res = await app.request('/health/ready');

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ready');
  });

  test('GET /health/live should return alive status', async () => {
    const res = await app.request('/health/live');

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('alive');
  });

  test('GET /metrics should return metrics object', async () => {
    const res = await app.request('/health/metrics');

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.vite).toBeDefined();
    expect(body.vite.running).toBeDefined();
    expect(body.uptime).toBeDefined();
    expect(body.memory).toBeDefined();
  });

  test('GET /debug/instances should return instances array', async () => {
    const res = await app.request('/health/debug/instances');

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.instances).toBeDefined();
    expect(Array.isArray(body.data.instances)).toBe(true);
  });
});
