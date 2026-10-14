(() => {
  "use strict";
  // Formula source: BizPilot renderCalculators. No business records are imported.
  const field = (key, label, value, unit = "money", max = null) => Object.freeze({ key, label, value: String(value), unit, max });
  const CALCULATIONS = Object.freeze([
    { id: "margin", title: "Маржа и наценка", category: "Продажи", icon: "%", description: "Прибыль с продажи и её доля в цене и затратах.", fields: [field("cost", "Прямые затраты на продажу", 700), field("price", "Цена продажи", 1200)] },
    { id: "breakeven", title: "Точка безубыточности", category: "Планирование", icon: "◎", description: "Сколько продаж нужно, чтобы покрыть постоянные расходы.", fields: [field("fixed", "Постоянные расходы", 4000), field("price", "Цена единицы", 500), field("variable", "Переменные расходы на единицу", 180)] },
    { id: "hourly", title: "Минимальная ставка часа", category: "Цена услуги", icon: "◷", description: "Ставка с учётом дохода, расходов и налогового резерва.", fields: [field("income", "Желаемый доход в месяц", 5000), field("costs", "Расходы бизнеса в месяц", 1500), field("tax", "Налог / резерв", 6, "%", 99), field("hours", "Оплачиваемых часов в месяц", 100, "ч.")] },
    { id: "discount", title: "Скидка от цены продажи", category: "Продажи", icon: "−%", description: "Цена и прибыль после скидки для клиента.", fields: [field("price", "Исходная цена для клиента", 1500), field("rate", "Скидка", 10, "%", 100), field("cost", "Прямые затраты на продажу", 700)] },
    { id: "roi", title: "Окупаемость рекламы (ROI)", category: "Маркетинг", icon: "↗", description: "Прибыль от рекламы после прямых затрат и рекламного бюджета.", fields: [field("spend", "Расходы на рекламу", 800), field("revenue", "Выручка от рекламы", 3200), field("cost", "Прямые затраты", 1200)] },
    { id: "ltv", title: "Стоимость клиента и LTV", category: "Клиенты", icon: "↔", description: "Стоимость привлечения и выручка от покупок одного клиента.", fields: [field("marketing", "Расходы на привлечение", 1500), field("clients", "Новых клиентов", 10, "чел."), field("average", "Средний чек", 1200), field("purchases", "Покупок на клиента", 3, "шт.")] },
    { id: "plan", title: "План продаж", category: "Планирование", icon: "▤", description: "Заказы в месяц и неделю, дневная цель по выручке.", fields: [field("revenue", "Цель по выручке за месяц", 20000), field("average", "Средний чек", 1500), field("days", "Рабочих дней", 22, "дн.")] },
    { id: "runway", title: "Финансовая подушка", category: "Финансы", icon: "◈", description: "На сколько месяцев хватит денег и какой резерв нужен.", fields: [field("cash", "Денежный резерв", 12000), field("costs", "Расходы в месяц", 3500), field("target", "Целевой запас месяцев", 6, "мес.")] },
    { id: "acquiring", title: "Комиссия эквайринга", category: "Банковские расходы", icon: "▣", description: "Комиссия за платёж, полученная сумма и эффективная ставка.", fields: [field("amount", "Сумма платежа", 2000), field("rate", "Ставка эквайринга", 2.5, "%", 100), field("fixed", "Фиксированная комиссия", 0)] },
    { id: "rko", title: "Стоимость РКО", category: "Банковские расходы", icon: "₽", description: "Расчётно-кассовое обслуживание за месяц и год.", fields: [field("turnover", "Оборот в месяц", 20000), field("monthlyFee", "Абонентская плата в месяц", 35), field("payments", "Платежей в месяц", 20, "шт."), field("paymentFee", "Стоимость одного платежа", 1.5), field("otherFees", "Прочие комиссии в месяц", 10)] }
  ].map(item => Object.freeze({ ...item, fields: Object.freeze(item.fields) })));
  const CURRENCIES = Object.freeze(["BYN", "RUB", "USD", "EUR"]);
  const DEFAULT_SELECTED = Object.freeze(["margin", "breakeven", "hourly", "discount"]);
  const definition = id => CALCULATIONS.find(item => item.id === id);
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const validSize = size => object(size) && Number.isInteger(size.width) && size.width >= 280 && size.width <= 2400 && Number.isInteger(size.height) && size.height >= 240 && size.height <= 2000 && [1, 2].includes(size.span);
  function normalizeBusinessCalculations(value = {}) {
    const source = object(value) ? value : {};
    return {
      currency: CURRENCIES.includes(source.currency) ? source.currency : "BYN",
      selected: Array.isArray(source.selected) ? [...new Set(source.selected.filter(id => definition(id)))] : [...DEFAULT_SELECTED],
      sizes: Object.fromEntries(CALCULATIONS.filter(item => validSize(source.sizes?.[item.id])).map(item => [item.id, { width: source.sizes[item.id].width, height: source.sizes[item.id].height, span: source.sizes[item.id].span }])),
      inputs: Object.fromEntries(CALCULATIONS.map(item => [item.id, Object.fromEntries(item.fields.map(entry => {
        const raw = source.inputs?.[item.id]?.[entry.key];
        return [entry.key, typeof raw === "string" ? raw.slice(0, 48) : entry.value];
      }))]))
    };
  }
  function validateBusinessCalculations(value) {
    if (!object(value) || !CURRENCIES.includes(value.currency) || !Array.isArray(value.selected) || value.selected.length > CALCULATIONS.length || !object(value.inputs)) throw new Error("Подсчёты: некорректный формат данных.");
    if (value.sizes != null && (!object(value.sizes) || Object.entries(value.sizes).some(([id, size]) => !definition(id) || !validSize(size)))) throw new Error("Подсчёты: некорректный размер карточки.");
    const seen = new Set();
    value.selected.forEach(id => {
      if (!definition(id)) throw new Error("Подсчёты: неизвестная карточка.");
      if (seen.has(id)) throw new Error("Подсчёты: повтор карточки.");
      seen.add(id);
    });
    if (Object.keys(value.inputs).some(id => !definition(id))) throw new Error("Подсчёты: неизвестный набор полей.");
    CALCULATIONS.forEach(item => {
      const fields = value.inputs[item.id];
      if (!object(fields) || Object.keys(fields).some(key => !item.fields.some(entry => entry.key === key))) throw new Error("Подсчёты: некорректный набор полей.");
      item.fields.forEach(entry => { if (typeof fields[entry.key] !== "string" || fields[entry.key].length > 48) throw new Error("Подсчёты: некорректное значение поля."); });
    });
  }
  function parseCalculationNumber(value, entry) {
    const text = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
    if (!text || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) && number >= 0 && number <= 1e15 && (entry.max == null || number <= entry.max) ? number : null;
  }
  function calculateBusinessValues(id, inputs = {}) {
    const item = definition(id);
    if (!item) throw new Error("Неизвестный подсчёт.");
    const numbers = Object.fromEntries(item.fields.map(entry => [entry.key, parseCalculationNumber(inputs[entry.key], entry)]));
    const invalid = item.fields.filter(entry => numbers[entry.key] === null).map(entry => entry.key);
    const n = numbers, metrics = [], bars = [];
    const metric = (key, label, value, unit = "money") => metrics.push({ key, label, value: invalid.length || !Number.isFinite(value) ? null : value, unit });
    const bar = (label, value) => bars.push({ label, value: invalid.length || !Number.isFinite(value) ? null : value });
    let note = "";
    if (id === "margin") {
      const profit = n.price - n.cost;
      metric("profit", "Прибыль", profit); metric("margin", "Маржа", n.price > 0 ? profit / n.price * 100 : null, "%"); metric("markup", "Наценка", n.cost > 0 ? profit / n.cost * 100 : null, "%");
      bar("Цена", n.price); bar("Затраты", n.cost); bar("Прибыль", profit);
      if (n.price === 0 || n.cost === 0) note = "При нулевой цене или затратах соответствующий процент не рассчитывается.";
    } else if (id === "breakeven") {
      const contribution = n.price - n.variable, units = contribution > 0 ? Math.ceil(n.fixed / contribution) : null;
      metric("units", "Нужно продаж", units, "шт."); metric("revenue", "Выручка для нуля", units === null ? null : units * n.price); metric("contribution", "Вклад с продажи", contribution > 0 ? contribution : null);
      bar("Постоянные расходы", n.fixed); bar("Выручка для нуля", units === null ? null : units * n.price);
      if (contribution <= 0) note = "Цена единицы должна быть выше переменных расходов: иначе продажи не покрывают постоянные расходы.";
    } else if (id === "hourly") {
      const revenue = (n.income + n.costs) / (1 - n.tax / 100), hourly = n.hours > 0 ? revenue / n.hours : null;
      metric("revenue", "Нужная выручка в месяц", revenue); metric("hourly", "Минимум за час", hourly); metric("safe", "С запасом 20%", hourly === null ? null : hourly * 1.2);
      if (n.hours === 0) note = "Укажите больше нуля оплачиваемых часов.";
    } else if (id === "discount") {
      const amount = n.price * n.rate / 100, final = n.price - amount;
      metric("amount", "Сумма скидки", amount); metric("final", "Цена после скидки", final); metric("profit", "Прибыль после скидки", final - n.cost);
      bar("Исходная цена", n.price); bar("После скидки", final); bar("Затраты", n.cost);
    } else if (id === "roi") {
      const gross = n.revenue - n.cost, net = gross - n.spend;
      metric("gross", "Валовая прибыль", gross); metric("net", "После затрат на рекламу", net); metric("roi", "ROI рекламы", n.spend > 0 ? net / n.spend * 100 : null, "%");
      if (n.spend === 0) note = "ROI не рассчитывается без расходов на рекламу.";
    } else if (id === "ltv") {
      const cac = n.clients > 0 ? n.marketing / n.clients : null, ltv = n.average * n.purchases;
      metric("cac", "Стоимость привлечения (CAC)", cac); metric("ltv", "Выручка с клиента (LTV)", ltv); metric("ratio", "LTV / CAC", cac > 0 ? ltv / cac : null, "×");
      note = "LTV здесь — выручка от покупок клиента; себестоимость и маржа в неё не входят.";
    } else if (id === "plan") {
      const orders = n.average > 0 ? Math.ceil(n.revenue / n.average) : null;
      metric("orders", "Заказов в месяц", orders, "шт."); metric("daily", "Выручка в рабочий день", n.days > 0 ? n.revenue / n.days : null); metric("weekly", "Заказов в неделю", orders === null ? null : orders / 4.33, "шт./нед.");
      note = "Месячные заказы округляются вверх. В недельном плане — 4,33 недели в месяце.";
    } else if (id === "runway") {
      const needed = n.costs * n.target;
      metric("months", "Хватит на", n.costs > 0 ? n.cash / n.costs : null, "мес."); metric("needed", "Нужный резерв", needed); metric("gap", "Запас / нехватка", n.cash - needed);
      if (n.costs === 0) note = "При нулевых расходах срок денежного резерва не рассчитывается.";
    } else if (id === "acquiring") {
      const fee = n.amount * n.rate / 100 + n.fixed;
      metric("fee", "Комиссия", fee); metric("net", "Получите", Math.max(0, n.amount - fee)); metric("effective", "Эффективная ставка", n.amount > 0 ? fee / n.amount * 100 : null, "%");
    } else if (id === "rko") {
      const total = n.monthlyFee + n.payments * n.paymentFee + n.otherFees;
      metric("total", "Стоимость в месяц", total); metric("annual", "Стоимость в год", total * 12); metric("effective", "Доля в обороте", n.turnover > 0 ? total / n.turnover * 100 : null, "%");
    }
    if (invalid.length) note = "Заполните поля неотрицательными числами. Проценты — в указанном диапазоне; значения — не больше 1 000 000 000 000 000.";
    return { metrics, bars, note, invalid };
  }
  function createBusinessCalculationsController(options) {
    let chain = Promise.resolve();
    const data = () => normalizeBusinessCalculations(options.getWorkspace()?.calculations);
    function mutate(operation) {
      const workspace = options.getWorkspace();
      const execute = async write => {
        if (!workspace || options.getWorkspace() !== workspace) throw new Error("Рабочий стол недоступен. Откройте приложение заново.");
        const candidate = normalizeBusinessCalculations(workspace.calculations);
        operation(candidate); validateBusinessCalculations(candidate);
        const saved = await options.saveSnapshot(write, candidate);
        if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение подсчётов.");
        workspace.calculations = candidate;
      };
      const run = chain.then(() => options.persistTransaction(execute));
      chain = run.catch(() => {}); return run;
    }
    const requireId = id => { if (!definition(id)) throw new Error("Неизвестный подсчёт."); };
    return Object.freeze({ data,
      add: id => mutate(candidate => { requireId(id); if (!candidate.selected.includes(id)) candidate.selected.push(id); }),
      remove: id => mutate(candidate => { requireId(id); candidate.selected = candidate.selected.filter(item => item !== id); }),
      reorder: (id, targetId, placement = "before") => mutate(candidate => {
        if (!candidate.selected.includes(id) || !candidate.selected.includes(targetId) || !["before", "after"].includes(placement)) throw new Error("Карточка для перемещения недоступна.");
        if (id === targetId) return;
        const order = candidate.selected.filter(item => item !== id), index = order.indexOf(targetId);
        order.splice(index + (placement === "after" ? 1 : 0), 0, id); candidate.selected = order;
      }),
      moveTo: (id, targetId) => mutate(candidate => {
        const sourceIndex = candidate.selected.indexOf(id), targetIndex = candidate.selected.indexOf(targetId);
        if (sourceIndex < 0 || targetIndex < 0) throw new Error("Карточка для перемещения недоступна.");
        if (sourceIndex === targetIndex) return;
        // Use the target's position before removal, in either direction.
        candidate.selected.splice(sourceIndex, 1);
        candidate.selected.splice(targetIndex, 0, id);
      }),
      setInput: (id, key, value) => mutate(candidate => {
        if (!definition(id)?.fields.some(entry => entry.key === key)) throw new Error("Неизвестное поле подсчёта.");
        if (typeof value !== "string" || value.length > 48) throw new Error("Слишком длинное значение.");
        candidate.inputs[id][key] = value;
      }),
      setCurrency: currency => mutate(candidate => { if (!CURRENCIES.includes(currency)) throw new Error("Неизвестная валюта."); candidate.currency = currency; }),
      setSize: (id, size) => mutate(candidate => { requireId(id); if (!validSize(size)) throw new Error("Некорректный размер карточки."); candidate.sizes[id] = { width: size.width, height: size.height, span: size.span }; }),
      resetSize: id => mutate(candidate => { requireId(id); delete candidate.sizes[id]; })
    });
  }
  window.ZETER_BUSINESS_CALCULATIONS_UTILS = Object.freeze({ CALCULATIONS, CURRENCIES, normalizeBusinessCalculations, validateBusinessCalculations, parseCalculationNumber, calculateBusinessValues, createBusinessCalculationsController });
})();
