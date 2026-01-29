# vite-plugin-jsx-tagger

Vite 插件，用于在编译时为 JSX 元素注入稳定的追踪属性，实现 Lovable 风格的 Visual Edit 功能。

## 功能特性

- 🏷️ **稳定 ID 标记** - 为所有原生 HTML 元素注入 `data-jsx-*` 属性
- 📍 **源码映射** - 维护 JSX ID 与源码位置的映射关系
- 🔌 **API 端点** - 提供 HTTP API 查询源码位置信息
- ⚡ **HMR 支持** - 文件更新时自动更新映射
- 🎯 **精准定位** - 支持按文件、行号范围查询

## 安装

```bash
npm install vite-plugin-jsx-tagger
# 或
pnpm add vite-plugin-jsx-tagger
# 或
bun add vite-plugin-jsx-tagger
```

## 使用方法

### 基础配置

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { jsxTaggerPlugin } from 'vite-plugin-jsx-tagger';

export default defineConfig({
  plugins: [
    // JSX Tagger 必须在 React 插件之前
    jsxTaggerPlugin({
      idPrefix: 'myapp',           // 可选: ID 前缀
      removeInProduction: false,   // 可选: 生产环境是否移除标记
      exclude: ['**/test/**'],     // 可选: 排除的文件模式
    }),
    react(),
  ],
});
```

### 配置选项

| 选项 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `idPrefix` | `string` | `''` | JSX ID 的前缀，用于区分不同项目 |
| `removeInProduction` | `boolean` | `false` | 生产环境是否移除 data-jsx-* 属性 |
| `exclude` | `string[]` | `[]` | 要排除的文件路径模式 (glob) |

## 转换示例

### 输入

```tsx
function App() {
  return (
    <div className="container">
      <h1>Hello World</h1>
      <MyComponent />
    </div>
  );
}
```

### 输出

```tsx
function App() {
  return (
    <div
      className="container"
      data-jsx-id="myapp-a1b2c3d4"
      data-jsx-file="/src/App.tsx"
      data-jsx-line="3"
      data-jsx-col="4"
    >
      <h1
        data-jsx-id="myapp-e5f6g7h8"
        data-jsx-file="/src/App.tsx"
        data-jsx-line="4"
        data-jsx-col="6"
      >Hello World</h1>
      <MyComponent />  {/* React 组件不会被标记 */}
    </div>
  );
}
```

## API 端点

插件在开发服务器上注册以下 API 端点:

### GET `/__jsx-source-map`

获取所有 JSX 元素的源码映射。

**响应示例:**
```json
{
  "success": true,
  "data": {
    "myapp-a1b2c3d4": {
      "id": "myapp-a1b2c3d4",
      "file": "/src/App.tsx",
      "line": 3,
      "column": 4,
      "element": "div"
    }
  },
  "count": 42
}
```

### GET `/__jsx-locate?id=<jsx-id>`

根据 JSX ID 查询源码位置。

**响应示例:**
```json
{
  "success": true,
  "data": {
    "id": "myapp-a1b2c3d4",
    "file": "/src/App.tsx",
    "line": 3,
    "column": 4,
    "element": "div"
  }
}
```

### GET `/__jsx-by-file?file=<file-path>`

获取指定文件中所有 JSX 元素。

**响应示例:**
```json
{
  "success": true,
  "data": [
    { "id": "myapp-a1b2c3d4", "file": "/src/App.tsx", "line": 3, "column": 4, "element": "div" },
    { "id": "myapp-e5f6g7h8", "file": "/src/App.tsx", "line": 4, "column": 6, "element": "h1" }
  ],
  "count": 2
}
```

## 编程访问

### 获取 SourceMapManager

```typescript
// 在其他 Vite 插件中访问
function myPlugin(): Plugin {
  return {
    name: 'my-plugin',
    configResolved(config) {
      const jsxTagger = config.plugins.find(p => p.name === 'vite-plugin-jsx-tagger');
      if (jsxTagger?.api?.getSourceMapManager) {
        const sourceMapManager = jsxTagger.api.getSourceMapManager();
        // 使用 sourceMapManager...
      }
    }
  };
}
```

### 直接使用 SourceMapManager

```typescript
import { SourceMapManager } from 'vite-plugin-jsx-tagger';

const manager = new SourceMapManager();

// 设置映射
manager.set('id1', {
  id: 'id1',
  file: '/src/App.tsx',
  line: 10,
  column: 5,
  element: 'div'
});

// 查询
const location = manager.get('id1');
const allByFile = manager.getByFile('/src/App.tsx');
const inRange = manager.getByLineRange('/src/App.tsx', 5, 15);
```

## ID 生成规则

- ID 基于 `文件路径:行号:列号` 生成 MD5 哈希 (取前 8 位)
- 相同位置的元素始终生成相同 ID
- 可通过 `idPrefix` 选项添加项目前缀

```typescript
import { generateStableId, parseJsxId, isValidJsxId } from 'vite-plugin-jsx-tagger';

// 生成 ID
const id = generateStableId('/src/App.tsx', 10, 5, 'myapp');
// => 'myapp-a1b2c3d4'

// 解析 ID
const parsed = parseJsxId('myapp-a1b2c3d4');
// => { prefix: 'myapp', hash: 'a1b2c3d4' }

// 验证 ID
isValidJsxId('myapp-a1b2c3d4'); // => true
isValidJsxId('invalid'); // => false
```

## 处理规则

1. ✅ **处理**: 所有小写开头的原生 HTML 元素 (`div`, `span`, `button` 等)
2. ❌ **跳过**: 大写开头的 React 组件 (`MyComponent`, `Header` 等)
3. ❌ **跳过**: React Fragment (`<>...</>`)
4. ❌ **跳过**: `node_modules` 中的文件
5. ❌ **跳过**: 已有 `data-jsx-id` 属性的元素

## 与 Visual Editor 集成

此插件是 Visual Edit 系统的基础设施，配合以下组件使用:

1. **Visual Edit 注入脚本** - 监听用户点击，高亮选中元素
2. **属性面板** - 显示和编辑选中元素的样式
3. **AST 处理系统** - 解析和修改源代码
4. **HMR 客户端** - 实时更新预览

## License

MIT
