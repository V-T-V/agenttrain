// 音效系统深层测试 D5（audio.ts 此前完全未测——0% 覆盖）。
// audio.ts 用 Web Audio API 合成音效，依赖 window.AudioContext。
// 关键约束：audio.ts 的 ctx 是模块级缓存（首次成功创建后复用），
// 无法跨测试重置。因此本文件只安装一次 stub AudioContext，
// 所有 oscillator-count 测试共享同一 stub，每测试前清空 oscillators 数组。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMuted,
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
} from '../src/game/audio.ts';

/** 记录所有 oscillator 创建。 */
interface OscRecord {
  type: OscillatorType;
  freq: number;
  start: number;
  stop: number;
}

interface StubCtx {
  currentTime: number;
  state: 'suspended' | 'running';
  resumeCalls: number;
  oscillators: OscRecord[];
  gainSetValueAtTime: Array<{ value: number; time: number }>;
  gainLinearRamp: Array<{ value: number; time: number }>;
  gainExpRamp: Array<{ value: number; time: number }>;
}

/** 单例 stub（全文件共享，因 audio.ts 缓存 ctx）。 */
const stub: StubCtx = {
  currentTime: 10,
  state: 'running',
  resumeCalls: 0,
  oscillators: [],
  gainSetValueAtTime: [],
  gainLinearRamp: [],
  gainExpRamp: [],
};

/** 清空 stub 记录（保留 ctx 实例）。 */
function resetRecords(): void {
  stub.oscillators = [];
  stub.gainSetValueAtTime = [];
  stub.gainLinearRamp = [];
  stub.gainExpRamp = [];
}

/** 安装 stub AudioContext（仅调用一次）。 */
function installStubCtx(): void {
  const gainNode = {
    gain: {
      setValueAtTime(value: number, time: number) {
        stub.gainSetValueAtTime.push({ value, time });
      },
      linearRampToValueAtTime(value: number, time: number) {
        stub.gainLinearRamp.push({ value, time });
      },
      exponentialRampToValueAtTime(value: number, time: number) {
        stub.gainExpRamp.push({ value, time });
      },
    },
    connect() {
      /* noop */
    },
  };
  const ctxObj = {
    currentTime: 10,
    state: stub.state,
    resume() {
      stub.resumeCalls++;
      stub.state = 'running';
    },
    createOscillator() {
      const rec: OscRecord = { type: 'sine', freq: 440, start: 0, stop: 0 };
      const osc = {
        get type() {
          return rec.type;
        },
        set type(t: OscillatorType) {
          rec.type = t;
        },
        frequency: {
          get value() {
            return rec.freq;
          },
          set value(v: number) {
            rec.freq = v;
          },
        },
        connect() {
          /* noop */
        },
        start(when: number) {
          rec.start = when;
        },
        stop(when: number) {
          rec.stop = when;
        },
      };
      stub.oscillators.push(rec);
      return osc;
    },
    createGain() {
      return gainNode;
    },
    destination: { __destination: true },
  };
  // 注入 stub（globalThis 索引赋值，TS 不报错）
  globalThis.window = globalThis.window ?? {};
  // @ts-expect-error window.AudioContext 不在 lib.dom 默认类型上
  globalThis.window.AudioContext = function () {
    return ctxObj;
  };
  globalThis.AudioContext = globalThis.window.AudioContext;
}

// 文件级 setup：安装一次 stub（audio.ts 缓存 ctx 后无法换）
installStubCtx();

test.beforeEach(() => {
  setMuted(false);
  resetRecords();
});

// ─── setMuted / isMuted 状态管理 ───

test('isMuted 默认 false（或被前一测试重置）', () => {
  setMuted(false);
  assert.equal(isMuted(), false);
});

test('setMuted(true) → isMuted 返回 true', () => {
  setMuted(true);
  assert.equal(isMuted(), true);
});

test('setMuted(false) → isMuted 返回 false', () => {
  setMuted(true);
  setMuted(false);
  assert.equal(isMuted(), false);
});

test('setMuted 多次切换状态正确', () => {
  setMuted(true);
  assert.equal(isMuted(), true);
  setMuted(true);
  assert.equal(isMuted(), true);
  setMuted(false);
  assert.equal(isMuted(), false);
  setMuted(true);
  assert.equal(isMuted(), true);
});

