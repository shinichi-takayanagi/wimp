import { DEFAULT_CONFIG, simulate, validateConfig } from './engine.mjs';

const STORAGE_KEY = 'wimp:config:v3';
const LEGACY_STORAGE_KEY = 'wimp:config:v2';
const form = document.querySelector('#simulation-form');
const stagesElement = document.querySelector('#spending-stages');
const errorElement = document.querySelector('#form-error');
const chart = document.querySelector('#projection-chart');
const ageSelect = document.querySelector('#age-select');
const downloadButtons = [document.querySelector('#download-csv'), document.querySelector('#download-png')];
const moneyFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

let latestConfig = null;
let latestResult = null;
let selectedAge = null;

const toMan = (yen) => yen / 10000;
const formatMan = (yen) => `${moneyFormatter.format(toMan(yen))}万円`;
const inputNumber = (value) => value.trim() === '' ? NaN : Number(value);

function setField(name, value) {
  form.elements[name].value = value;
}

function addStageRow(stage) {
  const row = document.createElement('div');
  row.className = 'stage-row';
  const ageLabel = document.createElement('label');
  ageLabel.className = 'stage-field';
  ageLabel.innerHTML = '<span class="input-wrap"><input class="stage-age" type="number" min="18" max="110" step="1" inputmode="numeric" required aria-label="支出変化時の年齢"><span class="unit">歳</span></span>';
  ageLabel.querySelector('input').value = stage.age;
  const spendingLabel = document.createElement('label');
  spendingLabel.className = 'stage-field';
  spendingLabel.innerHTML = '<span class="input-wrap"><span class="field-number stage-number" aria-hidden="true"></span><input class="stage-spending" type="number" min="0" step="0.1" inputmode="decimal" required aria-label="支出変化後の毎月の支出"><span class="unit">万円</span></span>';
  spendingLabel.querySelector('input').value = toMan(stage.monthlySpending);
  const remove = document.createElement('button');
  remove.className = 'remove-stage';
  remove.type = 'button';
  remove.setAttribute('aria-label', 'この支出の設定を削除');
  remove.textContent = '×';
  row.append(ageLabel, spendingLabel, remove);
  stagesElement.append(row);
  updateStageNumberBadges();
}

function updateStageNumberBadges() {
  [...stagesElement.querySelectorAll('.stage-row')].forEach((row, index) => {
    row.querySelector('.stage-number').textContent = String(5 + index);
  });
}

function populateForm(config) {
  for (const key of ['currentAge', 'endAge', 'annualReturn', 'annualInflation', 'retirementAge', 'pensionStartAge']) {
    setField(key, config[key]);
  }
  for (const key of ['startingAssets', 'monthlySalary', 'monthlyPension', 'baseMonthlySpending']) {
    setField(key, toMan(config[key]));
  }
  stagesElement.replaceChildren();
  for (const stage of config.spendingStages) addStageRow(stage);
}

function readConfig() {
  const value = (key) => inputNumber(form.elements[key].value);
  return {
    currentAge: value('currentAge'),
    endAge: value('endAge'),
    startingAssets: value('startingAssets') * 10000,
    annualReturn: value('annualReturn'),
    annualInflation: value('annualInflation'),
    monthlySalary: value('monthlySalary') * 10000,
    retirementAge: value('retirementAge'),
    pensionStartAge: value('pensionStartAge'),
    monthlyPension: value('monthlyPension') * 10000,
    baseMonthlySpending: value('baseMonthlySpending') * 10000,
    spendingStages: [...stagesElement.querySelectorAll('.stage-row')].map((row) => ({
      age: inputNumber(row.querySelector('.stage-age').value),
      monthlySpending: inputNumber(row.querySelector('.stage-spending').value) * 10000,
    })),
  };
}

function initialConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = applyNewDefaultsToPreviousDefaults(JSON.parse(raw));
      validateConfig(parsed);
      return parsed;
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const migrated = applyNewDefaultsToPreviousDefaults(JSON.parse(legacy));
      if (migrated.annualReturn === 0) migrated.annualReturn = DEFAULT_CONFIG.annualReturn;
      if (migrated.annualInflation === 0) migrated.annualInflation = DEFAULT_CONFIG.annualInflation;
      if (migrated.monthlyPension === 80000) migrated.monthlyPension = DEFAULT_CONFIG.monthlyPension;
      validateConfig(migrated);
      return migrated;
    }
  } catch { /* Stored data can be missing or outdated. */ }
  return DEFAULT_CONFIG;
}

function applyNewDefaultsToPreviousDefaults(config) {
  const previousStages = [
    { age: 60, monthlySpending: 150000 },
    { age: 65, monthlySpending: 120000 },
    { age: 70, monthlySpending: 100000 },
  ];
  const earlierSingleStage = [{ age: 60, monthlySpending: 150000 }];
  if (config.monthlySalary === 100000) config.monthlySalary = DEFAULT_CONFIG.monthlySalary;
  if (config.baseMonthlySpending === 200000) config.baseMonthlySpending = DEFAULT_CONFIG.baseMonthlySpending;
  if ([previousStages, earlierSingleStage].some((stages) =>
    JSON.stringify(config.spendingStages) === JSON.stringify(stages))) {
    config.spendingStages = DEFAULT_CONFIG.spendingStages.map((stage) => ({ ...stage }));
  }
  return config;
}

function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* Storage can be unavailable in private or restricted browsing modes. */ }
}

function setText(selector, text) {
  const element = document.querySelector(selector);
  if (element) element.textContent = text;
}

function renderMetrics(result) {
  setText('#ending-balance', formatMan(result.endingBalance));
  setText('#shortfall-age', result.firstShortfall
    ? `${result.firstShortfall.age}歳${result.firstShortfall.monthOfAge}か月`
    : '不足なし');
}

function niceMaximum(value) {
  if (value <= 0) return 1000000;
  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const leading = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return leading * power;
}

function flowScale(result, top, bottom) {
  const annualFlows = result.years.map((year) => ({
    ...year,
    income: year.salary + year.pension,
    assetChange: year.closingBalance - year.openingBalance,
  }));
  const flowMinimum = Math.min(0, ...annualFlows.map((year) => year.assetChange));
  const flowMaximum = Math.max(0, ...annualFlows.flatMap((year) => [year.income, year.spending, year.assetChange]));
  const flowMin = flowMinimum < 0 ? -niceMaximum(Math.abs(flowMinimum) * 1.05) : 0;
  const flowMax = niceMaximum(flowMaximum * 1.05);
  const flowY = (value) => bottom - ((value - flowMin) / (flowMax - flowMin)) * (bottom - top);
  return { annualFlows, flowMin, flowMax, flowY, zeroY: flowY(0) };
}

function selectedMarkMarkup(config, result, age) {
  const left = 76, right = 822, top = 22, bottom = 212;
  const maxValue = Math.max(...result.points.map((point) => point.balance));
  const yMax = niceMaximum(maxValue * 1.05);
  const { zeroY } = flowScale(result, top, bottom);
  const x = left + ((age - config.currentAge) / (config.endAge - config.currentAge)) * (right - left);
  const point = result.points.find((item) => item.age === age);
  if (!point) return '';
  const y = zeroY - (Math.max(0, point.balance) / yMax) * (zeroY - top);
  return `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" class="selected-line"/><circle cx="${x}" cy="${y}" r="7" class="selected-dot"/>`;
}

