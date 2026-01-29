/**
 * Scaffolder 单元测试
 */

import { describe, test, expect } from 'bun:test';
import { generateScaffold, generateDefaultAppTsx } from '../src/services/scaffolder';
import type { ProjectConfig } from '../src/types';

describe('generateScaffold', () => {
  const config: ProjectConfig = {
    projectId: 'test-project-123',
    projectName: 'Test Project',
    description: 'A test project for unit testing',
  };

  test('should generate scaffold files successfully', () => {
    const result = generateScaffold(config);

    expect(result.success).toBe(true);
    expect(result.files.length).toBeGreaterThan(0);
  });

  test('should include package.json', () => {
    const result = generateScaffold(config);
    const packageJson = result.files.find(f => f.path === 'package.json');

    expect(packageJson).toBeDefined();

    const pkg = JSON.parse(packageJson!.content);
    expect(pkg.name).toBe('test-project');
    expect(pkg.dependencies).toHaveProperty('react');
    expect(pkg.dependencies).toHaveProperty('react-dom');
  });

  test('should include vite.config.ts', () => {
    const result = generateScaffold(config);
    const viteConfig = result.files.find(f => f.path === 'vite.config.ts');

    expect(viteConfig).toBeDefined();
    expect(viteConfig!.content).toContain('defineConfig');
    expect(viteConfig!.content).toContain('react()');
  });

  test('should include tsconfig.json', () => {
    const result = generateScaffold(config);
    const tsConfig = result.files.find(f => f.path === 'tsconfig.json');

    expect(tsConfig).toBeDefined();

    const tsConfigParsed = JSON.parse(tsConfig!.content);
    expect(tsConfigParsed.compilerOptions.jsx).toBe('react-jsx');
  });

  test('should include tailwind.config.js', () => {
    const result = generateScaffold(config);
    const tailwindConfig = result.files.find(f => f.path === 'tailwind.config.js');

    expect(tailwindConfig).toBeDefined();
    expect(tailwindConfig!.content).toContain('tailwindcss');
    expect(tailwindConfig!.content).toContain('content');
  });

  test('should include index.html with project name', () => {
    const result = generateScaffold(config);
    const indexHtml = result.files.find(f => f.path === 'index.html');

    expect(indexHtml).toBeDefined();
    expect(indexHtml!.content).toContain('Test Project');
    expect(indexHtml!.content).toContain('A test project for unit testing');
  });

  test('should include main.tsx', () => {
    const result = generateScaffold(config);
    const mainTsx = result.files.find(f => f.path === 'src/main.tsx');

    expect(mainTsx).toBeDefined();
    expect(mainTsx!.content).toContain('ReactDOM.createRoot');
    expect(mainTsx!.content).toContain("import './styles/globals.css'");
  });

  test('should include globals.css with Tailwind directives', () => {
    const result = generateScaffold(config);
    const globalsCss = result.files.find(f => f.path === 'src/styles/globals.css');

    expect(globalsCss).toBeDefined();
    expect(globalsCss!.content).toContain('@tailwind base');
    expect(globalsCss!.content).toContain('@tailwind components');
    expect(globalsCss!.content).toContain('@tailwind utilities');
  });

  test('should escape HTML special characters in project name', () => {
    const configWithSpecialChars: ProjectConfig = {
      projectId: 'test-project-xss',
      projectName: '<script>alert("XSS")</script>',
      description: 'Test with "quotes" & <tags>',
    };

    const result = generateScaffold(configWithSpecialChars);
    const indexHtml = result.files.find(f => f.path === 'index.html');

    expect(indexHtml).toBeDefined();
    expect(indexHtml!.content).not.toContain('<script>');
    expect(indexHtml!.content).toContain('&lt;script&gt;');
  });
});

describe('generateDefaultAppTsx', () => {
  test('should generate App.tsx with project name', () => {
    const appTsx = generateDefaultAppTsx('My App');

    expect(appTsx).toContain('export default function App()');
    expect(appTsx).toContain('My App');
    expect(appTsx).toContain('min-h-screen');
  });

  test('should escape HTML in project name', () => {
    const appTsx = generateDefaultAppTsx('<script>alert("XSS")</script>');

    expect(appTsx).not.toContain('<script>');
    expect(appTsx).toContain('&lt;script&gt;');
  });
});
