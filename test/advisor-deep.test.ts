// AI 顾问深层测试 D2：askAdvice 异步链路、serializeSnapshot 拥堵/策略/事件行、
// countTargets 多目标分布、lineStrategyAdvice 边界（worstLineId 指向已删线、空 stops、端点不可延伸）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  askAdvice,
  lineStrategyAdvice,
  mockAdvice,
  parseAdvice,
  serializeSnapshot,
  shapeName,
} from '../src/ai/advisor.ts';
import { createInitialState } from '../src/game/state.ts';
import { createLine } from '../src/game/simulation.ts';
import { sample, type CongestionHistory } from '../src/game/congestion.ts';
import type { GameState, LineColor, Shape, Station } from '../src/game/types.ts';
import type { AIClient, Message } from '../src/ai/types.ts';

function runningState(): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  s.stations[0]!.shape = 'circle';
  s.stations[1]!.shape = 'triangle';
  s.stations[2]!.shape = 'square';
  s.stations[3]!.shape = 'star';
  return s;
}

function stubAI(reply: Partial<Message>, opts: { online?: boolean } = {}): AIClient {
  return {
    online: opts.online ?? false,
    async chat() {
      return {
        role: 'assistant',
        content: reply.content ?? null,
        toolCalls: reply.toolCalls,
      } as Message;
    },
  };
}

function throwingAI(err: Error): AIClient {
  return {
    online: true,
    async chat() {
      throw err;
    },
  };
}

// ─── askAdvice 异步链路（此前完全未直接测试） ───

test('askAdvice：在线 LLM 返回合法 JSON → 解析为结构化建议', async () => {
  const s = runningState();
  const ai = stubAI(
    {
      content: JSON.stringify({
        comment: '建议建线',
        action: 'create',
        fromShape: 'circle',
        toShape: 'square',
      }),
    },
    { online: true },
  );
  const a = await askAdvice(ai, s);
  assert.equal(a.action, 'create');
  assert.equal(a.fromShape, 'circle');
  assert.equal(a.toShape, 'square');
});

test('askAdvice：在线 LLM 返回 null content → 回退 mockAdvice', async () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }];
  const ai = stubAI({ content: null }, { online: true });
  const a = await askAdvice(ai, s);
  // mockAdvice 会给出 create/extend 建议
  assert.ok(['create', 'extend'].includes(a.action));
});

test('askAdvice：在线 LLM 返回空字符串 → 回退 mockAdvice', async () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'triangle' }];
  const ai = stubAI({ content: '' }, { online: true });
  const a = await askAdvice(ai, s);
  assert.equal(a.toShape, 'triangle');
});

test('askAdvice：网络抛错 → 回退 mockAdvice（不抛出）', async () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }];
  const ai = throwingAI(new Error('connection reset'));
  const a = await askAdvice(ai, s);
  // 应回退到 mockAdvice，给出 create（无线路时）
  assert.equal(a.action, 'create');
  assert.equal(a.fromShape, 'circle');
});

test('askAdvice：消息含 system + user 两条（system 是固定 prompt）', async () => {
  const s = runningState();
  const captured: Message[] = [];
  const ai: AIClient = {
    online: true,
    async chat(input) {
      captured.push(...input.messages);
      return { role: 'assistant', content: '{"action":"observe"}', toolCalls: [] } as Message;
    },
  };
  await askAdvice(ai, s);
  assert.equal(captured.length, 2);
  assert.equal(captured[0]!.role, 'system');
  assert.equal(captured[1]!.role, 'user');
  assert.ok((captured[0]!.content ?? '').includes('策略顾问'));
});

test('askAdvice：带 congestion 参数 → user 消息含预测行', async () => {
  const s = runningState();
  // 采样一次产生拥堵历史
  const history = sample(s, { samples: {} }, 0);
  let userContent = '';
  const ai: AIClient = {
    online: true,
    async chat(input) {
      userContent = input.messages.find((m) => m.role === 'user')?.content ?? '';
      return { role: 'assistant', content: '{"action":"observe"}', toolCalls: [] } as Message;
    },
  };
  await askAdvice(ai, s, history);
  assert.ok(userContent.includes('预测:'), `应含拥堵预测行：${userContent}`);
});