function renderChart(config, result) {
  const left = 76, right = 822, top = 22, bottom = 212;
  const maxValue = Math.max(...result.points.map((point) => point.balance));
  const yMax = niceMaximum(maxValue * 1.05);
  const { annualFlows, flowMin, flowMax, flowY, zeroY } = flowScale(result, top, bottom);
  const x = (age) => left + ((age - config.currentAge) / (config.endAge - config.currentAge)) * (right - left);
  const y = (value) => zeroY - (Math.max(0, value) / yMax) * (zeroY - top);
  const balanceLine = result.points.map((point, index) => `${index ? 'L' : 'M'}${x(point.age).toFixed(2)} ${y(point.balance).toFixed(2)}`).join(' ');
  const area = `${balanceLine} L${right} ${zeroY} L${left} ${zeroY} Z`;
  const flowSeries = [
    { key: 'income', className: 'income-bar' },
    { key: 'spending', className: 'spending-bar' },
    { key: 'assetChange', className: 'asset-change-bar' },
  ];
  const clusterWidth = Math.min(10, ((right - left) / annualFlows.length) * 0.78);
  const barGap = Math.min(1, clusterWidth * 0.08);
  const barWidth = (clusterWidth - barGap * 2) / 3;
  const flowBars = annualFlows.map((year) => flowSeries.map(({ key, className }, seriesIndex) => {
    const valueY = flowY(year[key]);
    const barHeight = Math.max(1, Math.abs(zeroY - valueY));
    const barX = x(year.age + 0.5) - clusterWidth / 2 + seriesIndex * (barWidth + barGap);
    const barY = Math.min(zeroY, valueY);
    return `<rect class="${className}" x="${barX.toFixed(2)}" y="${barY.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx=".8"/>`;
  }).join('')).join('');
  const grids = Array.from({ length: 5 }, (_, index) => {
    const value = yMax * index / 4;
    const gridY = y(value);
    return `<line x1="${left}" y1="${gridY}" x2="${right}" y2="${gridY}" class="${index === 0 ? 'zero-grid-line' : 'grid-line'}"/><text x="${left - 12}" y="${gridY + 4}" text-anchor="end" class="axis-label">${moneyFormatter.format(toMan(value))}</text>`;
  }).join('');
  const flowTicks = [...new Set([flowMin, 0, flowMax])].map((value) => {
    const tickY = flowY(value);
    return `<line x1="${right - 4}" y1="${tickY}" x2="${right}" y2="${tickY}" class="tick-line"/><text x="${right + 8}" y="${tickY + 4}" class="axis-label">${moneyFormatter.format(toMan(value))}</text>`;
  }).join('');
  const tickAges = new Set([config.currentAge, config.endAge]);
  for (let age = Math.ceil(config.currentAge / 10) * 10; age < config.endAge; age += 10) tickAges.add(age);
  const ticks = [...tickAges].sort((a, b) => a - b).map((age) =>
    `<line x1="${x(age)}" y1="${bottom}" x2="${x(age)}" y2="${bottom + 6}" class="tick-line"/><text x="${x(age)}" y="${bottom + 24}" text-anchor="middle" class="axis-label">${age}歳</text>`
  ).join('');
  const pensionMarker = config.pensionStartAge > config.currentAge && config.pensionStartAge < config.endAge
    ? `<line x1="${x(config.pensionStartAge)}" y1="${top}" x2="${x(config.pensionStartAge)}" y2="${bottom}" class="event-line"/><text x="${x(config.pensionStartAge) + 6}" y="${top + 13}" class="event-label">年金の受給開始</text>`
    : '';
  const hitPoints = annualFlows.map((year) =>
    `<circle class="chart-hit" data-age="${year.age}" cx="${x(year.age + 0.5)}" cy="${flowY(year.income)}" r="10"><title>${year.age}〜${year.age + 1}歳：収入 ${formatMan(year.income)}、支出 ${formatMan(year.spending)}、資産増減 ${formatMan(year.assetChange)}、年末残高 ${formatMan(year.closingBalance)}</title></circle>`
  ).join('');
  chart.innerHTML = `<title id="chart-title">年齢ごとの金融資産残高と年間収支</title><desc id="chart-desc">${config.currentAge}歳から${config.endAge}歳までを表示します。左軸は金融資産残高の折れ線、右軸は年ごとの収入、支出、資産増減の棒グラフです。両軸のゼロは同じ高さです。資産増減には運用損益を含みます。</desc><defs><linearGradient id="asset-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#93c59c" stop-opacity=".42"/><stop offset="100%" stop-color="#93c59c" stop-opacity=".02"/></linearGradient></defs>${grids}${flowTicks}${pensionMarker}<path d="${area}" fill="url(#asset-fill)"/>${flowBars}<path d="${balanceLine}" class="balance-line"/>${hitPoints}<g id="selected-mark">${selectedMarkMarkup(config, result, selectedAge)}</g><line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="axis-line"/><line x1="${right}" y1="${top}" x2="${right}" y2="${bottom}" class="axis-line"/>${ticks}<text x="${left}" y="18" class="axis-title">万円</text><text x="${right + 6}" y="14" class="axis-title">万円／年</text>`;
}

