import { describe, it, expect, beforeEach } from 'vitest';
import { transformSync } from '@babel/core';
import { jsxTaggerBabelPlugin } from '../src/babel-plugin';
import { SourceMapManager } from '../src/source-map';

describe('JSX Tagger Babel Plugin', () => {
  let sourceMapManager: SourceMapManager;

  beforeEach(() => {
    sourceMapManager = new SourceMapManager();
  });

  function transform(code: string, filePath = '/test/Component.tsx') {
    const result = transformSync(code, {
      filename: filePath,
      plugins: [
        ['@babel/plugin-syntax-typescript', { isTSX: true }],
        [jsxTaggerBabelPlugin, {
          sourceMapManager,
          filePath,
          idPrefix: 'test'
        }],
      ],
      configFile: false,
      babelrc: false,
    });
    return result?.code || '';
  }

  describe('基本转换', () => {
    it('应该为原生 HTML 元素添加 data-jsx-* 属性', () => {
      const code = `const App = () => <div>Hello</div>;`;
      const result = transform(code);

      expect(result).toContain('data-jsx-id=');
      expect(result).toContain('data-jsx-file="/test/Component.tsx"');
      expect(result).toContain('data-jsx-line=');
      expect(result).toContain('data-jsx-col=');
    });

    it('应该为多个元素生成不同的 ID', () => {
      const code = `
        const App = () => (
          <div>
            <span>Hello</span>
            <p>World</p>
          </div>
        );
      `;
      const result = transform(code);

      // 提取所有 data-jsx-id 值
      const ids = result.match(/data-jsx-id="([^"]+)"/g) || [];
      expect(ids.length).toBe(3); // div, span, p

      // 确保 ID 都是唯一的
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });

    it('不应该处理 React 组件 (大写开头)', () => {
      const code = `
        const App = () => (
          <div>
            <MyComponent />
            <AnotherComponent>Child</AnotherComponent>
          </div>
        );
      `;
      const result = transform(code);

      // div 应该有属性
      expect(result).toContain('data-jsx-id=');

      // 组件不应该有 data-jsx-id
      expect(result).not.toMatch(/<MyComponent[^>]*data-jsx-id/);
      expect(result).not.toMatch(/<AnotherComponent[^>]*data-jsx-id/);
    });

    it('应该保留现有属性', () => {
      const code = `const App = () => <div className="test" id="main">Hello</div>;`;
      const result = transform(code);

      expect(result).toContain('className="test"');
      expect(result).toContain('id="main"');
      expect(result).toContain('data-jsx-id=');
    });
  });

  describe('复杂场景', () => {
    it('应该处理嵌套元素', () => {
      const code = `
        const App = () => (
          <main>
            <header>
              <nav>
                <ul>
                  <li>Item</li>
                </ul>
              </nav>
            </header>
          </main>
        );
      `;
      const result = transform(code);
      const ids = result.match(/data-jsx-id="([^"]+)"/g) || [];

      // main, header, nav, ul, li
      expect(ids.length).toBe(5);
    });

    it('应该处理自闭合元素', () => {
      const code = `
        const App = () => (
          <div>
            <img src="test.jpg" />
            <br />
            <input type="text" />
          </div>
        );
      `;
      const result = transform(code);

      expect(result).toMatch(/<img[^>]*data-jsx-id/);
      expect(result).toMatch(/<br[^>]*data-jsx-id/);
      expect(result).toMatch(/<input[^>]*data-jsx-id/);
    });

    it('应该处理条件渲染', () => {
      const code = `
        const App = ({ show }) => (
          <div>
            {show && <span>Visible</span>}
            {show ? <p>Yes</p> : <p>No</p>}
          </div>
        );
      `;
      const result = transform(code);
      const ids = result.match(/data-jsx-id="([^"]+)"/g) || [];

      // div, span, p, p (三元运算符的两个分支)
      expect(ids.length).toBe(4);
    });

    it('应该处理列表渲染', () => {
      const code = `
        const App = ({ items }) => (
          <ul>
            {items.map(item => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        );
      `;
      const result = transform(code);

      expect(result).toMatch(/<ul[^>]*data-jsx-id/);
      expect(result).toMatch(/<li[^>]*data-jsx-id/);
    });
  });

  describe('ID 前缀', () => {
    it('应该在 ID 中包含前缀', () => {
      const code = `const App = () => <div>Test</div>;`;
      const result = transform(code);

      expect(result).toMatch(/data-jsx-id="test-[a-f0-9]{8}"/);
    });

    it('没有前缀时只有哈希值', () => {
      const result = transformSync(`const App = () => <div>Test</div>;`, {
        filename: '/test/Component.tsx',
        plugins: [
          ['@babel/plugin-syntax-typescript', { isTSX: true }],
          [jsxTaggerBabelPlugin, {
            sourceMapManager,
            filePath: '/test/Component.tsx',
            idPrefix: '' // 无前缀
          }],
        ],
        configFile: false,
        babelrc: false,
      });

      expect(result?.code).toMatch(/data-jsx-id="[a-f0-9]{8}"/);
      expect(result?.code).not.toMatch(/data-jsx-id="[^"]*-[a-f0-9]{8}"/);
    });
  });

  describe('源码映射记录', () => {
    it('应该记录所有转换的元素', () => {
      const code = `
        const App = () => (
          <div>
            <span>Text</span>
          </div>
        );
      `;
      transform(code);

      const all = sourceMapManager.getAll();
      const entries = Object.entries(all);

      expect(entries.length).toBe(2);

      // 验证记录的信息
      for (const [id, location] of entries) {
        expect(id).toMatch(/^test-[a-f0-9]{8}$/);
        expect(location.file).toBe('/test/Component.tsx');
        expect(location.line).toBeGreaterThan(0);
        expect(location.column).toBeGreaterThanOrEqual(0);
        expect(['div', 'span']).toContain(location.element);
      }
    });

    it('应该正确记录行号和列号', () => {
      const code = `const App = () => <div>Hello</div>;`;
      transform(code);

      const locations = sourceMapManager.getByFile('/test/Component.tsx');
      expect(locations.length).toBe(1);
      expect(locations[0].line).toBe(1);
      expect(locations[0].element).toBe('div');
    });
  });

  describe('避免重复处理', () => {
    it('不应该重复添加 data-jsx-id', () => {
      const code = `const App = () => <div data-jsx-id="existing-id">Hello</div>;`;
      const result = transform(code);

      // 只应该有一个 data-jsx-id
      const ids = result.match(/data-jsx-id/g) || [];
      expect(ids.length).toBe(1);
      expect(result).toContain('data-jsx-id="existing-id"');
    });
  });
});