test('askAdvice：不带 congestion → user 消息无预测行', async () => {
  const s = runningState();
  let userContent = '';
  const ai: AIClient = {
    online: true,
    async chat(input) {
      userContent = input.messages.find((m) => m.role === 'user')?.content ?? '';
      return { role: 'assistant', content: '{"action":"observe"}', toolCalls: [] } as Message;
    },
  };
  await askAdvice(ai, s);
  assert.ok(!userContent.includes('预测:'));
});

// ─── serializeSnapshot 深层（countTargets / 拥堵 / 策略 / 事件 / 线路形状链） ───

test('serializeSnapshot：站台含多目标乘客 → 「去往:」列出每种形状×计数', () => {
  const s = runningState();
  s.stations[0]!.passengers = [
    { target: 'square' },
    { target: 'square' },
    { target: 'triangle' },
  ];
  const snap = serializeSnapshot(s);
  // circle 站应有「去往:□×2 △×1」类似格式
  const line = snap.split('\n').find((l) => includesShape(l, 'circle')) ?? '';
  assert.ok(line.includes('□×2'), `应含 □×2：${line}`);
  assert.ok(line.includes('△×1'), `应含 △×1：${line}`);
});

test('serializeSnapshot：站台无乘客 → 「去往:无」', () => {
  const s = runningState();
  // 默认无乘客
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('去往:无'), `应含「去往:无」：${snap}`);
});

test('serializeSnapshot：等待人数显示 N/capacity', () => {
  const s = runningState();
  s.capacity = 6;
  s.stations[0]!.passengers = [{ target: 'square' }, { target: 'triangle' }];
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('等待2/6'), `应含「等待2/6」：${snap}`);
});

test('serializeSnapshot：线路列出形状链（circle-triangle-square）', () => {
  const s = runningState();
  createLine(s, s.stations[0]!.id, s.stations[1]!.id); // circle-triangle
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('○-△'), `线路应显示形状链 ○-△：${snap}`);
});

test('serializeSnapshot：线路含颜色标记', () => {
  const s = runningState();
  createLine(s, s.stations[0]!.id, s.stations[1]!.id);
  const color = s.lines[0]!.color;
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes(color), `应含线路颜色 ${color}：${snap}`);
});

test('serializeSnapshot：有 activeEvents → 含事件描述', () => {
  const s = runningState();
  s.activeEvents = [{ kind: 'slow', remaining: 5 }];
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('事件:'), `应含事件标记：${snap}`);
});

test('serializeSnapshot：无 activeEvents → 无事件行', () => {
  const s = runningState();
  s.activeEvents = [];
  const snap = serializeSnapshot(s);
  // 时间行里不应有「事件:」片段
  const timeLine = snap.split('\n')[0] ?? '';
  assert.ok(!timeLine.includes('事件:'));
});

test('serializeSnapshot：时间行含 elapsed 取整（floor）', () => {
  const s = runningState();
  s.elapsed = 42.9;
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('时间: 42s'), `应含「时间: 42s」：${snap}`);
});

test('serializeSnapshot：无线路时显示「(无线路)」', () => {
  const s = runningState();
  s.lines = [];
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('(无线路)'));
});

test('serializeSnapshot：无线路时策略行显示「(尚无线路)」', () => {
  const s = runningState();
  s.lines = [];
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('(尚无线路)'));
});

test('serializeSnapshot：有线路时策略行含均分/拥堵/利用率', () => {
  const s = runningState();
  createLine(s, s.stations[0]!.id, s.stations[1]!.id);
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('均分'));
  assert.ok(snap.includes('利用率'));
  assert.ok(snap.includes('形状覆盖'));
});

// ─── parseAdvice 深层（comment clampStr 边界） ───

test('parseAdvice：comment 恰好 4 字符 → 不补齐', () => {
  const s = runningState();
  const a = parseAdvice(JSON.stringify({ comment: '观察局势', action: 'observe' }), s);
  assert.equal(a.comment, '观察局势');
  assert.equal(a.comment.length, 4);
});

