// D7 形状模块深层测试：shapes.ts 此前仅被间接覆盖（shapeGlyph 通过 advisor 间接触达）。
// 本文件直接覆盖 shapeGlyph + 新增公共 API（isShape/parseShape/shapeFromGlyph/shapeCount），
// 并验证 DRY 重构后 advisor 的 asShape → parseShape 行为一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isShape,
  parseShape,
  shapeCount,
  shapeFromGlyph,
  shapeGlyph,
} from '../src/game/shapes.ts';
import { ALL_SHAPES } from '../src/game/types.ts';
import type { Shape } from '../src/game/types.ts';
import { parseAdvice } from '../src/ai/advisor.ts';

const SHAPES: Shape[] = ['circle', 'triangle', 'square', 'diamond', 'star'];
const GLYPHS: string[] = ['○', '△', '□', '◇', '☆'];

// ─── shapeGlyph：5 种形状各自正确 ───

test('shapeGlyph(circle) = ○', () => {
  assert.equal(shapeGlyph('circle'), '○');
});
test('shapeGlyph(triangle) = △', () => {
  assert.equal(shapeGlyph('triangle'), '△');
});
test('shapeGlyph(square) = □', () => {
  assert.equal(shapeGlyph('square'), '□');
});
test('shapeGlyph(diamond) = ◇', () => {
  assert.equal(shapeGlyph('diamond'), '◇');
});
test('shapeGlyph(star) = ☆', () => {
  assert.equal(shapeGlyph('star'), '☆');
});

test('shapeGlyph 与 ALL_SHAPES 一一对应（无遗漏无重复）', () => {
  const mapped = ALL_SHAPES.map((s) => shapeGlyph(s));
  assert.equal(mapped.length, 5);
  assert.equal(new Set(mapped).size, 5, '5 个 glyph 各不相同');
  for (const g of GLYPHS) {
    assert.ok(mapped.includes(g), `glyph ${g} 应被覆盖`);
  }
});

test('shapeGlyph 返回值均为单字符（长度=1）', () => {
  for (const s of ALL_SHAPES) {
    assert.equal(shapeGlyph(s).length, 1, `${s} 应映射单字符`);
  }
});

// ─── isShape：类型守卫 ───

test('isShape 对全部 5 种合法形状返回 true', () => {
  for (const s of SHAPES) {
    assert.equal(isShape(s), true, `${s} 应为合法 Shape`);
  }
});

test('isShape 对非法字符串返回 false', () => {
  assert.equal(isShape('hexagon'), false);
  assert.equal(isShape('Circle'), false, '大小写敏感');
  assert.equal(isShape(' circle '), false, '含空格非法');
  assert.equal(isShape(''), false);
  assert.equal(isShape('pentagon'), false);
});

test('isShape 对非字符串返回 false', () => {
  assert.equal(isShape(undefined), false);
  assert.equal(isShape(null), false);
  assert.equal(isShape(123), false);
  assert.equal(isShape(0), false);
  assert.equal(isShape(true), false);
  assert.equal(isShape({}), false);
  assert.equal(isShape([]), false);
  assert.equal(isShape(['circle']), false, '数组即使含合法值也非法');
});

test('isShape 作为类型守卫收窄（编译期 + 运行期一致）', () => {
  const v: unknown = 'square';
  assert.ok(isShape(v));
  // 类型守卫后可直接当 Shape 用
  assert.equal(shapeGlyph(v), '□');
});

// ─── parseShape：安全转换 ───

test('parseShape 合法值原样返回', () => {
  for (const s of SHAPES) {
    assert.equal(parseShape(s), s);
  }
});

test('parseShape 非法值返回 undefined（不抛错）', () => {
  assert.equal(parseShape('hexagon'), undefined);
  assert.equal(parseShape(''), undefined);
  assert.equal(parseShape(undefined), undefined);
  assert.equal(parseShape(null), undefined);
  assert.equal(parseShape(42), undefined);
  assert.equal(parseShape({ target: 'circle' }), undefined);
});

test('parseShape(undefined) 与 parseShape(非法) 行为一致（都 undefined）', () => {
  assert.equal(parseShape(undefined), parseShape('bad'));
});

