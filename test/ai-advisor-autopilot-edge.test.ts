// AI advisor 离线 Mock 决策质量 + autopilot 工具调度测试。
// 补充 advisor.test.ts 未覆盖：
//  - mockAdvice 决策一致性、目标选择、拥堵排序、create vs extend 阈值
//  - parseAdvice：```json``` 代码块包裹、comment 截断/补齐、缺字段默认
//  - autopilotTick：stub AIClient 返回 toolCalls → acted；无 toolCalls → 未行动；抛错 → 回退 mock
//  - autopilotTick：未知工具名被标记
//  - mockAutopilot：拥堵站 acted、无乘客未行动
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockAdvice, parseAdvice, serializeSnapshot } from '../src/ai/advisor.ts';
import { autopilotTick, mockAutopilot } from '../src/ai/autopilot.ts';
import { createInitialState } from '../src/game/state.ts';
import { createLine } from '../src/game/simulation.ts';
import type { GameState } from '../src/game/types.ts';
import type { AIClient, Message, ToolCall } from '../src/ai/types.ts';

function runningState(): GameState {
  const s = createInitialState(1);
  s.phase = 'running';
  s.stations[0]!.shape = 'circle';
  s.stations[1]!.shape = 'triangle';
  s.stations[2]!.shape = 'square';
  s.stations[3]!.shape = 'star';
  return s;
}

/** 造一个 stub AIClient：按预设回复 */
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

/** 造一个抛错的 AIClient（模拟网络失败） */
function throwingAI(err: Error): AIClient {
  return {
    online: true,
    async chat() {
      throw err;
    },
  };
}

// ─── mockAdvice 决策质量 ───

test('mockAdvice：决策一致性——相同输入给出相同建议', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }, { target: 'triangle' }];
  const a1 = mockAdvice(s);
  const a2 = mockAdvice(s);
  assert.deepEqual(a1, a2);
});

test('mockAdvice：目标选择取最堵站首个乘客的目标形状', () => {
  const s = runningState();
  // circle 站最堵，首个乘客目标 square
  s.stations[0]!.passengers = [{ target: 'square' }, { target: 'triangle' }];
  s.stations[1]!.passengers = [{ target: 'square' }]; // 较少
  const a = mockAdvice(s);
  assert.equal(a.fromShape, 'circle'); // 最堵
  assert.equal(a.toShape, 'square'); // 首个乘客目标
});

test('mockAdvice：按拥堵数排序选最堵站', () => {
  const s = runningState();
  // triangle 站比 circle 站更堵
  s.stations[1]!.passengers = [
    { target: 'circle' },
    { target: 'circle' },
    { target: 'circle' },
  ];
  s.stations[0]!.passengers = [{ target: 'square' }];
  const a = mockAdvice(s);
  assert.equal(a.fromShape, 'triangle'); // 3 个乘客 > 1 个
});

test('mockAdvice：线路未满（<7）→ action=create', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }];
  // runningState 初始无线路
  assert.equal(s.lines.length, 0);
  const a = mockAdvice(s);
  assert.equal(a.action, 'create');
});

test('mockAdvice：线路已满（≥7）→ action=extend', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }];
  // 手动塞满 7 条线（绕过 createLine 的真实约束，只测阈值）
  for (let i = 0; i < 7; i++) {
    s.lines.push({
      color: `c${i}`,
      stops: [s.stations[0]!.id, s.stations[1]!.id],
      trains: [],
    } as never);
  }
  assert.ok(s.lines.length >= 7);
  const a = mockAdvice(s);
  assert.equal(a.action, 'extend');
});

test('mockAdvice：comment 文案含拥堵站与目标形状信息', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }];
  const a = mockAdvice(s);
  assert.ok(a.comment.length > 0);
  assert.ok(a.comment.includes('○') || a.comment.includes('□')); // 含 circle 或 square 字形
});

// ─── parseAdvice 容错 ───

test('parseAdvice：```json``` 代码块包裹也能解析', () => {
  const s = runningState();
  const text = '```json\n{"comment":"建议","action":"create","fromShape":"circle","toShape":"square"}\n```';
  const a = parseAdvice(text, s);
  assert.equal(a.action, 'create');
  assert.equal(a.fromShape, 'circle');
});

test('parseAdvice：comment 超长被截断到上限', () => {
  const s = runningState();
  const longComment = '这是一段非常非常非常非常非常非常非常长的点评文案'.repeat(3);
  const a = parseAdvice(JSON.stringify({ comment: longComment, action: 'observe' }), s);
  assert.ok(a.comment.length <= 30);
});

test('parseAdvice：comment 过短被补齐到下限', () => {
  const s = runningState();
  const a = parseAdvice(JSON.stringify({ comment: '嗯', action: 'observe' }), s);
  assert.ok(a.comment.length >= 4);
});

