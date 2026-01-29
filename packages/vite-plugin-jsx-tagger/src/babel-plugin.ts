import type { PluginObj, types as t, NodePath } from '@babel/core';
import { generateStableId } from './id-generator';
import type { BabelPluginOptions, JsxLocation, SourceMapManagerInterface } from './types';

/**
 * 获取 JSX 元素名称
 */
function getElementName(
  name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName,
  types: typeof t
): string | null {
  if (types.isJSXIdentifier(name)) {
    return name.name;
  }
  if (types.isJSXMemberExpression(name)) {
    const objectName = getElementName(name.object, types);
    return objectName ? `${objectName}.${name.property.name}` : null;
  }
  if (types.isJSXNamespacedName(name)) {
    return `${name.namespace.name}:${name.name.name}`;
  }
  return null;
}

/**
 * 检测是否在 .map() / .forEach() / .filter() 等数组方法的回调中
 * 如果是，返回索引变量名（如果没有则自动添加）
 */
function getArrayIteratorInfo(
  path: NodePath<t.JSXOpeningElement>,
  types: typeof t
): { isInIterator: boolean; indexName?: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: NodePath<any> | null = path.parentPath;

  // 需要处理的数组迭代方法
  const iteratorMethods = ['map', 'forEach', 'filter', 'find', 'findIndex', 'some', 'every', 'flatMap'];

  while (current) {
    // 检查是否在箭头函数或函数表达式中
    if (current.isArrowFunctionExpression() || current.isFunctionExpression()) {
      const parentPath = current.parentPath;

      // 检查这个函数是否是某个方法调用的参数
      if (parentPath?.isCallExpression()) {
        const callee = parentPath.node.callee;

        // 检查是否是 xxx.map() / xxx.forEach() 等形式
        if (types.isMemberExpression(callee) &&
            types.isIdentifier(callee.property) &&
            iteratorMethods.includes(callee.property.name)) {

          // 获取回调函数的参数
          const funcNode = current.node as t.ArrowFunctionExpression | t.FunctionExpression;
          const params = funcNode.params;

          // 检查是否已有索引参数（第二个参数）
          let indexParam = params[1];

          if (!indexParam) {
            // 没有索引参数，需要添加一个
            const indexName = '__jsx_idx__';
            indexParam = types.identifier(indexName);
            params.push(indexParam);
          }

          // 获取索引变量名
          if (types.isIdentifier(indexParam)) {
            return {
              isInIterator: true,
              indexName: indexParam.name
            };
          }

          // 如果是解构模式，跳过（不常见）
          return { isInIterator: true };
        }
      }
    }

    current = current.parentPath;
  }

  return { isInIterator: false };
}

/**
 * 检查是否已有 data-jsx-id 属性
 */
function hasJsxIdAttribute(
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[],
  types: typeof t
): boolean {
  return attributes.some(
    attr =>
      types.isJSXAttribute(attr) &&
      types.isJSXIdentifier(attr.name) &&
      attr.name.name === 'data-jsx-id'
  );
}

/**
 * 创建 JSX 属性（静态字符串值）
 */
function createJsxAttribute(
  types: typeof t,
  name: string,
  value: string
): t.JSXAttribute {
  return types.jsxAttribute(
    types.jsxIdentifier(name),
    types.stringLiteral(value)
  );
}

/**
 * 创建动态 JSX 属性（模板字符串，用于 .map() 中的元素）
 * 生成: data-jsx-id={`baseId-${indexName}`}
 */
function createDynamicJsxIdAttribute(
  types: typeof t,
  baseId: string,
  indexName: string
): t.JSXAttribute {
  // 创建模板字符串: `${baseId}-${indexName}`
  const templateLiteral = types.templateLiteral(
    [
      types.templateElement({ raw: `${baseId}-`, cooked: `${baseId}-` }, false),
      types.templateElement({ raw: '', cooked: '' }, true)
    ],
    [types.identifier(indexName)]
  );

  return types.jsxAttribute(
    types.jsxIdentifier('data-jsx-id'),
    types.jsxExpressionContainer(templateLiteral)
  );
}

/**
 * JSX Tagger Babel 插件
 *
 * 为所有原生 HTML 元素注入 data-jsx-* 属性，用于 Visual Edit 功能
 */
export function jsxTaggerBabelPlugin(
  { types }: { types: typeof t }
): PluginObj<{ opts: BabelPluginOptions }> {
  return {
    name: 'jsx-tagger',

    visitor: {
      JSXOpeningElement(path, state) {
        const opts = state.opts;
        const { sourceMapManager, filePath, idPrefix = '' } = opts;

        // 获取位置信息
        const loc = path.node.loc;
        if (!loc) return;

        const line = loc.start.line;
        const column = loc.start.column;

        // 获取元素名称
        const elementName = getElementName(path.node.name, types);

        // 只处理原生 HTML 元素 (小写开头)
        // 跳过 React 组件 (大写开头) 和 Fragment (<>)
        if (!elementName || !/^[a-z]/.test(elementName)) return;

        // 检查是否已有 data-jsx-id (避免重复处理)
        if (hasJsxIdAttribute(path.node.attributes, types)) return;

        // 生成稳定的基础 ID
        const baseJsxId = generateStableId(filePath, line, column, idPrefix);

        // 检测是否在 .map() 等迭代器回调中
        const iteratorInfo = getArrayIteratorInfo(path, types);

        // 记录源码映射
        const location: JsxLocation = {
          id: baseJsxId,
          file: filePath,
          line,
          column,
          element: elementName,
        };
        sourceMapManager.set(baseJsxId, location);

        // 注入属性
        const attributes: t.JSXAttribute[] = [];

        // 如果在迭代器中且有索引变量，生成动态 ID
        if (iteratorInfo.isInIterator && iteratorInfo.indexName) {
          // 动态 ID: `baseId-${index}`
          attributes.push(createDynamicJsxIdAttribute(types, baseJsxId, iteratorInfo.indexName));
        } else {
          // 静态 ID
          attributes.push(createJsxAttribute(types, 'data-jsx-id', baseJsxId));
        }

        // 其他属性保持静态（用于源码定位）
        attributes.push(
          createJsxAttribute(types, 'data-jsx-file', filePath),
          createJsxAttribute(types, 'data-jsx-line', String(line)),
          createJsxAttribute(types, 'data-jsx-col', String(column)),
        );

        path.node.attributes.push(...attributes);
      },
    },
  };
}
