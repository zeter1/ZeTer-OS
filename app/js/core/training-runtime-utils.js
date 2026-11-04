(() => {
  "use strict";

  const active = location.href === "about:srcdoc"
    && window.parent !== window
    && document.documentElement.dataset.zeterTraining === "true";
  const shell = active ? "" : document.querySelector("#os").outerHTML;
  const boot = active ? "" : document.querySelector("#boot").outerHTML;
  const assets = active ? [] : [...document.querySelectorAll('script[type="application/zeter-script"][src]')].map(node => new URL(node.getAttribute("src"), document.baseURI).href);
  const stylesheet = active ? "" : new URL("css/style.css", document.baseURI).href;
  const records = new Map();
  let seeded = false;
  let resetWorkspace;
  let editingFocus = false;

  function registerWorkspace(reset) {
    if (!active || typeof reset !== "function") throw new Error("Учебное пространство недоступно.");
    resetWorkspace = reset;
  }

  function resetSeed(state) {
    if (!active) throw new Error("Учебное пространство недоступно.");
    records.clear();
    seeded = false;
    seed(state);
  }

  function memoryStorage() {
    const values = new Map();
    return {
      get length() { return values.size; },
      key: index => [...values.keys()][index] ?? null,
      getItem: key => values.get(String(key)) ?? null,
      setItem: (key, value) => { values.set(String(key), String(value)); },
      removeItem: key => { values.delete(String(key)); },
      clear: () => values.clear()
    };
  }

  function seed(state) {
    if (!active) throw new Error("Учебное состояние доступно только внутри урока.");
    if (seeded) return;
    state.firstRunCompleted = true;
    state.desktops.push({id:"training_projects", name:"Мои проекты"});
    const item = (id, type, name, parent, x, y, extra = {}) => {
      state.fs[id] = {id, type, name, parent, x, y, createdAt:Date.now(), updatedAt:Date.now(), ...extra};
    };
    item("training_note", "note", "Идеи на неделю", "desktop", 600, 130, {content:"Подготовить план проекта", richContent:"<p>Подготовить план проекта</p>"});
    item("training_folder", "folder", "Мои проекты", "desktop", 600, 260);
    item("training_file", "note", "План проекта", "training_folder", 40, 70, {content:"Первый шаг", richContent:"<p>Первый шаг</p>"});
    item("training_other", "note", "Заметки проекта", "training_projects", 40, 70, {content:"Отдельное пространство", richContent:"<p>Отдельное пространство</p>"});
    delete state.fs.app_calculator;
    state.notifications = [{id:"training_notification", title:"Встреча команды", text:"Календарь · встреча через 5 минут", read:false, createdAt:Date.now(), source:"calendar:training_example", type:"calendar"}];
    records.set("zeter-os-primary-state/osState/current", {id:"current", state, updatedAt:Date.now()});
    seeded = true;
  }

  function readRecord(db, store, key) {
    if (!active) throw new Error("Учебное хранилище недоступно.");
    if (!seeded) throw new Error("Учебное состояние ещё не подготовлено.");
    const value = records.get(`${db}/${store}/${key}`);
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function readRecords(db, store) {
    if (!active) throw new Error("Учебное хранилище недоступно.");
    const prefix = `${db}/${store}/`;
    return [...records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => JSON.parse(JSON.stringify(value)));
  }

  function writeRecord(db, store, value, key = value.id) {
    if (!active) throw new Error("Учебное хранилище недоступно.");
    records.set(`${db}/${store}/${key}`, JSON.parse(JSON.stringify(value)));
    return value;
  }

  function createFrame(token) {
    if (active) throw new Error("Повторный запуск учебной среды запрещён.");
    const frame = document.createElement("iframe");
    frame.className = "first-run-live-desktop";
    frame.title = "Учебный рабочий стол ZeTer OS";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;

    const escape = text => String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
    const sources = assets.map(src => `<script type="application/zeter-script" src="${escape(src)}"></script>`).join("");
    const runtime = assets.find(src => src.endsWith("/training-runtime-utils.js"));
    frame.srcdoc = `<!doctype html><html lang="ru" data-zeter-training="true" data-training-token="${escape(token)}"><head><meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'none'">
      <link rel="stylesheet" href="${escape(stylesheet)}"></head><body>${boot}${shell}${sources}<script src="${escape(runtime)}"></script></body></html>`;
    return frame;
  }

  async function runLesson(id, manual, signal, runId) {
    document.body.classList.toggle("zeter-reduced-motion", manual);
    const token = document.documentElement.dataset.trainingToken;
    const report = (type, extra = {}) => parent.postMessage({channel:"zeter-training", token, runId, type, ...extra}, "*");
    const delay = ms => new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const stop = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
      signal.addEventListener("abort", stop, {once:true});
    });
    const until = async condition => {
      const end = Date.now() + 10000;
      while (!condition()) {
        if (Date.now() > end) throw new Error("Результат действия не подтверждён.");
        await delay(40);
      }
    };
    const saved = () => readRecord("zeter-os-primary-state", "osState", "current").state;
    const visible = node => node && node.getClientRects().length && getComputedStyle(node).visibility !== "hidden"
      && !node.closest(".hidden, [hidden], .window.minimized");
    async function find(selector) {
      const end = Date.now() + 8000;
      do {
        const node = [...document.querySelectorAll(selector)].find(visible);
        if (node) return node;
        await delay(40);
      } while (Date.now() < end);
      throw new Error("Не найден элемент текущего действия.");
    }
    const byText = async (selector, text) => {
      await find(selector);
      const node = [...document.querySelectorAll(selector)].find(el => visible(el) && el.textContent.includes(text));
      if (!node) throw new Error("Действие недоступно в текущем интерфейсе.");
      return node;
    };
    let selectionOrigin, createdNoteId, activePointer = null;
    const cursor = document.createElement("div");
    cursor.className = "training-human-cursor";
    cursor.setAttribute("aria-hidden", "true");
    document.body.append(cursor);
    const move = async node => {
      node.scrollIntoView({block:"nearest", inline:"nearest"});
      const rect = node.getBoundingClientRect();
      report("pointer",{x:rect.left+Math.min(rect.width/2,80),y:rect.top+Math.min(rect.height/2,20)});
      cursor.style.left = `${rect.left + Math.min(rect.width / 2, 80)}px`;
      cursor.style.top = `${rect.top + Math.min(rect.height / 2, 20)}px`;
      await delay(manual ? 0 : 500);
      cursor.classList.remove("is-clicking");
      void cursor.offsetWidth;
      cursor.classList.add("is-clicking");
    };
    const click = async selector => {
      const el = typeof selector === "string" ? await find(selector) : selector;
      await move(el);
      signal.throwIfAborted();
      el.click();
    };
    const type = async (selector, value) => {
      const el = await find(selector);
      await move(el);
      editingFocus = true;
      el.focus();
      try {
      const apply = text => {
        if (el.isContentEditable) el.replaceChildren(...text.split("\n").map(line => {
          const paragraph = document.createElement("p");
          paragraph.textContent = line || "\u200b";
          return paragraph;
        }));
        else el.value = text;
        el.dispatchEvent(new Event("input", {bubbles:true}));
      };
      apply("");
      for (let n = 1; n <= value.length; n++) {
        apply(value.slice(0, n));
        if (!manual) await delay(65);
      }
      el.dispatchEvent(new Event("change", {bubbles:true}));
      } finally { editingFocus = false; report("focus"); }
    };
    const setValue = async (selector, value) => {
      const el = await find(selector);
      await move(el);
      signal.throwIfAborted();
      el.value = value;
      el.dispatchEvent(new Event("input",{bubbles:true}));
      el.dispatchEvent(new Event("change",{bubbles:true}));
    };
    const selectText = async text => {
      const area = await find(".rich-editor-area");
      editingFocus = true;
      area.focus();
      const offset = area.textContent.indexOf(text);
      if (offset < 0) throw new Error("Текст для выделения не найден.");
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
      let node, total = 0, startNode, startOffset, endNode, endOffset;
      while ((node = walker.nextNode())) {
        if (!startNode && total + node.length > offset) { startNode = node; startOffset = offset - total; }
        if (total + node.length >= offset + text.length) { endNode = node; endOffset = offset + text.length - total; break; }
        total += node.length;
      }
      const range = document.createRange();
      range.setStart(startNode,startOffset);
      range.setEnd(endNode,endOffset);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      area.dispatchEvent(new KeyboardEvent("keyup",{bubbles:true,key:"Shift"}));
      await find('[data-formatting-toolbar]:not([hidden])');
      await delay(manual ? 0 : 850);
    };
    const formatText = async (text, command) => {
      try {
        await selectText(text);
        await click(`[data-format="${command}"]`);
        await delay(manual ? 300 : 900);
      } finally { editingFocus = false; report("focus"); }
    };
    const closeEditor = async () => {
      await click('.window[data-app-id="editor"]:not(.minimized) [data-win="close"]');
      await until(() => !visible(document.querySelector('.window[data-app-id="editor"]')));
    };
    const rightClickNote = async () => {
      const el = await find('.desktop-icon[data-item-id="training_note"]');
      await move(el);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:r.left+20,clientY:r.top+20}));
    };
    const chooseIcon = async (id, ctrlKey = false) => {
      const el = await find(`.desktop-icon[data-item-id="${id}"]`);
      await move(el);
      el.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1,ctrlKey}));
    };
    const open = async action => {
      const button = document.querySelector(`#top-menu [data-top-action="${action}"]`);
      if (!visible(button)) await click("#mobile-menu-button");
      await click(`#top-menu [data-top-action="${action}"]`);
    };
    const openNote = async () => {
      const icon = await find('.desktop-icon[data-item-id="training_note"]');
      await move(icon);
      icon.dispatchEvent(new MouseEvent("dblclick", {bubbles:true}));
      await find(".rich-editor-area");
    };
    const start = async () => {
      if (!visible(document.querySelector("#start-menu"))) await click("#start-button");
    };
    const quick = async kind => { await start(); await click(`[data-start-quick="${kind}"]`); };
    try {
    const noteText = "Идеи на неделю.\nПодготовить план проекта.\nВстреча команды в среду.\nПроверить задачи и сохранить копию.";
    const steps = {
      start: [
        ["Открываем меню «Пуск» и смотрим быстрые действия.", start],
        ["Выбираем «Создать заметку».", () => click('[data-start-quick="note"]')],
        ["Даём новой заметке понятное название.", () => type(".window.active .editor-title","Мой первый план")],
        ["Печатаем небольшой план из двух строк.", () => type(".rich-editor-area","Мой первый день в ZeTer OS.\nСобрать идеи и выбрать задачи на неделю.")],
        ["Выделяем заголовок и делаем его жирным.", () => formatText("Мой первый день","bold")],
        ["Дожидаемся автосохранения и закрываем окно.", async () => {
          await until(() => Object.values(saved().fs).some(item => item.name === "Мой первый план" && /<(b|strong)\b/.test(item.richContent || "")));
          createdNoteId = Object.values(saved().fs).find(item => item.name === "Мой первый план").id;
          await closeEditor();
        }],
        ["Снова открываем сохранённую заметку со стола.", async () => {
          const el = await find(`.desktop-icon[data-item-id="${createdNoteId}"]`);
          await move(el); el.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
          await find(".rich-editor-area b, .rich-editor-area strong");
        }]
      ],
      search: [
        ["Открываем поиск по ОС.", () => open("search")],
        ["Вводим часть названия: «Идеи».", () => type(".global-search-input input","Идеи")],
        ["Выбираем результат и смотрим предпросмотр.", async () => click(await byText(".search-result","Идеи на неделю"))],
        ["Уточняем запрос полным названием заметки.", () => type(".global-search-input input","Идеи на неделю")],
        ["Ещё раз выбираем нужную запись.", async () => click(await byText(".search-result","Идеи на неделю"))],
        ["Нажимаем «Открыть» в предпросмотре.", () => click('[data-search-action="open"]')],
        ["Читаем найденную заметку в редакторе.", () => find(".rich-editor-area")]
      ],
      notifications: [
        ["Нажимаем колокольчик.", () => click("#notifications-button")],
        ["Выбираем категорию «Календарь».", () => click('[data-notification-filter="calendar"]')],
        ["Смотрим напоминание о встрече.", async () => byText("#notification-list","Встреча команды")],
        ["Отмечаем напоминание прочитанным.", () => click("[data-mark-all-notifications-read]")],
        ["Переключаемся на системные сообщения.", () => click('[data-notification-filter="system"]')],
        ["Возвращаемся ко всем уведомлениям.", () => click('[data-notification-filter="all"]')]
      ],
      note: [
        ["Создаём новую заметку через меню «Пуск».", () => quick("note")],
        ["Называем заметку «План недели».", () => type(".window.active .editor-title","План недели")],
        ["Печатаем план из четырёх абзацев.", () => type(".rich-editor-area",noteText)],
        ["Выделяем заголовок и включаем жирный шрифт.", () => formatText("Идеи на неделю.","bold")],
        ["Выделяем важное дело и включаем курсив.", () => formatText("Подготовить план проекта.","italic")],
        ["Подчёркиваем строку о встрече.", () => formatText("Встреча команды","underline")],
        ["Увеличиваем размер заголовка.", async () => {
          try { await selectText("Идеи на неделю."); await setValue("[data-font-size]","24"); }
          finally { editingFocus = false; report("focus"); }
        }],
        ["Дожидаемся сохранения текста и оформления.", async () => until(() => {
          const note = Object.values(saved().fs).find(item => item.name === "План недели");
          return note && /<(b|strong)\b/.test(note.richContent) && /<(i|em)\b/.test(note.richContent) && /<u\b|text-decoration/.test(note.richContent) && /24px/.test(note.richContent);
        })],
        ["Закрываем заметку: материал остаётся на столе.", closeEditor]
      ],
      desktops: [
        ["Открываем список рабочих столов.", start],
        ["Выбираем стол «Мои проекты».", () => click('[data-switch-desktop="training_projects"]')],
        ["Открываем материал выбранного проекта.", async () => {
          const el=await find('.desktop-icon[data-item-id="training_other"]'); await move(el);
          el.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
        }],
        ["Закрываем редактор, сохраняя материал.", closeEditor],
        ["Снова открываем список столов.", start],
        ["Возвращаемся на «Основной».", () => click('[data-switch-desktop="desktop"]')],
        ["Переключаемся обратно на «Мои проекты».", async () => { await start(); await click('[data-switch-desktop="training_projects"]'); }]
      ],
      catalog: [
        ["Открываем каталог приложений.", () => open("appcenter")],
        ["Устанавливаем ярлык калькулятора.", () => click('[data-install-app="calculator"]')],
        ["Открываем калькулятор из каталога.", () => click('[data-open-app="calculator"]')],
        ["Набираем первое число: 7.", () => click('.calc [data-v="7"]')],
        ["Выбираем сложение.", () => click('.calc [data-v="+"]')],
        ["Добавляем число 5.", () => click('.calc [data-v="5"]')],
        ["Получаем результат: 12.", async () => { await click('.calc [data-v="="]'); await until(() => document.querySelector(".calc-display")?.textContent === "12"); }]
      ],
      folders: [
        ["Открываем папку с рабочего стола.", async () => {
          const el=await find('.desktop-icon[data-item-id="training_folder"]'); await move(el);
          el.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
          await find(".file-card");
        }],
        ["Выбираем файл «План проекта» одним щелчком.", async () => {
          const el=await find('.file-card[data-item-id="training_file"]'); await move(el);
          el.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1}));
        }],
        ["Двойным щелчком открываем файл.", async () => {
          const el=await find('.file-card[data-item-id="training_file"]'); await move(el);
          el.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
        }],
        ["Дополняем текст плана.", () => type(".rich-editor-area","Первый шаг: собрать материалы.\nВторой шаг: обсудить план с командой.")],
        ["Ждём автосохранения и закрываем редактор.", async () => { await until(() => saved().fs.training_file.content.includes("Второй шаг")); await closeEditor(); }],
        ["Снова видим сохранённый файл в папке.", () => find('.file-card[data-item-id="training_file"]')]
      ],
      context: [
        ["Открываем меню заметки правой кнопкой.", rightClickNote],
        ["Выбираем команду «Открыть».", async () => click(await byText("#context-menu button","Открыть"))],
        ["Дополняем заметку короткой записью.", () => type(".rich-editor-area","Подготовить план проекта. Добавить сроки и обсудить результат.")],
        ["Ждём сохранения и закрываем редактор.", async () => { await until(() => saved().fs.training_note.content.includes("Добавить сроки")); await closeEditor(); }],
        ["Повторно открываем меню этой заметки.", rightClickNote],
        ["Создаём копию командой «Дублировать».", async () => click(await byText("#context-menu button","Дублировать"))]
      ],
      selection: [
        ["Выбираем первый значок.", () => chooseIcon("training_note")],
        ["С Ctrl добавляем к выделению второй значок.", () => chooseIcon("training_folder",true)],
        [innerWidth < 700 ? "Открываем действия выделенной группы." : "Медленно перемещаем выбранную группу.", async () => {
          // The mobile desktop uses an ordered grid instead of free icon placement.
          if (innerWidth < 700) { await rightClickNote(); return; }
          const el=await find('.desktop-icon[data-item-id="training_note"]');
          const r=el.getBoundingClientRect(); await move(el);
          selectionOrigin=[saved().fs.training_note.x,saved().fs.training_folder.x];
          activePointer = {pointerId:1};
          el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:r.left+20,clientY:r.top+20,button:0,pointerId:1}));
          for(let n=1;n<=20;n++) {
            const x=r.left+20+80*n/20,y=r.top+20+50*n/20;
            cursor.style.left=x+"px";cursor.style.top=y+"px";
            document.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:x,clientY:y,buttons:1,pointerId:1}));
            if(!manual)await delay(65);
          }
          document.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:r.left+100,clientY:r.top+70,button:0,pointerId:1}));
          activePointer = null;
          await until(() => saved().fs.training_note.x !== selectionOrigin[0]);
        }],
        ["Оставляем выделенным один материал.", async () => {
          document.querySelector("#context-menu")?.classList.add("hidden");
          await chooseIcon("training_note");
        }],
        ["С Ctrl снова добавляем папку.", () => chooseIcon("training_folder",true)],
        ["Открываем действия выбранной заметки.", rightClickNote]
      ],
      taskbar: [
        ["Открываем заметку с рабочего стола.", openNote],
        ["Открываем календарь поверх заметки.", () => open("calendar")],
        ["Возвращаемся к заметке через панель задач.", () => click('.taskbar-app[title="Текстовый редактор"]')],
        ["Сворачиваем окно заметки.", () => click('.window[data-app-id="editor"] [data-win="min"]')],
        ["Переключаемся на календарь.", () => click('.taskbar [data-app="calendar"]')],
        ["С панели задач возвращаем заметку.", () => click('.taskbar-app[title="Текстовый редактор"]')]
      ],
      windows: [
        ["Открываем заметку.", openNote],
        ["Сворачиваем окно.", () => click('.window[data-app-id="editor"] [data-win="min"]')],
        ["Возвращаем окно с панели задач.", () => click('.taskbar-app[title="Текстовый редактор"]')],
        [innerWidth < 700 ? "Открываем календарь вторым окном." : "Меняем размер кнопкой разворачивания.",
          () => innerWidth < 700 ? open("calendar") : click('.window[data-app-id="editor"] [data-win="max"]')],
        [innerWidth < 700 ? "Закрываем календарь, сохраняя открытую заметку." : "Возвращаем прежний размер окна.",
          () => innerWidth < 700 ? click('.window[data-app-id="calendar"] [data-win="close"]') : click('.window[data-app-id="editor"] [data-win="max"]')],
        ["Закрываем редактор.", closeEditor],
        ["Открываем сохранённый материал ещё раз.", openNote]
      ],
      tasks: [
        ["Открываем добавление задачи.", () => quick("task")],
        ["Вводим название задачи.", () => type("[data-task-title]","Отправить план проекта")],
        ["Добавляем описание результата.", () => type("[data-task-description]","Согласовать сроки, проверить материалы и отправить команде.")],
        ["Устанавливаем высокий приоритет.", () => setValue("[data-task-priority]","high")],
        ["Указываем статус «В работе».", () => setValue(".window [data-task-status]","doing")],
        ["Сохраняем новую задачу.", () => click(".window [data-save]")],
        ["Открываем список задач с результатом.", async () => { await start(); await click(await byText("#start-pinned button","Задачи")); }],
        ["Переключаем проект на доску задач.", () => click('[data-project-view="board"]')],
        ["Находим добавленную задачу на доске.", async () => byText(".task-card-title","Отправить план проекта")]
      ],
      calendar: [
        ["Открываем календарь.", () => open("calendar")],
        ["Начинаем создание нового события.", () => click("[data-add-event]")],
        ["Вводим название встречи.", () => type("[data-ev-title]","Встреча команды")],
        ["Раскрываем подробности события.", () => click(".calendar-editor-details summary")],
        ["Указываем место встречи.", () => type("[data-ev-location]","Переговорная: обсуждаем план проекта")],
        ["Добавляем описание встречи.", () => type("[data-ev-desc]","Проверить готовые материалы и распределить следующие шаги.")],
        ["Сохраняем событие в календаре.", () => click("[data-save-event]")],
        ["Переключаем календарь на повестку.", async () => { await until(() => !visible(document.querySelector(".window[data-app-id=calendaredit]"))); await setValue('.window[data-app-id="calendar"] [data-view]',"agenda"); }]
      ],
      settings: [
        ["Открываем Настройки.", () => open("settings")],
        ["Выбираем фон «Мята».", () => click('[data-wall="mint"]')],
        ["Меняем размер значков на крупный.", () => setValue('[data-desktop-appearance="iconSize"]',"large")],
        ["Выбираем более свободное размещение значков.", () => setValue('[data-desktop-appearance="density"]',"comfortable")],
        ["Ждём подтверждения сохранения оформления.", async () => until(() => saved().desktops[0].data.settings.desktopAppearance.density === "comfortable")],
        ["Закрываем настройки и рассматриваем новый стол.", () => click('.window[data-app-id="settings"] [data-win="close"]')]
      ],
      backup: [
        ["Открываем Центр безопасности данных.", () => open("security")],
        ["Запускаем проверку целостности.", () => click("[data-security-check]")],
        ["Рассматриваем результат проверки.", () => find("[data-security-check-result]")],
        ["Собираем и проверяем учебный ZIP.", () => click("[data-security-backup]")],
        ["Дожидаемся проверенного архива.", async () => until(() => saved().security.lastBackupVerified === true && saved().security.lastFullBackupSize > 0)],
        ["Обновляем показатели защиты после создания копии.", () => click("[data-security-refresh]")]
      ]
    }[id];
    if (!steps) throw new Error("Неизвестный урок.");
    for (let i=0;i<steps.length;i++) {
      report("action", {step:i+1,total:steps.length,text:steps[i][0]});
      if (manual) await new Promise((resolve, reject) => {
        const stop = () => { removeEventListener("message", next); reject(signal.reason); };
        const next = event => {
          if(event.source === parent && event.data?.channel === "zeter-training" && event.data.token === token && event.data.runId === runId && event.data.type === "next") {
            removeEventListener("message",next); signal.removeEventListener("abort", stop); resolve();
          }
        };
        addEventListener("message", next);
        signal.addEventListener("abort", stop, {once:true});
      });
      await steps[i][1]();
      if (!manual) await delay(2200);
      report("performed",{step:i+1,total:steps.length});
    }
    const result = {
      start: () => visible(document.querySelector(".window.active .rich-editor-area")) && Object.values(saved().fs).some(item => item.name === "Мой первый план" && /<(b|strong)\b/.test(item.richContent || "")),
      search: () => visible(document.querySelector(".window.active .rich-editor-area")),
      notifications: () => visible(document.querySelector("#notification-center")) && saved().notifications.every(item => item.read),
      note: () => !visible(document.querySelector(".window[data-app-id=editor]")) && Object.values(saved().fs).some(item =>
        item.name === "План недели"
        && noteText.split("\n").every(paragraph => item.content?.includes(paragraph))
        && /<(b|strong)\b/.test(item.richContent || "")
        && /<(i|em)\b/.test(item.richContent || "")
        && /<u\b|text-decoration/.test(item.richContent || "")
        && /24px/.test(item.richContent || "")),
      desktops: () => saved().currentDesktop === "training_projects",
      catalog: () => Object.values(saved().fs).some(item => item.appId === "calculator"),
      folders: () => visible(document.querySelector('.file-card[data-item-id="training_file"]')),
      context: () => Object.values(saved().fs).filter(item => item.parent === "desktop" && item.content?.includes("Добавить сроки")).length >= 2,
      selection: () => innerWidth < 700
        ? ["training_note", "training_folder"].every(id => document.querySelector(`.desktop-icon[data-item-id="${id}"]`)?.classList.contains("selected"))
        : saved().fs.training_note.x !== selectionOrigin[0] && saved().fs.training_folder.x !== selectionOrigin[1],
      taskbar: () => visible(document.querySelector(".window.active .rich-editor-area")),
      windows: () => visible(document.querySelector(".window.active .rich-editor-area")),
      tasks: () => saved().tasks.some(task => task.title === "Отправить план проекта"),
      calendar: () => !visible(document.querySelector(".window[data-app-id=calendaredit]")) && saved().events.some(event => event.title === "Встреча команды"),
      settings: () => !visible(document.querySelector(".window[data-app-id=settings]")) && saved().desktops[0].data.settings.wallpaper === "mint",
      backup: () => saved().security.lastBackupVerified === true && saved().security.lastFullBackupSize > 0
    }[id];
    await until(result);
    report("complete",{text: id === "backup" ? "Учебный архив подготовлен. Свой бэкап можно создать после обучения." : "Показ завершён. Результат остаётся на учебном столе."});
    } finally {
      if (activePointer) document.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,...activePointer}));
      editingFocus = false;
      document.getSelection()?.removeAllRanges();
      cursor.remove();
      report("focus");
    }
  }

  if (active) {
    Object.defineProperty(window,"localStorage",{value:memoryStorage()});
    Object.defineProperty(window,"sessionStorage",{value:memoryStorage()});
    Object.defineProperty(window,"indexedDB",{value:null});
    Object.defineProperty(window,"pywebview",{value:undefined});
    const token=document.documentElement.dataset.trainingToken;
    document.addEventListener("focusin", () => parent.postMessage({channel:"zeter-training",token,type:"focus",keepSelection:editingFocus},"*"));
    let commandNumber = 0, currentRun = null, playback = Promise.resolve();
    addEventListener("message", event => {
      const data = event.data;
      if(event.source !== parent || data?.channel !== "zeter-training" || data.token !== token
        || !Number.isSafeInteger(data.runId) || data.runId < commandNumber) return;
      if (!["play","stop"].includes(data.type)) return;
      commandNumber = data.runId;
      currentRun?.abort();
      if (data.type === "stop") return;
      const runId = data.runId;
      playback = playback.catch(() => {}).then(async () => {
        if (runId !== commandNumber) return;
        try {
          await resetWorkspace();
          if (runId !== commandNumber) return;
          currentRun = new AbortController();
          await runLesson(data.lesson, data.manual === true, currentRun.signal, runId);
        } catch(error) {
          if (runId !== commandNumber || error?.name === "AbortError") return;
          parent.postMessage({channel:"zeter-training",token,runId,type:"failed",text:"Показ остановлен. Нажми «Повторить» или перейди к следующему уроку."},"*");
        }
      });
    });
    addEventListener("DOMContentLoaded", async () => {
      try {
        for (const node of document.querySelectorAll('script[type="application/zeter-script"][src]')) {
          if (node.src.endsWith("/training-runtime-utils.js")) continue;
          await new Promise((resolve,reject) => {
            const script=document.createElement("script"); script.src=node.src;
            script.onload=resolve; script.onerror=reject; document.body.append(script);
          });
        }
        const deadline=Date.now()+15000;
        while (!document.querySelector("#boot")?.classList.contains("done")) {
          if(Date.now()>deadline)throw new Error("Учебная среда не готова.");
          await new Promise(resolve=>setTimeout(resolve,40));
        }
        document.querySelector("#boot")?.remove();
        parent.postMessage({channel:"zeter-training",token,type:"ready"},"*");
      } catch {
        parent.postMessage({channel:"zeter-training",token,type:"failed",text:"Не удалось открыть учебный рабочий стол. Повтори запуск."},"*");
      }
    });
  }

  window.ZETER_TRAINING_RUNTIME = Object.freeze({active, createFrame, readRecord, readRecords, writeRecord, seed, resetSeed, registerWorkspace});
})();