// ─── muted 时所有 sfx 静默（不创建 oscillator） ───

test('muted 时 sfxDeliver 不创建 oscillator', () => {
  setMuted(true);
  sfxDeliver();
  assert.equal(stub.oscillators.length, 0);
});

test('muted 时 sfxBuildLine 不创建 oscillator', () => {
  setMuted(true);
  sfxBuildLine();
  assert.equal(stub.oscillators.length, 0);
});

test('muted 时 sfxGameOver 不创建 oscillator', () => {
  setMuted(true);
  sfxGameOver();
  assert.equal(stub.oscillators.length, 0);
});

test('muted 时 sfxNewRecord 不创建 oscillator', () => {
  setMuted(true);
  sfxNewRecord();
  assert.equal(stub.oscillators.length, 0);
});

// ─── 各 sfx 触发正确数量的 oscillator ───

test('sfxDeliver 创建 1 个 oscillator（单音）', () => {
  sfxDeliver();
  assert.equal(stub.oscillators.length, 1);
});

test('sfxDeliver：freq=880, type=triangle', () => {
  sfxDeliver();
  assert.equal(stub.oscillators[0]!.freq, 880);
  assert.equal(stub.oscillators[0]!.type, 'triangle');
});

test('sfxPickup 创建 1 个 oscillator，freq=1320, type=sine', () => {
  sfxPickup();
  assert.equal(stub.oscillators.length, 1);
  assert.equal(stub.oscillators[0]!.freq, 1320);
  assert.equal(stub.oscillators[0]!.type, 'sine');
});

test('sfxBuildLine 创建 2 个 oscillator（双音和弦）', () => {
  sfxBuildLine();
  assert.equal(stub.oscillators.length, 2);
});

test('sfxBuildLine：第一音 freq=523，第二音 freq=784', () => {
  sfxBuildLine();
  assert.equal(stub.oscillators[0]!.freq, 523);
  assert.equal(stub.oscillators[1]!.freq, 784);
});

test('sfxBuildLine：第二音 start 晚于第一音（delay=0.08）', () => {
  sfxBuildLine();
  const t0 = stub.oscillators[0]!.start;
  const t1 = stub.oscillators[1]!.start;
  assert.ok(t1 > t0, `第二音应延后：t0=${t0} t1=${t1}`);
  assert.ok(Math.abs((t1 - t0) - 0.08) < 0.001, `delay 应≈0.08，实际 ${t1 - t0}`);
});

test('sfxUsePowerUp 创建 2 个 oscillator', () => {
  sfxUsePowerUp();
  assert.equal(stub.oscillators.length, 2);
  assert.equal(stub.oscillators[0]!.freq, 660);
  assert.equal(stub.oscillators[1]!.freq, 990);
});

test('sfxComboUp 创建 3 个 oscillator（上行音阶）', () => {
  sfxComboUp();
  assert.equal(stub.oscillators.length, 3);
});

test('sfxComboUp：三音 freq 递增 523→659→784', () => {
  sfxComboUp();
  assert.equal(stub.oscillators[0]!.freq, 523);
  assert.equal(stub.oscillators[1]!.freq, 659);
  assert.equal(stub.oscillators[2]!.freq, 784);
});

test('sfxOverloadWarn 创建 1 个 oscillator，freq=220, type=sawtooth', () => {
  sfxOverloadWarn();
  assert.equal(stub.oscillators.length, 1);
  assert.equal(stub.oscillators[0]!.freq, 220);
  assert.equal(stub.oscillators[0]!.type, 'sawtooth');
});

test('sfxGameOver 创建 3 个 oscillator（下行）', () => {
  sfxGameOver();
  assert.equal(stub.oscillators.length, 3);
});

test('sfxGameOver：三音 freq 递减 440→330→220', () => {
  sfxGameOver();
  assert.equal(stub.oscillators[0]!.freq, 440);
  assert.equal(stub.oscillators[1]!.freq, 330);
  assert.equal(stub.oscillators[2]!.freq, 220);
});