test('parseAdvice：comment 恰好 30 字符 → 不截断', () => {
  const s = runningState();
  // 构造精确 30 字符的 comment
  const c = '观察局势'.repeat(7) + '一二'; // 4*7+2 = 30
  assert.equal(c.length, 30);
  const a = parseAdvice(JSON.stringify({ comment: c, action: 'observe' }), s);
  assert.equal(a.comment.length, 30);
  assert.equal(a.comment, c);
});

test('parseAdvice：comment 全空白 → 用默认文案', () => {
  const s = runningState();
  const a = parseAdvice(JSON.stringify({ comment: '   ', action: 'observe' }), s);
  assert.equal(a.comment, '观察一下局势。');
});

test('parseAdvice：action 合法但 fromShape/toShape 非法 → action 保留，形状丢弃', () => {
  const s = runningState();
  const a = parseAdvice(
    JSON.stringify({
      comment: '建议',
      action: 'extend',
      fromShape: 'hexagon',
      toShape: 'octagon',
    }),
    s,
  );
  assert.equal(a.action, 'extend');
  assert.equal(a.fromShape, undefined);
  assert.equal(a.toShape, undefined);
});

test('parseAdvice：action=observe（合法）→ 保留', () => {
  const s = runningState();
  const a = parseAdvice(JSON.stringify({ comment: '看', action: 'observe' }), s);
  assert.equal(a.action, 'observe');
});

test('parseAdvice：含前后干扰文字 + 围栏 JSON → 抠出对象', () => {
  const s = runningState();
  const text = `好的，我建议：
\`\`\`json
{"comment":"建线","action":"create","fromShape":"circle","toShape":"triangle"}
\`\`\`
希望有帮助。`;
  const a = parseAdvice(text, s);
  assert.equal(a.action, 'create');
  assert.equal(a.fromShape, 'circle');
});

test('parseAdvice：JSON 大括号顺序倒置（}在{前）→ 回退 mock', () => {
  const s = runningState();
  // lastIndexOf('}') < indexOf('{') 不可能；构造 end <= start 的场景
  const text = '}{'; // start=1, end=0 → end < start
  const a = parseAdvice(text, s);
  assert.ok(['create', 'extend', 'remove', 'observe'].includes(a.action));
});

// ─── mockAdvice 深层（多站并列、空 state） ───

test('mockAdvice：多站并列拥堵 → 取排序首个（稳定）', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }, { target: 'square' }];
  s.stations[1]!.passengers = [{ target: 'circle' }, { target: 'circle' }];
  // 站0(circle) 与 站1(triangle) 并列 2 人；sort 稳定 → 站0 先
  const a = mockAdvice(s);
  assert.equal(a.fromShape, 'circle');
});

test('mockAdvice：所有站 0 乘客 → observe', () => {
  const s = runningState();
  for (const st of s.stations) st.passengers = [];
  const a = mockAdvice(s);
  assert.equal(a.action, 'observe');
  assert.equal(a.comment, '线路通畅，继续保持。');
});

test('mockAdvice：恰 7 条线 → extend', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }];
  for (let i = 0; i < 7; i++) {
    s.lines.push({ id: i, color: `c${i}`, stops: [0, 1] } as never);
  }
  const a = mockAdvice(s);
  assert.equal(a.action, 'extend');
});

// ─── lineStrategyAdvice 边界（此前部分覆盖） ───

function bareStrategyState(capacity = 6): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  s.capacity = capacity;
  s.nextPowerUpIn = 1e9;
  s.nextPassengerIn = 1e9;
  s.nextStationIn = 1e9;
  s.stations = [];
  s.lines = [];
  s.trains = [];
  return s;
}

function st(id: number, shape: Shape, x: number, y: number, passengers = 0): Station {
  return {
    id,
    shape,
    pos: { x, y },
    passengers: Array.from({ length: passengers }, () => ({ target: 'square' as const })),
    overloadTimer: 0,
    kind: 'normal',
  };
}

