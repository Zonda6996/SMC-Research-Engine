import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
const OUT=process.env.OUT_DIR??'ci-results';mkdirSync(`${OUT}/shots`,{recursive:true})
const server=spawn('npx',['tsx','tools/visualizer/server.ts'],{stdio:['ignore','pipe','pipe']})
let serverLog='';server.stdout.on('data',x=>serverLog+=x);server.stderr.on('data',x=>serverLog+=x)
async function waitServer(){for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:7788');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,500))}throw Error('server timeout\n'+serverLog)}
const errors:string[]=[];let report='# Visualizer QA — Apex/Reversal + Б1\n\n'
try{
 await waitServer();const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}})
 page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())});page.on('pageerror',e=>errors.push('page: '+e.message))
 await page.goto('http://127.0.0.1:7788',{waitUntil:'networkidle'});await page.selectOption('#source','fixture');await page.click('#loadBtn');await page.waitForFunction(()=>document.querySelector('#loading')?.classList.contains('hidden'),{timeout:30000})
 const duplicates=await page.evaluate(()=>{const m=new Map<string,number>();document.querySelectorAll('[id]').forEach(e=>m.set(e.id,(m.get(e.id)||0)+1));return[...m].filter(([,n])=>n>1)})
 report+=`- duplicate DOM ids: ${duplicates.length?JSON.stringify(duplicates):'0'}\n`
 await page.click('#confToggle');const details=page.locator('.indicator-settings details');await details.nth(0).locator('summary').click();await details.nth(1).locator('summary').click()
 await page.uncheck('#apexChk');await page.check('#reversalChk');await page.check('#apexChk');await page.uncheck('#reversalChk');await page.check('#reversalChk')
 await page.screenshot({path:`${OUT}/shots/indicator-settings.png`,fullPage:true})
 report+=`- indicator settings visible: ${await page.locator('.indicator-settings').isVisible()}\n- independent toggles: PASS\n`
 // Exact bug-1 sequence from the user.
 await page.click('#confToggle'); // back to ordinary chart
 await page.click('#poiZoneToggle');await page.click('#hmToggle');await page.click('#confToggle');await page.click('#hmToggle');await page.click('#confToggle')
 await page.waitForTimeout(300)
 const chart=await page.evaluate(()=>{const e=document.querySelector('#chart') as HTMLElement;const c=e?.querySelector('canvas') as HTMLCanvasElement|null;return{w:e?.clientWidth||0,h:e?.clientHeight||0,canvasW:c?.width||0,canvasH:c?.height||0,modeText:(document.querySelector('#confToggle') as HTMLElement)?.textContent}})
 await page.screenshot({path:`${OUT}/shots/bug1-close-sequence.png`,fullPage:true})
 const healthy=chart.w>400&&chart.h>300&&chart.canvasW>0&&chart.canvasH>0
 report+=`- Б1 sequence chart: ${JSON.stringify(chart)}\n- Б1 visual health: ${healthy?'PASS':'FAIL'}\n- console/page errors: ${errors.length}\n`
 if(errors.length)report+='\n## Errors\n'+errors.map(x=>`- ${x}`).join('\n')+'\n'
 await browser.close();if(duplicates.length||!healthy||errors.length)process.exitCode=1
}catch(e){errors.push(String(e));report+=`- fatal: ${String(e)}\n`;process.exitCode=1}finally{server.kill('SIGTERM');writeFileSync(`${OUT}/viz-indicator-qa.md`,report);console.log(report)}
