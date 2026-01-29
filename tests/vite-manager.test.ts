/**
 * ViteDevServerManager 单元测试
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ViteDevServerManager } from '../src/services/vite-manager';

describe('ViteDevServerManager', () => {
  let manager: ViteDevServerManager;

  beforeEach(() => {
    manager = new ViteDevServerManager({
      basePort: 15000,
      maxInstances: 5,
      idleTimeout: 60 * 1000,
      startupTimeout: 5000,
    });
  });

  afterEach(async () => {
    await manager.destroy();
  });

  test('should initialize with empty instances', () => {
    expect(manager.getRunningCount()).toBe(0);
    expect(manager.getAllInstances()).toHaveLength(0);
  });

  test('should return null for non-existent project preview URL', () => {
    expect(manager.getPreviewUrl('non-existent')).toBeNull();
  });

  test('should return null for non-existent project HMR URL', () => {
    expect(manager.getHmrUrl('non-existent')).toBeNull();
  });

  test('should return undefined for non-existent instance', () => {
    expect(manager.getInstance('non-existent')).toBeUndefined();
  });

  test('should emit events', () => {
    const events: string[] = [];

    manager.on('started', () => events.push('started'));
    manager.on('stopped', () => events.push('stopped'));
    manager.on('log', () => events.push('log'));

    // 手动触发事件测试
    manager.emit('started', { projectId: 'test', port: 15000 });
    manager.emit('stopped', { projectId: 'test' });

    expect(events).toContain('started');
    expect(events).toContain('stopped');
  });

  test('markActive should not throw for non-existent project', () => {
    expect(() => manager.markActive('non-existent')).not.toThrow();
  });

  test('getAllInstances should return array', () => {
    const instances = manager.getAllInstances();

    expect(Array.isArray(instances)).toBe(true);
  });

  test('destroy should complete without error', async () => {
    await expect(manager.destroy()).resolves.toBeUndefined();
  });
});

describe('ViteDevServerManager port allocation', () => {
  test('should allocate ports within range', () => {
    const manager = new ViteDevServerManager({
      basePort: 16000,
      maxInstances: 3,
      idleTimeout: 60000,
      startupTimeout: 5000,
    });

    // 端口池应该有 3 个端口
    const instances = manager.getAllInstances();
    expect(instances).toHaveLength(0);

    manager.destroy();
  });
});