test('sfxNewRecord 创建 4 个 oscillator（欢庆音阶）', () => {
  sfxNewRecord();
  assert.equal(stub.oscillators.length, 4);
});

test('sfxNewRecord：四音 freq 523→659→784→1047', () => {
  sfxNewRecord();
  assert.equal(stub.oscillators[0]!.freq, 523);
  assert.equal(stub.oscillators[1]!.freq, 659);
  assert.equal(stub.oscillators[2]!.freq, 784);
  assert.equal(stub.oscillators[3]!.freq, 1047);
});

// ─── tone 的 ADSR 包络参数 ───

test('sfxDeliver：gain.setValueAtTime(0) 在 start', () => {
  sfxDeliver();
  assert.equal(stub.gainSetValueAtTime[0]!.value, 0);
});

test('sfxDeliver：gain 线性上升后指数衰减', () => {
  sfxDeliver();
  assert.equal(stub.gainLinearRamp.length, 1);
  assert.equal(stub.gainExpRamp.length, 1);
  assert.ok(stub.gainLinearRamp[0]!.value > 0);
  assert.equal(stub.gainExpRamp[0]!.value, 0.001);
});

test('sfxDeliver：oscillator.stop 在 start+duration+0.05', () => {
  sfxDeliver();
  const osc = stub.oscillators[0]!;
  // duration=0.12, delay=0 → stop = currentTime(10) + 0 + 0.12 + 0.05 = 10.17
  assert.ok(Math.abs(osc.stop - (10 + 0.12 + 0.05)) < 0.001);
});

test('sfxDeliver：oscillator.start = currentTime + delay', () => {
  sfxDeliver();
  // delay=0 → start = 10
  assert.ok(Math.abs(stub.oscillators[0]!.start - 10) < 0.001);
});

test('sfxBuildLine：第二音 stop 晚于第一音 stop', () => {
  sfxBuildLine();
  assert.ok(stub.oscillators[1]!.stop > stub.oscillators[0]!.stop);
});

// ─── unlockAudio（基于已缓存的 ctx，state=running） ───

test('unlockAudio：ctx state=running 时不调用 resume', () => {
  // 共享 ctx 当前是 running（installStubCtx 默认）
  unlockAudio();
  assert.equal(stub.resumeCalls, 0);
});

test('unlockAudio：muted 时不 resume（ensureCtx 返回 null）', () => {
  setMuted(true);
  unlockAudio();
  assert.equal(stub.resumeCalls, 0);
});

// ─── 多次调用复用 ctx（懒初始化缓存） ───

test('多次 sfxDeliver 复用同一 ctx（oscillator 持续累积）', () => {
  sfxDeliver();
  sfxDeliver();
  sfxDeliver();
  // 每次创建 1 个 oscillator，共 3 个（ctx 复用，不重建）
  assert.equal(stub.oscillators.length, 3);
});

test('连续多种 sfx 调用各自创建预期 oscillator 数', () => {
  sfxDeliver(); // 1
  sfxBuildLine(); // 2
  sfxComboUp(); // 3
  sfxGameOver(); // 3
  sfxNewRecord(); // 4
  assert.equal(stub.oscillators.length, 1 + 2 + 3 + 3 + 4);
});

// ─── 波形 type / 频率顺序不变式（深层） ───

test('sfxComboUp 三音 freq 严格递增', () => {
  sfxComboUp();
  const [a, b, c] = stub.oscillators;
  assert.ok(a!.freq < b!.freq, `${a!.freq} < ${b!.freq}`);
  assert.ok(b!.freq < c!.freq, `${b!.freq} < ${c!.freq}`);
});

test('sfxGameOver 三音 freq 严格递减', () => {
  sfxGameOver();
  const [a, b, c] = stub.oscillators;
  assert.ok(a!.freq > b!.freq, `${a!.freq} > ${b!.freq}`);
  assert.ok(b!.freq > c!.freq, `${b!.freq} > ${c!.freq}`);
});

test('sfxNewRecord 四音 freq 严格递增（含尾音跳跃）', () => {
  sfxNewRecord();
  const f = stub.oscillators.map((o) => o.freq);
  assert.ok(f[0]! < f[1]! && f[1]! < f[2]! && f[2]! < f[3]!, `应递增，实际 ${f}`);
});

