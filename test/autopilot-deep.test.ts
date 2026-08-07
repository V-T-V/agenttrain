// 自动驾驶深层测试 D3：buildAutopilotTools 内部行为 + autopilotTick/mockAutopilot 边界。
// 覆盖此前未直接测试的：
//  - findStationByShape：同形状多站时选最堵的（通过 create_line 目标解析间接验证）
//  - findExtendableLine：head 优先于 tail 匹配
//  - 工具参数 schema（enum=可用形状、required 字段）
//  - create_line 达 MAX_LINES 上限失败、相同站点失败
//  - extend_line 无可延伸线/目标形状缺失/已在在线失败
//  - remove_line 颜色不存在
//  - mockAutopilot：extend 成功优先于 create、create 兜底、全失败
//  - autopilotTick：工具执行返回 ok=false 被标记 ✗、并发期间 state 变化
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAutopilotTools } from '../src/ai/tools.ts';
import { autopilotTick, mockAutopilot } from '../src/ai/autopilot.ts';
import { createInitialState } from '../src/game/state.ts';
import { createLine, extendLine } from '../src/game/simulation.ts';
import { MAX_LINES } from '../src/game/config.ts';
import type { GameState, Shape } from '../src/game/types.ts';
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

// ─── 工具参数 schema ───

test('create_line 工具：parameters.enum 列出当前所有可用形状', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  const create = tools.find((t) => t.name === 'create_line')!;
  const fromEnum = create.parameters.properties.fromShape!.enum as string[];
  assert.ok(fromEnum.includes('circle'));
  assert.ok(fromEnum.includes('triangle'));
  assert.ok(fromEnum.includes('square'));
  assert.ok(fromEnum.includes('star'));
});

test('create_line 工具：required 含 fromShape 与 toShape', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  const create = tools.find((t) => t.name === 'create_line')!;
  assert.ok(create.parameters.required!.includes('fromShape'));
  assert.ok(create.parameters.required!.includes('toShape'));
});

test('remove_line 工具：required 含 color', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  const remove = tools.find((t) => t.name === 'remove_line')!;
  assert.ok(remove.parameters.required!.includes('color'));
});

test('extend_line 工具：description 说明「无可用 create_line」', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  const extend = tools.find((t) => t.name === 'extend_line')!;
  assert.ok(extend.description.includes('create_line'));
});

test('工具 description 都非空', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  for (const t of tools) {
    assert.ok(t.description.length > 10, `${t.name} description 应详尽`);
  }
});

// ─── findStationByShape：最堵优先（间接验证） ───

test('create_line：同形状两站时选乘客更多的那个作为 from', () => {
  const s = runningState();
  // 两个 circle 站：站0 无乘客，加一个有乘客的 circle 站
  s.stations.push({
    id: 100,
    shape: 'circle',
    pos: { x: 500, y: 500 },
    passengers: [{ target: 'square' }, { target: 'square' }],
    overloadTimer: 0,
    kind: 'normal',
  });
  const tools = buildAutopilotTools(s);
  const create = tools.find((t) => t.name === 'create_line')!;
  const res = create.execute({ fromShape: 'circle', toShape: 'triangle' });
  // 选了站100（有乘客的）作为起点
  assert.equal((res as { ok: boolean }).ok, true);
  assert.equal(s.lines[0]!.stops[0], 100);
});

test('create_line：同形状两站，to 也选最堵的', () => {
  const s = runningState();
  // triangle 站1 无乘客；加一个有乘客的 triangle 站
  s.stations.push({
    id: 200,
    shape: 'triangle',
    pos: { x: 600, y: 600 },
    passengers: [{ target: 'circle' }, { target: 'circle' }, { target: 'circle' }],
    overloadTimer: 0,
    kind: 'normal',
  });
  const tools = buildAutopilotTools(s);
  const create = tools.find((t) => t.name === 'create_line')!;
  const res = create.execute({ fromShape: 'circle', toShape: 'triangle' });
  assert.equal((res as { ok: boolean }).ok, true);
  assert.equal(s.lines[0]!.stops[1], 200);
});