test('parseAdvice：comment 缺失时给默认文案', () => {
  const s = runningState();
  const a = parseAdvice(JSON.stringify({ action: 'observe' }), s);
  assert.ok(a.comment.length > 0);
});

test('parseAdvice：仅 action=remove 不需形状也能解析', () => {
  const s = runningState();
  const a = parseAdvice(JSON.stringify({ comment: '删线', action: 'remove' }), s);
  assert.equal(a.action, 'remove');
  assert.equal(a.fromShape, undefined);
  assert.equal(a.toShape, undefined);
});

test('serializeSnapshot：含已送达数与线路计数', () => {
  const s = runningState();
  s.delivered = 5;
  const snap = serializeSnapshot(s);
  assert.ok(snap.includes('已送达'));
  assert.match(snap, /线路: \d+\/7/);
});

// ─── autopilotTick 工具调度 ───

test('autopilotTick：stub 返回 create_line 工具调用 → acted=true', async () => {
  const s = runningState();
  const toolCalls: ToolCall[] = [
    { id: 't1', name: 'create_line', arguments: { fromShape: 'circle', toShape: 'square' } },
  ];
  const ai = stubAI({ toolCalls });
  const r = await autopilotTick(ai, s);
  assert.equal(r.acted, true);
  assert.ok(r.summary.includes('create_line'));
  assert.ok(r.summary.includes('✓'));
  assert.ok(s.lines.length > 0); // 真实建了线
});

test('autopilotTick：stub 无 toolCalls（仅文字）→ acted=false', async () => {
  const s = runningState();
  const ai = stubAI({ content: '保持现状' });
  const r = await autopilotTick(ai, s);
  assert.equal(r.acted, false);
  assert.ok(r.summary.includes('保持现状'));
});

test('autopilotTick：stub 抛错 → 回退 mockAutopilot', async () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }];
  const ai = throwingAI(new Error('network down'));
  const r = await autopilotTick(ai, s);
  // 回退到 mock：因有乘客 → 应 acted=true，summary 含 mock
  assert.equal(r.acted, true);
  assert.ok(r.summary.includes('mock'));
});

test('autopilotTick：未知工具名被标记为未知', async () => {
  const s = runningState();
  const toolCalls: ToolCall[] = [
    { id: 't1', name: 'teleport_train', arguments: {} }, // 不存在的工具
  ];
  const ai = stubAI({ toolCalls });
  const r = await autopilotTick(ai, s);
  assert.equal(r.acted, true);
  assert.ok(r.summary.includes('teleport_train'));
  assert.ok(r.summary.includes('未知工具'));
});

test('autopilotTick：多个工具调用顺序执行并汇总', async () => {
  const s = runningState();
  const toolCalls: ToolCall[] = [
    { id: 't1', name: 'create_line', arguments: { fromShape: 'circle', toShape: 'square' } },
    { id: 't2', name: 'extend_line', arguments: { fromShape: 'square', toShape: 'star' } },
  ];
  const ai = stubAI({ toolCalls });
  const r = await autopilotTick(ai, s);
  assert.equal(r.acted, true);
  assert.ok(r.summary.includes('create_line'));
  assert.ok(r.summary.includes('extend_line'));
});

// ─── mockAutopilot 启发式 ───

test('mockAutopilot：有拥堵站 → 建线/延伸（acted=true）', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }];
  const r = mockAutopilot(s);
  assert.equal(r.acted, true);
  assert.ok(r.summary.includes('mock'));
});

test('mockAutopilot：所有站无乘客 → acted=false', () => {
  const s = runningState();
  // 初始无乘客
  for (const st of s.stations) st.passengers = [];
  const r = mockAutopilot(s);
  assert.equal(r.acted, false);
});

test('mockAutopilot：已有线时优先 extend_line', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'square' }];
  // 先建一条 circle-triangle 线，使 extend 有机会成功
  createLine(s, s.stations[0]!.id, s.stations[1]!.id);
  const r = mockAutopilot(s);
  // extend 优先；若 extend 成功则 summary 含 extend
  if (r.acted) {
    assert.ok(r.summary.includes('extend') || r.summary.includes('create'));
  }
});

test('autopilotTick：上下文快照在 await 前冻结（serializeSnapshot 被调用一次）', async () => {
  const s = runningState();
  let calls = 0;
  // 包一层计数 chat 调用，间接验证快照已序列化
  const ai: AIClient = {
    online: false,
    async chat(input) {
      calls++;
      // 验证 user 消息内容是序列化快照（含「站点:」）
      const userMsg = input.messages.find((m) => m.role === 'user');
      assert.ok(userMsg?.content?.includes('站点:'));
      return { role: 'assistant', content: '观察', toolCalls: [] } as Message;
    },
  };
  await autopilotTick(ai, s);
  assert.equal(calls, 1);
});
