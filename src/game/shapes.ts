// 形状 → 展示字符的统一映射（之前 advisor.ts 的 shapeName 与 events.ts 的 emojiOf 重复）。
// 放在 game/ 下中立位置，避免 advisor ↔ events 循环依赖。

import type { Shape } from './types.ts';

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
