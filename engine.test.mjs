import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, simulate } from './engine.mjs';

const config = (overrides = {}) => ({ ...DEFAULT_CONFIG, annualReturn: 0, annualInflation: 0, spendingStages: [], ...overrides });
const closeToYen = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) < 0.01, `${label}: expected ${expected}円, got ${actual}円`);
};

// 月次ループとは独立した等比数列の和で、1年間の生活費を求める。
function expectedAnnualSpending(monthlyBase, annualInflation) {
  if (annualInflation === 0) return monthlyBase * 12;
  const annualFactor = 1 + annualInflation / 100;
  const monthlyFactor = annualFactor ** (1 / 12);
  return monthlyBase * (annualFactor - 1) / (monthlyFactor - 1);
}

test('初期条件に年利・インフレ率・給与・支出・年金の設定を反映する', () => {
  assert.equal(DEFAULT_CONFIG.annualReturn, 4);
  assert.equal(DEFAULT_CONFIG.annualInflation, 2);
  assert.equal(DEFAULT_CONFIG.monthlySalary, 350000);
  assert.equal(DEFAULT_CONFIG.baseMonthlySpending, 350000);
  assert.equal(DEFAULT_CONFIG.monthlyPension, 100000);
  assert.deepEqual(DEFAULT_CONFIG.spendingStages, [{ age: 65, monthlySpending: 250000 }]);
});

test('年齢の切替月から新しい生活費が適用される', () => {
  const result = simulate(config({
    currentAge: 59,
    endAge: 61,
    startingAssets: 1200000,
    annualReturn: 0,
    monthlySalary: 0,
    monthlyPension: 0,
    baseMonthlySpending: 100000,
    spendingStages: [{ age: 60, monthlySpending: 200000 }],
  }));
  assert.equal(result.months[11].spending, 100000);
  assert.equal(result.months[12].spending, 200000);
  assert.equal(result.years[0].closingBalance, 0);
  assert.equal(result.firstShortfall.age, 60);
  assert.equal(result.firstShortfall.monthOfAge, 0);
  assert.equal(result.cumulativeShortfall, 2400000);
});

test('月の収入が支出を上回る場合、差額を資産に積み立てる', () => {
  const result = simulate(config({
    currentAge: 45,
    endAge: 46,
    startingAssets: 1000000,
    annualReturn: 0,
    monthlySalary: 200000,
    monthlyPension: 0,
    baseMonthlySpending: 150000,
  }));
  assert.equal(result.years[0].deposit, 600000);
  assert.equal(result.years[0].withdrawal, 0);
  assert.equal(result.endingBalance, 1600000);
  assert.equal(result.firstShortfall, null);
});

test('資産を使い切った後の不足額を月ごとに集計する', () => {
  const result = simulate(config({
    currentAge: 45,
    endAge: 46,
    startingAssets: 200000,
    annualReturn: 0,
    monthlySalary: 0,
    monthlyPension: 0,
    baseMonthlySpending: 100000,
  }));
  assert.equal(result.firstShortfall.age, 45);
  assert.equal(result.firstShortfall.monthOfAge, 2);
  assert.equal(result.firstShortfall.elapsedMonth, 3);
  assert.equal(result.cumulativeWithdrawal, 200000);
  assert.equal(result.cumulativeShortfall, 1000000);
  assert.equal(result.endingBalance, 0);
});

test('年金は設定年齢から毎月の支出を相殺する', () => {
  const result = simulate(config({
    currentAge: 64,
    endAge: 66,
    startingAssets: 2400000,
    annualReturn: 0,
    monthlySalary: 0,
    pensionStartAge: 65,
    monthlyPension: 50000,
    baseMonthlySpending: 100000,
  }));
  assert.equal(result.months[11].pension, 0);
  assert.equal(result.months[12].pension, 50000);
  assert.equal(result.years[0].withdrawal, 1200000);
  assert.equal(result.years[1].withdrawal, 600000);
  assert.equal(result.endingBalance, 600000);
});

test('年利を月利に変換した12か月の運用結果が一致する', () => {
  const result = simulate(config({
    currentAge: 45,
    endAge: 46,
    startingAssets: 1000000,
    annualReturn: 12,
    monthlySalary: 0,
    monthlyPension: 0,
    baseMonthlySpending: 0,
  }));
  assert.ok(Math.abs(result.endingBalance - 1120000) < 0.001);
});

test('物価上昇率は生活費に月次で適用される', () => {
  const result = simulate(config({
    currentAge: 45,
    endAge: 47,
    startingAssets: 0,
    annualReturn: 0,
    annualInflation: 12,
    monthlySalary: 100000,
    monthlyPension: 0,
    baseMonthlySpending: 10000,
  }));
  assert.ok(Math.abs(result.months[12].spending - 11200) < 0.001);
});

test('同じ年齢の支出切替を拒否する', () => {
  assert.throws(() => simulate(config({ spendingStages: [
    { age: 60, monthlySpending: 100000 },
    { age: 60, monthlySpending: 200000 },
  ] })), /重複/);
});

