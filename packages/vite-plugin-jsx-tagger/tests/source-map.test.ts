import { describe, it, expect, beforeEach } from 'vitest';
import { SourceMapManager } from '../src/source-map';
import type { JsxLocation } from '../src/types';

describe('SourceMapManager', () => {
  let manager: SourceMapManager;

  beforeEach(() => {
    manager = new SourceMapManager();
  });

  const createLocation = (overrides: Partial<JsxLocation> = {}): JsxLocation => ({
    id: 'test-12345678',
    file: '/src/App.tsx',
    line: 10,
    column: 5,
    element: 'div',
    ...overrides,
  });

  describe('基本操作', () => {
    it('应该能够设置和获取位置信息', () => {
      const location = createLocation();
      manager.set(location.id, location);

      const result = manager.get(location.id);
      expect(result).toEqual(location);
    });

    it('应该返回 undefined 对于不存在的 ID', () => {
      const result = manager.get('non-existent');
      expect(result).toBeUndefined();
    });

    it('应该能够删除位置信息', () => {
      const location = createLocation();
      manager.set(location.id, location);

      const deleted = manager.delete(location.id);
      expect(deleted).toBe(true);
      expect(manager.get(location.id)).toBeUndefined();
    });

    it('删除不存在的 ID 应该返回 false', () => {
      const result = manager.delete('non-existent');
      expect(result).toBe(false);
    });

    it('应该能够清空所有映射', () => {
      manager.set('id1', createLocation({ id: 'id1' }));
      manager.set('id2', createLocation({ id: 'id2' }));

      manager.clear();
      expect(manager.size).toBe(0);
    });

    it('应该正确报告 size', () => {
      expect(manager.size).toBe(0);

      manager.set('id1', createLocation({ id: 'id1' }));
      expect(manager.size).toBe(1);

      manager.set('id2', createLocation({ id: 'id2' }));
      expect(manager.size).toBe(2);
    });

    it('应该正确检查 has', () => {
      const location = createLocation();
      manager.set(location.id, location);

      expect(manager.has(location.id)).toBe(true);
      expect(manager.has('non-existent')).toBe(false);
    });
  });

  describe('批量查询', () => {
    beforeEach(() => {
      // 设置测试数据
      manager.set('id1', createLocation({
        id: 'id1',
        file: '/src/App.tsx',
        line: 10,
        element: 'div'
      }));
      manager.set('id2', createLocation({
        id: 'id2',
        file: '/src/App.tsx',
        line: 20,
        element: 'span'
      }));
      manager.set('id3', createLocation({
        id: 'id3',
        file: '/src/Header.tsx',
        line: 5,
        element: 'header'
      }));
      manager.set('id4', createLocation({
        id: 'id4',
        file: '/src/App.tsx',
        line: 30,
        element: 'div'
      }));
    });

    it('getAll 应该返回所有映射', () => {
      const all = manager.getAll();
      expect(Object.keys(all).length).toBe(4);
    });

    it('getByFile 应该按文件过滤', () => {
      const appLocations = manager.getByFile('/src/App.tsx');
      expect(appLocations.length).toBe(3);

      const headerLocations = manager.getByFile('/src/Header.tsx');
      expect(headerLocations.length).toBe(1);

      const nonExistent = manager.getByFile('/src/NonExistent.tsx');
      expect(nonExistent.length).toBe(0);
    });

    it('getByLineRange 应该按行号范围过滤', () => {
      const locations = manager.getByLineRange('/src/App.tsx', 15, 25);
      expect(locations.length).toBe(1);
      expect(locations[0].line).toBe(20);
    });

    it('getByElement 应该按元素类型过滤', () => {
      const divs = manager.getByElement('div');
      expect(divs.length).toBe(2);

      const spans = manager.getByElement('span');
      expect(spans.length).toBe(1);
    });
  });

  describe('文件级操作', () => {
    it('clearFile 应该清除指定文件的所有映射', () => {
      manager.set('id1', createLocation({ id: 'id1', file: '/src/App.tsx' }));
      manager.set('id2', createLocation({ id: 'id2', file: '/src/App.tsx' }));
      manager.set('id3', createLocation({ id: 'id3', file: '/src/Header.tsx' }));

      const cleared = manager.clearFile('/src/App.tsx');
      expect(cleared).toBe(2);
      expect(manager.size).toBe(1);
      expect(manager.getByFile('/src/App.tsx').length).toBe(0);
      expect(manager.getByFile('/src/Header.tsx').length).toBe(1);
    });

    it('clearFile 不存在的文件应该返回 0', () => {
      manager.set('id1', createLocation({ id: 'id1' }));
      const cleared = manager.clearFile('/src/NonExistent.tsx');
      expect(cleared).toBe(0);
      expect(manager.size).toBe(1);
    });
  });

  describe('序列化', () => {
    it('toJSON 应该正确序列化', () => {
      const location = createLocation();
      manager.set(location.id, location);

      const json = manager.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed[location.id]).toEqual(location);
    });

    it('fromJSON 应该正确反序列化', () => {
      const original = createLocation();
      const json = JSON.stringify({ [original.id]: original });

      manager.fromJSON(json);

      expect(manager.get(original.id)).toEqual(original);
    });

    it('fromJSON 应该清除现有数据', () => {
      manager.set('old', createLocation({ id: 'old' }));

      const newLocation = createLocation({ id: 'new' });
      manager.fromJSON(JSON.stringify({ new: newLocation }));

      expect(manager.has('old')).toBe(false);
      expect(manager.has('new')).toBe(true);
    });

    it('fromJSON 应该对无效 JSON 抛出错误', () => {
      expect(() => manager.fromJSON('invalid json')).toThrow();
    });
  });
});
