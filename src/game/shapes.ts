// 形状 → 展示字符的统一映射（之前 advisor.ts 的 shapeName 与 events.ts 的 emojiOf 重复）。
// 放在 game/ 下中立位置，避免 advisor ↔ events 循环依赖。
//
// 本模块集中所有 Shape 的字符串/字符/校验转换，供 advisor 解析 LLM 输出、
// 存档校验、UI 渲染等复用，消除散落各处的 isShape/asShape 重复实现。

import type { Shape } from './types.ts';
import { ALL_SHAPES } from './types.ts';

/** 形状 → 单字符展示（○ △ □ ◇ ☆）。 */
export function shapeGlyph(shape: Shape): string {
  switch (shape) {
    case 'circle':
      return '○';
    case 'triangle':
      return '△';
    case 'square':
      return '□';
    case 'diamond':
      return '◇';
    case 'star':
      return '☆';
  }
}

/** 字符 → 形状的反查表（shapeGlyph 的逆映射）。 */
const GLYPH_TO_SHAPE: ReadonlyMap<string, Shape> = new Map(
  ALL_SHAPES.map((s) => [shapeGlyph(s), s]),
);

/** 所有合法形状的 Set（isShape 用）。 */
const SHAPE_SET: ReadonlySet<string> = new Set(ALL_SHAPES);

/**
 * 判断任意值是否为合法 Shape 字符串。
 * 供存档校验 / 解析 LLM 输出 / 反序列化等场景防御性校验。
 */
export function isShape(v: unknown): v is Shape {
  return typeof v === 'string' && SHAPE_SET.has(v);
}

/**
 * 把任意值安全转为 Shape；非法/未定义返回 undefined（不抛错）。
 * 替代散落各处的 asShape 实现：advisor 解析 LLM JSON、scenario 解析剧本都用它。
 */
export function parseShape(v: unknown): Shape | undefined {
  return isShape(v) ? v : undefined;
}

/** 字符（○ △ □ ◇ ☆）→ Shape；未知字符返回 undefined。 */
export function shapeFromGlyph(g: unknown): Shape | undefined {
  return typeof g === 'string' ? GLYPH_TO_SHAPE.get(g) : undefined;
}

/** 形状总数（= ALL_SHAPES.length），供注册表/成就计数复用。 */
export function shapeCount(): number {
  return ALL_SHAPES.length;
}

