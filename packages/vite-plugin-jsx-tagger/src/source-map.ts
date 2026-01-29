import type { JsxLocation, SourceMapManagerInterface } from './types';

/**
 * 源码映射管理器
 * 管理 JSX ID 与源码位置的映射关系
 */
export class SourceMapManager implements SourceMapManagerInterface {
  private map = new Map<string, JsxLocation>();

  /**
   * 设置 JSX ID 的位置信息
   */
  set(id: string, location: JsxLocation): void {
    this.map.set(id, location);
  }

  /**
   * 获取 JSX ID 的位置信息
   */
  get(id: string): JsxLocation | undefined {
    return this.map.get(id);
  }

  /**
   * 获取所有映射关系
   */
  getAll(): Record<string, JsxLocation> {
    return Object.fromEntries(this.map);
  }

  /**
   * 清空所有映射
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * 删除指定 ID 的映射
   */
  delete(id: string): boolean {
    return this.map.delete(id);
  }

  /**
   * 获取映射数量
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * 检查是否存在指定 ID
   */
  has(id: string): boolean {
    return this.map.has(id);
  }

  /**
   * 根据文件路径获取所有 JSX 元素
   */
  getByFile(filePath: string): JsxLocation[] {
    return Array.from(this.map.values()).filter(loc => loc.file === filePath);
  }

  /**
   * 根据行号范围获取 JSX 元素
   */
  getByLineRange(filePath: string, startLine: number, endLine: number): JsxLocation[] {
    return this.getByFile(filePath).filter(
      loc => loc.line >= startLine && loc.line <= endLine
    );
  }

  /**
   * 根据元素类型获取 JSX 元素
   */
  getByElement(element: string): JsxLocation[] {
    return Array.from(this.map.values()).filter(loc => loc.element === element);
  }

  /**
   * 清除指定文件的所有映射 (用于文件更新时)
   */
  clearFile(filePath: string): number {
    let count = 0;
    for (const [id, loc] of this.map) {
      if (loc.file === filePath) {
        this.map.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * 导出为 JSON 格式 (用于持久化)
   */
  toJSON(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  /**
   * 从 JSON 导入 (用于恢复)
   */
  fromJSON(json: string): void {
    try {
      const data = JSON.parse(json) as Record<string, JsxLocation>;
      this.map.clear();
      for (const [id, location] of Object.entries(data)) {
        this.map.set(id, location);
      }
    } catch {
      throw new Error('Invalid JSON format for source map');
    }
  }
}
