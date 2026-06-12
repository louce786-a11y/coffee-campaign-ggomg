// game.js - 纯逻辑层, 浏览器和 node 通用 (ES module)
// 不依赖 DOM / localStorage, 全部走参数, 方便单测

// ===== 5 张券的元数据 =====
export const COUPONS = [
  { id: 'C1', name: '基础券', discount: '5元满减(满50可用)',     prob: 40, weight: 40, rare: false },
  { id: 'C3', name: '经典券', discount: '免费中杯美式',           prob: 15, weight: 15, rare: false },
  { id: 'C5', name: '至尊券', discount: '免费任意大杯',           prob:  5, weight:  5, rare: true  },
  { id: 'C4', name: '豪华券', discount: '拿铁免费升杯',           prob: 10, weight: 10, rare: true  },
  { id: 'C2', name: '精品券', discount: '8折优惠(全场咖啡)',      prob: 30, weight: 30, rare: false },
];

// 老虎机视觉用的卡序 (从左到右, 跟弧形布局一致)
export const ARC_ORDER = ['C1', 'C3', 'C5', 'C4', 'C2'];

export const SLOT_TOTAL_CARDS = 40;       // reel 长度
export const SLOT_WINNER_INDEX = 35;      // 中奖卡在 reel 的位置
export const RARE_WEIGHT_THRESHOLD = 10;  // weight <= 10 视为稀有
export const DAILY_FREE_DRAWS = 1;        // 每天免费次数
export const PITY_THRESHOLD = 10;         // 连抽 10 次必出稀有

// ===== 加权随机抽 (可注入随机源) =====
export function weightedPick(coupons = COUPONS, rand = Math.random) {
  const total = coupons.reduce((s, c) => s + c.weight, 0);
  let r = rand() * total;
  for (const c of coupons) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return coupons[coupons.length - 1];
}

// ===== 保底逻辑: 连抽 N 次没出稀有 → 强制出稀有 =====
export class PityCounter {
  constructor(threshold = PITY_THRESHOLD) {
    this.threshold = threshold;
    this.sinceRare = 0;
  }
  // 返回被强制改写的 coupon (如果有)
  // expected: 本次加权随机的结果
  // rand: 注入的随机源
  apply(expected, rand = Math.random) {
    this.sinceRare += 1;
    if (expected.rare) {
      this.sinceRare = 0;
      return expected;
    }
    if (this.sinceRare >= this.threshold) {
      // 强制抽一张稀有的
      const rares = COUPONS.filter(c => c.rare);
      const forced = rares[Math.floor(rand() * rares.length)];
      this.sinceRare = 0;
      return forced;
    }
    return expected;
  }
  reset() { this.sinceRare = 0; }
  get state() { return { sinceRare: this.sinceRare, threshold: this.threshold }; }
}

// ===== 每日次数限制 =====
export class DailyLimit {
  // state: { [dateStr]: { free: 0, bonus: 0 } }
  static key = 'drawLimit_v1';
  static today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  static load(store) {
    try { return JSON.parse(store.getItem(DailyLimit.key) || '{}'); }
    catch { return {}; }
  }
  static remaining(state, dateStr = DailyLimit.today()) {
    const used = (state[dateStr]?.free || 0) + (state[dateStr]?.bonus || 0);
    return Math.max(0, DAILY_FREE_DRAWS - used);
  }
  static consume(state, dateStr = DailyLimit.today(), kind = 'free') {
    const cur = state[dateStr] || { free: 0, bonus: 0 };
    cur[kind] = (cur[kind] || 0) + 1;
    state[dateStr] = cur;
    return state;
  }
}

// ===== 老虎机 reel 布局计算 =====
export class SlotLayout {
  // 给定 winnerId, 计算 reel 的 40 张卡的 id 数组
  // 让 winnerId 出现在 SLOT_WINNER_INDEX 位置
  static build(winnerId, total = SLOT_TOTAL_CARDS) {
    const ordered = ARC_ORDER.map(id => COUPONS.find(c => c.id === id));
    const cards = [];
    for (let i = 0; i < total; i++) {
      cards.push(ordered[i % ordered.length].id);
    }
    // 重排最后 5 张, 让 winner 落在 SLOT_WINNER_INDEX
    const winnerInOrder = ARC_ORDER.indexOf(winnerId);
    if (winnerInOrder > 0) {
      const last5 = cards.slice(-5);
      const rotated = new Array(5);
      for (let k = 0; k < 5; k++) {
        rotated[k] = last5[(k + winnerInOrder) % 5];
      }
      cards.splice(-5, 5, ...rotated);
    }
    return cards;
  }
  // 给定 cardWidth, 计算最终 translateX, 让 winner 精准对齐中心
  static finalOffset(cardWidth, winnerIndex = SLOT_WINNER_INDEX) {
    // 卡宽 == 帧宽, 整卡停即可, 不加随机偏移
    return -(winnerIndex * cardWidth);
  }
}