for (const inflation of [false, true]) {
  for (const salary of [false, true]) {
    for (const pension of [false, true]) {
      for (const spendingChange of [false, true]) {
        const name = `組合せ: インフレ${inflation ? '有' : '無'}・収入${salary ? '有' : '無'}・年金${pension ? '有' : '無'}・生活費変更${spendingChange ? '有' : '無'}`;
        test(name, () => {
          const annualInflation = inflation ? 12 : 0;
          const secondYearBase = spendingChange ? 50000 : 100000;
          const salaryYear = salary ? 40000 * 12 : 0;
          const pensionYear = pension ? 30000 * 12 : 0;
          const spendingYear64 = expectedAnnualSpending(100000, annualInflation);
          const spendingYear65 = expectedAnnualSpending(secondYearBase, annualInflation) * (1 + annualInflation / 100);
          const withdrawalYear64 = spendingYear64 - salaryYear;
          const withdrawalYear65 = spendingYear65 - pensionYear;
          const expectedWithdrawal = withdrawalYear64 + withdrawalYear65;
          const expectedBalance = 10000000 - expectedWithdrawal;

          const result = simulate(config({
            currentAge: 64,
            endAge: 66,
            startingAssets: 10000000,
            annualInflation,
            monthlySalary: salary ? 40000 : 0,
            retirementAge: 65,
            pensionStartAge: 65,
            monthlyPension: pension ? 30000 : 0,
            baseMonthlySpending: 100000,
            spendingStages: spendingChange ? [{ age: 65, monthlySpending: 50000 }] : [],
          }));

          assert.equal(result.firstShortfall, null);
          closeToYen(result.endingBalance, expectedBalance, '終了時資産');
          closeToYen(result.cumulativeWithdrawal, expectedWithdrawal, '累計取崩し');
          closeToYen(result.cumulativePension, pensionYear, '累計年金');
          closeToYen(result.years[0].salary, salaryYear, '64歳の給与');
          closeToYen(result.years[1].pension, pensionYear, '65歳の年金');
          closeToYen(result.years[0].spending, spendingYear64, '64歳の生活費');
          closeToYen(result.years[1].spending, spendingYear65, '65歳の生活費');
          closeToYen(result.years[0].withdrawal, withdrawalYear64, '64歳の取崩し');
          closeToYen(result.years[1].withdrawal, withdrawalYear65, '65歳の取崩し');
          closeToYen(result.years[1].closingBalance, expectedBalance, '65歳末の資産');
          closeToYen(result.points[1].balance, 10000000 - withdrawalYear64, '65歳時点のグラフ資産');
          closeToYen(result.points[2].cumulativeWithdrawal, expectedWithdrawal, '66歳時点のグラフ取崩し');
          closeToYen(result.months[12].spending, secondYearBase * (1 + annualInflation / 100), '生活費切替の初月');
          assert.equal(result.months[11].salary, salary ? 40000 : 0);
          assert.equal(result.months[12].salary, 0);
          assert.equal(result.months[11].pension, 0);
          assert.equal(result.months[12].pension, pension ? 30000 : 0);
        });
      }
    }
  }
}

test('収入で積み立てた後に生活費を増やして資産を使い切り、年金開始後も不足額を集計する', () => {
  const result = simulate(config({
    currentAge: 64,
    endAge: 67,
    startingAssets: 0,
    monthlySalary: 150000,
    retirementAge: 65,
    pensionStartAge: 66,
    monthlyPension: 80000,
    baseMonthlySpending: 100000,
    spendingStages: [
      { age: 65, monthlySpending: 200000 },
      { age: 66, monthlySpending: 100000 },
    ],
  }));

  assert.deepEqual(result.firstShortfall, { age: 65, monthOfAge: 3, elapsedMonth: 16 });
  assert.equal(result.endingBalance, 0);
  assert.equal(result.cumulativeWithdrawal, 600000);
  assert.equal(result.cumulativeShortfall, 2040000);
  assert.equal(result.cumulativePension, 960000);
  assert.equal(result.years[0].deposit, 600000);
  assert.equal(result.years[0].closingBalance, 600000);
  assert.equal(result.years[1].withdrawal, 600000);
  assert.equal(result.years[1].shortfall, 1800000);
  assert.equal(result.years[2].pension, 960000);
  assert.equal(result.years[2].shortfall, 240000);
  assert.deepEqual(result.points.map(({ age, balance }) => [age, balance]), [
    [64, 0], [65, 600000], [66, 0], [67, 0],
  ]);
});

test('運用益と毎月の取崩しを組み合わせても終了時資産が閉形式と一致する', () => {
  const opening = 1000000;
  const monthlySpending = 10000;
  const monthlyFactor = 1.12 ** (1 / 12);
  const expectedBalance = opening * 1.12 - monthlySpending * (1.12 - 1) / (monthlyFactor - 1);
  const result = simulate(config({
    currentAge: 45,
    endAge: 46,
    startingAssets: opening,
    annualReturn: 12,
    monthlySalary: 0,
    monthlyPension: 0,
    baseMonthlySpending: monthlySpending,
  }));

  closeToYen(result.endingBalance, expectedBalance, '運用しながら取崩した終了時資産');
  closeToYen(result.years[0].investmentGain, expectedBalance - opening + monthlySpending * 12, '年間運用益');
  assert.equal(result.cumulativeWithdrawal, monthlySpending * 12);
  assert.equal(result.firstShortfall, null);
});