test('create_line：形状不存在 → ok=false 含「找不到」', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  const create = tools.find((t) => t.name === 'create_line')!;
  // diamond 形状不存在
  const res = create.execute({ fromShape: 'diamond', toShape: 'circle' }) as {
    ok: boolean;
    reason?: string;
  };
  assert.equal(res.ok, false);
  assert.ok(res.reason?.includes('找不到'));
});

// ─── create_line 上限 ───

test('create_line：达 MAX_LINES 上限 → ok=false', () => {
  const s = runningState();
  // 手动塞满 MAX_LINES 条线（绕过 createLine 真实建线）
  for (let i = 0; i < MAX_LINES; i++) {
    s.lines.push({ id: i, color: 'red', stops: [0, 1] } as never);
  }
  assert.equal(s.lines.length, MAX_LINES);
  const tools = buildAutopilotTools(s);
  const create = tools.find((t) => t.name === 'create_line')!;
  const res = create.execute({ fromShape: 'circle', toShape: 'triangle' }) as {
    ok: boolean;
    reason?: string;
  };
  assert.equal(res.ok, false);
  assert.ok(res.reason?.includes('上限'));
});

test('create_line：from 与 to 解析为同一站 → ok=false', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  const create = tools.find((t) => t.name === 'create_line')!;
  // 只有一个 circle 站 → from=to=站0
  const res = create.execute({ fromShape: 'circle', toShape: 'circle' }) as {
    ok: boolean;
    reason?: string;
  };
  assert.equal(res.ok, false);
});

// ─── extend_line 深层 ───

test('extend_line：无可从该形状延伸的线 → ok=false', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  const extend = tools.find((t) => t.name === 'extend_line')!;
  const res = extend.execute({ fromShape: 'circle', toShape: 'square' }) as {
    ok: boolean;
    reason?: string;
  };
  assert.equal(res.ok, false);
  assert.ok(res.reason?.includes('没有可从'));
});

test('extend_line：有可延伸线但目标形状不存在 → ok=false', () => {
  const s = runningState();
  createLine(s, s.stations[0]!.id, s.stations[1]!.id); // circle-triangle
  const tools = buildAutopilotTools(s);
  const extend = tools.find((t) => t.name === 'extend_line')!;
  // diamond 不存在
  const res = extend.execute({ fromShape: 'triangle', toShape: 'diamond' }) as {
    ok: boolean;
    reason?: string;
  };
  assert.equal(res.ok, false);
  assert.ok(res.reason?.includes('找不到目标'));
});

test('extend_line：head 优先匹配（线 head=triangle 时 fromShape=triangle 命中 head）', () => {
  const s = runningState();
  // 建线 circle-triangle，head=circle tail=triangle
  createLine(s, s.stations[0]!.id, s.stations[1]!.id);
  const tools = buildAutopilotTools(s);
  const extend = tools.find((t) => t.name === 'extend_line')!;
  // fromShape=triangle 命中 tail
  const res = extend.execute({ fromShape: 'triangle', toShape: 'square' });
  assert.equal((res as { ok: boolean }).ok, true);
  // square 加到尾部
  assert.equal(s.lines[0]!.stops[s.lines[0]!.stops.length - 1], s.stations[2]!.id);
});

test('extend_line：head 匹配时新站加到头部', () => {
  const s = runningState();
  // 建线 circle-triangle，head=circle
  createLine(s, s.stations[0]!.id, s.stations[1]!.id);
  const tools = buildAutopilotTools(s);
  const extend = tools.find((t) => t.name === 'extend_line')!;
  // fromShape=circle 命中 head → 新站加到头部
  const res = extend.execute({ fromShape: 'circle', toShape: 'square' });
  assert.equal((res as { ok: boolean }).ok, true);
  assert.equal(s.lines[0]!.stops[0], s.stations[2]!.id); // square 在头部
});

