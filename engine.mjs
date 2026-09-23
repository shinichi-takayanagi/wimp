export const DEFAULT_CONFIG = Object.freeze({
  currentAge: 45,
  endAge: 100,
  startingAssets: 30000000,
  annualReturn: 4,
  annualInflation: 2,
  monthlySalary: 350000,
  retirementAge: 60,
  pensionStartAge: 65,
  monthlyPension: 100000,
  baseMonthlySpending: 350000,
  spendingStages: [{ age: 65, monthlySpending: 250000 }],
});

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export function validateConfig(config) {
  const integer = (key, min, max, label) => {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) {
      throw new Error(`${label}は${min}〜${max}の整数で入力してください。`);
    }
  };
  const number = (key, min, max, label) => {
    if (!isFiniteNumber(config[key]) || config[key] < min || config[key] > max) {
      throw new Error(`${label}は${min}〜${max}で入力してください。`);
    }
  };

  integer('currentAge', 18, 100, '現在の年齢');
  integer('endAge', 19, 110, '試算終了時の年齢');
  if (config.endAge <= config.currentAge) {
    throw new Error('試算終了時の年齢は、現在の年齢より大きい値にしてください。');
  }
  number('startingAssets', 0, 1e12, '現在の金融資産');
  number('annualReturn', -99, 100, '想定利回り');
  number('annualInflation', -20, 50, 'インフレ率');
  number('monthlySalary', 0, 1e10, '毎月の労働収入');
  integer('retirementAge', 18, 110, '収入終了時の年齢');
  integer('pensionStartAge', 60, 75, '年金の受給開始年齢');
  number('monthlyPension', 0, 1e10, '毎月の年金収入');
  number('baseMonthlySpending', 0, 1e10, '毎月の支出');

  if (!Array.isArray(config.spendingStages) || config.spendingStages.length > 30) {
    throw new Error('支出の設定は30件以内にしてください。');
  }
  const ages = new Set();
  for (const stage of config.spendingStages) {
    if (!Number.isInteger(stage.age) || stage.age < 18 || stage.age > 110) {
      throw new Error('支出の切替年齢は18〜110歳の整数で入力してください。');
    }
    if (!isFiniteNumber(stage.monthlySpending) || stage.monthlySpending < 0 || stage.monthlySpending > 1e10) {
      throw new Error('切替後の毎月の支出は0以上で入力してください。');
    }
    if (ages.has(stage.age)) {
      throw new Error('同じ年齢の支出の設定が重複しています。');
    }
    ages.add(stage.age);
  }
}

export function simulate(config) {
  validateConfig(config);
  const stages = [...config.spendingStages].sort((a, b) => a.age - b.age);
  const monthlyReturn = Math.pow(1 + config.annualReturn / 100, 1 / 12) - 1;
  const monthlyInflation = Math.pow(1 + config.annualInflation / 100, 1 / 12);
  const monthCount = (config.endAge - config.currentAge) * 12;
  const months = [];
  const years = [];
  const points = [{ age: config.currentAge, balance: config.startingAssets, cumulativeWithdrawal: 0 }];
  let balance = config.startingAssets;
  let cumulativeWithdrawal = 0;
  let cumulativePension = 0;
  let cumulativeShortfall = 0;
  let firstShortfall = null;
  let activeStage = 0;
  let baseSpending = config.baseMonthlySpending;

  for (let index = 0; index < monthCount; index += 1) {
    const age = config.currentAge + Math.floor(index / 12);
    const monthOfAge = index % 12;
    while (activeStage < stages.length && stages[activeStage].age <= age) {
      baseSpending = stages[activeStage].monthlySpending;
      activeStage += 1;
    }

    const openingBalance = balance;
    const salary = age < config.retirementAge ? config.monthlySalary : 0;
    const pension = age >= config.pensionStartAge ? config.monthlyPension : 0;
    const spending = baseSpending * Math.pow(monthlyInflation, index);
    const investmentGain = openingBalance * monthlyReturn;
    const availableAssets = Math.max(0, openingBalance + investmentGain);
    const cashFlow = salary + pension - spending;
    const deposit = Math.max(0, cashFlow);
    const withdrawal = Math.min(availableAssets, Math.max(0, -cashFlow));
    const shortfall = Math.max(0, -cashFlow - withdrawal);
    balance = availableAssets + deposit - withdrawal;

    cumulativeWithdrawal += withdrawal;
    cumulativePension += pension;
    cumulativeShortfall += shortfall;
    if (firstShortfall === null && shortfall > 0.005) {
      firstShortfall = { age, monthOfAge, elapsedMonth: index + 1 };
    }

    const month = {
      elapsedMonth: index + 1,
      age,
      monthOfAge,
      openingBalance,
      salary,
      pension,
      spending,
      investmentGain,
      deposit,
      withdrawal,
      shortfall,
      closingBalance: balance,
      cumulativeWithdrawal,
      cumulativePension,
    };
    months.push(month);

    if (monthOfAge === 11) {
      const slice = months.slice(index - 11, index + 1);
      const sum = (key) => slice.reduce((total, item) => total + item[key], 0);
      years.push({
        age,
        openingBalance: slice[0].openingBalance,
        salary: sum('salary'),
        pension: sum('pension'),
        spending: sum('spending'),
        investmentGain: sum('investmentGain'),
        deposit: sum('deposit'),
        withdrawal: sum('withdrawal'),
        shortfall: sum('shortfall'),
        closingBalance: balance,
      });
      points.push({ age: age + 1, balance, cumulativeWithdrawal });
    }
  }

  return {
    months,
    years,
    points,
    firstShortfall,
    endingBalance: balance,
    cumulativeWithdrawal,
    cumulativePension,
    cumulativeShortfall,
  };
}