// ─── shapeFromGlyph：字符反查（shapeGlyph 逆映射） ───

test('shapeFromGlyph(○) = circle', () => {
  assert.equal(shapeFromGlyph('○'), 'circle');
});
test('shapeFromGlyph(△) = triangle', () => {
  assert.equal(shapeFromGlyph('△'), 'triangle');
});
test('shapeFromGlyph(□) = square', () => {
  assert.equal(shapeFromGlyph('□'), 'square');
});
test('shapeFromGlyph(◇) = diamond', () => {
  assert.equal(shapeFromGlyph('◇'), 'diamond');
});
test('shapeFromGlyph(☆) = star', () => {
  assert.equal(shapeFromGlyph('☆'), 'star');
});

test('shapeFromGlyph 未知字符返回 undefined', () => {
  assert.equal(shapeFromGlyph('X'), undefined);
  assert.equal(shapeFromGlyph('★'), undefined, '实心星 ≠ 空心星');
  assert.equal(shapeFromGlyph('circle'), undefined, '名字非字符 glyph');
  assert.equal(shapeFromGlyph(''), undefined);
});

test('shapeFromGlyph 非字符串入参返回 undefined', () => {
  assert.equal(shapeFromGlyph(undefined), undefined);
  assert.equal(shapeFromGlyph(null), undefined);
  assert.equal(shapeFromGlyph(1), undefined);
});

test('shapeGlyph ∘ shapeFromGlyph = 恒等（5 形状往返一致）', () => {
  for (const s of ALL_SHAPES) {
    const g = shapeGlyph(s);
    assert.equal(shapeFromGlyph(g), s, `${s} 往返应一致`);
  }
});

// ─── shapeCount ───

test('shapeCount = 5', () => {
  assert.equal(shapeCount(), 5);
});

test('shapeCount 与 ALL_SHAPES.length 一致', () => {
  assert.equal(shapeCount(), ALL_SHAPES.length);
});

test('shapeCount 多次调用稳定（无副作用）', () => {
  const a = shapeCount();
  const b = shapeCount();
  const c = shapeCount();
  assert.equal(a, b);
  assert.equal(b, c);
});

// ─── DRY 重构回归：advisor.parseAdvice 用 parseShape 后行为不变 ───

function emptyState(): { stations: never[]; lines: never[] } {
  return { stations: [], lines: [] };
}

test('parseAdvice 合法 fromShape/toShape 正确解析（重构后仍工作）', () => {
  const st = emptyState();
  const advice = parseAdvice(
    '{"comment":"建议","action":"create","fromShape":"circle","toShape":"triangle"}',
    st as never,
  );
  assert.equal(advice.fromShape, 'circle');
  assert.equal(advice.toShape, 'triangle');
  assert.equal(advice.action, 'create');
});

test('parseAdvice 非法 fromShape 降级为 undefined（parseShape 行为）', () => {
  const st = emptyState();
  const advice = parseAdvice(
    '{"comment":"建议","action":"create","fromShape":"hexagon","toShape":"square"}',
    st as never,
  );
  assert.equal(advice.fromShape, undefined, '非法形状应被 parseShape 过滤');
  assert.equal(advice.toShape, 'square');
});

test('parseAdvice 缺省 fromShape/toShape 两者均 undefined', () => {
  const st = emptyState();
  const advice = parseAdvice('{"comment":"建议","action":"observe"}', st as never);
  assert.equal(advice.fromShape, undefined);
  assert.equal(advice.toShape, undefined);
});

test('parseAdvice 大小写敏感：Circle（大写）降级为 undefined', () => {
  const st = emptyState();
  const advice = parseAdvice(
    '{"comment":"建议","action":"extend","fromShape":"Circle"}',
    st as never,
  );
  assert.equal(advice.fromShape, undefined);
});

test('parseAdvice 5 种形状全部可正确解析', () => {
  const st = emptyState();
  for (const s of SHAPES) {
    const advice = parseAdvice(
      `{"comment":"x","action":"create","fromShape":"${s}"}`,
      st as never,
    );
    assert.equal(advice.fromShape, s, `${s} 应可解析`);
  }
});
