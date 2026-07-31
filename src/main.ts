// Vite 入口：拿到 canvas/ctx，装配输入与 AI，跑固定步长主循环。
//
// AI 三大功能（全部外挂于纯逻辑，离线自动降级）：
//  - 开局剧本：AI 生成 cityName / modifiers / events，注入 scenario 与 eventQueue
//  - 策略顾问：每 30s 或按 A，弹出底部气泡建议（只建议，不代操作）
//  - 自动驾驶：按 M 切换；自动模式下 AI 每 5s 用工具自主调度

import './style.css';
import { FIXED_STEP } from './game/config.ts';
import { createInitialState, defaultScenario } from './game/state.ts';
import { step } from './game/simulation.ts';
import { render, type RenderOptions } from './render.ts';
import {
  beginDrag,
  bindPointer,
  deleteLineNear,
  endDrag,
  stationAt,
  updateDrag,
  type DragState,
} from './input.ts';
import { Rng } from './utils/rng.ts';
import type { Difficulty, GameState, PowerUpType, Vec2 } from './game/types.ts';
import { buildEventQueue } from './game/events.ts';
import { usePowerUp } from './game/powerups.ts';
import {
  ALL_DIFFICULTIES,
  loadPreferredDifficulty,
  savePreferredDifficulty,
} from './game/difficulty.ts';
import { loadHighScores, recordScore } from './game/highscore.ts';
import { type GameOverStats, checkAchievements } from './game/achievements.ts';
import {
  setMuted,
  sfxBuildLine,
  sfxComboUp,
  sfxDeliver,
  sfxGameOver,
  sfxNewRecord,
  sfxOverloadWarn,
  sfxPickup,
  sfxUsePowerUp,
  unlockAudio,
} from './game/audio.ts';
import {
  type TutorialStep,
  inTutorial,
  markTutorialSeen,
  nextTutorialStep,
  pauseMenuHitTest,
  pauseMenuLayout,
  shouldShowTutorial,
} from './game/tutorial.ts';
import {
  type Camera,
  createCamera,
  pan as panCamera,
  screenToWorld,
  zoomAt,
} from './game/camera.ts';
import { createAIClient } from './ai/client.ts';
import { generateScenario } from './ai/scenario.ts';
import { askAdvice, type Advice } from './ai/advisor.ts';
import { autopilotTick } from './ai/autopilot.ts';
import { serializeSnapshot } from './ai/advisor.ts';
import type { AIClient, Message } from './ai/types.ts';
import { saveGame, loadGame, clearSave } from './game/persist.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;

// 启动时尝试恢复存档：有则续局（含 Rng 状态，保证随机序列连贯），无则新开局。
const restored = loadGame();
let state = restored ? restored.state : createInitialState(Date.now() >>> 0);
let rng = restored ? Rng.fromState(restored.rngState) : new Rng(state.seed);
let drag: DragState | null = null;
let accumulator = 0;
let lastTime = performance.now();
/** 自动存档倒计时（秒）：running 阶段每 AUTOSAVE_INTERVAL 秒存一次。 */
const AUTOSAVE_INTERVAL = 5;
let autosaveIn = AUTOSAVE_INTERVAL;
/** gameover 时存档只清除一次的标志，避免每帧重复 clearSave。 */
let gameoverSaveCleared = false;

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
/** ready 面板当前选中的难度（记忆上次选择）。 */
let selectedDifficulty: Difficulty = loadPreferredDifficulty();
/** 本局是否破纪录（gameover 面板展示）。 */
let newRecord = false;
/** 各档最高分缓存（避免每帧 localStorage 解析；仅在 recordScore 后刷新）。 */
let bestScoresCache = loadHighScores();
/** 上一帧的送达数/连击数，用于检测变化触发音效。 */
let prevDelivered = 0;
let prevCombo = 0;
let prevPowerUpCount = 0;
let prevOverloadWarning = false;
/** 音效静音开关。 */
let muted = false;
/** 本局道具使用次数（成就统计用）。 */
let powerUpsUsed = 0;
/** 本局建立的线路总数（成就统计用）。 */
let linesBuilt = 0;
/** 本局 Game Over 时新解锁的成就 id 列表（结算页展示）。 */
let newlyUnlocked: string[] = [];
/** 当前教程步骤（0=不在教程态，1-4=四步引导）。 */
let tutorialStep: TutorialStep = 0;
/** 摄像机（缩放/平移大地图）。首帧按显示尺寸 fit。 */
let camera: Camera = { x: 0, y: 0, zoom: 1 };
/** 是否尚未做首帧摄像机 fit（拿到 canvas 尺寸后立刻 fit 一次）。 */
let cameraNeedsFit = true;
/** 是否正在拖拽平移地图（中键 / 空格+左键）。 */
let panning = false;
let panLast = { x: 0, y: 0 };
/** 空格键是否按下（用于「空格+左键」平移地图）。 */
let spaceDown = false;

