"use strict";

// Explicit browser entrypoint. No application or storage is opened by importing this module.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runTrainingSmoke({chromium, startPreview, outputDir, browserExecutable, widths = [1440, 390], autoplay = false, startLesson = 0}) {
  const root = path.resolve(__dirname, "..");
  const out = outputDir || path.join(root, "work/training-live-qa");
  fs.mkdirSync(out, {recursive:true});
  const preview = await startPreview({root:path.join(root,"app"),allow:["index.html","js","css","assets","manifest.json"],ttlSeconds:600});
  let browser, primaryError;
  const results = [];
  try {
    browser = await chromium.launch({headless:true,chromiumSandbox:true,...(browserExecutable ? {executablePath:browserExecutable} : {})});
    for (const width of widths) {
      // Playwright's serviceWorkers:block init script itself reads the prohibited
      // serviceWorker getter in opaque frames. Instead prevent registration before boot.
      const context = await browser.newContext({viewport:{width,height:width<600?740:900},reducedMotion:autoplay ? "no-preference" : "reduce"});
      try {
        await context.addInitScript(() => {
          if(window !== top) return;
          window.__ZETER_UI_PREVIEW__ = true;
          document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.zeterWebManaged = "true"; });
        });
        const page = await context.newPage(), errors=[];
        page.on("pageerror",error=>errors.push(error.message));
        await page.route("**/*",route => {
          const url=route.request().url();
          return url.startsWith(preview.url) && !url.endsWith("service-worker.js") ? route.continue() : route.abort();
        });
        await page.goto(preview.url);
        await page.locator("#boot").waitFor({state:"hidden"});
        await page.locator("[data-first-quick]").click();
        await page.locator(".first-run-lesson-picker").waitFor();
        await page.evaluate(() => {
          localStorage.setItem("training-parent-sentinel","keep");
          sessionStorage.setItem("training-parent-sentinel","keep");
        });
        const parentState = () => page.evaluate(async () => {
          const record = await ZETER_STORAGE_UTILS.readIndexedDbRecord("zeter-os-primary-state","osState","current");
          const {fs,desktops,tasks,events} = record.state;
          return JSON.stringify({fs,desktops,tasks,events});
        });
        const before = await parentState();
        let firstFrame, firstTimeOrigin, firstToken;
        for(let lesson=startLesson;lesson<15;lesson++) {
          if (lesson === startLesson) await page.locator(`.first-run-lesson-picker [data-tour-select="${lesson}"]`).click();
          const status=page.locator("[data-live-status]");
          await page.waitForFunction(() => document.querySelector("[data-live-status]")?.dataset.liveAction || document.querySelector("[data-live-status]")?.dataset.liveResult);
          const child=page.frames().find(frame=>frame!==page.mainFrame());
          assert.ok(child);
          const identity = await child.evaluate(() => ({time:performance.timeOrigin,token:document.documentElement.dataset.trainingToken}));
          if (!firstFrame) { firstFrame=child; firstTimeOrigin=identity.time; firstToken=identity.token; }
          else {
            assert.equal(child,firstFrame,"lessons must reuse one frame");
            assert.equal(identity.time,firstTimeOrigin,"the application must not navigate between lessons");
            assert.equal(identity.token,firstToken);
          }
          assert.equal(await page.locator(".first-run-live-desktop").getAttribute("sandbox"),"allow-scripts");
          const isolated = await child.evaluate(async () => {
            let denied=false, networkDenied=false;
            try { void parent.document.body; } catch { denied=true; }
            try { await fetch(location.origin+"/training-must-not-connect"); } catch { networkDenied=true; }
            dispatchEvent(new Event("pywebviewready"));
            return {
              denied,networkDenied,indexedDb:indexedDB===null,
              local:localStorage.getItem("training-parent-sentinel"),
              session:sessionStorage.getItem("training-parent-sentinel"),
              native:ZETER_NATIVE_STORAGE.shouldUseNativeStorage(),
              nativeReady:await ZETER_NATIVE_STORAGE.waitForNativeStorage(),
              bridge:typeof pywebview
            };
          });
          assert.deepEqual(isolated,{denied:true,networkDenied:true,indexedDb:true,local:null,session:null,native:false,nativeReady:false,bridge:"undefined"});
          if(lesson===0) {
            const statusBefore=await status.textContent();
            const token=await child.evaluate(()=>document.documentElement.dataset.trainingToken);
            await page.evaluate(token=>window.postMessage({channel:"zeter-training",token,type:"complete",text:"FORGED"},"*"),token);
            assert.equal(await status.textContent(),statusBefore,"message from a different source must be ignored");
          }
          let last=0, outcome;
          if(autoplay) {
            await page.waitForFunction(() => document.querySelector("[data-live-status]")?.dataset.liveResult, null, {timeout:90000});
            outcome=await status.evaluate(el=>({result:el.dataset.liveResult,step:Number(el.dataset.liveAction),text:el.textContent}));
          } else for(let count=0;count<20;count++) {
            await page.waitForFunction(last=>{
              const el=document.querySelector("[data-live-status]");
              return el?.dataset.liveResult || Number(el?.dataset.liveAction)>last;
            },last,{timeout:25000});
            outcome=await status.evaluate(el=>({result:el.dataset.liveResult,step:Number(el.dataset.liveAction),text:el.textContent}));
            if(outcome.result) break;
            last=outcome.step;
            if(lesson===3 && last===5) await page.screenshot({path:path.join(out,`note-typing-${width}.png`)});
            await page.locator("[data-live-next]").click();
          }
          assert.equal(outcome.result,"complete",`lesson ${lesson+1}, action ${outcome.step} at ${width}px: ${outcome.text}`);
          const state=await child.evaluate(()=>ZETER_TRAINING_RUNTIME.readRecord("zeter-os-primary-state","osState","current").state);
          if(lesson===3) {
            const note=Object.values(state.fs).find(item=>item.name==="План недели");
            assert.ok(note);
            for(const text of ["Идеи на неделю.","Подготовить план проекта.","Встреча команды в среду.","Проверить задачи и сохранить копию."]) {
              assert.ok(note.content.includes(text));
            }
            assert.match(note.richContent,/<(b|strong)\b/);
            assert.match(note.richContent,/<(i|em)\b/);
            assert.match(note.richContent,/<u\b|text-decoration/);
            assert.match(note.richContent,/24px/);
          }
          if(lesson===4) assert.equal(state.currentDesktop,"training_projects");
          if(lesson===8) {
            if(width >= 700) assert.notEqual(state.fs.training_note.x,600);
            else assert.equal(await child.locator('.desktop-icon.selected').count(),2);
          }
          if(lesson===11) assert.ok(state.tasks.some(task=>task.title==="Отправить план проекта"));
          if(lesson===12) assert.ok(state.events.some(event=>event.title==="Встреча команды"));
          if(lesson===13) assert.equal(state.desktops[0].data.settings.wallpaper,"mint");
          if(lesson===14) { assert.equal(state.security.lastBackupVerified,true); assert.ok(state.security.lastFullBackupSize>0); }
          if([2,3,8,14].includes(lesson)) await page.screenshot({path:path.join(out,`lesson-${lesson+1}-${width}.png`)});
          assert.equal(await parentState(),before,"training must preserve the parent's actual materials");
          assert.equal(await page.evaluate(()=>localStorage.getItem("training-parent-sentinel")),"keep");
          assert.equal(await page.evaluate(()=>sessionStorage.getItem("training-parent-sentinel")),"keep");
          assert.equal(await page.evaluate(()=>document.activeElement?.tagName==="IFRAME"),false,"the playback must return focus to parent controls");
          results.push({width,lesson:lesson+1,status:"PASS",actions:outcome.step});
          console.log(`PASS live lesson ${lesson+1}/15 at ${width}px`);
          await page.locator("[data-tour-next]").click();
        }
        await page.locator('[data-first-backup-create]').waitFor();
        await page.locator("[data-tour-exit]").click();
        await page.locator(".first-run-screen").waitFor({state:"detached"});
        assert.equal(await page.locator("iframe").count(),0);
        assert.deepEqual(errors,[]);
      } finally { await context.close(); }
    }
  } catch(error) { primaryError=error; throw error; }
  finally {
    fs.writeFileSync(path.join(out,"results.json"),JSON.stringify({results,error:primaryError?.message || null},null,2));
    let cleanupError;
    try { await browser?.close(); } catch(error) {cleanupError=error;}
    try { await preview.close(); } catch(error) {cleanupError=cleanupError?new AggregateError([cleanupError,error]):error;}
    if(cleanupError) throw primaryError?new AggregateError([primaryError,cleanupError]):cleanupError;
  }
  return results;
}

module.exports = {runTrainingSmoke};
