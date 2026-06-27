import { chromium } from "playwright";
const BASE="http://localhost:5050";
const b=await chromium.launch({executablePath:"/home/user/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",args:["--no-sandbox"]});
const ctx=await b.newContext();
const r=await ctx.request.post(`${BASE}/api/auth/login`,{data:{email:"admin@capavate.io",password:"adminpass"},headers:{"content-type":"application/json"}});
console.log("LOGIN:", r.status());
const p=await ctx.newPage();
try{
  await p.goto(`${BASE}/admin/dashboard`,{waitUntil:"load",timeout:20000});
  await p.waitForTimeout(6000);
  await p.screenshot({path:"/home/user/workspace/build_spec/opus_logs/shots/admin_dashboard.png",fullPage:true});
  console.log("ADMIN URL:", p.url());
  console.log("ADMIN TEXT:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,450));
}catch(e){console.log("ADMIN ERR:",e.message);}
try{
  await p.goto(`${BASE}/admin/regions`,{waitUntil:"load",timeout:20000});
  await p.waitForTimeout(5000);
  await p.screenshot({path:"/home/user/workspace/build_spec/opus_logs/shots/admin_regions.png",fullPage:true});
  console.log("REGIONS URL:", p.url());
  console.log("REGIONS TEXT:", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,450));
}catch(e){console.log("REGIONS ERR:",e.message);}
await b.close();