/** 任意带 clientX/clientY 的事件（MouseEvent / Touch / PointerEvent）。 */
interface ClientPoint {
  clientX: number;
  clientY: number;
}

/** 把窗口/画布坐标换算成世界坐标（经摄像机变换）。 */
function toWorld(e: ClientPoint): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return screenToWorld(
    camera,
    e.clientX - rect.left,
    e.clientY - rect.top,
    rect.width,
    rect.height,
  );
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
  autosaveIn = AUTOSAVE_INTERVAL;
  powerUpsUsed = 0;
  linesBuilt = 0;
  newlyUnlocked = [];
  prevDelivered = 0;
  prevCombo = 0;
  prevPowerUpCount = 0;
  prevOverloadWarning = false;
  camera = { x: 0, y: 0, zoom: 1 };
  cameraNeedsFit = true; // 重置后首帧重新 fit 到屏幕
  // 清除旧存档：重开意味着放弃当前进度。
  clearSave();
  newRecord = false;
  const seed = Date.now() >>> 0;
  state = createInitialState(seed, selectedDifficulty);
  rng = new Rng(seed);
  drag = null;

  if (useNewScenario && ai) {
    aiStatus = 'AI 生成剧本中…';
    const { scenario, online } = await generateScenario(ai, () => rng.next());
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

// 统一指针抽象：同时支持桌面鼠标与移动端触摸（优先 PointerEvent，回退 mouse+touch）。
// 捕获返回的 unbind 函数，供 HMR 热更新时清理，避免事件监听器累积泄漏。
const unbindPointer = bindPointer(canvas, {
  onDown: (e) => {
    unlockAudio(); // 首次交互解锁音频（浏览器自动播放策略）
    // 中键 或 空格+左键：开始平移地图（任何阶段都允许）
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      panning = true;
      panLast = { x: e.point.clientX, y: e.point.clientY };
      return;
    }
    // 教程态：任意点击前进一步（不与游戏交互）
    if (inTutorial(tutorialStep)) {
      advanceTutorial();
      return;
    }
    // 暂停态：点击命中菜单按钮（遮罩是视口坐标，用屏幕坐标命中）
    if (state.phase === 'paused') {
      const rect = canvas.getBoundingClientRect();
      const sx = e.point.clientX - rect.left;
      const sy = e.point.clientY - rect.top;
      const hit = pauseMenuHitTest(pauseMenuLayout(rect.width, rect.height, aiMode), sx, sy);
      if (hit) handlePauseMenu(hit);
      return;
    }
    if (state.phase === 'ready') {
      void restart(true);
      startGame();
      maybeStartTutorial();
      return;
    }
    if (state.phase === 'gameover') {
      void restart(true);
      return;
    }
    if (aiMode === 'auto') return; // 自动模式禁用人工画线
    const pos = toWorld(e.point);
    if (e.button === 2) {
      deleteLineNear(state, pos);
      return;
    }
    drag = beginDrag(state, pos);
  },
  onMove: (e) => {
    // 平移地图
    if (panning) {
      const rect = canvas.getBoundingClientRect();
      camera = panCamera(
        camera,
        e.clientX - panLast.x,
        e.clientY - panLast.y,
        rect.width,
        rect.height,
      );
      panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!drag) return;
    drag = updateDrag(state, drag, toWorld(e));
  },
  onUp: (e) => {
    if (panning) {
      panning = false;
      return;
    }
    if (!drag) return;
    const linesBefore = state.lines.length;
    endDrag(state, drag, toWorld(e));
    if (state.lines.length > linesBefore) {
      linesBuilt++;
      if (!muted) sfxBuildLine();
    }
    drag = null;
  },
});

// 滚轮缩放：以鼠标为锚点
function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  camera = zoomAt(
    camera,
    e.clientX - rect.left,
    e.clientY - rect.top,
    rect.width,
    rect.height,
    factor,
  );
}
canvas.addEventListener('wheel', onWheel, { passive: false });

// 双击删线（桌面专属快捷操作，触屏用长按或两指替代——当前保留 dblclick）。
function onDblClick(e: MouseEvent): void {
  if (aiMode === 'auto') return;
  deleteLineNear(state, toWorld(e));
}
canvas.addEventListener('dblclick', onDblClick);