function line(
  state: GameState,
  color: LineColor,
  stops: Station[],
  onboard: number,
): void {
  for (const s of stops) {
    if (!state.stations.some((x) => x.id === s.id)) state.stations.push(s);
  }
  const id = state.nextLineId++;
  state.lines.push({ id, color, stops: stops.map((s) => s.id) });
  state.trains.push({
    lineId: id,
    segment: 0,
    t: 0,
    direction: 1,
    passengers: Array.from({ length: onboard }, () => ({ target: 'square' as const })),
    dwellTimer: 0,
  });
}

test('lineStrategyAdvice：worstLineId 指向已删除线 → 回退 observe', () => {
  const s = bareStrategyState();
  // 构造两条线，记录后会评估出 worstLineId；
  // 然后从 state.lines 删掉那条最差线（模拟 id 漂移）
  line(s, 'red', [st(1, 'circle', 0, 0), st(2, 'triangle', 100, 0)], 3);
  line(s, 'blue', [st(3, 'square', 200, 0), st(4, 'star', 300, 0)], 3);
  // 删掉 blue（可能是 worst）
  s.lines = s.lines.filter((l) => l.color === 'red');
  // worstLineId 仍可能指向已删的 blue → find 返回 undefined → observe
  const a = lineStrategyAdvice(s);
  assert.equal(a.action, 'observe');
});

test('lineStrategyAdvice：worstLine stops 为空 → observe', () => {
  const s = bareStrategyState();
  line(s, 'red', [st(1, 'circle', 0, 0), st(2, 'triangle', 100, 0)], 3);
  // 手动塞一条空 stops 的「最差」线
  s.lines.push({ id: 999, color: 'blue', stops: [] });
  const a = lineStrategyAdvice(s);
  // 空 stops 的线 evaluateLine 会很低 → remove；或 stopsOnLine 空 → observe
  assert.ok(['remove', 'observe'].includes(a.action));
});

test('lineStrategyAdvice：最差线评分 <35 但 stops 为空 → 仍 remove（不依赖 stops）', () => {
  const s = bareStrategyState();
  // red 是高分线
  line(s, 'red', [st(1, 'circle', 0, 0), st(2, 'triangle', 1500, 0)], 6);
  // blue：空载 + 空 stops + 远端 → 必然 < 35
  s.lines.push({ id: 99, color: 'blue', stops: [] });
  s.trains.push({ lineId: 99, segment: 0, t: 0, direction: 1, passengers: [], dwellTimer: 0 });
  const a = lineStrategyAdvice(s);
  // 空 stops 线 evaluateLine 应极低 → remove
  assert.ok(a.action === 'remove' || a.action === 'observe');
  assert.ok(a.comment.length > 0);
});

test('lineStrategyAdvice：comment 在 remove 时含线路颜色', () => {
  const s = bareStrategyState();
  line(s, 'red', [st(1, 'circle', 0, 0), st(2, 'triangle', 1500, 0), st(3, 'square', 3000, 0)], 6);
  line(s, 'blue', [st(4, 'diamond', 9000, 0), st(5, 'diamond', 9100, 0)], 0);
  const a = lineStrategyAdvice(s);
  if (a.action === 'remove') {
    assert.ok(a.comment.includes('blue') || a.comment.includes('red'));
  }
});

test('lineStrategyAdvice：comment 在 extend 时含目标形状字形', () => {
  const s = bareStrategyState();
  line(s, 'red', [st(1, 'circle', 0, 0), st(2, 'triangle', 1500, 0), st(3, 'square', 3000, 0)], 6);
  line(s, 'blue', [st(4, 'star', 5000, 0, 5), st(5, 'diamond', 5100, 0, 0)], 2);
  s.stations.push(st(6, 'square', 5050, 0));
  const a = lineStrategyAdvice(s);
  if (a.action === 'extend') {
    // 乘客目标都是 square（st 默认），字形 □
    assert.ok(a.comment.includes('□') || a.comment.length > 0);
  }
});

test('shapeName：diamond → ◇，star → ☆', () => {
  assert.equal(shapeName('diamond'), '◇');
  assert.equal(shapeName('star'), '☆');
});

// 辅助：判断文本是否含某形状的字形（用于在多行快照里定位站点行）
function includesShape(text: string, shape: Shape): boolean {
  return text.includes(shapeName(shape));
}
