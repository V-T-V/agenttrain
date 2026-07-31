// 音效系统 —— 零依赖 Web Audio API 合成，不引入任何音频文件。
// 所有音效用 OscillatorNode + GainNode 实时合成，体积极小、即开即用。
// 参考 kids-games/src/core/audio.ts 的设计思路，但针对列车调度游戏的反馈音效。

let ctx: AudioContext | null = null;
let muted = false;

/** 懒初始化 AudioContext（浏览器自动播放策略：需用户交互后才能创建）。 */
function ensureCtx(): AudioContext | null {
  if (muted) return null;
  if (ctx) return ctx;
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

/** 用户首次交互时解锁音频（浏览器自动播放策略）。 */
export function unlockAudio(): void {
  const c = ensureCtx();
  if (c && c.state === 'suspended') void c.resume();
}

/** 切换静音。 */
export function setMuted(m: boolean): void {
  muted = m;
}

/** 当前是否静音。 */
export function isMuted(): boolean {
  return muted;
}

/**
 * 播放一个简单音调。
 * @param freq 频率(Hz)
 * @param duration 持续(秒)
 * @param type 波形
 * @param volume 音量(0-1)
 * @param delay 延迟(秒)
 */
function tone(
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.15,
  delay = 0,
): void {
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const start = c.currentTime + delay;
  // ADSR 简化：快速起音 + 线性衰减
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

// ===== 游戏音效 =====

/** 送达一名乘客：清脆短音。 */
export function sfxDeliver(): void {
  tone(880, 0.12, 'triangle', 0.12);
}

/** 建立线路：上扬双音。 */
export function sfxBuildLine(): void {
  tone(523, 0.1, 'square', 0.1);
  tone(784, 0.15, 'square', 0.1, 0.08);
}

/** 拾取道具：叮。 */
export function sfxPickup(): void {
  tone(1320, 0.08, 'sine', 0.14);
}

/** 使用道具：确认音。 */
export function sfxUsePowerUp(): void {
  tone(660, 0.08, 'triangle', 0.1);
  tone(990, 0.1, 'triangle', 0.1, 0.06);
}

/** 连击升级（每 5 连击）：上行音阶。 */
export function sfxComboUp(): void {
  tone(523, 0.06, 'triangle', 0.1);
  tone(659, 0.06, 'triangle', 0.1, 0.05);
  tone(784, 0.1, 'triangle', 0.1, 0.1);
}

/** 站点过载警告：低沉警告。 */
export function sfxOverloadWarn(): void {
  tone(220, 0.2, 'sawtooth', 0.08);
}

/** Game Over：下行音。 */
export function sfxGameOver(): void {
  tone(440, 0.2, 'triangle', 0.12);
  tone(330, 0.2, 'triangle', 0.12, 0.15);
  tone(220, 0.4, 'triangle', 0.12, 0.3);
}

/** 新纪录：欢庆上行音阶。 */
export function sfxNewRecord(): void {
  tone(523, 0.08, 'triangle', 0.12);
  tone(659, 0.08, 'triangle', 0.12, 0.08);
  tone(784, 0.08, 'triangle', 0.12, 0.16);
  tone(1047, 0.2, 'triangle', 0.12, 0.24);
}