function onContextMenu(e: MouseEvent): void {
  e.preventDefault();
}
canvas.addEventListener('contextmenu', onContextMenu);

// 空格按下/松开：用于「空格+左键」平移地图；不响应重复触发
function onSpaceDown(e: KeyboardEvent): void {
  if (e.code === 'Space') {
    spaceDown = true;
    e.preventDefault();
  }
}
function onSpaceUp(e: KeyboardEvent): void {
  if (e.code === 'Space') spaceDown = false;
}
window.addEventListener('keydown', onSpaceDown);
window.addEventListener('keyup', onSpaceUp);

function onGameKey(e: KeyboardEvent): void {
  // 方向键平移地图（running/paused 都允许）
  if (state.phase === 'running' || state.phase === 'paused') {
    const rect = canvas.getBoundingClientRect();
    const step = 80; // 屏幕像素
    if (e.key === 'ArrowLeft') {
      camera = panCamera(camera, step, 0, rect.width, rect.height);
      return;
    }
    if (e.key === 'ArrowRight') {
      camera = panCamera(camera, -step, 0, rect.width, rect.height);
      return;
    }
    if (e.key === 'ArrowUp') {
      camera = panCamera(camera, 0, step, rect.width, rect.height);
      return;
    }
    if (e.key === 'ArrowDown') {
      camera = panCamera(camera, 0, -step, rect.width, rect.height);
      return;
    }
  }
  // 教程态：任意键前进一步
  if (inTutorial(tutorialStep)) {
    advanceTutorial();
    return;
  }
  if (state.phase === 'ready') {
    // 1/2/3 选难度（不立即开始）；其它键开始游戏
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      selectedDifficulty = ALL_DIFFICULTIES[Number(e.key) - 1]!;
      state.difficulty = selectedDifficulty;
      savePreferredDifficulty(selectedDifficulty);
      return;
    }
    void restart(true);
    startGame();
    maybeStartTutorial();
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
      tryUsePowerUp('speed');
      return;
    case '2':
      tryUsePowerUp('clear');
      return;
    case '3':
      tryUsePowerUp('deliver');
      return;
    case '4':
      tryUsePowerUp('magnet');
      return;
    case '5':
      tryUsePowerUp('shield');
      return;
    case '6':
      tryUsePowerUp('double');
      return;
    case 's':
    case 'S':
      muted = !muted;
      setMuted(muted);
      return;
    default:
      break;
  }
}
window.addEventListener('keydown', onGameKey);

// ---------- 教程与暂停菜单 ----------

/** 若是新玩家（未看过教程），进入教程第一步。 */
function maybeStartTutorial(): void {
  if (shouldShowTutorial()) {
    tutorialStep = 1;
    state.phase = 'paused'; // 教程态暂停游戏推进（渲染叠加教程遮罩）
  }
}

/** 教程前进一步；到最后一步结束并标记已看。 */
function advanceTutorial(): void {
  tutorialStep = nextTutorialStep(tutorialStep);
  if (tutorialStep === 0) {
    markTutorialSeen();
    if (state.phase === 'paused') state.phase = 'running';
  }
}

/** 从外部主动重看教程（ready / 暂停菜单入口）。 */
function replayTutorial(): void {
  tutorialStep = 1;
  if (state.phase === 'ready') {
    void restart(true);
    startGame();
  }
  state.phase = 'paused';
}

/** 处理暂停菜单按钮点击。 */
function handlePauseMenu(id: 'resume' | 'restart' | 'difficulty' | 'toggle-ai' | 'tutorial'): void {
  switch (id) {
    case 'resume':
      state.phase = 'running';
      return;
    case 'restart':
      tutorialStep = 0;
      void restart(true);
      startGame();
      return;
    case 'difficulty':
      tutorialStep = 0;
      state.phase = 'ready';
      return;
    case 'toggle-ai':
      aiMode = aiMode === 'manual' ? 'auto' : 'manual';
      aiStatus = aiMode === 'auto' ? 'AI 自动驾驶开启' : aiStatus;
      return;
    case 'tutorial':
      replayTutorial();
      return;
  }
}

