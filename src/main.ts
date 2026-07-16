// Vite 入口：拿到 canvas/ctx，装配输入与 AI，跑固定步长主循环。
//
// AI 三大功能（全部外挂于纯逻辑，离线自动降级）：
//  - 开局剧本：AI 生成 cityName / modifiers / events，注入 scenario 与 eventQueue
//  - 策略顾问：每 30s 或按 A，弹出底部气泡建议（只建议，不代操作）
//  - 自动驾驶：按 M 切换；自动模式下 AI 每 5s 用工具自主调度

import './style.css';
import { FIXED_STEP, WORLD_HEIGHT, WORLD_WIDTH } from './game/config.ts';
import { createInitialState, defaultScenario } from './game/state.ts';
import { step } from './game/simulation.ts';
import { render, type RenderOptions } from './render.ts';
import {
  beginDrag,
  deleteLineNear,
  endDrag,
  stationAt,
  updateDrag,
  type DragState,
} from './input.ts';
import { Rng } from './utils/rng.ts';
import type { GameState, Vec2 } from './game/types.ts';
import { buildEventQueue } from './game/events.ts';
import { usePowerUp } from './game/powerups.ts';
import { createAIClient } from './ai/client.ts';
import { generateScenario } from './ai/scenario.ts';
import { askAdvice, type Advice } from './ai/advisor.ts';
import { autopilotTick } from './ai/autopilot.ts';
import { serializeSnapshot } from './ai/advisor.ts';
import type { AIClient, Message } from './ai/types.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;

let state = createInitialState(Date.now() >>> 0);
let rng = new Rng(state.seed);
let drag: DragState | null = null;
let accumulator = 0;
let lastTime = performance.now();

// AI 状态
let ai: AIClient | null = null;
let aiMode: 'manual' | 'auto' = 'manual';
let advice: Advice | null = null;
/** 自动/顾问最近一条状态文案（HUD 右下显示）。 */
let aiStatus = 'AI 初始化中…';
/** 顾问自动触发倒计时（秒）。 */
let nextAdviceIn = 30;
/** 自动驾驶触发倒计时（秒）。 */
let nextAutopilotIn = 5;
/** 顾问/自动驾驶是否正在请求中，防止重入。 */
let adviceBusy = false;
let autopilotBusy = false;

