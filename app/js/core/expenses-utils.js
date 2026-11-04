(() => {
  "use strict";
  const CURRENCIES = Object.freeze(["BYN", "RUB", "USD", "EUR"]);
  const CATEGORY_COLORS = Object.freeze(["#78bda5", "#86aee8", "#c29ae0", "#e7b976", "#dc929b", "#86c2cc"]);
  const DEFAULT_CATEGORIES = Object.freeze([
    ...["Продукты", "Транспорт", "Жильё", "Здоровье", "Покупки", "Развлечения", "Подписки", "Работа", "Другое"].map((name, i) => Object.freeze({ id: `expense_category_${i + 1}`, name, kind: "expense", color: CATEGORY_COLORS[i % CATEGORY_COLORS.length], archived: false })),
    ...["Зарплата", "Подработка", "Продажи", "Подарки", "Другие доходы"].map((name, i) => Object.freeze({ id: `income_category_${i + 1}`, name, kind: "income", color: CATEGORY_COLORS[i % CATEGORY_COLORS.length], archived: false }))
  ]);
  const MAX_MINOR = 1000000000000, ID = /^[A-Za-z0-9_-]{1,220}$/;
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const fold = value => String(value || "").normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е");
  const text = (value, max) => typeof value === "string" && value.length <= max;
  const validId = value => typeof value === "string" && ID.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
  const validMinor = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_MINOR;
  function validExpenseDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number), date = new Date(Date.UTC(year, month - 1, day));
    return year >= 1900 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  function localExpenseDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function parseExpenseAmount(value) {
    const source = String(value ?? "").trim().replace(/[ \u00a0\u202f]/g, "");
    if (!/^\d{1,11}(?:[.,]\d{1,2})?$/.test(source)) return null;
    const [whole, fraction = ""] = source.replace(",", ".").split(".");
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return validMinor(minor) ? minor : null;
  }
  function expenseAmountInput(minor) { return `${Math.trunc(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, "0")}`; }
  function formatExpenseAmount(minor, currency) {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
  }
  function normalizeExpenses(value) {
    const source = object(value) ? clone(value) : {};
    return { ...source, currency: source.currency ?? "BYN", categories: source.categories ?? DEFAULT_CATEGORIES.map(item => ({ ...item })), entries: source.entries ?? [], budgets: source.budgets ?? [] };
  }
  function validateExpenses(value) {
    if (value == null) return;
    if (!object(value) || !CURRENCIES.includes(value.currency) || !["categories", "entries", "budgets"].every(key => Array.isArray(value[key]))) throw new Error("Расходы: некорректный формат данных.");
    if (value.categories.length > 200 || value.entries.length > 5000 || value.budgets.length > 5000) throw new Error("Расходы: превышен лимит (200 категорий, 5000 операций и лимитов).");
    const ids = new Set(), names = new Set(), categories = new Set(), entries = new Map(), refunds = new Map(), budgets = new Set();
    const identity = item => {
      if (!object(item) || !validId(item.id) || ids.has(item.id)) throw new Error("Расходы: некорректный или повторяющийся ID.");
      ids.add(item.id);
    };
    value.categories.forEach(item => {
      identity(item);
      if (!text(item.name, 100) || !item.name.trim() || !["expense", "income"].includes(item.kind) || names.has(`${item.kind}:${fold(item.name.trim())}`) || !CATEGORY_COLORS.includes(item.color) || typeof item.archived !== "boolean") throw new Error("Категория: уникальное название до 100 символов, вид операции и допустимый цвет.");
      names.add(`${item.kind}:${fold(item.name.trim())}`); categories.add(item.id);
    });
    value.entries.forEach(item => {
      identity(item);
      if (!validMinor(item.amountMinor)) throw new Error("Расходы: сумма должна быть от 0,01 до 10 000 000 000,00.");
      if (!CURRENCIES.includes(item.currency) || !validExpenseDate(item.date)) throw new Error("Расходы: проверьте валюту и дату.");
      if (!categories.has(item.categoryId) || !["expense", "income", "refund"].includes(item.kind) || value.categories.find(category => category.id === item.categoryId).kind !== (item.kind === "income" ? "income" : "expense")) throw new Error("Категория не соответствует виду операции.");
      if (!text(item.title, 300) || !text(item.notes, 4000) || !text(item.paymentMethod, 80) || !text(item.projectName, 500) || !(item.projectId === "" || validId(item.projectId))) throw new Error("Расходы: некорректный текст или ссылка на проект.");
      if (![item.createdAt, item.updatedAt].every(time => Number.isSafeInteger(time) && time >= 0)) throw new Error("Расходы: некорректная дата записи.");
      if (item.kind === "refund" ? !validId(item.originalEntryId) : item.originalEntryId !== "") throw new Error("Расходы: некорректная ссылка возврата.");
      entries.set(item.id, item);
    });
    value.entries.filter(item => item.kind === "refund").forEach(item => {
      const original = entries.get(item.originalEntryId);
      if (!original || original.kind !== "expense" || original.currency !== item.currency || original.categoryId !== item.categoryId || original.projectId !== item.projectId || item.date < original.date) throw new Error("Возврат: исходная покупка, дата, валюта, категория или проект не совпадают.");
      const total = (refunds.get(original.id) || 0) + item.amountMinor;
      if (total > original.amountMinor) throw new Error("Сумма возвратов превышает стоимость покупки.");
      refunds.set(original.id, total);
    });
    value.budgets.forEach(item => {
      if (!object(item) || typeof item.month !== "string" || !/^\d{4}-\d{2}$/.test(item.month) || !validExpenseDate(`${item.month}-01`) || !CURRENCIES.includes(item.currency) || !(item.categoryId === "" || value.categories.some(category => category.id === item.categoryId && category.kind === "expense")) || !validMinor(item.limitMinor)) throw new Error("Лимит: проверьте месяц, валюту, категорию расходов и сумму.");
      const key = `${item.month}:${item.currency}:${item.categoryId}`;
      if (budgets.has(key)) throw new Error("Лимит для этого месяца и категории уже существует.");
      budgets.add(key);
    });
  }
  function filterExpenses(data, filter = {}) {
    const categories = new Map(data.categories.map(item => [item.id, item.name]));
    const tokens = fold(filter.query).trim().split(/\s+/).filter(Boolean);
    return data.entries.filter(item => (!filter.currency || item.currency === filter.currency) && (!filter.month || item.date.slice(0, 7) === filter.month)
      && (!filter.from || item.date >= filter.from) && (!filter.to || item.date <= filter.to)
      && (!filter.categoryId || item.categoryId === filter.categoryId) && (!filter.kind || item.kind === filter.kind) && (filter.projectId == null || item.projectId === filter.projectId)
      && (!filter.paymentMethod || item.paymentMethod === filter.paymentMethod)
      && tokens.every(token => fold([item.title, item.notes, item.projectName, item.paymentMethod, categories.get(item.categoryId)].join("\n")).includes(token)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }
  function summarizeExpenses(data, filter) {
    if (!CURRENCIES.includes(filter?.currency)) throw new Error("Выберите одну валюту для итогов.");
    const entries = filterExpenses(data, filter), byCategory = new Map(), days = new Map();
    let spentMinor = 0, refundMinor = 0, incomeMinor = 0;
    entries.forEach(item => {
      const amount = item.kind === "refund" ? -item.amountMinor : item.amountMinor;
      if (item.kind === "refund") refundMinor += item.amountMinor; else if (item.kind === "income") incomeMinor += item.amountMinor; else spentMinor += item.amountMinor;
      byCategory.set(item.categoryId, (byCategory.get(item.categoryId) || 0) + amount);
      days.set(item.date, (days.get(item.date) || 0) + amount);
    });
    return { spentMinor, refundMinor, incomeMinor, netMinor: spentMinor - refundMinor, balanceMinor: incomeMinor - spentMinor + refundMinor, count: entries.length,
      categories: data.categories.filter(item => byCategory.has(item.id)).map(item => ({ ...item, amountMinor: byCategory.get(item.id) })).sort((a, b) => b.amountMinor - a.amountMinor),
      days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, amountMinor]) => ({ date, amountMinor })) };
  }
  function expensesCSVRows(data, filter = {}) {
    const safe = value => { const source = String(value ?? ""); return /^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(source) ? `'${source}` : source; };
    const categories = new Map(data.categories.map(item => [item.id, item.name]));
    return [["Дата", "Вид", "Название", "Категория", "Сумма", "Валюта", "Оплата", "Проект", "Комментарий", "ID", "ID покупки"],
      ...filterExpenses(data, filter).map(item => [item.date, item.kind === "refund" ? "Возврат" : item.kind === "income" ? "Доход" : "Расход", safe(item.title), safe(categories.get(item.categoryId)), expenseAmountInput(item.amountMinor), item.currency, safe(item.paymentMethod), safe(item.projectName), safe(item.notes), safe(item.id), safe(item.originalEntryId)])];
  }
  function createExpensesController(options) {
    let chain = Promise.resolve();
    const data = () => normalizeExpenses(options.getWorkspace()?.expenses);
    const find = (items, id) => { const item = items.find(row => row.id === id); if (!item) throw new Error("Запись уже удалена или недоступна."); return item; };
    function mutate(operation) {
      const workspace = options.getWorkspace();
      const execute = async write => {
        if (!workspace || options.getWorkspace() !== workspace) throw new Error("Рабочий стол недоступен. Откройте расходы заново.");
        const candidate = data(), baseline = JSON.stringify(workspace.expenses), result = operation(candidate, workspace);
        validateExpenses(candidate);
        const saved = await options.saveSnapshot(write, candidate);
        if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение расходов. Повторите попытку.");
        if (options.getWorkspace() !== workspace || JSON.stringify(workspace.expenses) !== baseline) throw new Error("Данные изменились во время сохранения. Откройте расходы заново и проверьте запись.");
        workspace.expenses = candidate;
        return result;
      };
      const transaction = () => options.persistTransaction(execute);
      const run = chain.catch(() => {}).then(() => options.queueMutation ? options.queueMutation(transaction) : transaction());
      chain = run.catch(() => {}); return run;
    }
    return Object.freeze({ data,
      saveEntry: (draft, editingId = "", originalEntry = null) => {
        const captured = clone(draft), original = originalEntry ? clone(originalEntry) : null;
        return mutate((candidate, workspace) => {
          const previous = editingId ? find(candidate.entries, editingId) : null;
          if (previous && original && JSON.stringify(previous) !== JSON.stringify(original)) throw new Error("Запись изменена в другом окне. Ввод сохранён в форме; откройте запись заново.");
          const amountMinor = parseExpenseAmount(captured.amount);
          if (amountMinor === null) throw new Error("Укажите сумму от 0,01 до 10 000 000 000,00, не больше двух знаков после запятой.");
          const kind = previous?.kind || captured.kind || "expense", originalEntryId = previous?.originalEntryId || (kind === "refund" ? captured.originalEntryId : "");
          if (!previous && kind !== "refund" && !candidate.categories.some(item => item.id === captured.categoryId && !item.archived && item.kind === (kind === "income" ? "income" : "expense"))) throw new Error("Категория уже скрыта или недоступна. Выберите доступную категорию или откройте форму заново.");
          const purchase = kind === "refund" ? find(candidate.entries, originalEntryId) : null;
          const projectId = purchase?.projectId ?? captured.projectId ?? "", project = workspace.taskProjects?.find(item => item.id === projectId);
          if (!purchase && projectId && !project && projectId !== previous?.projectId) throw new Error("Проект уже удалён или недоступен.");
          const now = Date.now(), entry = { ...(previous || {}), id: previous?.id || options.createId("expense"), kind, originalEntryId, amountMinor,
            currency: purchase?.currency || captured.currency, date: captured.date, categoryId: purchase?.categoryId || captured.categoryId,
            title: String(captured.title || "").trim(), notes: String(captured.notes || ""), paymentMethod: String(captured.paymentMethod || "").trim(),
            projectId, projectName: projectId ? purchase?.projectName || project?.name || previous?.projectName || "" : "", createdAt: previous?.createdAt ?? now, updatedAt: now };
          if (previous) candidate.entries[candidate.entries.indexOf(previous)] = entry; else candidate.entries.push(entry);
          return entry;
        });
      },
      removeEntry: (id, originalEntry = null) => mutate(candidate => {
        const item = find(candidate.entries, id);
        if (originalEntry && JSON.stringify(item) !== JSON.stringify(originalEntry)) throw new Error("Запись изменена в другом окне. Откройте её заново.");
        if (candidate.entries.some(row => row.originalEntryId === id)) throw new Error("У покупки есть возвраты. Сначала удалите связанные возвраты.");
        candidate.entries = candidate.entries.filter(row => row.id !== id);
      }),
      saveCategory: (draft, id = "", originalCategory = null) => mutate(candidate => {
        const previous = id ? find(candidate.categories, id) : null;
        if (previous && originalCategory && JSON.stringify(previous) !== JSON.stringify(originalCategory)) throw new Error("Категория изменена в другом окне. Откройте её заново.");
        const item = { ...(previous || {}), id: previous?.id || options.createId("expensecategory"), name: String(draft.name || "").trim(), kind: previous?.kind || draft.kind || "expense", color: draft.color || CATEGORY_COLORS[0], archived: Boolean(draft.archived) };
        if (previous) candidate.categories[candidate.categories.indexOf(previous)] = item; else candidate.categories.push(item);
        return item;
      }),
      setBudget: (draft, expectedBudget = undefined) => {
        const captured = clone(draft), expected = expectedBudget === undefined ? undefined : clone(expectedBudget);
        return mutate(candidate => {
          const matches = item => item.month === captured.month && item.currency === captured.currency && item.categoryId === captured.categoryId;
          const current = candidate.budgets.find(matches) || null;
          if (expected !== undefined && JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("Лимит изменился после открытия формы. Ввод сохранён; закройте форму и откройте лимит заново.");
          const amount = String(captured.amount ?? "").trim(), limitMinor = amount ? parseExpenseAmount(amount) : 0;
          if (limitMinor === null) throw new Error("Укажите положительную сумму лимита или оставьте поле пустым, чтобы убрать лимит.");
          candidate.budgets = candidate.budgets.filter(item => !matches(item));
          if (limitMinor) candidate.budgets.push({ month: captured.month, currency: captured.currency, categoryId: captured.categoryId, limitMinor });
        });
      },
      copyBudgets: draft => {
        const captured = clone(draft);
        return mutate(candidate => {
          const { fromMonth, toMonth, currency, replaceExisting, expectedBudgets } = captured;
          if (![fromMonth, toMonth].every(value => typeof value === "string" && /^\d{4}-\d{2}$/.test(value) && validExpenseDate(`${value}-01`)) || fromMonth === toMonth || !CURRENCIES.includes(currency)) throw new Error("Копирование лимитов: проверьте месяцы и валюту.");
          const current = candidate.budgets.filter(item => item.currency === currency && [fromMonth, toMonth].includes(item.month));
          if (!Array.isArray(expectedBudgets) || JSON.stringify(current) !== JSON.stringify(expectedBudgets)) throw new Error("Лимиты изменились после открытия предпросмотра. Закройте форму и откройте копирование заново.");
          const source = current.filter(item => item.month === fromMonth);
          if (!source.length) throw new Error("В исходном месяце нет лимитов для этой валюты.");
          let copied = 0, skipped = 0;
          source.forEach(item => {
            const index = candidate.budgets.findIndex(row => row.month === toMonth && row.currency === currency && row.categoryId === item.categoryId);
            if (index >= 0 && replaceExisting !== true) { skipped++; return; }
            const next = { ...item, month: toMonth };
            if (index >= 0) candidate.budgets[index] = next; else candidate.budgets.push(next);
            copied++;
          });
          return { copied, skipped };
        });
      },
      setCurrency: currency => mutate(candidate => { candidate.currency = currency; })
    });
  }
  window.ZETER_EXPENSES_UTILS = Object.freeze({ CURRENCIES, CATEGORY_COLORS, normalizeExpenses, validateExpenses, validExpenseDate, localExpenseDate, parseExpenseAmount, expenseAmountInput, formatExpenseAmount, filterExpenses, summarizeExpenses, expensesCSVRows, createExpensesController });
})();