function renderAgeSelect(config) {
  ageSelect.replaceChildren();
  for (let age = config.currentAge; age < config.endAge; age += 1) {
    const option = document.createElement('option');
    option.value = age;
    option.textContent = `${age}歳`;
    ageSelect.append(option);
  }
  ageSelect.value = selectedAge;
}

function renderDetails(config, result) {
  const year = result.years.find((item) => item.age === selectedAge);
  if (!year) return;
  setText('#detail-title', `${year.age}歳の内訳`);
  setText('#detail-period', `${year.age}〜${year.age + 1}歳`);
  const grid = document.querySelector('#detail-grid');
  grid.replaceChildren();
  const activeStageIndex = config.spendingStages
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage }) => stage.age <= year.age)
    .sort((a, b) => a.stage.age - b.stage.age)
    .at(-1)?.index;
  const spendingReferences = [activeStageIndex === undefined ? 3 : 5 + activeStageIndex];
  const operatingGain = year.investmentGain;
  const balanceFlow = year.investmentGain + year.deposit - year.withdrawal;
  const makeItem = (label, value, references = [], emphasis = false) => {
    const cell = document.createElement('div');
    cell.className = `detail-item formula-item${emphasis ? ' detail-item-emphasis' : ''}`;
    const labelLine = document.createElement('div');
    labelLine.className = 'detail-label-line';
    const name = document.createElement('span');
    name.className = 'detail-label';
    name.textContent = label;
    labelLine.append(name);
    if (references.length) {
      const referenceList = document.createElement('span');
      referenceList.className = 'reference-inline';
      referenceList.setAttribute('aria-label', `条件 ${references.join('、')}`);
      referenceList.append('（');
      for (const number of references) {
        if (referenceList.childNodes.length > 1) referenceList.append('、');
        const reference = document.createElement('strong');
        reference.textContent = String(number);
        referenceList.append(reference);
      }
      referenceList.append('）');
      labelLine.append(referenceList);
    }
    const amount = document.createElement('strong');
    amount.textContent = formatMan(value);
    cell.append(labelLine, amount);
    return cell;
  };
  const addFormula = (container, items) => {
    const row = document.createElement('div');
    row.className = 'formula-row';
    items.forEach((item, index) => {
      if (index > 0) {
        const operator = document.createElement('span');
        operator.className = 'equation-operator';
        operator.textContent = item.operator;
        operator.setAttribute('aria-label', item.operator === '+' ? '足す' : item.operator === '−' ? '引く' : '等しい');
        row.append(operator);
      }
      row.append(makeItem(item.label, item.value, item.references, item.emphasis));
    });
    container.append(row);
  };
  const addSubpanel = (title, formulas) => {
    const subpanel = document.createElement('section');
    subpanel.className = 'detail-subpanel';
    const heading = document.createElement('h4');
    heading.textContent = title;
    subpanel.append(heading);
    for (const formula of formulas) addFormula(subpanel, formula);
    grid.append(subpanel);
  };
  const incomeAndReturn = year.salary + year.pension + operatingGain;
  const incomeFormula = [
    { label: '労働収入', value: year.salary, references: [1] },
    { label: '年金収入', value: year.pension, operator: '+', references: [2] },
    { label: '運用損益', value: operatingGain, operator: '+' },
    { label: '収入・運用益計', value: incomeAndReturn, operator: '=' },
  ];
  const cashflowFormula = [
    { label: '収入・運用益計', value: incomeAndReturn },
    { label: '支出', value: year.spending, operator: '−', references: spendingReferences },
  ];
  if (year.shortfall > 0.005) {
    cashflowFormula.push({ label: '不足額', value: year.shortfall, operator: '+' });
  }
  cashflowFormula.push({ label: '収支', value: balanceFlow, operator: '=', references: [4] });
  addSubpanel('収支', [incomeFormula, cashflowFormula]);
  addSubpanel('資産', [[
    { label: '年初残高', value: year.openingBalance },
    { label: '収支', value: balanceFlow, operator: '+', references: [4] },
    { label: '年末残高', value: year.closingBalance, operator: '=', emphasis: true },
  ]]);
}