/** 把窗口/画布坐标换算成世界坐标（这里 1:1，但预留缩放接口）。 */
function toWorld(e: MouseEvent): Vec2 {
  const rect = canvas.getBoundingClientRect();
  const scaleX = WORLD_WIDTH / rect.width;
  const scaleY = WORLD_HEIGHT / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

/** 启动 AI 客户端（异步，不阻塞游戏）。 */
async function initAi(): Promise<void> {
  ai = await createAIClient((input) => mockAllDelegate(input));
  aiStatus = ai.online ? 'AI 在线 ✦' : 'AI 离线（走 Mock）';
}

/** 离线 mock 总入口：根据最后一条 user 消息的内容决定回什么。 */
function mockAllDelegate(input: { messages: Message[]; tools?: unknown[] }): string | Message {
  const last = input.messages[input.messages.length - 1];
  const text = last?.content ?? '';
  // 剧本请求（system 里提到 JSON 对象）
  if (text.includes('送达目标') || text.includes('cityName')) {
    const s = mockScenarioString();
    return s;
  }
  // 带工具 → 自动驾驶，回一个占位文字（mock autopilot 由专门的启发式处理）
  if (input.tools && input.tools.length > 0) {
    return '保持现状';
  }
  return '观察局势，注意最堵的站点。';
}

/** 离线剧本 JSON 字符串（供 mock delegate 用）。 */
function mockScenarioString(): string {
  return JSON.stringify({
    cityName: '通勤之城',
    description: '一场突如其来的大雾笼罩了线路。',
    trainSpeedMultiplier: 0.85,
    stationIntervalMultiplier: 1,
    events: [{ at: 25, kind: 'surge', stationShape: 'circle', duration: 12 }],
    deliverTarget: 55,
  });
}

function startGame(): void {
  if (state.phase === 'ready') state.phase = 'running';
}

/** 重新开始：可选用 AI 生成新剧本。 */
async function restart(useNewScenario: boolean): Promise<void> {
  accumulator = 0;
  advice = null;
  aiMode = 'manual';
  nextAdviceIn = 30;
  nextAutopilotIn = 5;
  const seed = Date.now() >>> 0;
  state = createInitialState(seed);
  rng = new Rng(seed);
  drag = null;

  if (useNewScenario && ai) {
    aiStatus = 'AI 生成剧本中…';
    const { scenario, online } = await generateScenario(ai, Math.random);
    state.scenario = scenario;
    state.eventQueue = buildEventQueue(scenario);
    aiStatus = online ? 'AI 在线 ✦' : 'AI 离线（Mock 剧本）';
  } else {
    state.scenario = defaultScenario();
    state.eventQueue = buildEventQueue(state.scenario);
  }
}

/** 手动请求顾问建议。 */
async function requestAdvice(): Promise<void> {
  if (!ai || adviceBusy || state.phase !== 'running') return;
  adviceBusy = true;
  aiStatus = 'AI 思考中…';
  try {
    advice = await askAdvice(ai, state);
  } finally {
    adviceBusy = false;
    aiStatus = ai.online ? 'AI 在线 ✦' : 'AI 离线（Mock）';
    nextAdviceIn = 30;
  }
}

/** 自动驾驶一轮。 */
async function runAutopilot(): Promise<void> {
  if (!ai || autopilotBusy || state.phase !== 'running') return;
  autopilotBusy = true;
  try {
    const action = await autopilotTick(ai, state);
    if (action.acted) aiStatus = `AI 自动: ${action.summary}`;
  } finally {
    autopilotBusy = false;
    nextAutopilotIn = 5;
  }
}

// ---------- 输入装配 ----------

canvas.addEventListener('mousedown', (e) => {
  if (state.phase === 'ready') {
    void restart(true);
    startGame();
    return;
  }
  if (state.phase === 'gameover') {
    void restart(true);
    return;
  }
  if (aiMode === 'auto') return; // 自动模式禁用人工画线
  const pos = toWorld(e);
  if (e.button === 2) {
    deleteLineNear(state, pos);
    return;
  }
  drag = beginDrag(state, pos);
});

canvas.addEventListener('mousemove', (e) => {
  if (!drag) return;
  drag = updateDrag(state, drag, toWorld(e));
});

window.addEventListener('mouseup', (e) => {
  if (!drag) return;
  endDrag(state, drag, toWorld(e));
  drag = null;
});

canvas.addEventListener('dblclick', (e) => {
  if (aiMode === 'auto') return;
  deleteLineNear(state, toWorld(e));
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (state.phase === 'ready') {
    void restart(true);
    startGame();
    return;
  }
  switch (e.key) {
    case 'r':
    case 'R':
      void restart(true);
      return;
    case 'p':
    case 'P':
      if (state.phase === 'running') state.phase = 'paused';
      else if (state.phase === 'paused') state.phase = 'running';
      return;
    case 'a':
    case 'A':
      void requestAdvice();
      return;
    case 'm':
    case 'M':
      aiMode = aiMode === 'manual' ? 'auto' : 'manual';
      aiStatus = aiMode === 'auto' ? 'AI 自动驾驶开启' : aiStatus;
      return;
    case 'n':
    case 'N':
      void restart(true);
      return;
    case '1':
      usePowerUp(state, 'speed');
      return;
    case '2':
      usePowerUp(state, 'clear');
      return;
    case '3':
      usePowerUp(state, 'deliver');
      return;
    default:
      break;
  }
});

// ---------- 主循环 ----------

function frame(now: number): void {
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.25) dt = 0.25;

  accumulator += dt;
  while (accumulator >= FIXED_STEP) {
    step(state, FIXED_STEP, rng);
    accumulator -= FIXED_STEP;
  }

  // AI 定时触发（基于真实时间 dt，不进 simulation 的固定步长）
  if (state.phase === 'running') {
    nextAdviceIn -= dt;
    if (nextAdviceIn <= 0 && !adviceBusy) void requestAdvice();
    if (aiMode === 'auto') {
      nextAutopilotIn -= dt;
      if (nextAutopilotIn <= 0 && !autopilotBusy) void runAutopilot();
    }
  }

  const renderOpts: RenderOptions = {
    dragPreview: drag ? { color: drag.color, from: drag.from, to: drag.to } : null,
    advice,
    aiMode,
    aiStatus,
  };
  render(ctx, state, WORLD_WIDTH, WORLD_HEIGHT, renderOpts);

  requestAnimationFrame(frame);
}

canvas.width = WORLD_WIDTH;
canvas.height = WORLD_HEIGHT;
void initAi();
requestAnimationFrame(frame);

// 暴露给控制台调试用
(window as unknown as { __game?: unknown }).__game = {
  get state(): GameState {
    return state;
  },
  restart: () => restart(true),
  stationAt: (p: Vec2) => stationAt(state, p),
  snapshot: () => serializeSnapshot(state),
  setAuto: (on: boolean) => {
    aiMode = on ? 'auto' : 'manual';
  },
};
