// test.mjs - 跑 node test 即可: node --test test.mjs
// 覆盖: 加权分布 / 保底 / 每日限次 / 老虎机布局 / 老虎机精准停
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUPONS, ARC_ORDER, RARE_WEIGHT_THRESHOLD, DAILY_FREE_DRAWS,
  weightedPick, PityCounter, DailyLimit, SlotLayout,
} from './game.js';

// ===== 1. 加权随机分布 =====
test('weightedPick 10000 次分布误差 < 2%', () => {
  const N = 10000;
  const counts = Object.fromEntries(COUPONS.map(c => [c.id, 0]));
  // 用固定种子可重现
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < N; i++) {
    const c = weightedPick(COUPONS, rand);
    counts[c.id]++;
  }
  for (const c of COUPONS) {
    const actual = counts[c.id] / N;
    const expected = c.prob / 100;
    assert.ok(
      Math.abs(actual - expected) < 0.02,
      `${c.id} 实际 ${(actual*100).toFixed(2)}% 偏离期望 ${(expected*100)}% 超过 2%`
    );
  }
});

test('weightedPick 返回 COUPONS 中的一项', () => {
  const c = weightedPick();
  assert.ok(COUPONS.find(x => x.id === c.id), '返回的必须在 COUPONS 里');
});

// ===== 2. PityCounter 保底逻辑 =====
test('PityCounter 9 次普通后第 10 次必出稀有', () => {
  const pity = new PityCounter(10);
  const nonRare = COUPONS.find(c => !c.rare);
  // 9 次强制传入普通 expected
  for (let i = 0; i < 9; i++) {
    pity.apply(nonRare);
  }
  assert.equal(pity.sinceRare, 9);
  // 第 10 次再传入普通, 应被强制改成稀有
  const lastResult = pity.apply(nonRare);
  assert.equal(lastResult.rare, true, '第 10 次必须强制出稀有');
});

test('PityCounter 真实随机下 10 次内必出稀有 (含自然 + 保底)', () => {
  const pity = new PityCounter(10);
  let seed = 999;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let sawRare = false;
  for (let i = 0; i < 10; i++) {
    const expected = weightedPick(COUPONS, rand);
    const result = pity.apply(expected, rand);
    if (result.rare) { sawRare = true; break; }
  }
  assert.equal(sawRare, true, '10 次内必须见到至少 1 张稀有 (自然+保底)');
});

test('PityCounter 中间出了稀有会重置计数', () => {
  const pity = new PityCounter(10);
  pity.sinceRare = 5;
  const fakeRare = { ...COUPONS[0], rare: true };
  pity.apply(fakeRare);
  assert.equal(pity.sinceRare, 0, '出稀有后 sinceRare 应清零');
});

test('PityCounter 第 9 次仍可出普通, 不强制稀有', () => {
  const pity = new PityCounter(10);
  let seed = 1;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  // 跑 9 次都返回普通
  for (let i = 0; i < 9; i++) {
    pity.apply({ ...COUPONS[0], rare: false }, rand);
  }
  assert.equal(pity.sinceRare, 9);
  assert.equal(pity.sinceRare < pity.threshold, true);
});

// ===== 3. DailyLimit 每日限次 =====
test('DailyLimit 第一次有 1 次机会, 用完为 0', () => {
  const state = {};
  const today = '2026-06-12';
  assert.equal(DailyLimit.remaining(state, today), DAILY_FREE_DRAWS);
  DailyLimit.consume(state, today, 'free');
  assert.equal(DailyLimit.remaining(state, today), 0);
});

test('DailyLimit 跨日重置', () => {
  const state = { '2026-06-12': { free: 1, bonus: 0 } };
  assert.equal(DailyLimit.remaining(state, '2026-06-12'), 0);
  assert.equal(DailyLimit.remaining(state, '2026-06-13'), DAILY_FREE_DRAWS);
});

test('DailyLimit bonus 不占 free 额度', () => {
  const state = {};
  const today = '2026-06-12';
  DailyLimit.consume(state, today, 'free');
  DailyLimit.consume(state, today, 'bonus');
  assert.equal(DailyLimit.remaining(state, today), 0, '两个都用了, 剩余 0');
  // 第二天, 又是新的
  assert.equal(DailyLimit.remaining(state, '2026-06-13'), DAILY_FREE_DRAWS);
});

// ===== 4. SlotLayout 老虎机布局 =====
test('SlotLayout 40 张, 中奖卡在 35 位', () => {
  for (const id of ARC_ORDER) {
    const reel = SlotLayout.build(id);
    assert.equal(reel.length, 40);
    assert.equal(reel[35], id, `winnerId=${id} 时 reel[35] 应等于 ${id}`);
  }
});

test('SlotLayout reel 是 ARC_ORDER 循环 8 次', () => {
  const reel = SlotLayout.build('C5');
  for (let i = 0; i < 35; i++) {
    assert.equal(reel[i], ARC_ORDER[i % 5], `reel[${i}] 期望 ${ARC_ORDER[i%5]}`);
  }
});

test('SlotLayout finalOffset 精准停 (无随机偏移)', () => {
  const off = SlotLayout.finalOffset(320, 35);
  assert.equal(off, -35 * 320, '应等于 -(winnerIndex * cardWidth)');
});

// ===== 5. 元数据一致性 =====
test('所有 COUPONS 权重和 = 100', () => {
  const total = COUPONS.reduce((s, c) => s + c.weight, 0);
  assert.equal(total, 100);
});

test('RARE_WEIGHT_THRESHOLD 内的券都标了 rare: true', () => {
  for (const c of COUPONS) {
    if (c.weight <= RARE_WEIGHT_THRESHOLD) {
      assert.equal(c.rare, true, `${c.id} weight ${c.weight} <= ${RARE_WEIGHT_THRESHOLD} 应是稀有`);
    } else {
      assert.equal(c.rare, false, `${c.id} weight ${c.weight} > ${RARE_WEIGHT_THRESHOLD} 不应是稀有`);
    }
  }
});

test('ARC_ORDER 长度 = 5 且无重复', () => {
  assert.equal(ARC_ORDER.length, 5);
  assert.equal(new Set(ARC_ORDER).size, 5);
});