function selectAge(age) {
  if (!latestConfig || !latestResult || !Number.isInteger(age) || age < latestConfig.currentAge || age >= latestConfig.endAge) return;
  selectedAge = age;
  ageSelect.value = age;
  renderChart(latestConfig, latestResult);
  renderDetails(latestConfig, latestResult);
}

function previewAge(age) {
  if (!latestConfig || !latestResult || !Number.isInteger(age) || age < latestConfig.currentAge || age >= latestConfig.endAge || age === selectedAge) return;
  selectedAge = age;
  ageSelect.value = age;
  const marker = chart.querySelector('#selected-mark');
  if (marker) marker.innerHTML = selectedMarkMarkup(latestConfig, latestResult, age);
  renderDetails(latestConfig, latestResult);
}

function update() {
  try {
    const config = readConfig();
    const result = simulate(config);
    latestConfig = config;
    latestResult = result;
    if (selectedAge === null || selectedAge < config.currentAge || selectedAge >= config.endAge) {
      selectedAge = Math.min(config.endAge - 1, Math.max(config.currentAge, 65));
    }
    errorElement.hidden = true;
    for (const button of downloadButtons) button.disabled = false;
    renderMetrics(result);
    renderAgeSelect(config);
    renderChart(config, result);
    renderDetails(config, result);
    saveConfig(config);
  } catch (error) {
    if (errorElement) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    }
    latestResult = null;
    for (const button of downloadButtons) button.disabled = true;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function exportCsv() {
  if (!latestResult) return;
  const headers = ['経過月', '年齢', '年齢内経過月', '月初の金融資産_円', '労働収入_円', '年金収入_円', '毎月の支出_円', '金融資産の運用損益_円', '金融資産への積立_円', '金融資産の取崩し_円', '不足額_円', '月末の金融資産_円'];
  const rows = latestResult.months.map((month) => [
    month.elapsedMonth, month.age, month.monthOfAge + 1,
    month.openingBalance, month.salary, month.pension, month.spending,
    month.investmentGain, month.deposit, month.withdrawal, month.shortfall, month.closingBalance,
  ].map((value) => Math.round(value)).join(','));
  const csv = `\ufeff${[headers.join(','), ...rows].join('\r\n')}\r\n`;
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'wimp-monthly-projection.csv');
}