test('資産ゼロで収入と生活費が同額でも、翌月のインフレによる不足を検知する', () => {
  const result = simulate(config({
    currentAge: 45,
    endAge: 46,
    startingAssets: 0,
    annualInflation: 12,
    monthlySalary: 100000,
    monthlyPension: 0,
    baseMonthlySpending: 100000,
  }));
  assert.deepEqual(result.firstShortfall, { age: 45, monthOfAge: 1, elapsedMonth: 2 });
  assert.equal(result.cumulativeWithdrawal, 0);
  closeToYen(result.cumulativeShortfall, expectedAnnualSpending(100000, 12) - 1200000, 'インフレによる累計不足');
});

test('年金開始後の余剰分は積み立てられ、開始前の不足額は残る', () => {
  const result = simulate(config({
    currentAge: 64,
    endAge: 66,
    startingAssets: 0,
    monthlySalary: 0,
    pensionStartAge: 65,
    monthlyPension: 150000,
    baseMonthlySpending: 100000,
  }));
  assert.deepEqual(result.firstShortfall, { age: 64, monthOfAge: 0, elapsedMonth: 1 });
  assert.equal(result.cumulativeShortfall, 1200000);
  assert.equal(result.cumulativeWithdrawal, 0);
  assert.equal(result.years[1].deposit, 600000);
  assert.equal(result.cumulativePension, 1800000);
  assert.equal(result.endingBalance, 600000);
});

test('給与と年金が同時に入る月は両方を生活費から差し引く', () => {
  const result = simulate(config({
    currentAge: 65,
    endAge: 66,
    startingAssets: 0,
    monthlySalary: 70000,
    retirementAge: 66,
    pensionStartAge: 65,
    monthlyPension: 50000,
    baseMonthlySpending: 100000,
  }));
  assert.equal(result.months[0].deposit, 20000);
  assert.equal(result.years[0].salary, 840000);
  assert.equal(result.years[0].pension, 600000);
  assert.equal(result.years[0].deposit, 240000);
  assert.equal(result.cumulativeWithdrawal, 0);
  assert.equal(result.cumulativeShortfall, 0);
  assert.equal(result.endingBalance, 240000);
});

test('標準条件の月次収支・年齢別内訳・グラフ値が互いに一致する', () => {
  const result = simulate(DEFAULT_CONFIG);
  assert.equal(result.months.length, (DEFAULT_CONFIG.endAge - DEFAULT_CONFIG.currentAge) * 12);
  assert.equal(result.years.length, DEFAULT_CONFIG.endAge - DEFAULT_CONFIG.currentAge);
  assert.equal(result.points.length, result.years.length + 1);

  for (const [index, month] of result.months.entries()) {
    closeToYen(month.salary + month.pension + month.withdrawal + month.shortfall,
      month.spending + month.deposit, `${index + 1}か月目の現金収支`);
    closeToYen(month.closingBalance,
      month.openingBalance + month.investmentGain + month.deposit - month.withdrawal,
      `${index + 1}か月目の資産収支`);
    assert.ok(month.closingBalance >= 0, `${index + 1}か月目の資産がマイナス`);
    if (index > 0) closeToYen(month.openingBalance, result.months[index - 1].closingBalance, '前月末資産との接続');
  }

  for (const [index, year] of result.years.entries()) {
    const months = result.months.slice(index * 12, index * 12 + 12);
    for (const field of ['salary', 'pension', 'spending', 'investmentGain', 'deposit', 'withdrawal', 'shortfall']) {
      closeToYen(year[field], months.reduce((sum, month) => sum + month[field], 0), `${year.age}歳の${field}`);
    }
    closeToYen(year.closingBalance, months[11].closingBalance, `${year.age}歳末の資産`);
    closeToYen(result.points[index + 1].balance, year.closingBalance, `${year.age + 1}歳時点のグラフ資産`);
  }

  closeToYen(result.endingBalance, result.months.at(-1).closingBalance, '終了時資産');
  closeToYen(result.cumulativeWithdrawal,
    result.months.reduce((sum, month) => sum + month.withdrawal, 0), '累計取崩し');
  closeToYen(result.cumulativeShortfall,
    result.months.reduce((sum, month) => sum + month.shortfall, 0), '累計不足額');
  const firstDeficit = result.months.find((month) => month.shortfall > 0.005);
  assert.deepEqual(result.firstShortfall,
    firstDeficit ? { age: firstDeficit.age, monthOfAge: firstDeficit.monthOfAge, elapsedMonth: firstDeficit.elapsedMonth } : null);
});
