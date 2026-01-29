import { describe, it, expect } from 'vitest';
import { generateStableId, parseJsxId, isValidJsxId } from '../src/id-generator';

describe('ID Generator', () => {
  describe('generateStableId', () => {
    it('应该生成 8 位十六进制哈希', () => {
      const id = generateStableId('/src/App.tsx', 10, 5);
      expect(id).toMatch(/^[a-f0-9]{8}$/);
    });

    it('相同输入应该生成相同 ID', () => {
      const id1 = generateStableId('/src/App.tsx', 10, 5);
      const id2 = generateStableId('/src/App.tsx', 10, 5);
      expect(id1).toBe(id2);
    });

    it('不同输入应该生成不同 ID', () => {
      const id1 = generateStableId('/src/App.tsx', 10, 5);
      const id2 = generateStableId('/src/App.tsx', 10, 6);
      const id3 = generateStableId('/src/App.tsx', 11, 5);
      const id4 = generateStableId('/src/Header.tsx', 10, 5);

      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id1).not.toBe(id4);
    });

    it('应该支持前缀', () => {
      const id = generateStableId('/src/App.tsx', 10, 5, 'myapp');
      expect(id).toMatch(/^myapp-[a-f0-9]{8}$/);
    });

    it('空前缀应该不包含连字符', () => {
      const id = generateStableId('/src/App.tsx', 10, 5, '');
      expect(id).toMatch(/^[a-f0-9]{8}$/);
      expect(id).not.toContain('-');
    });

    it('前缀可以包含连字符', () => {
      const id = generateStableId('/src/App.tsx', 10, 5, 'my-app');
      expect(id).toMatch(/^my-app-[a-f0-9]{8}$/);
    });
  });

  describe('parseJsxId', () => {
    it('应该解析没有前缀的 ID', () => {
      const result = parseJsxId('12345678');
      expect(result).toEqual({ hash: '12345678' });
    });

    it('应该解析带前缀的 ID', () => {
      const result = parseJsxId('myapp-12345678');
      expect(result).toEqual({ prefix: 'myapp', hash: '12345678' });
    });

    it('应该处理多段前缀', () => {
      const result = parseJsxId('my-app-12345678');
      expect(result).toEqual({ prefix: 'my-app', hash: '12345678' });
    });

    it('应该处理无效格式作为纯哈希', () => {
      const result = parseJsxId('not-valid-format');
      expect(result).toEqual({ hash: 'not-valid-format' });
    });
  });

  describe('isValidJsxId', () => {
    it('有效的 ID 应该返回 true', () => {
      expect(isValidJsxId('12345678')).toBe(true);
      expect(isValidJsxId('abcdef12')).toBe(true);
      expect(isValidJsxId('myapp-12345678')).toBe(true);
      expect(isValidJsxId('my-app-abcdef12')).toBe(true);
    });

    it('无效的 ID 应该返回 false', () => {
      expect(isValidJsxId('')).toBe(false);
      expect(isValidJsxId('123')).toBe(false); // 太短
      expect(isValidJsxId('123456789')).toBe(false); // 太长
      expect(isValidJsxId('1234567g')).toBe(false); // 无效字符
      expect(isValidJsxId(null as any)).toBe(false);
      expect(isValidJsxId(undefined as any)).toBe(false);
    });
  });
});
