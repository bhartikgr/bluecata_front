import { chromium } from "playwright";
const BASE="http://localhost:5050";
const b=await chromium.launch({executablePath:"/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",args:["--no-sandbox"]});
const ctx=await b.newContext();
const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{email:"chapterless@opusaudit.test",password:"password123"},headers:{"content-type":"application/json"}});
console.log("LOGIN:", r.status());
const p=await ctx.newPage();
try{
  await p.goto(`${BASE}/collective/dashboard`,{waitUntil:"load",timeout:20000});
  await p.waitForTimeout(5000);
  await p.screenshot({path:"/home/user/workspace/build_spec/opus_logs/shots/chapterless_dashboard.png",fullPage:true});
  console.log("URL:", p.url());
  console.log("TEXT:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,400));
}catch(e){console.log("ERR:",e.message);}
await b.close();
