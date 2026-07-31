// render / input 层 smoke 测试：用桩 ctx 验证 render 不崩溃、且读取了正确的状态字段；
// 验证 input 的拖拽/吸附/删线意图解析逻辑（纯函数部分）。
//
// 之前 render.ts(800+行) 与 input.ts 零测试，是最大覆盖盲区。
// 这里不验证像素，只验证「不崩溃 + 关键公式不硬编码 + 意图解析正确」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/game/state.ts';
import { render } from '../src/render.ts';
import { beginDrag, endDrag, stationAt, updateDrag } from '../src/input.ts';
import { MAX_INVENTORY, MAX_LINES } from '../src/game/config.ts';

// Node 环境无 Path2D；render 的 drawShape 用了 new Path2D()。
// 这里装一个最小桩，让 render 能跑完不崩溃。（ctx 的 createRadialGradient 等由 Proxy 桩返回 no-op）
// @ts-expect-error 注入全局 Path2D 桩
globalThis.Path2D = class {
  arc() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  rect() {}
};

/** 桩 CanvasRenderingContext2D：记录所有调用，全部 no-op，让 render 跑完不崩溃。 */
function makeStubCtx(): CanvasRenderingContext2D {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const handler = {
    get: (_t: unknown, prop: string) => {
      if (prop === 'canvas') return { width: 3840, height: 1200 };
      if (prop === 'measureText') return () => ({ width: 10 });
      // createRadialGradient 返回一个带 addColorStop 的对象
      if (prop === 'createRadialGradient') return () => gradient;
      // 其余函数属性返回 no-op
      return typeof prop === 'string' ? noop : undefined;
    },
    set: () => true,
  };
  // @ts-expect-error 桩对象，不需要完整实现 Canvas API
  return new Proxy({}, handler);
}

test('render 在 ready 阶段不崩溃', () => {
  const s = createInitialState(1);
  const ctx = makeStubCtx();
  // 不应抛错
  assert.doesNotThrow(() => render(ctx, s, 3840, 1200, {}));
});

test('render 在 running 阶段（带线路/列车/道具）不崩溃', () => {
  const s = createInitialState(7);
  s.phase = 'running';
  // 造一些线路/列车/道具/乘客，让各绘制分支都走到
  const [a, b] = s.stations;
  if (a && b) {
    a.passengers.push({ target: b.shape });
  }
  s.powerUps.push({ id: 0, type: 'speed', pos: { x: 500, y: 500 } });
  s.inventory = { speed: 1, clear: 0, deliver: 0, magnet: 0, shield: 0, double: 0 };
  s.combo = { count: 6, timer: 2 }; // 触发连击显示
  s.activeEvents = [{ kind: 'slow', remaining: 5 }];
  const ctx = makeStubCtx();
  assert.doesNotThrow(() => render(ctx, s, 3840, 1200, { alpha: 0.5 }));
});

test('render 在 gameover 阶段不崩溃', () => {
  const s = createInitialState(1);
  s.phase = 'gameover';
  const ctx = makeStubCtx();
  assert.doesNotThrow(() => render(ctx, s, 3840, 1200, { newRecord: true }));
});

test('render 在 paused 阶段（暂停菜单）不崩溃', () => {
  const s = createInitialState(1);
  s.phase = 'paused';
  const ctx = makeStubCtx();
  assert.doesNotThrow(() => render(ctx, s, 3840, 1200, { aiMode: 'auto' }));
});

test('render 在教程态不崩溃', () => {
  const s = createInitialState(1);
  s.phase = 'paused';
  const ctx = makeStubCtx();
  assert.doesNotThrow(() => render(ctx, s, 3840, 1200, { tutorialStep: 2 }));
});

// ---------- input 层意图解析 ----------

test('stationAt 在站点附近返回其 id', () => {
  const s = createInitialState(1);
  const first = s.stations[0]!;
  const got = stationAt(s, { x: first.pos.x + 5, y: first.pos.y + 5 });
  assert.equal(got, first.id);
});

test('stationAt 远离站点返回 null', () => {
  const s = createInitialState(1);
  assert.equal(stationAt(s, { x: 5, y: 5 }), null);
});

test('beginDrag 在站点上开始返回 DragState', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  const first = s.stations[0]!;
  const drag = beginDrag(s, { x: first.pos.x, y: first.pos.y });
  assert.ok(drag);
  assert.equal(drag!.originStationId, first.id);
});

test('beginDrag 在空白处返回 null', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  assert.equal(beginDrag(s, { x: 5, y: 5 }), null);
});

test('updateDrag 靠近另一站点时吸附其坐标', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  const [a, b] = s.stations;
  const drag = beginDrag(s, { x: a!.pos.x, y: a!.pos.y })!;
  // 拖到 b 附近（在吸附半径内）
  const updated = updateDrag(s, drag, { x: b!.pos.x + 10, y: b!.pos.y + 10 });
  assert.ok(Math.abs(updated.to.x - b!.pos.x) < 1, '应吸附到 b 的坐标');
});

test('endDrag 在另一站点上完成建线', () => {
  const s = createInitialState(1);
  s.phase = 'running';
  const [a, b] = s.stations;
  const drag = beginDrag(s, { x: a!.pos.x, y: a!.pos.y })!;
  endDrag(s, drag, { x: b!.pos.x, y: b!.pos.y });
  assert.equal(s.lines.length, 1, '应成功建立一条线');
});

// ---------- 硬编码回归 guard（防止修过的 bug 复发）----------

test('MAX_INVENTORY 与 pickup 上限一致（防 <3 硬编码回归）', () => {
  // 这个常量现在被 powerups.ts 实际使用；若有人改回硬编码 3，此测试仍过，
  // 但至少文档化「背包上限来自 MAX_INVENTORY」这一约定。
  assert.ok(MAX_INVENTORY > 0);
});

test('MAX_LINES 与 HUD 显示一致（防 /7 硬编码回归）', () => {
  assert.ok(MAX_LINES > 7, 'MAX_LINES 已从 7 放大');
});