/** 使用道具的统一入口：成功则计次 + 音效。 */
function tryUsePowerUp(type: PowerUpType): void {
  if (usePowerUp(state, type)) {
    powerUpsUsed++;
    if (!muted) sfxUsePowerUp();
  }
}

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

  // 音效：检测状态变化触发（纯逻辑层不碰音频，由 frame 检测 diff）
  if (!muted) {
    if (state.delivered > prevDelivered) sfxDeliver();
    if (state.combo.count > prevCombo && state.combo.count % 5 === 0) sfxComboUp();
    // 道具拾取：地图道具减少
    if (state.powerUps.length < prevPowerUpCount) sfxPickup();
    // 过载警告：任一站点进入满载时低沉提示（首次进入才响）
    const anyOverload = state.stations.some((s) => s.passengers.length >= state.capacity);
    if (anyOverload && !prevOverloadWarning) sfxOverloadWarn();
    prevOverloadWarning = anyOverload;
  }
  prevDelivered = state.delivered;
  prevCombo = state.combo.count;
  prevPowerUpCount = state.powerUps.length;

  // AI 定时触发（基于真实时间 dt，不进 simulation 的固定步长）
  if (state.phase === 'running') {
    nextAdviceIn -= dt;
    if (nextAdviceIn <= 0 && !adviceBusy) void requestAdvice();
    if (aiMode === 'auto') {
      nextAutopilotIn -= dt;
      if (nextAutopilotIn <= 0 && !autopilotBusy) void runAutopilot();
    }
    // 自动存档：每 AUTOSAVE_INTERVAL 秒序列化 state + Rng 状态，刷新可续局。
    autosaveIn -= dt;
    if (autosaveIn <= 0) {
      saveGame(state, rng.getState());
      autosaveIn = AUTOSAVE_INTERVAL;
    }
    gameoverSaveCleared = false;
  } else if (state.phase === 'gameover' && !gameoverSaveCleared) {
    // 游戏结束：记录最高分（按难度档），清除存档（刷新应开新局而非回到 gameover）。
    newRecord = recordScore(state.difficulty, state.delivered);
    bestScoresCache = loadHighScores(); // 刷新缓存
    clearSave();
    gameoverSaveCleared = true;
    // 成就检测
    const stats: GameOverStats = {
      delivered: state.delivered,
      maxCombo: state.maxCombo,
      difficulty: state.difficulty,
      elapsedSec: state.elapsed,
      powerUpsUsed,
      reachedTarget: state.delivered >= state.scenario.deliverTarget,
      linesBuilt,
    };
    newlyUnlocked = checkAchievements(stats);
    // 音效
    if (!muted) {
      if (newRecord) sfxNewRecord();
      else sfxGameOver();
    }
  }

  // 插值因子：accumulator 是固定步长后剩余的未消费时间，
  // alpha ∈[0,1) 表示「当前逻辑帧已推进的比例」，渲染时据此在上一帧与当前帧位置间 lerp。
  const alpha = FIXED_STEP > 0 ? accumulator / FIXED_STEP : 0;
  const renderOpts: RenderOptions = {
    dragPreview: drag ? { color: drag.color, from: drag.from, to: drag.to } : null,
    advice,
    aiMode,
    aiStatus,
    alpha,
    bestScores: bestScoresCache,
    newRecord,
    tutorialStep,
    camera,
    newlyUnlocked,
  };
  // 显示视口尺寸 = canvas 的 CSS 尺寸；backing store 按它 × dpr，保证 HiDPI 清晰。
  // 注意：CSS 布局首帧可能尚未就绪（rect 为 0），此时跳过渲染等下一帧。
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.round(rect.width);
  const cssH = Math.round(rect.height);
  if (cssW <= 0 || cssH <= 0) {
    requestAnimationFrame(frame);
    return;
  }
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
  }
  // 每帧重置变换：dpr 缩放（render 内部再叠加 camera 变换）
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 首帧或重置后：把摄像机 fit 到显示窗口（看到整个世界）
  if (cameraNeedsFit) {
    camera = createCamera(cssW, cssH);
    cameraNeedsFit = false;
  }
  render(ctx, state, cssW, cssH, renderOpts);

  requestAnimationFrame(frame);
}

void initAi();
requestAnimationFrame(frame);

// 窗口尺寸变化（含 DPR 变化、浏览器窗口缩放）时重新 fit 摄像机。
function onResize(): void {
  cameraNeedsFit = true;
}
window.addEventListener('resize', onResize);

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

/** 清理所有事件监听器（Vite HMR 热更新时调用，避免累积泄漏）。 */
function dispose(): void {
  unbindPointer();
  canvas.removeEventListener('wheel', onWheel);
  canvas.removeEventListener('dblclick', onDblClick);
  canvas.removeEventListener('contextmenu', onContextMenu);
  window.removeEventListener('keydown', onSpaceDown);
  window.removeEventListener('keyup', onSpaceUp);
  window.removeEventListener('keydown', onGameKey);
  window.removeEventListener('resize', onResize);
}

// Vite HMR：模块替换时先清理上一版的监听器，防止重复绑定累积。
if (import.meta.hot) {
  import.meta.hot.dispose(() => dispose());
}
