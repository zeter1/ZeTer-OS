"use strict";

// Explicit browser acceptance only. Import is inert; all state belongs to a new context.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runMobileSmoke({ chromium, startPreview, outputDir, baseline = false, calendarOnly = false }) {
  const root = path.resolve(__dirname, "..");
  const out = outputDir || path.join(root, "work/mobile-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json"], ttlSeconds: 600 });
  let browser;
  const checks = [], errors = [];
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", route => {
      const url = route.request().url();
      if (!url.startsWith(preview.url)) return route.abort();
      if (new URL(url).pathname === "/js/app.js") {
        const seed = `const owner=ZETER_STORAGE_UTILS;
          window.ZETER_STORAGE_UTILS={...owner,createPrimaryStateSaveQueue:opts=>{const q=owner.createPrimaryStateSaveQueue(opts);return {...q,transaction:fn=>q.transaction(write=>fn(async(s,o)=>{const r=await write(s,o);window.__mobileSaved=JSON.parse(JSON.stringify(s));return r;}))};}};
          if(!localStorage.getItem('mobile-fixture')){
          const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;
          ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(s);
          s.desktops[0].data.events.push({id:'mobile-event',title:'Тестовое событие',date:ZETER_CORE_UTILS.todayISO(),start:'09:00',end:'10:00',category:'work',repeat:'none',createdAt:1,updatedAt:1});
          s.desktops[0].data.contacts=ZETER_CONTACTS_UTILS.normalizeContacts({projects:[{id:'mobile-project',name:'Работа'}],categories:[],entries:[{id:'mobile-contact',projectId:'mobile-project',name:'Тестовый контакт',fields:[{id:'phone',type:'phone',label:'Телефон',value:'+375290000000'}]}]});
          s.desktops.push({id:'mobile-second',name:'Очень длинное название второго рабочего стола для проверки мобильной шапки',data:JSON.parse(JSON.stringify(s.desktops[0].data))});
          for(let i=0;i<24;i++)s.fs['mobile-note-'+i]={id:'mobile-note-'+i,type:'note',name:'Мобильная заметка '+i,parent:'desktop',content:'Контрольный текст '+i,richContent:'',x:1200+i*100,y:900,createdAt:1,updatedAt:1};
          s.fs['mobile-folder']={id:'mobile-folder',type:'folder',name:'Материалы телефона',parent:'desktop',x:1600,y:900,createdAt:1,updatedAt:1,explorerView:{mode:'medium',freePlacement:true}};
          s.fs['mobile-child']={id:'mobile-child',type:'note',name:'Вложенная заметка',parent:'mobile-folder',content:'Сохранить этот текст',richContent:'',createdAt:1,updatedAt:1};
          s.fs['mobile-child-2']={id:'mobile-child-2',type:'note',name:'Вторая заметка',parent:'mobile-folder',content:'Соседняя заметка',richContent:'',x:1200,y:1400,createdAt:1,updatedAt:1};
          localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('mobile-fixture','1');}
        `;
        return route.fulfill({ contentType: "application/javascript", body: seed + fs.readFileSync(path.join(root, "app/js/app.js"), "utf8") });
      }
      return route.continue();
    });
    await page.goto(preview.url);
    await page.locator("#boot").waitFor({ state: "hidden" });
    await page.screenshot({ path: path.join(out, "phone-desktop.png") });
    if (baseline) {
      console.log(JSON.stringify(await page.evaluate(() => ({ viewport: innerWidth, taskbar: document.querySelector('#taskbar').getBoundingClientRect().toJSON(), desktopScrollWidth: document.querySelector('#desktop-items').scrollWidth })), null, 2));
      return { baseline: true, out };
    }
    const menu = page.locator('#mobile-menu-button');
    const home = page.locator('#mobile-home-button');
    const create = page.locator('#mobile-desktop-create');
    assert.equal(await create.isVisible(), true, 'create is directly available on the desktop');
    assert.equal(await create.locator('..').getAttribute('class'), 'mobile-header', 'plus lives in the header');
    assert.equal(await create.getAttribute('aria-label'), 'Создать материал');
    assert.ok(await create.locator('span').evaluate(el => el.clientWidth <= 28), 'visible plus is compact');
    assert.ok((await page.locator('#mobile-desktop-name').textContent()).trim(), 'header names the current desktop');
    const fitWindow = async (win, label) => {
      const r = await win.boundingBox();
      const bounds = await page.locator('#window-layer').boundingBox();
      await page.screenshot({path:path.join(out,`${label}.png`)});
      assert.ok(r && bounds && Math.abs(r.x - bounds.x) < 2 && Math.abs(r.y - bounds.y) < 2 && Math.abs(r.width - bounds.width) < 2 && Math.abs(r.height - bounds.height) < 2, `${label}: window must fill available area ${JSON.stringify({r,bounds})}`);
      checks.push(label);
    };
    const openMenuApp = async id => {
      await menu.tap();
      assert.equal(await menu.getAttribute('aria-expanded'), 'true');
      await page.locator(`#top-menu [data-top-action="${id}"]`).tap();
      assert.equal(await menu.getAttribute('aria-expanded'), 'false');
      return page.locator(`.window[data-app-id="${id}"]:not(.minimized)`).last();
    };
    for (const [width, height] of calendarOnly ? [] : [[320,568], [360,800], [390,844], [430,932], [844,390]]) {
      await page.setViewportSize({ width, height });
      await page.locator('#desktop-items').evaluate(el => { el.scrollTop = 0; });
      const action = page.locator('.desktop-item-menu').first();
      const actionSize = await action.boundingBox();
      assert.ok(actionSize.width >= 44 && actionSize.height >= 44, 'desktop menu target is at least 44px');
      const geometry = await page.locator('.desktop-item').evaluateAll(entries => entries.map(entry => {
        const rect = selector => entry.querySelector(selector).getBoundingClientRect();
        const icon = rect('.icon'), label = rect('.label'), badge = rect('.desktop-item-menu-glyph');
        return { aligned: Math.abs(icon.x + icon.width / 2 - label.x - label.width / 2) < 1,
          small: badge.width <= 24 && badge.height <= 24,
          corner: badge.x < icon.x && badge.y < icon.y && badge.right > icon.x && badge.bottom > icon.y };
      }));
      assert.ok(geometry.length && geometry.every(g => g.aligned && g.small && g.corner), 'labels stay below icons; small menu badges overlap only the upper-left corner');
      const windowsBefore = await page.locator('.window').count();
      await action.tap();
      assert.equal(await page.locator('#context-menu').isVisible(), true);
      assert.equal(await page.locator('.window').count(), windowsBefore, 'ellipsis never opens the material');
      await page.locator('#context-menu .context-close-btn').tap();
      await page.screenshot({path:path.join(out, `desktop-actions-${width}.png`)});
      await create.tap();
      assert.equal(await page.locator('#context-menu').isVisible(), true, 'create opens the existing menu');
      await page.locator('#context-menu .context-close-btn').tap();
      checks.push(`desktop-direct-actions-${width}x${height}`);
      assert.equal(await page.locator('.mobile-header').isVisible(), true);
      assert.equal(await page.locator('.taskbar-search').isVisible(), false);
      assert.equal(await page.locator('#top-menu').isVisible(), false);
      assert.equal(await page.locator('#notifications-button').isVisible(), true);
      await page.locator('.mobile-header [data-top-action="search"]').tap();
      await page.locator('#global-search-field').fill('мобильная');
      await page.locator('#global-search-close').tap();
      assert.equal(await page.locator('#global-search').isVisible(), false);
      for (const id of ['settings','calendar','appcenter','security','monitor','about','help']) {
        const win = await openMenuApp(id);
        await fitWindow(win, `${id}-${width}x${height}`);
        assert.equal(await win.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `outer window overflow: ${id}-${width}`);
        await page.screenshot({ path: path.join(out, `${id}-${width}.png`) });
        await win.locator('[data-win="close"]').tap();
        await win.waitFor({ state: 'detached' });
      }
      await menu.tap();
      await page.screenshot({ path: path.join(out, `menu-${width}.png`) });
      await menu.tap();
      checks.push(`automatic-shell-search-menu-${width}x${height}`);
      const materialsBefore = await page.locator('#desktop-items [data-item-id]').count();
      await menu.tap();
      await page.locator('[data-top-action="desktop-menu"]').tap();
      const sheet = page.locator('#context-menu');
      const sheetRect = await sheet.boundingBox();
      const barRect = await page.locator('#taskbar').boundingBox();
      assert.ok(sheetRect.x >= 7 && sheetRect.width >= width - 20, 'phone actions span the available width');
      assert.ok(Math.abs(sheetRect.y + sheetRect.height - barRect.y + 8) <= 1, 'sheet sits above taskbar');
      assert.ok(sheetRect.y >= await page.locator('.mobile-header').evaluate(el => el.getBoundingClientRect().bottom), 'long menu stays below header');
      const close = sheet.locator('.context-close-btn');
      const closeRect = await close.boundingBox();
      assert.ok(closeRect.y >= sheetRect.y && closeRect.y + closeRect.height <= sheetRect.y + sheetRect.height + 1, 'close stays visible even in landscape');
      const list=sheet.locator('.context-menu-items');
      const listRect=await list.boundingBox();
      assert.ok(listRect.y+listRect.height<=closeRect.y,'close has a separate row rather than covering commands');
      await list.evaluate(el=>{el.scrollTop=el.scrollHeight;});
      const lastAction=await list.locator('button').last().boundingBox();
      assert.ok(lastAction.y>=listRect.y&&lastAction.y+lastAction.height<=listRect.y+listRect.height+1,'last command can be scrolled fully into view');
      await list.evaluate(el=>{el.scrollTop=0;});
      await page.screenshot({path:path.join(out,`action-sheet-${width}.png`)});
      await close.tap();
      assert.equal(await sheet.isVisible(), false);
      assert.equal(await page.locator('#desktop-items [data-item-id]').count(), materialsBefore, 'cancel creates no material');
      checks.push(`bottom-sheet-cancel-${width}x${height}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await menu.tap();
    await page.locator('[data-top-action="desktop-menu"]').tap();
    assert.equal(await page.locator('#context-menu').isVisible(),true,'Create opens a choice rather than writing data');
    await home.tap();
    for (const width of calendarOnly ? [] : [320,390]) {
      await page.setViewportSize({width,height:844});
      await page.locator('#desktop-items .desktop-icon').filter({hasText:'Контакты'}).tap();
      const contacts=page.locator('.window[data-app-id="contacts"]:not(.minimized)');
      await fitWindow(contacts,`contacts-${width}`);
      await contacts.locator('[data-contact-project="mobile-project"]').tap();
      await contacts.locator('[data-contact-search]').fill('Тестовый');
      await contacts.locator('[data-contact-open="mobile-contact"]').tap();
      await contacts.locator('[data-contact-action="back"]').tap();
      assert.equal(await contacts.locator('[data-contact-search]').inputValue(),'Тестовый');
      await page.screenshot({path:path.join(out,`contacts-${width}.png`)});
      await contacts.locator('[data-win="close"]').tap();
      await contacts.waitFor({state:'detached'});
      await page.locator('#desktop-items .desktop-icon').filter({hasText:'Задачи'}).tap();
      const tasks=page.locator('.window[data-app-id="tasks"]:not(.minimized)');
      await fitWindow(tasks,`tasks-${width}`);
      await tasks.locator('[data-project-view="board"]').tap();
      await tasks.locator('.task-actions > button').first().waitFor({state:'visible'});
      const taskButtons=await tasks.locator('.task-actions > button').evaluateAll(buttons=>buttons.map(el=>el.getBoundingClientRect().height));
      assert.ok(taskButtons.length&&taskButtons.every(height=>height>=44),`task actions have at least 44px height: ${JSON.stringify(taskButtons)}`);
      await page.screenshot({path:path.join(out,`tasks-${width}.png`)});
      await tasks.locator('[data-win="close"]').tap();
      await tasks.waitFor({state:'detached'});
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const calendar=await openMenuApp('calendar');
    await calendar.locator('[data-view]').selectOption('day');
    await page.waitForFunction(()=>{const field=document.querySelector('.calendar-app [data-view]');return field?.value==='day'&&!field.disabled;});
    const timed=calendar.locator('.calendar-timed-event[data-edit-event="mobile-event"]').first();
    await timed.scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>window.__mobileSaved?.desktops?.[0]?.data?.events?.some(e=>e.id==='mobile-event'));
    const eventBefore=await page.evaluate(()=>JSON.stringify(__mobileSaved.desktops[0].data.events.find(e=>e.id==='mobile-event')));
    const eventRect=await timed.boundingBox();
    assert.notEqual(await timed.evaluate(el=>getComputedStyle(el).touchAction),'none','event must allow native touch scrolling');
    await page.evaluate(()=>{
      window.__mobileScrollCount=0;window.__mobileScrollSettled=false;
      document.addEventListener('scroll',()=>{window.__mobileScrollCount++;window.__mobileScrollSettled=false;},true);
      document.addEventListener('scrollend',()=>{window.__mobileScrollSettled=true;},true);
    });
    const eventX=eventRect.x+eventRect.width/2, eventY=eventRect.y+eventRect.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:eventX,y:eventY}]});
    for(const dy of [-20,-40,-60,-80])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:eventX,y:eventY+dy}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    // A tap during inertial scrolling stops the fling rather than activating a button.
    // Wait for the browser's real scroll completion before testing the next action.
    await page.waitForFunction(()=>window.__mobileScrollCount>0&&window.__mobileScrollSettled);
    assert.equal(await page.evaluate(()=>JSON.stringify(__mobileSaved.desktops[0].data.events.find(e=>e.id==='mobile-event'))),eventBefore,'swiping an event must not change its saved date/time');
    assert.equal(await page.locator('.window:not(.minimized)').count(),1,'swipe must not open an event editor');
    checks.push('calendar-touch-scroll-preserves-event');
    await calendar.locator('[data-win="close"]').tap();
    await calendar.waitFor({state:'detached'});
    if(calendarOnly)return {checks,out};
    const icon = page.locator('#desktop-items [data-item-id="mobile-note-0"]');
    await icon.tap();
    const note = page.locator('.window:not(.minimized)').last();
    assert.equal(await create.isVisible(), false, 'desktop creation hides while a window is open');
    await fitWindow(note, 'single-tap-note');
    const tools = note.locator('[data-window-header-tools]');
    for (const width of [320,390,844]) {
      await page.setViewportSize({width,height:width===844?390:844});
      await tools.evaluate(el => { el.scrollLeft = 0; });
      await page.waitForFunction(() => {
        const el = document.querySelector('.window:not(.minimized) [data-window-header-tools]');
        return el.classList.contains('has-more-after') === (el.scrollWidth > el.clientWidth + 1) && !el.classList.contains('has-more-before');
      });
      const sizes = await tools.locator('button:visible').evaluateAll(buttons => buttons.map(el => ({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
      assert.ok(sizes.length && sizes.every(s=>s.width>=44&&s.height>=44), 'editor actions have 44px touch targets');
      if (await tools.evaluate(el=>el.scrollWidth>el.clientWidth+1)) {
        await tools.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
        await page.waitForFunction(() => {
          const el=document.querySelector('.window:not(.minimized) [data-window-header-tools]');
          return el.classList.contains('has-more-before')&&!el.classList.contains('has-more-after');
        });
      }
      await page.screenshot({path:path.join(out,`editor-scroll-hints-${width}.png`)});
      checks.push(`editor-touch-targets-scroll-hints-${width}`);
    }
    // Reusing the slot after refresh must reset scroll and release its old observer.
    await tools.evaluate(el => {
      const source=el.firstElementChild;
      window.ZETER_WINDOW_UI_UTILS.syncWindowHeaderTools(el.closest('.window'),source);
    });
    assert.equal(await tools.evaluate(el=>el.scrollLeft),0);
    await page.setViewportSize({width:390,height:844});
    const winId = await note.getAttribute('data-win-id');
    await home.tap();
    assert.equal(await page.locator('.window:not(.minimized)').count(), 0, 'Home preserves and minimizes windows');
    assert.equal(await create.isVisible(), true, 'Home restores direct creation');
    const switcher = page.locator(`.taskbar-app[data-win-id="${winId}"]`);
    await switcher.tap();
    assert.equal(await note.isVisible(), true);
    await page.setViewportSize({ width: 844, height: 390 });
    await fitWindow(note, 'rotation-keeps-open-note');
    await page.setViewportSize({ width: 390, height: 480 });
    await fitWindow(note, 'short-viewport-keeps-controls');
    await note.locator('[data-win="close"]').tap();
    await note.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 390, height: 844 });
    // A real touch sequence must scroll rather than move/save an icon.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 630 }] });
    for (const y of [580,530,480,430,380]) await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:190,y}] });
    await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
    await page.waitForFunction(() => document.querySelector('#desktop-items').scrollTop > 0);
    await page.waitForFunction(() => window.__mobileScrollSettled);
    assert.equal(await page.locator('#selection-box').isVisible(), false);
    await page.locator('#desktop-items').evaluate(el => { el.scrollTop = 0; });
    // Long press: wait for the menu condition, then release. No app may open.
    await page.evaluate(()=>{
      window.__touchTrace=[];
      for(const type of ['pointerdown','pointerup','click','contextmenu'])document.addEventListener(type,event=>window.__touchTrace.push({type,tag:event.target.tagName,id:event.target.id,cls:event.target.className,pointerType:event.pointerType,pointerId:event.pointerId}),true);
    });
    const box = await icon.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+25}]});
    await page.locator('#context-menu').waitFor({state:'visible'});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    if(!await page.locator('#context-menu').isVisible()){
      console.log('longpress diagnostic',await page.evaluate(()=>window.__touchTrace));
      await page.screenshot({path:path.join(out,'longpress-failure.png')});
    }
    assert.equal(await page.locator('#context-menu').isVisible(),true,'long-press menu must stay open after release');
    assert.equal(await page.locator('.window:not(.minimized)').count(), 0);
    await page.locator('#context-menu button').first().tap();
    assert.equal(await page.locator('.window:not(.minimized)').count(),1,'a separate tap must execute the selected menu command');
    checks.push('longpress-release-safe-separate-tap-opens');
    await home.tap();
    await page.locator('#desktop-items [data-item-id="mobile-folder"]').tap();
    const folder = page.locator('.window[data-app-id="folder"]:not(.minimized)');
    await fitWindow(folder, 'touch-folder');
    const cards = await folder.locator('.file-card').evaluateAll(els => els.map(el => { const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}; }));
    assert.equal(cards.length,2);
    assert.ok(cards[0].x+cards[0].w<=cards[1].x+1 || cards[1].x+cards[1].w<=cards[0].x+1 || cards[0].y+cards[0].h<=cards[1].y+1 || cards[1].y+cards[1].h<=cards[0].y+1,'free-placement cards must not overlap on phone');
    await page.screenshot({path:path.join(out,'folder-free-390.png')});
    await folder.locator('.file-card[data-item-id="mobile-child"]').tap();
    assert.equal(await page.locator('.window:not(.minimized)').count(), 2, 'nested file opens with one tap');
    await home.tap();
    await page.waitForFunction(() => window.__mobileSaved?.fs?.['mobile-note-0']);
    assert.equal(await page.evaluate(() => __mobileSaved.fs['mobile-note-0'].x),1200, 'phone rendering must preserve desktop coordinates');
    assert.equal(await page.evaluate(() => __mobileSaved.fs['mobile-child'].content),'Сохранить этот текст');
    await page.reload();
    await page.locator('#boot').waitFor({state:'hidden'});
    await home.tap();
    await page.screenshot({ path: path.join(out, 'phone-desktop.png') });
    checks.push('touch-scroll-longpress-folder-home-reload-preserves-data');
    await page.locator('#start-button').tap();
    await page.locator('[data-switch-desktop="mobile-second"]').tap();
    await home.tap();
    const secondName = 'Очень длинное название второго рабочего стола для проверки мобильной шапки';
    assert.equal(await page.locator('#mobile-desktop-name').textContent(), secondName);
    assert.equal(await page.locator('#mobile-desktop-name').getAttribute('title'), secondName);
    for (const width of [320,360,390,430]) {
      await page.setViewportSize({width,height:844});
      assert.ok(await page.locator('.mobile-header').evaluate(el => el.scrollWidth <= el.clientWidth), 'long desktop name never pushes header actions outside viewport');
    }
    await create.tap();
    page.once('dialog', dialog => dialog.accept('Папка второго стола'));
    await page.locator('#context-menu button').filter({hasText:'Новая папка'}).tap();
    await page.waitForFunction(async () => {
      const c = window.ZETER_OS_CONFIG;
      const record = await window.ZETER_STORAGE_UTILS.readPrimaryStateRecord({dbName:c.PRIMARY_STATE_DB, storeName:c.PRIMARY_STATE_STORE, id:c.PRIMARY_STATE_ID});
      return Object.values(record?.state?.fs || {}).some(item => item.name === 'Папка второго стола' && item.parent === 'mobile-second');
    });
    await page.reload();
    await page.locator('#boot').waitFor({state:'hidden'});
    assert.equal(await page.locator('#mobile-desktop-name').textContent(), secondName);
    assert.equal(await page.locator('#desktop-items .label').filter({hasText:'Папка второго стола'}).count(), 1);
    await page.locator('#start-button').tap();
    await page.locator('[data-switch-desktop="desktop"]').tap();
    assert.equal(await page.locator('#mobile-desktop-name').textContent(), 'Основной');
    assert.equal(await page.locator('#desktop-items .label').filter({hasText:'Папка второго стола'}).count(), 0);
    checks.push('desktop-name-switch-long-title-create-on-current-reload');
    // A separate mouse context proves desktop UI and opening semantics survive.
    const desktop = await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
    await desktop.addInitScript(() => { window.__ZETER_UI_PREVIEW__=true; });
    const desktopPage = await desktop.newPage();
    await desktopPage.route('**/*',route => {
      if(!route.request().url().startsWith(preview.url))return route.abort();
      if(new URL(route.request().url()).pathname==='/js/app.js')return route.fulfill({contentType:'application/javascript',body:"const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));\n"+fs.readFileSync(path.join(root,'app/js/app.js'),'utf8')});
      return route.continue();
    });
    await desktopPage.goto(preview.url);
    await desktopPage.locator('#boot').waitFor({state:'hidden'});
    assert.equal(await desktopPage.locator('.mobile-header').isVisible(),false);
    assert.equal(await desktopPage.locator('#top-menu').isVisible(),true);
    assert.equal(await desktopPage.locator('.taskbar-search').isVisible(),true);
    await desktopPage.screenshot({path:path.join(out,'desktop-1440.png')});
    await desktopPage.locator('[data-top-action="settings"]').click();
    assert.equal(await desktopPage.locator('.window [data-win="max"]').isVisible(),true);
    await desktopPage.locator('.window [data-win="close"]').click();
    await desktopPage.locator('.window').waitFor({state:'detached'});
    await desktopPage.locator('#desktop-items').click({button:'right',position:{x:600,y:450}});
    const desktopMenu=desktopPage.locator('#context-menu');
    assert.equal(await desktopMenu.evaluate(el=>getComputedStyle(el).position),'absolute');
    assert.equal(Math.round((await desktopMenu.boundingBox()).width),250,'desktop popup keeps its original width');
    await desktopMenu.locator('.context-close-btn').click();
    checks.push('desktop-shell-retained-1440');
    const fresh=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    await fresh.addInitScript(() => { window.__ZETER_UI_PREVIEW__=true; });
    const freshPage=await fresh.newPage();
    const freshErrors=[];
    freshPage.on('pageerror',e=>freshErrors.push(e.message));
    await freshPage.route('**/*',route=>route.request().url().startsWith(preview.url)?route.continue():route.abort());
    await freshPage.goto(preview.url);
    await freshPage.locator('#boot').waitFor({state:'hidden'});
    await freshPage.locator('.first-run-screen[open]').waitFor({state:'visible'});
    await freshPage.screenshot({path:path.join(out,'first-run-390.png')});
    assert.deepEqual(freshErrors,[],'unmodified app startup in an empty phone context');
    checks.push('unmodified-startup-first-run-phone');
    assert.equal(errors.length, 0, errors.join("\n"));
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors},null,2));
    console.log(`mobile UI: PASS (${checks.length} checks, 0 JS errors)`);
    return { checks, out };
  } finally {
    if (browser) await browser.close();
    await preview.close();
  }
}

module.exports = { runMobileSmoke };
