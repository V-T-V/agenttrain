// 带种子的可复现伪随机数发生器（mulberry32）。
// 用同一 seed 构造的实例会产出完全相同的序列，便于确定性测试与调试。
// 这是一个类而非纯函数，因为随机序列本身是有状态的。

export class Rng {
  private state: number;

  constructor(seed: number) {
    // 把任意输入归一化成 uint32，避免 0 这种会让算法退化的种子。
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** 返回 [0,1) 的浮点数。 */
  next(): number {
    // mulberry32
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [min,max) 的浮点数。 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** 返回 [min,max] 的整数（闭区间）。 */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** 以概率 p（[0,1]）返回 true。 */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 从数组中等概率抽取一个元素。 */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: 空数组');
    const idx = this.int(0, items.length - 1);
    return items[idx] as T;
  }

  /**
   * 导出当前内部状态（用于存档序列化）。
   * 与种子不同：seed 是初始值，state 是经过若干次 next() 后的当前值。
   * 续局时用 fromState(state) 重建实例，可保证随机序列连贯。
   */
  getState(): number {
    return this.state >>> 0;
  }

  /**
   * 从导出的内部状态重建 Rng 实例（存档续局用）。
   * state 归一化到 uint32，0 退化值同样用黄金分割常数兜底（与构造函数一致）。
   */
  static fromState(state: number): Rng {
    const r = Object.create(Rng.prototype) as Rng;
    r['state'] = state >>> 0;
    if (r['state'] === 0) r['state'] = 0x9e3779b9;
    return r;
  }
}
