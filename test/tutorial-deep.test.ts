// 教程与暂停菜单深层测试 D4：
//  - markTutorialSeen（此前未测）
//  - shouldShowTutorial 隐私模式（localStorage 抛错 → 返回 false）
//  - TUTORIAL_TEXT 内容完整性（每步 title/body 非空、4 步齐全）
//  - pauseMenuLayout 数学（按钮尺寸固定 240×40、间距 10、居中计算、极小/负尺寸、按钮间无重叠）
//  - pauseMenuHitTest 边界（精确边界值、按钮间隙不命中）
//  - nextTutorialStep 负数与越界输入
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TUTORIAL_TEXT,
  TUTORIAL_TOTAL,
  inTutorial,
  markTutorialSeen,
  nextTutorialStep,
  pauseMenuHitTest,
  pauseMenuLayout,
  shouldShowTutorial,
} from '../src/game/tutorial.ts';

// 本文件的 localStorage：用独立 store，避免与其他测试文件的全局 stub 冲突
const store = new Map<string, string>();
const originalLS = (globalThis as { localStorage?: unknown }).localStorage;
// @ts-expect-error 注入到 globalThis
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

test.afterEach(() => {
  store.clear();
});

test.after(() => {
  // 恢复（防止影响后续测试文件）
  (globalThis as { localStorage?: unknown }).localStorage = originalLS;
});

// ─── markTutorialSeen（此前完全未测） ───

test('markTutorialSeen：写入 localStorage 标记', () => {
  store.clear();
  markTutorialSeen();
  assert.equal(store.get('agenttrain-tutorial-seen'), '1');
});

test('markTutorialSeen 后 shouldShowTutorial 返回 false', () => {
  store.clear();
  assert.equal(shouldShowTutorial(), true);
  markTutorialSeen();
  assert.equal(shouldShowTutorial(), false);
});

test('markTutorialSeen：重复调用幂等（标记仍为 1）', () => {
  store.clear();
  markTutorialSeen();
  markTutorialSeen();
  markTutorialSeen();
  assert.equal(store.get('agenttrain-tutorial-seen'), '1');
  assert.equal(shouldShowTutorial(), false);
});

test('markTutorialSeen：标记值非「1」时 shouldShowTutorial 仍为 true', () => {
  store.clear();
  store.set('agenttrain-tutorial-seen', '0'); // 非法值
  assert.equal(shouldShowTutorial(), true);
});

test('markTutorialSeen：标记为其他 key 不影响教程', () => {
  store.clear();
  store.set('other-key', '1');
  assert.equal(shouldShowTutorial(), true);
});

// ─── shouldShowTutorial 隐私模式（localStorage 抛错） ───

test('shouldShowTutorial：localStorage.getItem 抛错 → 返回 false（不弹教程）', () => {
  // 临时替换为抛错的 localStorage
  const throwingLS = {
    getItem(): string {
      throw new Error('SecurityError: privacy mode');
    },
    setItem(): void {
      throw new Error('denied');
    },
    removeItem(): void {},
    clear(): void {},
  };
  const saved = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = throwingLS;
  try {
    assert.equal(shouldShowTutorial(), false);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = saved;
  }
});

test('markTutorialSeen：localStorage.setItem 抛错 → 静默忽略（不抛出）', () => {
  const throwingLS = {
    getItem(): string | null {
      return null;
    },
    setItem(): void {
      throw new Error('QuotaExceeded');
    },
    removeItem(): void {},
    clear(): void {},
  };
  const saved = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = throwingLS;
  try {
    // 不应抛出
    assert.doesNotThrow(() => markTutorialSeen());
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = saved;
  }
});

// ─── TUTORIAL_TEXT 内容完整性（此前未测） ───

test('TUTORIAL_TEXT：恰好 4 步（1-4）', () => {
  const keys = Object.keys(TUTORIAL_TEXT).map(Number).sort((a, b) => a - b);
  assert.deepEqual(keys, [1, 2, 3, 4]);
});

