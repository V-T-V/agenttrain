// 新手教程与暂停菜单的纯逻辑（不依赖 DOM / Canvas，便于单测）。
// 教程是 UI 层概念，不写进 GameState；本模块只管「步骤推进」「是否该展示教程」
// 与「暂停菜单的按钮布局/命中检测」。

/** 教程步骤：0 = 关闭（不在教程态），1-4 = 四步引导。 */
export type TutorialStep = 0 | 1 | 2 | 3 | 4;

/** 教程总步数。 */
export const TUTORIAL_TOTAL = 4;

/** 每一步的标题与说明文案（渲染层直接读）。 */
export const TUTORIAL_TEXT: Record<Exclude<TutorialStep, 0>, { title: string; body: string }> = {
  1: {
    title: '① 建立线路',
    body: '从一个站点按住，拖到另一个站点，建立你的第一条线路。线路会自动配一列列车。',
  },
  2: {
    title: '② 列车自动运行',
    body: '列车会沿线自动运行，到站时把乘客送到对应形状的站点即可得分。',
  },
  3: {
    title: '③ 道具',
    body: '地图上的 ⚡🧹📦 道具，列车经过会自动拾取。按 1/2/3 键使用（加速/清站/急送）。',
  },
  4: {
    title: '④ 别让站点堵爆',
    body: '站点满载持续 6 秒会 Game Over。用线路疏导乘客，保持站点通畅！',
  },
};

/** 是否处于教程态（step > 0）。 */
export function inTutorial(step: TutorialStep): boolean {
  return step > 0;
}

/** 前进到下一步；已到最后一步则结束（返回 0）。 */
export function nextTutorialStep(step: TutorialStep): TutorialStep {
  if (step <= 0) return 0;
  if (step >= TUTORIAL_TOTAL) return 0; // 完成最后一步 → 关闭
  return (step + 1) as TutorialStep;
}

/** 是否该向新玩家展示教程（localStorage 无「已看过」标记时）。 */
export function shouldShowTutorial(): boolean {
  try {
    return localStorage.getItem('agenttrain-tutorial-seen') !== '1';
  } catch {
    return false; // 隐私模式：不强行弹教程
  }
}

/** 标记教程已完成（跳过或自然结束都调用），下次不再自动弹。 */
export function markTutorialSeen(): void {
  try {
    localStorage.setItem('agenttrain-tutorial-seen', '1');
  } catch {
    /* 忽略 */
  }
}

// ---------- 暂停菜单布局与命中检测 ----------

/** 暂停菜单的一个按钮项。 */
export interface PauseMenuItem {
  /** 稳定 id，main.ts 据此分发动作。 */
  id: 'resume' | 'restart' | 'difficulty' | 'toggle-ai' | 'tutorial';
  /** 显示文案。 */
  label: string;
  /** 命中区域（画布逻辑坐标）。 */
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * 计算暂停菜单所有按钮的布局（居中竖排）。
 * @param width 画布逻辑宽
 * @param height 画布逻辑高
 * @param aiMode 当前 AI 模式（用于在「切换 AI」按钮上显示当前态）
 */
export function pauseMenuLayout(
  width: number,
  height: number,
  aiMode: 'manual' | 'auto',
): PauseMenuItem[] {
  const btnW = 240;
  const btnH = 40;
  const gap = 10;
  const items: Array<PauseMenuItem['id']> = [
    'resume',
    'restart',
    'difficulty',
    'toggle-ai',
    'tutorial',
  ];
  const labels: Record<PauseMenuItem['id'], string> = {
    resume: '▶  继续游戏',
    restart: '🔄  重新开始',
    difficulty: '🎚️  切换难度',
    'toggle-ai': aiMode === 'auto' ? '🤖  切到手动 (当前自动)' : '🤖  切到自动 (当前手动)',
    tutorial: '📖  重看新手教程',
  };
  const totalH = items.length * btnH + (items.length - 1) * gap;
  const startY = (height - totalH) / 2;
  const x = (width - btnW) / 2;
  return items.map((id, i) => ({
    id,
    label: labels[id],
    rect: { x, y: startY + i * (btnH + gap), w: btnW, h: btnH },
  }));
}

/** 判断画布坐标命中暂停菜单的哪个按钮；未命中返回 null。 */
export function pauseMenuHitTest(
  items: readonly PauseMenuItem[],
  x: number,
  y: number,
): PauseMenuItem['id'] | null {
  for (const it of items) {
    const r = it.rect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return it.id;
  }
  return null;
}