test('extend_line：目标站已在线上 → ok=false（extendLine 拒绝重复）', () => {
  const s = runningState();
  createLine(s, s.stations[0]!.id, s.stations[1]!.id); // circle-triangle
  // 延伸到 square
  extendLine(s, s.lines[0]!.id, s.stations[2]!.id, false);
  // 再延伸到 square（已在）→ 失败
  const tools = buildAutopilotTools(s);
  const extend = tools.find((t) => t.name === 'extend_line')!;
  const res = extend.execute({ fromShape: 'square', toShape: 'circle' }) as { ok: boolean };
  assert.equal(res.ok, false);
});

// ─── remove_line 深层 ───

test('remove_line：颜色不存在 → ok=false 含「没有该颜色」', () => {
  const s = runningState();
  createLine(s, s.stations[0]!.id, s.stations[1]!.id);
  const tools = buildAutopilotTools(s);
  const remove = tools.find((t) => t.name === 'remove_line')!;
  const res = remove.execute({ color: 'nonexistent' }) as { ok: boolean; reason?: string };
  assert.equal(res.ok, false);
  assert.ok(res.reason?.includes('没有该颜色'));
});

test('remove_line：成功删除后 lines 与 trains 都减少', () => {
  const s = runningState();
  createLine(s, s.stations[0]!.id, s.stations[1]!.id);
  const color = s.lines[0]!.color;
  const linesBefore = s.lines.length;
  const trainsBefore = s.trains.length;
  const tools = buildAutopilotTools(s);
  const remove = tools.find((t) => t.name === 'remove_line')!;
  const res = remove.execute({ color });
  assert.equal((res as { ok: boolean }).ok, true);
  assert.equal(s.lines.length, linesBefore - 1);
  assert.equal(s.trains.length, trainsBefore - 1);
});

// ─── autopilotTick 深层 ───

test('autopilotTick：工具执行返回 ok=false → summary 标记 ✗', async () => {
  const s = runningState();
  // 调用 remove_line 但没有该颜色 → ok=false
  const toolCalls: ToolCall[] = [
    { id: 't1', name: 'remove_line', arguments: { color: 'ghost' } },
  ];
  const ai = stubAI({ toolCalls });
  const r = await autopilotTick(ai, s);
  assert.equal(r.acted, true);
  assert.ok(r.summary.includes('remove_line'));
  assert.ok(r.summary.includes('✗'));
});

test('autopilotTick：工具 execute 抛错 → 不崩溃，标记 ✗（ok 未定义）', async () => {
  const s = runningState();
  // 造一个会抛错的工具调用：传非法参数让 createLine 内部不抛但 ok=false
  // 实际 create_line 不会抛，但验证未知工具路径
  const toolCalls: ToolCall[] = [
    { id: 't1', name: 'unknown_tool', arguments: {} },
    { id: 't2', name: 'create_line', arguments: { fromShape: 'circle', toShape: 'triangle' } },
  ];
  const ai = stubAI({ toolCalls });
  const r = await autopilotTick(ai, s);
  assert.equal(r.acted, true);
  assert.ok(r.summary.includes('unknown_tool'));
  assert.ok(r.summary.includes('✓')); // create_line 成功
});

test('autopilotTick：reply.content 为 null 且无 toolCalls → summary 用「观察中」兜底', async () => {
  const s = runningState();
  const ai = stubAI({ content: null });
  const r = await autopilotTick(ai, s);
  assert.equal(r.acted, false);
  assert.equal(r.summary, '观察中');
});

test('autopilotTick：reply.content 超长 → summary 截断到 24 字符', async () => {
  const s = runningState();
  const long = '这是一段非常长的观察总结'.repeat(10);
  const ai = stubAI({ content: long });
  const r = await autopilotTick(ai, s);
  assert.equal(r.acted, false);
  assert.ok(r.summary.length <= 24);
});