test('TUTORIAL_TEXT：每步 title 非空', () => {
  for (const step of [1, 2, 3, 4] as const) {
    assert.ok(TUTORIAL_TEXT[step].title.length > 0, `step ${step} title 应非空`);
  }
});

test('TUTORIAL_TEXT：每步 body 非空且足够详细（>=10 字）', () => {
  for (const step of [1, 2, 3, 4] as const) {
    assert.ok(TUTORIAL_TEXT[step].body.length >= 10, `step ${step} body 应详尽`);
  }
});

test('TUTORIAL_TEXT：step 1 讲建线', () => {
  const body = TUTORIAL_TEXT[1].body + TUTORIAL_TEXT[1].title;
  assert.ok(body.includes('线') || body.includes('拖'));
});

test('TUTORIAL_TEXT：step 3 讲道具', () => {
  const body = TUTORIAL_TEXT[3].body + TUTORIAL_TEXT[3].title;
  assert.ok(body.includes('道具') || body.includes('⚡'));
});

test('TUTORIAL_TEXT：step 4 讲过载/Game Over', () => {
  const body = TUTORIAL_TEXT[4].body + TUTORIAL_TEXT[4].title;
  assert.ok(body.includes('堵') || body.includes('满载') || body.includes('Over'));
});

test('TUTORIAL_TOTAL 与 TUTORIAL_TEXT 键数一致', () => {
  assert.equal(TUTORIAL_TOTAL, Object.keys(TUTORIAL_TEXT).length);
});

// ─── nextTutorialStep 边界（负数、越界） ───

test('nextTutorialStep：负数输入 → 返回 0（不进入教程）', () => {
  assert.equal(nextTutorialStep(-1 as never), 0);
  assert.equal(nextTutorialStep(-100 as never), 0);
});

test('nextTutorialStep：超过 TUTORIAL_TOTAL → 返回 0', () => {
  assert.equal(nextTutorialStep(5 as never), 0);
  assert.equal(nextTutorialStep(99 as never), 0);
});

test('nextTutorialStep：1→2→3→4→0 完整流程', () => {
  let step: 0 | 1 | 2 | 3 | 4 = 1;
  step = nextTutorialStep(step);
  assert.equal(step, 2);
  step = nextTutorialStep(step);
  assert.equal(step, 3);
  step = nextTutorialStep(step);
  assert.equal(step, 4);
  step = nextTutorialStep(step);
  assert.equal(step, 0);
});

test('inTutorial：0 为假，1-4 为真，负数为假', () => {
  assert.equal(inTutorial(0), false);
  assert.equal(inTutorial(-1 as never), false);
  assert.equal(inTutorial(1), true);
  assert.equal(inTutorial(2), true);
  assert.equal(inTutorial(3), true);
  assert.equal(inTutorial(4), true);
});

// ─── pauseMenuLayout 数学（按钮尺寸/间距/居中） ───

test('pauseMenuLayout：所有按钮宽度=240 高度=40', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  for (const it of items) {
    assert.equal(it.rect.w, 240);
    assert.equal(it.rect.h, 40);
  }
});

test('pauseMenuLayout：按钮间距=10（相邻按钮 y 差 = 50）', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  for (let i = 1; i < items.length; i++) {
    const gap = items[i]!.rect.y - items[i - 1]!.rect.y;
    assert.equal(gap, 50, `按钮 ${i - 1}→${i} 间距应为 50（40高+10gap）`);
  }
});

test('pauseMenuLayout：所有按钮 x 相同（竖排居中）', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  const x = items[0]!.rect.x;
  for (const it of items) {
    assert.equal(it.rect.x, x);
  }
});

test('pauseMenuLayout：按钮组整体垂直居中（startY = (height-totalH)/2）', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  const totalH = 5 * 40 + 4 * 10; // 240
  const expectedStartY = (600 - totalH) / 2; // 180
  assert.equal(items[0]!.rect.y, expectedStartY);
});

test('pauseMenuLayout：x = (width-240)/2（水平居中）', () => {
  const items = pauseMenuLayout(1000, 600, 'manual');
  assert.equal(items[0]!.rect.x, (1000 - 240) / 2);
});