async function exportPng() {
  if (!latestResult) return;
  const clone = chart.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '920');
  clone.setAttribute('height', '276');
  const styles = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  styles.textContent = '.grid-line{stroke:#dce6df;stroke-width:1}.zero-grid-line{stroke:#b3c5ba;stroke-width:1.3}.axis-line,.tick-line{stroke:#aabbb2;stroke-width:1}.axis-label,.axis-title{fill:#66776c;font:13px sans-serif}.event-line{stroke:#b1c8b6;stroke-dasharray:5 5}.event-label{fill:#577762;font:12px sans-serif}.selected-line{stroke:#647a69;stroke-dasharray:4 4}.selected-dot{fill:#fff;stroke:#17694d;stroke-width:3}.balance-line{fill:none;stroke:#17694d;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.income-bar{fill:#3c82ad;fill-opacity:.84}.spending-bar{fill:#ca8840;fill-opacity:.84}.asset-change-bar{fill:#8963a5;fill-opacity:.84}.chart-hit{fill:transparent}';
  clone.insertBefore(styles, clone.firstChild);
  const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  legend.innerHTML = '<line x1="100" y1="263" x2="116" y2="263" stroke="#17694d" stroke-width="4"/><text x="122" y="267" fill="#466656" font-size="11" font-family="sans-serif">金融資産残高</text><rect x="260" y="259" width="8" height="8" rx="2" fill="#3c82ad"/><text x="274" y="267" fill="#466656" font-size="11" font-family="sans-serif">収入</text><rect x="340" y="259" width="8" height="8" rx="2" fill="#ca8840"/><text x="354" y="267" fill="#466656" font-size="11" font-family="sans-serif">支出</text><rect x="420" y="259" width="8" height="8" rx="2" fill="#8963a5"/><text x="434" y="267" fill="#466656" font-size="11" font-family="sans-serif">資産増減</text>';
  clone.append(legend);
  const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1840;
    canvas.height = 552;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) throw new Error('PNGの生成に失敗しました。');
    downloadBlob(pngBlob, 'wimp-asset-projection.png');
  } catch {
    if (errorElement) {
      errorElement.textContent = 'PNG画像を作成できませんでした。';
      errorElement.hidden = false;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

populateForm(initialConfig());
update();
form.addEventListener('input', update);
document.querySelector('#add-stage').addEventListener('click', () => {
  const ages = [...stagesElement.querySelectorAll('.stage-age')].map((input) => Number(input.value)).filter(Number.isFinite);
  const currentAge = Number(form.elements.currentAge.value) || 45;
  const endAge = Number(form.elements.endAge.value) || 100;
  const preferredAge = Math.max(currentAge + 1, ...ages.map((age) => age + 5), 60);
  const candidates = Array.from({ length: Math.max(0, endAge - currentAge - 1) }, (_, index) => currentAge + index + 1)
    .filter((age) => !ages.includes(age));
  const nextAge = candidates.find((age) => age >= preferredAge) ?? candidates.at(-1);
  if (nextAge === undefined) {
    if (errorElement) {
      errorElement.textContent = '追加できる年齢がありません。登録済みの支出変化時の年齢を変更してください。';
      errorElement.hidden = false;
    }
    return;
  }
  const lastSpending = stagesElement.lastElementChild?.querySelector('.stage-spending')?.value;
  addStageRow({ age: nextAge, monthlySpending: (Number(lastSpending) || Number(form.elements.baseMonthlySpending.value) || 0) * 10000 });
  update();
});
stagesElement.addEventListener('click', (event) => {
  const button = event.target.closest('.remove-stage');
  if (!button) return;
  button.closest('.stage-row').remove();
  updateStageNumberBadges();
  update();
});
ageSelect.addEventListener('change', () => selectAge(Number(ageSelect.value)));
chart.addEventListener('click', (event) => {
  const point = event.target.closest('.chart-hit');
  if (point) selectAge(Number(point.dataset.age));
});
chart.addEventListener('pointermove', (event) => {
  const point = event.target.closest('.chart-hit');
  if (point) previewAge(Number(point.dataset.age));
});
document.querySelector('#download-csv').addEventListener('click', exportCsv);
document.querySelector('#download-png').addEventListener('click', exportPng);
