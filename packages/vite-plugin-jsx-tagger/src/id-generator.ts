import { createHash } from 'crypto';

/**
 * 生成稳定的 JSX ID
 * 基于文件路径 + 行号 + 列号生成，确保同一位置的元素 ID 不变
 *
 * @param filePath - 源文件路径
 * @param line - 行号
 * @param column - 列号
 * @param prefix - 可选的 ID 前缀
 * @returns 格式为 "prefix-hash" 或 "hash" 的稳定 ID
 */
export function generateStableId(
  filePath: string,
  line: number,
  column: number,
  prefix: string = ''
): string {
  const input = `${filePath}:${line}:${column}`;
  const hash = createHash('md5').update(input).digest('hex').slice(0, 8);
  return prefix ? `${prefix}-${hash}` : hash;
}

/**
 * 解析 JSX ID 获取前缀和哈希值
 *
 * @param jsxId - JSX ID 字符串
 * @returns 解析后的前缀和哈希值
 */
export function parseJsxId(jsxId: string): { prefix?: string; hash: string } {
  const lastDashIndex = jsxId.lastIndexOf('-');

  // 检查是否有前缀 (前缀和哈希之间用 '-' 分隔)
  // 哈希值是 8 个字符的十六进制
  if (lastDashIndex > 0 && jsxId.length - lastDashIndex - 1 === 8) {
    const potentialHash = jsxId.slice(lastDashIndex + 1);
    if (/^[a-f0-9]{8}$/.test(potentialHash)) {
      return {
        prefix: jsxId.slice(0, lastDashIndex),
        hash: potentialHash
      };
    }
  }

  // 没有前缀的情况
  return { hash: jsxId };
}

/**
 * 验证是否为有效的 JSX ID 格式
 *
 * @param jsxId - 要验证的 ID
 * @returns 是否为有效格式
 */
export function isValidJsxId(jsxId: string): boolean {
  if (!jsxId || typeof jsxId !== 'string') return false;

  const { hash } = parseJsxId(jsxId);
  return /^[a-f0-9]{8}$/.test(hash);
}
