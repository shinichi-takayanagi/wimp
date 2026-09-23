import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, simulate } from './engine.mjs';

const config = (overrides = {}) => ({
  ...DEFAULT_CONFIG,
  currentAge: 45,
  endAge: 46,
  startingAssets: 0,
  annualReturn: 0,
  annualInflation: 0,
  monthlySalary: 0,
  retirementAge: 60,
  pensionStartAge: 65,
  monthlyPension: 0,
  baseMonthlySpending: 0,
  spendingStages: [],
  ...overrides,
});

const closeTo = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 0.01, `${message}: expected ${expected}, got ${actual}`);
};

test('既定の試算期間と資産額を使う', () => {
  assert.equal(DEFAULT_CONFIG.endAge, 80);
  assert.equal(DEFAULT_CONFIG.startingAssets, 15_000_000);
});

test('年利を実効月利に変換して複利運用する', () => {
  const result = simulate(config({ startingAssets: 1_000_000, annualReturn: 12 }));
  closeTo(result.endingBalance, 1_120_000, '12か月後の残高');
});

test('年率インフレを実効月利に変換して毎月支出に反映する', () => {
  const monthlyRate = 1.12 ** (1 / 12) - 1;
  const result = simulate(config({
    endAge: 47,
    annualInflation: 12,
    monthlySalary: 100_000,
    baseMonthlySpending: 10_000,
  }));
  closeTo(result.months[0].spending, 10_000, '初月の支出');
  closeTo(result.months[1].spending, 10_000 * (1 + monthlyRate), '2か月目の支出');
  closeTo(result.months[12].spending, 11_200, '1年後の初月支出');
  closeTo(result.years[0].spending,
    10_000 * ((1 + monthlyRate) ** 12 - 1) / monthlyRate, '初年度の合計支出');
});

test('支出ステージは切替年齢の最初の月から適用する', () => {
  const result = simulate(config({
    currentAge: 59,
    endAge: 61,
    baseMonthlySpending: 100_000,
    spendingStages: [{ age: 60, monthlySpending: 200_000 }],
  }));
  assert.equal(result.months[11].spending, 100_000);
  assert.equal(result.months[12].spending, 200_000);
});

test('月の収入が支出を上回る場合、差額を資産に積み立てる', () => {
  const result = simulate(config({
    startingAssets: 1_000_000,
    monthlySalary: 200_000,
    baseMonthlySpending: 150_000,
  }));
  assert.equal(result.years[0].deposit, 600_000);
  assert.equal(result.years[0].withdrawal, 0);
  assert.equal(result.endingBalance, 1_600_000);
});

test('資産を使い切った後もマイナス残高で支出を計上する', () => {
  const result = simulate(config({
    startingAssets: 200_000,
    baseMonthlySpending: 100_000,
  }));
  assert.equal(result.months[2].closingBalance, -100_000);
  assert.equal(result.years[0].withdrawal, 1_200_000);
  assert.equal(result.endingBalance, -1_000_000);
});

test('資産残高がマイナスの月は資産運用損益を計上しない', () => {
  const result = simulate(config({
    startingAssets: 100_000,
    annualReturn: 12,
    baseMonthlySpending: 150_000,
  }));
  assert.ok(result.months[0].closingBalance < 0);
  assert.equal(result.months[0].investmentGain > 0, true);
  assert.equal(result.months[1].openingBalance < 0, true);
  assert.equal(result.months[1].investmentGain, 0);
  assert.equal(result.months[1].closingBalance, result.months[1].openingBalance - 150_000);
});

test('年利運用と月次取崩しを合わせて月末残高を計算する', () => {
  const opening = 1_000_000;
  const monthlyRate = 1.12 ** (1 / 12) - 1;
  const result = simulate(config({
    startingAssets: opening,
    annualReturn: 12,
    baseMonthlySpending: 10_000,
  }));
  const expectedBalance = opening * (1 + monthlyRate) ** 12
    - 10_000 * ((1 + monthlyRate) ** 12 - 1) / monthlyRate;
  closeTo(result.endingBalance, expectedBalance, '終了時の資産残高');
});

test('年金収入は設定年齢から毎月の支出を相殺する', () => {
  const result = simulate(config({
    currentAge: 64,
    endAge: 66,
    pensionStartAge: 65,
    monthlyPension: 50_000,
    baseMonthlySpending: 100_000,
  }));
  assert.equal(result.months[11].pension, 0);
  assert.equal(result.months[12].pension, 50_000);
  assert.equal(result.years[0].withdrawal, 1_200_000);
  assert.equal(result.years[1].withdrawal, 600_000);
  assert.equal(result.endingBalance, -1_800_000);
});

test('年齢別集計と月次資産残高が一致する', () => {
  const result = simulate(DEFAULT_CONFIG);
  assert.equal(result.months.length, (DEFAULT_CONFIG.endAge - DEFAULT_CONFIG.currentAge) * 12);
  assert.equal(result.years.length, DEFAULT_CONFIG.endAge - DEFAULT_CONFIG.currentAge);
  assert.equal(result.points.length, result.years.length + 1);

  for (const [index, month] of result.months.entries()) {
    closeTo(month.closingBalance,
      month.openingBalance + month.investmentGain + month.deposit - month.withdrawal,
      `${index + 1}か月目の資産残高`);
    if (index > 0) closeTo(month.openingBalance, result.months[index - 1].closingBalance, '前月末残高との接続');
  }
  for (const [index, year] of result.years.entries()) {
    const months = result.months.slice(index * 12, index * 12 + 12);
    for (const field of ['salary', 'pension', 'spending', 'investmentGain', 'deposit', 'withdrawal']) {
      closeTo(year[field], months.reduce((sum, month) => sum + month[field], 0), `${year.age}歳の${field}`);
    }
    closeTo(year.closingBalance, months[11].closingBalance, `${year.age}歳末の残高`);
    closeTo(result.points[index + 1].balance, year.closingBalance, `${year.age + 1}歳時点のグラフ残高`);
  }
  closeTo(result.endingBalance, result.months.at(-1).closingBalance, '終了時の資産残高');
});

test('同じ年齢の支出切替は拒否する', () => {
  assert.throws(() => simulate(config({ spendingStages: [
    { age: 60, monthlySpending: 100_000 },
    { age: 60, monthlySpending: 200_000 },
  ] })), /重複/);
});