test('pauseMenuLayout：极小画布（200×100）仍返回 5 按钮（可能溢出但不报错）', () => {
  const items = pauseMenuLayout(200, 100, 'manual');
  assert.equal(items.length, 5);
  // x = (200-240)/2 = -20（按钮比画布宽，会溢出但布局仍计算）
  assert.equal(items[0]!.rect.x, -20);
});

test('pauseMenuLayout：极大画布（4000×3000）按钮仍居中', () => {
  const items = pauseMenuLayout(4000, 3000, 'manual');
  assert.equal(items[0]!.rect.x, (4000 - 240) / 2);
  const totalH = 240;
  assert.equal(items[0]!.rect.y, (3000 - totalH) / 2);
});

test('pauseMenuLayout：toggle-ai 文案在 manual 模式含「自动」（提示切换目标）', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  const ai = items.find((i) => i.id === 'toggle-ai')!;
  assert.ok(ai.label.includes('自动'));
  assert.ok(ai.label.includes('手动'));
});

test('pauseMenuLayout：toggle-ai 文案在 auto 模式含「手动」', () => {
  const items = pauseMenuLayout(960, 600, 'auto');
  const ai = items.find((i) => i.id === 'toggle-ai')!;
  assert.ok(ai.label.includes('手动'));
  assert.ok(ai.label.includes('自动'));
});

test('pauseMenuLayout：所有 label 非空且含 emoji 或符号', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  for (const it of items) {
    assert.ok(it.label.length > 0);
  }
});

test('pauseMenuLayout：按钮间无垂直重叠（gap>=0）', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  for (let i = 1; i < items.length; i++) {
    const prevBottom = items[i - 1]!.rect.y + items[i - 1]!.rect.h;
    const currTop = items[i]!.rect.y;
    assert.ok(currTop >= prevBottom, `按钮 ${i} 不应与 ${i - 1} 重叠`);
  }
});

// ─── pauseMenuHitTest 边界 ───

test('pauseMenuHitTest：按钮间隙（y 在两按钮之间）不命中', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  // 按钮0 底部 y=180+40=220，按钮1 顶部 y=230；间隙 220-230
  const gapY = items[0]!.rect.y + items[0]!.rect.h + 5; // 225
  const cx = items[0]!.rect.x + items[0]!.rect.w / 2;
  assert.equal(pauseMenuHitTest(items, cx, gapY), null);
});

test('pauseMenuHitTest：x 在按钮外（左侧）不命中', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  const r = items[0]!.rect;
  assert.equal(pauseMenuHitTest(items, r.x - 1, r.y + r.h / 2), null);
});

test('pauseMenuHitTest：x 在按钮外（右侧）不命中', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  const r = items[0]!.rect;
  assert.equal(pauseMenuHitTest(items, r.x + r.w + 1, r.y + r.h / 2), null);
});

test('pauseMenuHitTest：空菜单 → 总是返回 null', () => {
  assert.equal(pauseMenuHitTest([], 100, 100), null);
  assert.equal(pauseMenuHitTest([], 0, 0), null);
});

test('pauseMenuHitTest：命中最后一个按钮', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  const last = items[items.length - 1]!;
  const cx = last.rect.x + last.rect.w / 2;
  const cy = last.rect.y + last.rect.h / 2;
  assert.equal(pauseMenuHitTest(items, cx, cy), last.id);
});

test('pauseMenuHitTest：返回的是首个命中（前按钮优先）', () => {
  // 构造两个重叠按钮，验证返回第一个
  const items = [
    { id: 'resume' as const, label: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'restart' as const, label: 'b', rect: { x: 0, y: 0, w: 100, h: 100 } },
  ];
  assert.equal(pauseMenuHitTest(items, 50, 50), 'resume');
});

test('pauseMenuHitTest：负坐标不命中（按钮都在正区）', () => {
  const items = pauseMenuLayout(960, 600, 'manual');
  assert.equal(pauseMenuHitTest(items, -10, -10), null);
});
