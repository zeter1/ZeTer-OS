"use strict";
// Inert module. All storage is synthetic; only the app public directory is served.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
async function runCalendarPlannerSmoke({ chromium, startPreview, outputDir, caseNames = null } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/calendar-planner-qa");
  fs.mkdirSync(out, { recursive: true });
  const files = ["config", "utils", "time-tracking-utils", "project-overview-utils", "data-normalizers", "preferences-writer-utils", "task-ui-utils", "task-app-ui-utils", "calendar-utils", "calendar-ui-utils", "storage-utils", "automation-utils"].map(name => `js/core/${name}.js`);
  const source = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8"), adapter = source.slice(source.indexOf("  function calendarPersistenceOptions("), source.indexOf("  function calendarMutationSaved("));
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "css", ...files], ttlSeconds: 600 });
  let browser; const results = [];
  const cases = [
    ["month is clean; day selection, empty insights, keyboard and double-click create", async page => {
      assert.equal(await page.locator("[data-add-event]").count(), 1);
      assert.equal(await page.locator(".day-cell").count(), 42);
      const next = await page.evaluate(() => ZETER_CALENDAR_UTILS.calendarDateAdd(fixture.today, 5));
      await page.locator(`.day-cell[data-day="${next}"]`).click();
      assert.match(await page.locator(".calendar-day-insights").innerText(), /Свободное время/);
      await page.locator(`.day-cell[data-day="${next}"]`).focus(); await page.keyboard.press("ArrowRight");
      assert.equal(await page.evaluate(() => fixture.calendar.selected), await page.evaluate(() => ZETER_CALENDAR_UTILS.calendarDateAdd(fixture.today, 6)));
      await page.evaluate(() => {
        fixture.keyboardEvidence = [];
        document.addEventListener("keydown", event => fixture.keyboardEvidence.push({ key: event.key, target: event.target?.getAttribute?.("data-ev-title") !== null ? "event-title" : event.target?.className || event.target?.tagName, editorContainsFocus: Boolean(document.querySelector("#editor")?.contains(document.activeElement)) }), true);
      });
      await page.keyboard.press("Control+Enter"); assert.equal(await page.locator("#editor").count(), 1);
      await page.evaluate(() => fixture.keyboardEvidence.push({ checkpoint: "after-create", editorContainsFocus: Boolean(document.querySelector("#editor")?.contains(document.activeElement)), active: document.activeElement?.outerHTML?.slice(0, 200) }));
      assert.equal(await page.locator("[data-ev-title]").evaluate(node => document.activeElement === node), true, "mounted editor must own focus before immediate Escape");
      await page.keyboard.press("Escape");
      console.log("calendar keyboard evidence:", JSON.stringify(await page.evaluate(() => fixture.keyboardEvidence)));
      assert.equal(await page.locator("#editor").count(), 0);
      await page.evaluate(date => { fixture.dayNodeBeforeClick = document.querySelector(`.day-cell[data-day="${date}"]`); }, next);
      await page.locator(`.day-cell[data-day="${next}"]`).click();
      assert.equal(await page.evaluate(date => fixture.dayNodeBeforeClick === document.querySelector(`.day-cell[data-day="${date}"]`), next), true, "day selection must preserve the DOM target between native double-click events");
      await page.locator(`.day-cell[data-day="${next}"]`).dblclick(); assert.equal(await page.locator("#editor").count(), 1);
    }],
    ["24h grids preserve early/late events and overlap lanes", async page => {
      assert.equal(await page.locator('.month-grid .event-chip[data-edit-event="block"] span').evaluate(node=>getComputedStyle(node).display!=="none"),true,"wide month must display event start times");
      await page.locator("[data-view]").selectOption("day"); await page.waitForFunction(() => fixture.preferences.view === "day");
      assert.equal(await page.locator(".calendar-time-slot").count(), 48);
      assert.match(await page.locator(".calendar-ruler-hours").innerText(), /00:00[\s\S]*24:00/);
      assert.equal(await page.locator('.calendar-timed-event[data-edit-event="early"]').count(), 1);
      assert.equal(await page.locator('.calendar-timed-event[data-edit-event="late"]').count(), 1);
      const rects = await page.locator('.calendar-timed-event[data-edit-event="block"],.calendar-timed-event[data-edit-event="clash"]').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { left:r.left, right:r.right }; }));
      assert.ok(rects[0].right <= rects[1].left + 1 || rects[1].right <= rects[0].left + 1, "parallel lanes must not overlap horizontally");
      await page.locator("[data-view]").selectOption("week"); await page.waitForFunction(() => fixture.preferences.view === "week");
      assert.equal(await page.locator(".calendar-time-column").count(), 7);
      assert.doesNotMatch(await page.locator(".calendar-title").innerText(), /Invalid Date|GMT|Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
      assert.match(await page.locator(".calendar-title").innerText(), /^Неделя \d+ .* — \d+ /);
      assert.equal(await page.locator(".calendar-time-slot").count(), 336);
      await page.screenshot({ path:path.join(out,"week-wide.png"),fullPage:true });
    }],
    ["filtered availability uses hidden events; all-day never promises free hours", async page => {
      await page.locator("[data-calendar-search]").fill("Основной");
      assert.equal(await page.locator(".event-list .event-card").count(), 1);
      assert.match(await page.locator(".calendar-filter-context").innerText(), /все события/);
      assert.match(await page.locator(".calendar-conflicts").innerText(), /09:30–10:00/);
      assert.match(await page.locator(".calendar-day-insights").innerText(), /весь день или без времени/);
      assert.equal(await page.locator("[data-free-date]").count(), 0);
    }],
    ["description and attachment draft survive refusal, retry and remount", async page => {
      await page.locator("[data-add-event]").click();
      assert.equal(await page.locator("[data-ev-desc]").isVisible(), true);
      await page.locator("[data-ev-title]").fill("План с файлом"); await page.locator("[data-ev-desc]").fill("Подробное описание\nВторая строка");
      await page.locator("[data-ev-file]").selectOption("material"); await page.locator("[data-attach-existing]").click();
      await page.evaluate(() => { fixture.refuse=true; }); await page.locator("[data-save-event]").click();
      await page.waitForFunction(() => fixture.toasts.some(row => row[0] === "Не удалось сохранить событие"));
      assert.equal(await page.locator("[data-ev-desc]").inputValue(), "Подробное описание\nВторая строка");
      assert.equal(await page.locator("[data-remove-attachment]").count(), 1);
      assert.equal(await page.evaluate(() => fixture.workspace().events.filter(item => item.title === "План с файлом").length), 0);
      await page.evaluate(() => { fixture.refuse=false; }); await page.locator("[data-save-event]").click(); await page.locator("#editor").waitFor({state:"detached"});
      await page.evaluate(() => { const event=fixture.workspace().events.find(item=>item.title === "План с файлом"); fixture.mountEditor({eventId:event.id}); });
      assert.equal(await page.locator("[data-remove-attachment]").count(),1);
      await page.locator("#editor [data-open-attachment]").click(); assert.deepEqual(await page.evaluate(() => fixture.openedFiles), ["material"]);
      await page.locator("[data-remove-attachment]").click(); assert.equal(await page.locator("[data-remove-attachment]").count(),0);
      assert.ok(await page.evaluate(() => state.fs.material),"removing a link must keep the material");
    }],
    ["category settings are unavailable for all and standard categories", async page => {
      const settings=page.locator(".calendar-category-settings-trigger"), manager=page.locator(".calendar-category-manager");
      const before=await page.evaluate(()=>JSON.stringify(state));
      assert.equal(await settings.getAttribute("aria-disabled"),"true");
      assert.equal(await settings.evaluate(node=>node.tabIndex),-1);
      assert.equal(await settings.evaluate(node=>getComputedStyle(node).opacity),await page.locator("[data-project-settings]").evaluate(node=>getComputedStyle(node).opacity));
      await settings.click({force:true});
      assert.equal(await manager.evaluate(node=>node.open),false);
      await settings.focus(); await page.keyboard.press("Enter"); await page.keyboard.press("Space");
      assert.equal(await manager.evaluate(node=>node.open),false,"keyboard cannot open unavailable settings");
      await page.locator("[data-calendar-category]").focus(); await settings.click({force:true});
      assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector("[data-calendar-category]")),true,"disabled settings do not take focus on click");
      await page.screenshot({path:path.join(out,"all-categories-disabled.png"),fullPage:true});
      await page.evaluate(()=>{fixture.workspace().calendarCategories=[{id:"calcat_available",name:"Своя категория",color:"#7aa8ff"}];fixture.mountCalendar();});
      await page.locator("[data-calendar-category]").selectOption("calcat_available");
      assert.equal(await settings.getAttribute("aria-disabled"),"false");
      assert.equal(await settings.evaluate(node=>node.tabIndex),0);
      await settings.click(); assert.equal(await manager.evaluate(node=>node.open),true);
      await page.locator("[data-calendar-category]").selectOption("");
      assert.equal(await settings.getAttribute("aria-disabled"),"true");
      assert.equal(await manager.evaluate(node=>node.open),false,"switching to all closes settings");
      await page.locator("[data-calendar-category]").selectOption("work");
      assert.equal(await settings.getAttribute("aria-disabled"),"true");
      await settings.click({force:true}); assert.equal(await manager.evaluate(node=>node.open),false);
      await page.locator(".calendar-category-trigger").click();
      assert.equal(await page.locator("[data-create-category]").isEnabled(),true,"creation remains available");
      const after=await page.evaluate(()=>structuredClone(state)),previous=JSON.parse(before);
      assert.deepEqual(after.desktops[0].data.events,previous.desktops[0].data.events);
      assert.deepEqual(after.desktops[1],previous.desktops[1]);
    }],
    ["category creation and autosaved settings retain newer edits and failure drafts", async page => {
      const creator=page.locator(".calendar-category-creator"), trigger=creator.locator("summary");
      assert.equal(await page.locator(".calendar-view-actions .calendar-category-trigger").count(),0);
      const selectBox=await page.locator("[data-calendar-category]").boundingBox(), settingsBox=await page.locator(".calendar-category-settings-trigger").boundingBox(), buttonBox=await trigger.boundingBox();
      assert.equal(await page.locator(".calendar-category-settings-trigger").innerText(),"Настройки категории");
      assert.ok(settingsBox.x>=selectBox.x+selectBox.width && buttonBox.x>=settingsBox.x+settingsBox.width);
      assert.equal(await creator.locator("[data-delete-category]").count(),0);
      await trigger.focus();await page.keyboard.press("Enter");
      await page.waitForFunction(()=>document.activeElement===document.querySelector("[data-new-category-name]"));
      await page.locator("[data-new-category-name]").fill("Встречи с клиентами");
      await page.locator("[data-new-category-color]").fill("#e2ad73");
      await page.evaluate(()=>{fixture.refuse=true;});await page.locator("[data-create-category]").click();
      await page.waitForFunction(()=>document.querySelector("[data-category-create-status]").textContent.includes("отказ"));
      assert.equal(await page.locator("[data-new-category-name]").inputValue(),"Встречи с клиентами");
      await page.evaluate(()=>{fixture.refuse=false;});await page.locator("[data-create-category]").click();
      await page.waitForFunction(()=>fixture.workspace().calendarCategories.length===1);
      const id=await page.evaluate(()=>fixture.workspace().calendarCategories[0].id);
      await page.locator("[data-calendar-category]").selectOption(id);await page.locator(".calendar-category-settings-trigger").click();
      await page.waitForFunction(()=>!document.querySelector(".calendar-category-creator").open);
      assert.equal(await page.locator("[data-save-category],[data-reset-category]").count(),0);
      await page.evaluate(()=>{fixture.refuse=true;});
      await page.locator("[data-category-description]").fill("Встречи и обсуждение важных вопросов");
      await page.locator("[data-category-icon]").selectOption("💼");
      await page.waitForFunction(()=>document.querySelector("[data-category-status]").textContent.includes("отказ"));
      assert.equal(await page.locator("[data-category-description]").inputValue(),"Встречи и обсуждение важных вопросов");
      assert.equal(await page.locator("[data-calendar-category]").isDisabled(),true);
      await page.evaluate(()=>{fixture.refuse=false;});await page.locator("[data-retry-category-settings]").click();
      await page.waitForFunction(()=>document.querySelector("[data-category-status]").textContent==="Сохранено");
      assert.match(await page.locator('[data-calendar-category] option:checked').innerText(),/💼/);
      await page.evaluate(()=>{fixture.hold={};});
      await page.locator("[data-category-name]").fill("Первое имя");await page.locator("[data-category-name]").dispatchEvent("change");
      await page.waitForFunction(()=>typeof fixture.hold?.resolve==="function");
      await page.locator("[data-category-name]").fill("Последнее имя");await page.locator("[data-category-name]").dispatchEvent("change");
      assert.equal(await page.locator("[data-category-name]").inputValue(),"Последнее имя");
      await page.evaluate(()=>{fixture.hold.resolve();fixture.hold=null;});
      await page.waitForFunction(()=>fixture.workspace().calendarCategories[0].name==="Последнее имя" && document.querySelector("[data-category-status]").textContent==="Сохранено");
      assert.equal(await page.locator("[data-category-name]").inputValue(),"Последнее имя");
      assert.match(await page.locator("[data-category-settings-info]").innerText(),/Последнее имя/);
      const writes=await page.evaluate(()=>fixture.writes);await page.locator("[data-category-name]").dispatchEvent("change");
      assert.equal(await page.evaluate(()=>fixture.writes),writes,"unchanged blur does not save twice");
      await page.evaluate(()=>{fixture.workspace().calendarCategories[0].name="Новое из другого окна";});
      await page.locator("[data-category-name]").fill("Мой черновик");await page.locator("[data-category-name]").dispatchEvent("change");
      await page.waitForFunction(()=>document.querySelector("[data-category-status]").textContent.includes("другом окне"));
      await page.evaluate(()=>document.querySelector(".calendar-app").refreshCalendar());
      assert.equal(await page.locator("[data-category-name]").inputValue(),"Мой черновик","another calendar refresh preserves autosave draft");
      await trigger.click();await page.locator("[data-new-category-name]").fill("Отдельная новая");await page.locator("[data-create-category]").click();
      await page.waitForFunction(()=>fixture.workspace().calendarCategories.length===2);
      assert.equal(await page.evaluate(()=>fixture.workspace().calendarCategories[0].name),"Новое из другого окна");
      await page.locator(".calendar-category-settings-trigger").click();
      assert.equal(await page.locator("[data-category-name]").inputValue(),"Мой черновик");
      await page.locator("[data-discard-category-settings]").click();
      assert.equal(await page.locator("[data-category-name]").inputValue(),"Новое из другого окна");
      await page.screenshot({path:path.join(out,"category-autosave.png"),fullPage:true});
      await page.locator("[data-calendar-category]").selectOption("work");
      assert.equal(await page.locator(".calendar-category-settings-trigger").getAttribute("aria-disabled"),"true");
      await page.locator("[data-calendar-category]").selectOption("");
    }],
    ["category deletion cancels, retains draft on refusal and transfers only after ACK", async page => {
      await page.locator(".calendar-category-trigger").click();
      await page.locator("[data-new-category-name]").fill("Удаляемая"); await page.locator("[data-create-category]").click();
      await page.waitForFunction(() => fixture.workspace().calendarCategories.length === 1);
      const categoryId = await page.evaluate(() => fixture.workspace().calendarCategories[0].id);
      await page.evaluate(id => { fixture.workspace().events.push({id:"to-transfer",title:"Сохранить событие",date:fixture.today,category:id,description:"Текст",attachments:[{kind:"fs",id:"material"}],repeat:"weekly",repeatWeekdays:[1,3]}); }, categoryId);
      const before = await page.evaluate(() => JSON.stringify(state));
      await page.locator("[data-calendar-category]").selectOption(categoryId);
      await page.locator(".calendar-category-settings-trigger").click();
      await page.locator("[data-delete-category]").click();
      assert.match(await page.locator("[data-category-status]").innerText(), /перенести/);
      assert.equal(await page.evaluate(() => JSON.stringify(state)), before);
      await page.locator("[data-category-replacement]").selectOption("work");
      await page.evaluate(() => { fixture.allowConfirm = false; });
      await page.locator("[data-delete-category]").click();
      assert.equal(await page.evaluate(() => JSON.stringify(state)), before, "cancel preserves category and events");
      await page.evaluate(() => { fixture.allowConfirm = true; fixture.refuse = true; });
      await page.locator("[data-delete-category]").click();
      await page.waitForFunction(() => document.querySelector("[data-category-status]").textContent.includes("отказ"));
      assert.equal(await page.evaluate(() => JSON.stringify(state)), before);
      assert.equal(await page.locator("[data-category-name]").inputValue(), "Удаляемая");
      assert.equal(await page.locator("[data-category-replacement]").inputValue(), "work");
      await page.screenshot({path:path.join(out,"category-delete-refusal.png"),fullPage:true});
      await page.evaluate(() => { fixture.refuse = false; fixture.hold = {}; });
      await page.locator("[data-delete-category]").click();
      await page.waitForFunction(() => typeof fixture.hold?.resolve === "function");
      assert.equal(await page.locator("[data-delete-category]").isDisabled(), true);
      assert.equal(await page.locator("[data-calendar-category]").isDisabled(), true);
      assert.equal(await page.evaluate(() => JSON.stringify(state)), before, "pending ACK does not publish deletion");
      await page.evaluate(() => { fixture.hold.resolve(); fixture.hold = null; });
      await page.waitForFunction(() => fixture.workspace().calendarCategories.length === 0);
      assert.equal(await page.locator("[data-calendar-category]").inputValue(), "");
      const after = await page.evaluate(() => structuredClone(state)), expected = JSON.parse(before);
      expected.desktops[0].data.calendarCategories = [];
      expected.desktops[0].data.events.find(event => event.id === "to-transfer").category = "work";
      assert.deepEqual(after, expected, "all other event fields, files and other desktop survive");
      assert.equal(await page.locator("[data-category-settings-fields]").isVisible(), false);
      assert.equal(await page.evaluate(() => fixture.confirmations.length), 3);
      assert.match(await page.evaluate(() => fixture.confirmations.at(-1)), /Работа/);
    }],
    ["project creation from calendar uses shared dialog and publishes only after ACK", async page => {
      const selectBox=await page.locator("[data-calendar-project]").boundingBox(),settingsBox=await page.locator("[data-project-settings]").boundingBox(),buttonBox=await page.locator("[data-create-project]").boundingBox();
      assert.ok(settingsBox.x>=selectBox.x+selectBox.width && buttonBox.x>=settingsBox.x+settingsBox.width,"project settings are immediately after selection, before creation");
      assert.equal(await page.locator("[data-project-settings]").isDisabled(),true);
      const before=await page.evaluate(()=>JSON.stringify(state));
      await page.locator("[data-create-project]").click();
      const dialog=page.locator("[data-task-project-dialog]");
      await dialog.locator("input").fill("Отменённый проект"); await dialog.locator("[data-project-cancel]").click();
      assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
      await page.locator("[data-create-project]").click(); await dialog.locator("input").fill("Проект из календаря");
      await page.evaluate(()=>{fixture.refuse=true;}); await dialog.locator('[type="submit"]').click();
      await page.waitForFunction(()=>!document.querySelector('[data-task-project-dialog] [role="alert"]').hidden);
      assert.equal(await dialog.locator("input").inputValue(),"Проект из календаря");
      assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
      await page.evaluate(()=>{fixture.refuse=false;fixture.hold={};}); await dialog.locator('[type="submit"]').click();
      await page.waitForFunction(()=>typeof fixture.hold?.resolve==="function");
      assert.equal(await dialog.locator('[type="submit"]').isDisabled(),true);
      assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
      await page.evaluate(()=>{fixture.hold.resolve();fixture.hold=null;}); await dialog.waitFor({state:"detached"});
      const project=await page.evaluate(()=>fixture.workspace().taskProjects.find(item=>item.name==="Проект из календаря"));
      assert.ok(project?.id); assert.equal(await page.locator("[data-calendar-project]").inputValue(),project.id);
      const after=await page.evaluate(()=>structuredClone(state)),previous=JSON.parse(before);
      assert.deepEqual(after.desktops[0].data.events,previous.desktops[0].data.events);
      assert.deepEqual(after.desktops[0].data.tasks,previous.desktops[0].data.tasks);
      assert.deepEqual(after.desktops[1],previous.desktops[1]);
      await page.screenshot({path:path.join(out,"project-created.png"),fullPage:true});
    }],
    ["project settings autosave retain latest metadata and retry before closing", async page => {
      await page.locator("[data-calendar-project]").selectOption("project");
      const before=await page.evaluate(()=>JSON.stringify(state));
      await page.locator("[data-project-settings]").click();
      const dialog=page.locator("[data-project-settings-dialog]");
      assert.equal(await dialog.locator('[type="submit"]').count(),0);
      await dialog.locator("[data-settings-cancel]").click();
      assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
      await page.locator("[data-project-settings]").click();
      await page.evaluate(()=>{fixture.refuse=true;});
      await dialog.locator('[name="name"]').fill("Изменённый проект");
      await dialog.locator('[name="goal"]').fill("Ожидаемый результат");
      await dialog.locator('[name="status"]').selectOption("paused");
      await page.waitForFunction(()=>!document.querySelector('[data-project-settings-dialog] [role="alert"]').hidden);
      assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
      await dialog.locator('[name="startDate"]').fill("2027-01-10");await dialog.locator('[name="deadline"]').fill("2027-01-01");
      await page.waitForFunction(()=>document.querySelector('[data-project-settings-dialog] [role="alert"]').textContent.includes("раньше"));
      assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
      await dialog.locator('[name="deadline"]').fill("2027-02-01");
      await page.waitForFunction(()=>document.querySelector('[data-project-settings-dialog] [role="alert"]').textContent.includes("отказ"));
      await page.evaluate(()=>{fixture.refuse=false;fixture.hold={};});await dialog.locator("[data-project-settings-retry]").click();
      await page.waitForFunction(()=>typeof fixture.hold?.resolve==="function");
      assert.equal(await dialog.locator('[name="goal"]').isEnabled(),true);
      await dialog.locator('[name="goal"]').fill("Последний результат");await dialog.locator('[name="goal"]').dispatchEvent("change");
      assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
      await page.evaluate(()=>{fixture.hold.resolve();fixture.hold=null;});
      await page.waitForFunction(()=>fixture.workspace().taskProjects[0].goal==="Последний результат" && document.querySelector("[data-project-autosave-status]").textContent==="Сохранено");
      assert.equal(await page.locator('[data-calendar-project] option:checked').innerText(),"Изменённый проект");
      const after=await page.evaluate(()=>structuredClone(state)),previous=JSON.parse(before);
      assert.deepEqual(after.desktops[0].data.events,previous.desktops[0].data.events);assert.deepEqual(after.desktops[0].data.tasks,previous.desktops[0].data.tasks);assert.deepEqual(after.desktops[1],previous.desktops[1]);
      await page.screenshot({path:path.join(out,"project-autosave.png"),fullPage:true});
      await dialog.locator("[data-settings-cancel]").click();await page.locator("[data-project-settings]").click();
      assert.equal(await dialog.locator('[name="goal"]').inputValue(),"Последний результат");
      assert.equal(await dialog.locator('[name="deadline"]').inputValue(),"2027-02-01");
      await dialog.locator('[name="description"]').fill("Сохранить при закрытии");await dialog.locator("[data-settings-cancel]").click();
      await dialog.waitFor({state:"detached"});
      assert.equal(await page.evaluate(()=>fixture.workspace().taskProjects[0].description),"Сохранить при закрытии");
    }],
    ["category settings expand fully without internal scrolling", async page => {
      await page.evaluate(()=>{fixture.workspace().calendarCategories=[{id:"calcat_layout",name:"Категория для проверки",color:"#7aa8ff"}];fixture.mountCalendar();});
      await page.locator("[data-calendar-category]").selectOption("calcat_layout");
      for(const [width,height] of [[1440,900],[760,800],[390,844],[320,600],[390,340]]) {
        await page.setViewportSize({width,height});
        const settings=page.locator(".calendar-category-manager");
        if(!await settings.evaluate(node=>node.open)) await settings.locator("summary").click();
        const panel=await page.locator(".calendar-category-body").evaluate(node=>{const rect=node.getBoundingClientRect();return{client:node.clientHeight,scroll:node.scrollHeight,x:rect.x,right:rect.right,bottom:rect.bottom,overflow:getComputedStyle(node).overflowY};});
        assert.ok(panel.scroll<=panel.client+1,`${width} category settings have no internal scrollbar`);
        assert.equal(panel.overflow,"visible");
        assert.ok(panel.x>=0 && panel.right<=width,`${width} category settings fit horizontally`);
        if(height>=800) assert.ok(panel.bottom<=height,`${width} category settings fully fit the tall viewport`);
        await page.locator("[data-delete-category]").scrollIntoViewIfNeeded();
        assert.equal(await page.locator("[data-delete-category]").isVisible(),true);
        const outer=await page.locator(".calendar-app").evaluate(node=>node.scrollWidth-node.clientWidth);
        assert.ok(outer<=2,`${width} outer horizontal overflow`);
        await page.screenshot({path:path.join(out,`category-settings-${width}-${height}.png`),fullPage:true});
      }
    }],
    ["task planning creates independent blocks and timer requires explicit action", async page => {
      const baseline=await page.evaluate(()=>JSON.stringify(fixture.workspace().tasks));
      for (let index=0;index<2;index++) { await page.locator("[data-add-event]").click(); await page.locator("[data-ev-title]").fill(`План задачи ${index}`); await page.locator("[data-ev-task]").selectOption("task"); await page.locator("[data-save-event]").click(); await page.locator("#editor").waitFor({state:"detached"}); }
      assert.equal(await page.evaluate(()=>fixture.workspace().events.filter(item=>item.taskId==="task").length),3);
      assert.equal(await page.evaluate(()=>JSON.stringify(fixture.workspace().tasks)),baseline);
      assert.equal(await page.evaluate(()=>fixture.timerStarts.length),0);
      await page.locator("[data-start-event-timer]").first().click(); assert.equal(await page.evaluate(()=>fixture.timerStarts.length),1);
      await page.locator("[data-open-task]").first().click(); assert.equal(await page.evaluate(()=>fixture.openedTasks[0]),"task");
    }],
    ["selected time range opens dated editor; keyboard equivalent remains available", async page => {
      await page.locator("[data-view]").selectOption("day"); await page.waitForFunction(()=>fixture.preferences.view==="day");
      const track=page.locator("[data-time-day]"); await track.evaluate(node=>{node.closest('.calendar-board').scrollTop=650;});
      const box=await track.boundingBox(); await page.mouse.move(box.x+box.width*.75,box.y+720); await page.mouse.down(); await page.mouse.move(box.x+box.width*.75,box.y+810,{steps:5}); await page.mouse.up();
      await page.locator("#editor").waitFor(); assert.equal(await page.locator("[data-ev-start]").inputValue(),"12:00"); assert.equal(await page.locator("[data-ev-end]").inputValue(),"13:30");
      await page.keyboard.press("Escape");
      await page.locator('[data-time-slot="840"]').focus(); await page.keyboard.press("Enter"); await page.locator("#editor").waitFor();
      assert.equal(await page.locator("[data-ev-start]").inputValue(),"14:00");
    }],
    ["drag ACK and resize refusal retain old position; retry writes one result", async page => {
      await page.locator("[data-view]").selectOption("day"); await page.waitForFunction(()=>fixture.preferences.view==="day");
      const card=page.locator('.calendar-timed-event[data-edit-event="block"]'); await card.scrollIntoViewIfNeeded();
      let box=await card.boundingBox(); await page.evaluate(()=>{fixture.hold={};});
      await page.mouse.move(box.x+10,box.y+12); await page.mouse.down(); await page.mouse.move(box.x+10,box.y+72,{steps:5}); await page.mouse.up();
      await page.waitForFunction(()=>typeof fixture.hold?.resolve==="function"); assert.equal(await page.evaluate(()=>fixture.workspace().events.find(item=>item.id==="block").start),"09:00");
      await page.evaluate(()=>{fixture.hold.resolve();fixture.hold=null;}); await page.waitForFunction(()=>fixture.workspace().events.find(item=>item.id==="block").start==="10:00");
      await page.evaluate(()=>{fixture.refuse=true;}); await card.scrollIntoViewIfNeeded(); box=await card.boundingBox();
      await page.evaluate(box=>{
        fixture.resizeEvidence={box,trackTop:document.querySelector('[data-time-day]').getBoundingClientRect().top,viewportHeight:innerHeight,hit:document.elementFromPoint(box.x+box.width*.5,box.y+box.height-3)?.outerHTML?.slice(0,240),events:[]};
        for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,event=>fixture.resizeEvidence.events.push({type,y:event.clientY,target:event.target.className,resizeHandle:Boolean(event.target.closest?.('[data-resize-event]')),trackTop:document.querySelector('[data-time-day]')?.getBoundingClientRect().top,boardScroll:document.querySelector('.calendar-board')?.scrollTop}),true);
      },box);
      await page.mouse.move(box.x+box.width*.5,box.y+box.height-3); await page.mouse.down(); await page.mouse.move(box.x+box.width*.5,box.y+box.height+27,{steps:5}); await page.mouse.up();
      await page.locator("#editor").waitFor(); assert.equal(await page.evaluate(()=>fixture.workspace().events.find(item=>item.id==="block").end),"11:00");
      console.log("calendar resize evidence:",JSON.stringify(await page.evaluate(()=>({...fixture.resizeEvidence,savedDraft:fixture.lastSavedDraft,editorParams:fixture.lastEditorParams,start:document.querySelector('[data-ev-start]').value,end:document.querySelector('[data-ev-end]').value}))));
      assert.equal(await page.locator("[data-ev-end]").inputValue(),"11:30"); await page.evaluate(()=>{fixture.refuse=false;}); await page.locator("[data-save-event]").click(); await page.locator("#editor").waitFor({state:"detached"});
      assert.equal(await page.evaluate(()=>fixture.workspace().events.find(item=>item.id==="block").end),"11:30"); assert.equal(await page.evaluate(()=>fixture.workspace().events.filter(item=>item.id==="block").length),1);
      assert.equal(await page.evaluate(()=>fixture.workspace().events.find(item=>item.id==="clash").title),"Скрытая встреча");
    }],
    ["recurrence scope uses base snapshot and actual occurrence dates", async page => {
      const tomorrow=await page.evaluate(()=>ZETER_CALENDAR_UTILS.calendarDateAdd(fixture.today,1));
      await page.evaluate(date=>fixture.mountEditor({eventId:"series",occurrenceDate:date}),tomorrow);
      assert.equal(await page.locator("[data-ev-date]").inputValue(),await page.evaluate(()=>fixture.today));
      await page.locator("[data-ev-scope]").selectOption("one"); assert.equal(await page.locator("[data-ev-date]").inputValue(),tomorrow);
      await page.locator("[data-ev-title]").fill("Одно изменённое"); await page.locator("[data-save-event]").click(); await page.locator("#editor").waitFor({state:"detached"});
      assert.equal(await page.evaluate(date=>ZETER_CALENDAR_UTILS.calendarEventsForDate(fixture.workspace().events,date).filter(item=>item.title==="Одно изменённое").length,tomorrow),1);
      assert.ok(await page.evaluate(date=>fixture.workspace().events.find(item=>item.id==="series").excludedDates.includes(date),tomorrow));
    }],
    ["persisted view and work hours survive remount; agenda is bounded actual occurrences", async page => {
      await page.evaluate(()=>{fixture.preferences.view="week";fixture.calendar.view="month";fixture.mountCalendar();}); assert.equal(await page.locator("[data-view]").inputValue(),"week");
      await page.locator(".calendar-options summary").click(); await page.locator("[data-work-start]").fill("08:00"); await page.locator("[data-work-start]").dispatchEvent("change");
      await page.waitForFunction(()=>fixture.preferences.workStart==="08:00");
      await page.locator("[data-view]").selectOption("agenda"); await page.waitForFunction(()=>fixture.preferences.view==="agenda");
      const today=await page.evaluate(()=>fixture.today), to=await page.evaluate(()=>ZETER_CALENDAR_UTILS.calendarDateAdd(fixture.today,2));
      await page.locator("[data-agenda-from]").fill(today); await page.locator("[data-agenda-to]").fill(to); await page.locator("[data-agenda-to]").dispatchEvent("change");
      assert.equal(await page.locator('.agenda-row [data-edit-event="series"]').count(),3);
    }],
    ["month capacity follows cell size, counts hidden events and uses narrow dots", async page => {
      await page.evaluate(()=>{for(let index=0;index<8;index++)fixture.workspace().events.push({id:`density_${index}`,title:`Плотный план ${index}`,date:fixture.today,start:`${String(10+index).padStart(2,'0')}:00`,end:`${String(11+index).padStart(2,'0')}:00`});fixture.mountCalendar();});
      const capacity=()=>page.evaluate(()=>{const cell=document.querySelector(`.day-cell[data-day="${fixture.today}"]`),buttons=[...cell.querySelectorAll('.calendar-cell-events > button')],visible=buttons.filter(node=>getComputedStyle(node).display!=='none'),more=[...cell.querySelectorAll('.calendar-more')].find(node=>getComputedStyle(node).display!=='none');return{visible:visible.length,more:Number(more?.textContent.replace('+','')||0),total:ZETER_CALENDAR_UTILS.calendarEventsForDate(fixture.workspace().events,fixture.today).length+1,dot:visible[0]?.getBoundingClientRect().width};});
      await page.setViewportSize({width:1440,height:1300});
      const wide=await capacity(); assert.ok(wide.visible>=3); assert.equal(wide.visible+wide.more,wide.total);
      await page.setViewportSize({width:320,height:600});
      const narrow=await capacity(); assert.ok(narrow.visible<wide.visible); assert.equal(narrow.visible+narrow.more,narrow.total); assert.ok(narrow.dot<=8,'narrow month uses dots rather than clipped letters');
      assert.equal(await page.locator('.event-list .event-card').count(),narrow.total-1,'selected day keeps the complete event list');
      await page.screenshot({path:path.join(out,'month-density-320.png'),fullPage:true});
    }],
    ["future recurrence edits preserve changed exclusions through refusal and retry", async page => {
      await page.evaluate(()=>{
        const add=ZETER_CALENDAR_UTILS.calendarDateAdd;
        fixture.workspace().events.find(item=>item.id==='series').excludedDates=[add(fixture.today,2)];
        fixture.mountEditor({eventId:'series',occurrenceDate:add(fixture.today,1),scope:'future'});
      });
      const excluded=await page.evaluate(()=>ZETER_CALENDAR_UTILS.calendarDateAdd(fixture.today,3));
      await page.locator('#editor .calendar-editor-details summary').click();
      await page.locator('[data-ev-excluded]').fill(excluded);
      const before=await page.evaluate(()=>JSON.stringify(fixture.workspace().events));
      await page.evaluate(()=>{fixture.refuse=true;});await page.locator('[data-save-event]').click();
      await page.waitForFunction(()=>fixture.toasts.some(row=>row[0]==='Не удалось сохранить событие'));
      assert.equal(await page.locator('[data-ev-excluded]').inputValue(),excluded);
      assert.equal(await page.evaluate(()=>JSON.stringify(fixture.workspace().events)),before);
      await page.evaluate(()=>{fixture.refuse=false;});await page.locator('[data-save-event]').click();await page.locator('#editor').waitFor({state:'detached'});
      const evidence=await page.evaluate(()=>{
        const add=ZETER_CALENDAR_UTILS.calendarDateAdd, split=fixture.workspace().events.find(item=>item.id!=='series'&&item.title==='Ежедневный план');
        return {excluded:split.excludedDates,restored:ZETER_CALENDAR_UTILS.occursOn(split,add(fixture.today,2)),skipped:ZETER_CALENDAR_UTILS.occursOn(split,add(fixture.today,3)),pastUntil:fixture.workspace().events.find(item=>item.id==='series').repeatUntil,disk:fixture.disk.desktops[0].data.events.find(item=>item.id===split.id).excludedDates};
      });
      assert.deepEqual(evidence,{excluded:[excluded],restored:true,skipped:false,pastUntil:await page.evaluate(()=>fixture.today),disk:[excluded]});
    }],
    ["agenda search filters series before applying its occurrence cap", async page => {
      await page.evaluate(()=>{
        const add=ZETER_CALENDAR_UTILS.calendarDateAdd;
        fixture.workspace().events=[...Array.from({length:14},(_,index)=>({id:`dense_${index}`,title:`Частая серия ${index}`,date:fixture.today,start:'09:00',end:'10:00',repeat:'daily'})),{id:'wanted',title:'Нужная встреча',date:add(fixture.today,364),start:'11:00',end:'12:00'}];
        fixture.mountCalendar();
      });
      await page.locator('[data-view]').selectOption('agenda');await page.waitForFunction(()=>fixture.preferences.view==='agenda');
      await page.locator('.calendar-options summary').click();
      await page.locator('[data-agenda-to]').fill(await page.evaluate(()=>ZETER_CALENDAR_UTILS.calendarDateAdd(fixture.today,365)));
      await page.locator('[data-agenda-to]').dispatchEvent('change');
      await page.locator('[data-calendar-search]').fill('Нужная встреча');
      assert.equal(await page.locator('.agenda-row [data-edit-event="wanted"]').count(),1,"matching event beyond unrelated series must remain searchable");
    }],
    ["only the active recurrence deletion menu can target a series", async page => {
      await page.evaluate(() => {
        fixture.workspace().events.push({ id:"second-series", title:"Вторая серия", date:fixture.today, start:"18:00", end:"19:00", repeat:"daily" });
        fixture.mountCalendar();
      });
      const first=page.locator('.event-card').filter({has:page.locator('[data-delete-event="series"]')}), second=page.locator('.event-card').filter({has:page.locator('[data-delete-event="second-series"]')});
      await first.locator('[data-delete-event]').click(); await second.locator('[data-delete-event]').click();
      assert.equal(await first.locator('[data-delete-scope]').count(),0,"opening another series must remove the old menu before its target changes");
      assert.equal(await second.locator('[data-delete-scope]').count(),3);
      await second.locator('[data-delete-scope="one"]').click();
      await page.waitForFunction(()=>fixture.workspace().events.find(item=>item.id==="second-series").excludedDates?.includes(fixture.today));
      assert.equal(await page.evaluate(()=>Boolean(fixture.workspace().events.find(item=>item.id==="series").excludedDates?.includes(fixture.today))),false);
      assert.equal(await page.evaluate(()=>fixture.disk.desktops[0].data.events.length),7);
    }],
    ["removed project and category filters reveal remaining events after refresh", async page => {
      await page.locator('[data-calendar-project]').selectOption('project');
      assert.equal(await page.locator('.event-list .event-card').count(),1);
      await page.evaluate(()=>{fixture.workspace().taskProjects=[];fixture.workspace().tasks[0].projectId='';fixture.workspace().events[0].projectId='';document.querySelector('.calendar-app').refreshCalendar();});
      assert.equal(await page.locator('[data-calendar-project]').inputValue(),'');
      assert.equal(await page.locator('.event-list .event-card').count(),6,"a removed project must not leave an invisible filter active");
      await page.evaluate(()=>{fixture.workspace().calendarCategories=[{id:'calcat_removed',name:'Временная',color:'#7aa8ff'}];fixture.workspace().events[0].category='calcat_removed';fixture.mountCalendar();});
      await page.locator('[data-calendar-category]').selectOption('calcat_removed');
      assert.equal(await page.locator('.event-list .event-card').count(),1);
      await page.evaluate(()=>{fixture.workspace().calendarCategories=[];fixture.workspace().events[0].category='work';document.querySelector('.calendar-app').refreshCalendar();});
      assert.equal(await page.locator('[data-calendar-category]').inputValue(),'');
      assert.equal(await page.locator('.event-list .event-card').count(),6,"a transferred category must not leave an invisible filter active");
    }],
    ["single occurrence can move beyond the original series end with refusal and retry", async page => {
      const before = await page.evaluate(() => {
        fixture.workspace().events = fixture.workspace().events.map(event => ZETER_DATA_NORMALIZERS.normalizeCalendarEvent(event));
        syncLegacyWorkspaceAliases(state); return JSON.stringify(state);
      });
      await page.evaluate(() => fixture.mountEditor({ eventId: "series", occurrenceDate: fixture.today, scope: "one" }));
      const moved = await page.evaluate(() => ZETER_CALENDAR_UTILS.calendarDateAdd(fixture.today, 10));
      await page.locator("[data-ev-date]").fill(moved); await page.locator("[data-ev-end-date]").fill(moved);
      await page.evaluate(() => { fixture.refuse = true; }); await page.locator("[data-save-event]").click();
      await page.waitForFunction(() => fixture.toasts.length > 0);
      assert.equal(await page.evaluate(() => fixture.writes), 1, "a single occurrence must reach persistence without the series repeatUntil restriction");
      assert.equal(await page.evaluate(() => JSON.stringify(state)), before);
      assert.equal(await page.locator("[data-ev-date]").inputValue(), moved);
      await page.evaluate(() => { fixture.refuse = false; }); await page.locator("[data-save-event]").click();
      await page.locator("#editor").waitFor({ state: "detached" });
      const evidence = await page.evaluate(() => ({ events: fixture.workspace().events, disk: fixture.disk.desktops[0].data.events, other: state.desktops[1] }));
      const detached = evidence.events.find(item => item.id.startsWith("fixture_"));
      assert.equal(detached.date, moved); assert.equal(detached.repeat, "none"); assert.equal(detached.repeatUntil, "");
      assert.deepEqual(evidence.events.find(item => item.id === "series").excludedDates, [JSON.parse(before).desktops[0].data.events[5].date]);
      assert.deepEqual(evidence.events, evidence.disk); assert.deepEqual(evidence.other, JSON.parse(before).desktops[1]);
    }],
    ["future deletion from the first occurrence removes the empty series only after ACK", async page => {
      const before = await page.evaluate(() => { syncLegacyWorkspaceAliases(state); return JSON.stringify(state); });
      const card = page.locator('.event-card').filter({ has: page.locator('[data-delete-event="series"]') });
      await card.locator('[data-delete-event]').click();
      await page.evaluate(() => { fixture.refuse = true; }); await card.locator('[data-delete-scope="future"]').click();
      await page.waitForFunction(() => fixture.toasts.some(row => row[0] === "Не удалось удалить событие"));
      assert.equal(await page.evaluate(() => JSON.stringify(state)), before);
      await page.evaluate(() => { fixture.refuse = false; fixture.hold = {}; }); await card.locator('[data-delete-scope="future"]').click();
      await page.waitForFunction(() => typeof fixture.hold?.resolve === "function");
      assert.equal(await page.evaluate(() => JSON.stringify(state)), before);
      await page.evaluate(() => { fixture.hold.resolve(); fixture.hold = null; });
      await page.waitForFunction(() => !fixture.workspace().events.some(item => item.id === "series"));
      assert.deepEqual(await page.evaluate(() => fixture.disk.desktops[0].data.events), JSON.parse(before).desktops[0].data.events.filter(item => item.id !== "series"));
      assert.deepEqual(await page.evaluate(() => state.desktops[1]), JSON.parse(before).desktops[1]);
    }],
    ["invalid excluded dates retain the draft and require correction before saving", async page => {
      await page.evaluate(() => fixture.mountEditor({ eventId: "series" }));
      await page.locator(".calendar-editor-details summary").click();
      const before = await page.evaluate(() => JSON.stringify(state));
      await page.locator("[data-ev-excluded]").fill("2027-02-30, invalid-date");
      await page.locator("[data-save-event]").click();
      await page.waitForFunction(() => fixture.toasts.length > 0);
      assert.equal(await page.locator("#editor").count(), 1, "invalid exclusions must not be silently discarded");
      assert.equal(await page.evaluate(() => fixture.writes), 0);
      assert.equal(await page.evaluate(() => JSON.stringify(state)), before);
      assert.equal(await page.locator("[data-ev-excluded]").inputValue(), "2027-02-30, invalid-date");
      await page.locator("[data-ev-excluded]").fill(await page.evaluate(() => ZETER_CALENDAR_UTILS.calendarDateAdd(fixture.today, 1)));
      await page.locator("[data-save-event]").click(); await page.locator("#editor").waitFor({ state: "detached" });
      assert.deepEqual(await page.evaluate(() => fixture.workspace().events.find(item => item.id === "series").excludedDates), [await page.evaluate(() => ZETER_CALENDAR_UTILS.calendarDateAdd(fixture.today, 1))]);
    }],
    ["disabling recurrence permits a date beyond the old end and retains retry draft", async page => {
      const target = await page.evaluate(() => ZETER_CALENDAR_UTILS.calendarDateAdd(fixture.today, 5));
      await page.evaluate(() => { fixture.mountEditor({ eventId: "series" }); fixture.refuse = true; });
      const before = await page.evaluate(() => structuredClone(fixture.workspace().events));
      await page.locator(".calendar-editor-details summary").click();
      await page.locator("[data-ev-repeat-interval]").fill("0");
      await page.locator("[data-ev-excluded]").fill("2027-02-30");
      await page.locator("[data-ev-repeat]").selectOption("none");
      await page.locator("[data-ev-date]").fill(target);
      await page.locator("[data-ev-end-date]").fill(target);
      await page.locator("[data-save-event]").click();
      await page.waitForFunction(() => fixture.toasts.length > 0);
      assert.equal(await page.evaluate(() => fixture.writes), 1, "inactive recurrence settings must not block a non-repeating event");
      assert.deepEqual(await page.evaluate(() => fixture.workspace().events), before);
      assert.equal(await page.locator("[data-ev-date]").inputValue(), target);
      assert.equal(await page.locator("[data-ev-repeat]").inputValue(), "none");
      assert.equal(await page.locator("[data-ev-repeat-interval]").inputValue(), "0", "refusal must retain the form draft");
      await page.evaluate(() => { fixture.refuse = false; });
      await page.locator("[data-save-event]").click(); await page.locator("#editor").waitFor({ state: "detached" });
      assert.equal(await page.evaluate(date => ZETER_CALENDAR_UTILS.calendarEventsForDate(fixture.workspace().events, date).filter(item => item.id === "series").length, target), 1);
      assert.equal(await page.evaluate(() => fixture.disk.events.find(item => item.id === "series").repeatUntil), "");
      assert.equal(await page.evaluate(() => fixture.disk.events.find(item => item.id === "series").repeatInterval), 1);
      assert.deepEqual(await page.evaluate(() => fixture.workspace().events.filter(item => item.id !== "series")), before.filter(item => item.id !== "series"));
    }],
    ["disabling recurrence removes hidden exceptions that would hide the saved event", async page => {
      await page.evaluate(() => {
        fixture.workspace().events.find(item => item.id === "series").excludedDates = [fixture.today];
        fixture.mountEditor({ eventId: "series" });
      });
      await page.locator(".calendar-editor-details summary").click();
      await page.locator("[data-ev-repeat]").selectOption("none");
      await page.locator("[data-save-event]").click(); await page.locator("#editor").waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => ZETER_CALENDAR_UTILS.calendarEventsForDate(fixture.workspace().events, fixture.today).filter(item => item.id === "series").length), 1, "saved non-repeating event must remain visible on its date");
      assert.deepEqual(await page.evaluate(() => fixture.disk.events.find(item => item.id === "series").excludedDates), []);
      await page.evaluate(() => { state = structuredClone(fixture.disk); fixture.mountCalendar(); });
      assert.equal(await page.locator('.event-card [data-edit-event="series"]').count(), 1);
    }],
    ["narrow, short, keyboard and long-label layout", async page => {
      for (const [width,height] of [[1440,900],[390,844],[320,600],[390,340]]) {
        await page.setViewportSize({width,height}); await page.evaluate(()=>{document.querySelector('#host').style.height='calc(100vh - 16px)';});
        const overflow=await page.locator(".calendar-app").evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth})); assert.ok(overflow.scroll<=overflow.client+2,`${width} outer horizontal overflow`);
        await page.locator(".calendar-category-trigger").click();
        const categoryPanel = await page.locator(".calendar-category-create-body").boundingBox();
        assert.ok(categoryPanel.x >= 0 && categoryPanel.x + categoryPanel.width <= width, `${width} category panel fits horizontally`);
        await page.screenshot({path:path.join(out,`categories-${width}-${height}.png`),fullPage:true});
        await page.locator(".calendar-category-trigger").click();
        await page.screenshot({path:path.join(out,`month-${width}-${height}.png`),fullPage:true});
        await page.locator("[data-add-event]").click(); await page.locator("[data-ev-title]").fill("Очень длинное название события для проверки узкого окна и переноса текста");
        await page.locator("[data-save-event]").scrollIntoViewIfNeeded(); assert.equal(await page.locator("[data-save-event]").isVisible(),true);
        const editorOverflow=await page.locator("#editor").evaluate(node=>node.scrollWidth-node.clientWidth); assert.ok(editorOverflow<=2,`${width} editor overflow`);
        await page.screenshot({path:path.join(out,`editor-${width}-${height}.png`),fullPage:true}); await page.keyboard.press("Escape");
      }
    }]
  ];
  try {
    browser=await chromium.launch({chromiumSandbox:true,headless:false});
    for (const [name,check] of cases) {
      if (caseNames && !caseNames.some(part => name.includes(part))) continue;
      const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:"block"}),page=await context.newPage(),errors=[];
      page.setDefaultTimeout(10000);
      page.on("pageerror",error=>errors.push(error.message));
      await context.route("**/*",route=>{const url=route.request().url();if(!url.startsWith(preview.url))return route.abort();if(url===preview.url)return route.fulfill({contentType:"text/html",body:'<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="css/style.css"><style>body{margin:0;padding:8px;box-sizing:border-box}#host{height:calc(100vh - 16px)}#editor{position:fixed;inset:8px;z-index:99;background:#142035;overflow:auto;padding:8px;box-sizing:border-box}</style></head><body><main id="host"></main></body></html>'});return route.continue();});
      try {
        await page.goto(preview.url);for(const file of files)await page.addScriptTag({url:new URL(file,preview.url).href});await page.addScriptTag({content:adapter});
        await page.evaluate(()=>{
          const today=ZETER_CORE_UTILS.todayISO(), add=ZETER_CALENDAR_UTILS.calendarDateAdd;
          window.state={desktops:[{id:"desktop",data:{events:[{id:"block",title:"Основной блок",date:today,endDate:today,start:"09:00",end:"10:00",taskId:"task",projectId:"project",projectName:"Проект"},{id:"clash",title:"Скрытая встреча",date:today,start:"09:30",end:"10:30",category:"health"},{id:"early",title:"Раннее событие",date:today,start:"01:00",end:"02:00"},{id:"late",title:"Позднее событие",date:today,start:"23:00",end:"23:45"},{id:"all",title:"На весь день",date:today,endDate:today,allDay:true},{id:"series",title:"Ежедневный план",date:today,start:"16:00",end:"17:00",repeat:"daily",repeatUntil:add(today,3)}],tasks:[{id:"task",title:"Исходная задача с длинным названием",due:today,status:"todo",projectId:"project"}],taskProjects:[{id:"project",name:"Проект"}],calendarCategories:[]}},{id:"other",data:{events:[{id:"sentinel",title:"Другой стол"}]}}],fs:{material:{id:"material",name:"Тестовый материал"}}};
          window.fixture={today,toasts:[],writes:0,refuse:false,hold:null,openedTasks:[],openedFiles:[],timerStarts:[],calendar:{view:"month",date:today,selected:today},preferences:{view:"month",workStart:"09:00",workEnd:"18:00",showTaskDeadlines:true}};
          fixture.workspace=()=>state.desktops[0].data;let serial=0,chain=Promise.resolve();window.uid=()=>`fixture_${++serial}`;window.syncLegacyWorkspaceAliases=value=>{value.events=value.desktops[0].data.events;};window.automationEventBaseline=new Map();window.scheduleAutomationCheck=()=>{};window.createAutomationRuntimeController=ZETER_AUTOMATION_UTILS.createAutomationRuntimeController;
          window.queueAutomationMutation=operation=>{const result=chain.catch(()=>{}).then(operation);chain=result.catch(()=>{});return result;};
          const queue=ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({getState:()=>state,cloneState:structuredClone,writesAllowed:()=>true,nativeStorage:()=>true,writePrimaryRecord:async snapshot=>{fixture.writes++;if(fixture.hold)await new Promise(resolve=>{fixture.hold.resolve=resolve;});if(fixture.refuse)throw new Error("Искусственный отказ записи");fixture.disk=structuredClone(snapshot);return{updatedAt:1};}});
          window.persistSearchAwareTransaction=operation=>queue.transaction(operation);const options=calendarPersistenceOptions("desktop");fixture.controller=ZETER_CALENDAR_UTILS.createCalendarEventController(options);
          const common={document,formatDate:value=>(typeof value === "string" ? ZETER_CORE_UTILS.parseISO(value) : value).toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"}),getCalendar:()=>fixture.calendar,setCalendar:value=>{fixture.calendar=value;},getEvents:()=>fixture.workspace().events,getTasks:()=>fixture.workspace().tasks,getTaskProjects:()=>fixture.workspace().taskProjects,getCategories:()=>fixture.workspace().calendarCategories,getCalendarPreferences:()=>fixture.preferences,
            saveCalendarPreferences:async patch=>{await queue.transaction(async write=>{const snapshot=structuredClone(state);snapshot.desktops[0].data.preferences={...fixture.preferences,...patch};await write(snapshot);fixture.preferences={...fixture.preferences,...patch};});},
            saveCategory:async(draft,id,original)=>queue.transaction(async write=>{const list=structuredClone(fixture.workspace().calendarCategories),previous=list.find(item=>item.id===id);if(id&&JSON.stringify(previous)!==JSON.stringify(original))throw new Error("Категория изменена в другом окне");const category={...draft,id:id||`calcat_${++serial}`};const categories=id?list.map(item=>item.id===id?category:item):[...list,category];const snapshot=structuredClone(state);snapshot.desktops[0].data.calendarCategories=categories;await write(snapshot);fixture.workspace().calendarCategories=categories;return category;}),
            deleteCategory:async(id,replacement,original)=>queue.transaction(async write=>{const previous=fixture.workspace().calendarCategories.find(item=>item.id===id);if(JSON.stringify(previous)!==JSON.stringify(original))throw new Error("Категория изменена в другом окне");const snapshot=structuredClone(state),workspace=snapshot.desktops[0].data;workspace.calendarCategories=workspace.calendarCategories.filter(item=>item.id!==id);workspace.events=workspace.events.map(event=>event.category===id?{...event,category:replacement}:event);await write(snapshot);fixture.workspace().calendarCategories=workspace.calendarCategories;fixture.workspace().events=workspace.events;}),
            openProjectSettings:(id,onSaved)=>{const project=fixture.workspace().taskProjects.find(item=>item.id===id);const controller=ZETER_TASK_APP_UI_UTILS.createTaskProjectSettingsController({getStore:fixture.workspace,persistTransaction:operation=>queue.transaction(operation),saveSnapshot:async(write,candidate)=>{const snapshot=structuredClone(state);Object.assign(snapshot.desktops[0].data,candidate);return write(snapshot);}});ZETER_TASK_APP_UI_UTILS.showTaskProjectSettingsDialog(document,project,controller,onSaved,{autoSave:true});},
            openProjectCreator:onCreated=>{const creation=ZETER_TASK_APP_UI_UTILS.createTaskCreationController({getWorkspace:fixture.workspace,persistTransaction:operation=>queue.transaction(operation),saveSnapshot:async(write,candidate)=>{const snapshot=structuredClone(state);Object.assign(snapshot.desktops[0].data,candidate);return write(snapshot);}});ZETER_TASK_APP_UI_UTILS.showTaskProjectDialog(document,creation.createProject,onCreated);},
            getAttachmentCandidates:()=>[{kind:"fs",id:"material",title:"Тестовый материал"}],resolveAttachment:ref=>state.fs[ref.id]?{title:state.fs[ref.id].name}:null,openAttachment:ref=>fixture.openedFiles.push(ref.id),openTask:id=>fixture.openedTasks.push(id),startEventTimer:event=>fixture.timerStarts.push(event.id),saveEventRecord:(...args)=>{fixture.lastSavedDraft=structuredClone(args[0]);return fixture.controller.saveEvent(...args);},removeEvent:(...args)=>fixture.controller.removeEvent(...args),openEventEditor:params=>{fixture.lastEditorParams=structuredClone(params);fixture.mountEditor(params);},refreshOpenCalendars:()=>document.querySelectorAll(".calendar-app").forEach(node=>node.refreshCalendar()),todayISO:()=>fixture.today,toast:(...args)=>fixture.toasts.push(args),confirmUser:message=>{(fixture.confirmations ||= []).push(message);return fixture.allowConfirm!==false;},closeWindow:()=>document.querySelector('#editor')?.remove()};
          fixture.mountCalendar=()=>document.querySelector('#host').replaceChildren(ZETER_CALENDAR_UI_UTILS.createCalendarApp(common));fixture.mountEditor=params=>{document.querySelector('#editor')?.remove();const node=ZETER_CALENDAR_UI_UTILS.createCalendarEventEditorApp(params,"editor",common);node.id="editor";document.body.appendChild(node);};fixture.mountCalendar();
        });
        await check(page);assert.deepEqual(errors,[]);results.push({name,status:"PASS"});console.log(`calendar planner PASS: ${name}`);
      } catch(error) {results.push({name,status:"FAIL",error:error.message,pageErrors:errors});console.error(`calendar planner FAIL: ${name}: ${error.message}`);await page.screenshot({path:path.join(out,`failure-${results.length}.png`),fullPage:true});}
      finally {await context.close();}
    }
  } finally {
    const fingerprints=Object.fromEntries([...files,"js/app.js","css/60-apps-calendar-notes-tables.css"].map(file=>[file,crypto.createHash("sha256").update(fs.readFileSync(path.join(root,"app",file))).digest("hex")]));
    fs.writeFileSync(path.join(out,"results.json"),JSON.stringify({results,fingerprints},null,2));await browser?.close();await preview.close();
  }
  const failures = results.filter(result => result.status === "FAIL");
  if (failures.length) throw new AggregateError(failures.map(result => new Error(`${result.name}: ${result.error}`)), `${failures.length} calendar planner scenarios failed; see results.json`);
  return results;
}
module.exports={runCalendarPlannerSmoke};