test('sfxBuildLine / sfxUsePowerUp 全部 square/triangle（非 sine/sawtooth）', () => {
  sfxBuildLine();
  sfxUsePowerUp();
  for (const o of stub.oscillators) {
    assert.ok(o.type === 'square' || o.type === 'triangle', `波形应为 square/triangle，实际 ${o.type}`);
  }
});

test('所有 sfx 的 oscillator stop > start（每个音有正时长）', () => {
  sfxDeliver();
  sfxBuildLine();
  sfxComboUp();
  sfxGameOver();
  sfxNewRecord();
  sfxOverloadWarn();
  sfxPickup();
  sfxUsePowerUp();
  for (const o of stub.oscillators) {
    assert.ok(o.stop > o.start, `stop(${o.stop}) 应 > start(${o.start})`);
  }
});

// ─── 延迟时序精确（delay 参数） ───

test('sfxUsePowerUp：第二音 start 晚于第一音 0.06', () => {
  sfxUsePowerUp();
  const t0 = stub.oscillators[0]!.start;
  const t1 = stub.oscillators[1]!.start;
  assert.ok(Math.abs((t1 - t0) - 0.06) < 0.001, `delay 应≈0.06，实际 ${t1 - t0}`);
});

test('sfxComboUp：第二/三音 delay 分别 0.05/0.1', () => {
  sfxComboUp();
  const t0 = stub.oscillators[0]!.start;
  const t1 = stub.oscillators[1]!.start;
  const t2 = stub.oscillators[2]!.start;
  assert.ok(Math.abs((t1 - t0) - 0.05) < 0.001, `delay2 应≈0.05，实际 ${t1 - t0}`);
  assert.ok(Math.abs((t2 - t0) - 0.1) < 0.001, `delay3 应≈0.1，实际 ${t2 - t0}`);
});

test('sfxGameOver：第二/三音 delay 分别 0.15/0.3', () => {
  sfxGameOver();
  const t0 = stub.oscillators[0]!.start;
  const t1 = stub.oscillators[1]!.start;
  const t2 = stub.oscillators[2]!.start;
  assert.ok(Math.abs((t1 - t0) - 0.15) < 0.001, `delay2 应≈0.15，实际 ${t1 - t0}`);
  assert.ok(Math.abs((t2 - t0) - 0.3) < 0.001, `delay3 应≈0.3，实际 ${t2 - t0}`);
});

test('sfxNewRecord：四音 delay 序列 0/0.08/0.16/0.24', () => {
  sfxNewRecord();
  const t0 = stub.oscillators[0]!.start;
  const delays = stub.oscillators.map((o) => o.start - t0);
  const expected = [0, 0.08, 0.16, 0.24];
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(delays[i]! - expected[i]!) < 0.001, `delay[${i}] 应≈${expected[i]}，实际 ${delays[i]}`);
  }
});

// ─── duration 通过 stop 时间反映（stop - start - 0.05 ≈ duration） ───

test('sfxDeliver duration=0.12：stop - start - 0.05 = 0.12', () => {
  sfxDeliver();
  const o = stub.oscillators[0]!;
  assert.ok(Math.abs(o.stop - o.start - 0.05 - 0.12) < 0.001, `实际 ${o.stop - o.start - 0.05}`);
});

test('sfxOverloadWarn duration=0.2：stop - start - 0.05 = 0.2', () => {
  sfxOverloadWarn();
  const o = stub.oscillators[0]!;
  assert.ok(Math.abs(o.stop - o.start - 0.05 - 0.2) < 0.001, `实际 ${o.stop - o.start - 0.05}`);
});

// ─── muted 状态隔离与切换不残留 oscillator ───

test('先 muted 静默再解除：解除后恢复发声', () => {
  setMuted(true);
  sfxDeliver();
  assert.equal(stub.oscillators.length, 0);
  setMuted(false);
  sfxDeliver();
  assert.equal(stub.oscillators.length, 1);
});

test('unlockAudio 幂等：多次调用 resume 计数仍为 0（state 已 running）', () => {
  unlockAudio();
  unlockAudio();
  unlockAudio();
  assert.equal(stub.resumeCalls, 0);
});