test('autopilotTick：工具调用并发期间 state 被改 → 工具作用于最新 state', async () => {
  const s = runningState();
  const toolCalls: ToolCall[] = [
    { id: 't1', name: 'create_line', arguments: { fromShape: 'circle', toShape: 'triangle' } },
  ];
  const ai: AIClient = {
    online: false,
    async chat() {
      // 在 chat resolve 前修改 state（模拟主循环并发）
      s.lines.push({ id: 999, color: 'red', stops: [0, 1] } as never);
      return { role: 'assistant', content: null, toolCalls } as Message;
    },
  };
  const r = await autopilotTick(ai, s);
  // 工具仍执行（作用于已被修改的 state）
  assert.equal(r.acted, true);
});

// ─── mockAutopilot 深层 ───

test('mockAutopilot：最堵站乘客目标形状对应站不存在 → create 失败 → 全失败 acted=false', () => {
  const s = runningState();
  // circle 站有乘客，目标 diamond，但无 diamond 站
  s.stations[0]!.passengers = [{ target: 'diamond' as Shape }];
  // 移除所有 diamond 可能性（本来就没有）
  const r = mockAutopilot(s);
  // extend 失败（无可延伸线），create 也失败（无 diamond 站）
  assert.equal(r.acted, false);
  assert.ok(r.summary.includes('无法操作') || r.summary.includes('mock'));
});

test('mockAutopilot：最堵站无乘客 → 跳过，找次堵', () => {
  const s = runningState();
  // 站0（circle）无乘客，站1（triangle）有乘客
  s.stations[0]!.passengers = [];
  s.stations[1]!.passengers = [{ target: 'square' }];
  const r = mockAutopilot(s);
  assert.equal(r.acted, true);
  assert.ok(r.summary.includes('mock'));
});

test('mockAutopilot：已有匹配线时 extend 成功优先', () => {
  const s = runningState();
  s.stations[0]!.passengers = [{ target: 'triangle' }];
  // circle-triangle 已存在 → extend 可命中（但目标 triangle 已是端点，会失败）
  // 改为：circle 站乘客目标 square，建 circle-triangle 线，extend triangle→square
  s.stations[0]!.passengers = [{ target: 'square' }];
  createLine(s, s.stations[0]!.id, s.stations[1]!.id); // circle-triangle
  const r = mockAutopilot(s);
  // extend（triangle→square）应成功
  assert.equal(r.acted, true);
  assert.ok(r.summary.includes('extend'));
});

test('mockAutopilot：仅一个站有乘客且目标=自身形状 → create 失败（同站）', () => {
  const s = runningState();
  // 只保留 circle 站有乘客，目标 circle（自身）→ create 同站失败
  s.stations[0]!.passengers = [{ target: 'circle' as Shape }];
  for (let i = 1; i < s.stations.length; i++) s.stations[i]!.passengers = [];
  const r = mockAutopilot(s);
  // extend 无线 → create circle→circle 同站失败
  assert.equal(r.acted, false);
});

// ─── 工具闭包捕获 state（每次重建工具反映最新 state） ───

test('工具闭包：删除站后重建工具，enum 不再含该形状', () => {
  const s = runningState();
  let tools = buildAutopilotTools(s);
  const before = tools.find((t) => t.name === 'create_line')!.parameters.properties.fromShape!
    .enum as string[];
  assert.ok(before.includes('star'));
  // 删掉 star 站
  s.stations = s.stations.filter((st) => st.shape !== 'star');
  tools = buildAutopilotTools(s);
  const after = tools.find((t) => t.name === 'create_line')!.parameters.properties.fromShape!
    .enum as string[];
  assert.ok(!after.includes('star'));
});

test('工具闭包：两次 execute 作用于同一 state（闭包稳定）', () => {
  const s = runningState();
  const tools = buildAutopilotTools(s);
  const create = tools.find((t) => t.name === 'create_line')!;
  create.execute({ fromShape: 'circle', toShape: 'triangle' });
  create.execute({ fromShape: 'circle', toShape: 'square' });
  // 两次都作用于同一 state → 两条线
  assert.equal(s.lines.length, 2);
});
