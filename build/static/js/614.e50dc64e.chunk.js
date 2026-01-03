/*! For license information please see 614.e50dc64e.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[614],{7118:(e,s,n)=>{n.d(s,{A:()=>a});const a=(0,n(77784).A)("users",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["path",{d:"M16 3.13a4 4 0 0 1 0 7.75",key:"1da9ce"}]])},7365:(e,s,n)=>{n.d(s,{A:()=>a});const a=(0,n(77784).A)("settings",[["path",{d:"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",key:"1qme2f"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]])},14459:(e,s,n)=>{n.d(s,{A:()=>a});const a=(0,n(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},18233:(e,s,n)=>{n.r(s),n.d(s,{default:()=>M});var a=n(65043),t=n(62837),i=n(86213),r=n(73216),l=n(60184),c=n(45394),d=n(55930),o=n(49535),m=n(41680),x=n(65469),h=n(75088),p=n(7118),u=n(77784);const b=(0,u.A)("zap",[["path",{d:"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",key:"1xq2db"}]]);var g=n(77819),j=n(82054);const v=(0,u.A)("chart-column",[["path",{d:"M3 3v16a2 2 0 0 0 2 2h16",key:"c24i48"}],["path",{d:"M18 17V9",key:"2bz60n"}],["path",{d:"M13 17V5",key:"1frdt8"}],["path",{d:"M8 17v-3",key:"17ska0"}]]);var f=n(7365);const N=(0,u.A)("target",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"12",r:"6",key:"1vlfrh"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}]]);var y=n(20751),w=n(27836),k=n(89577),S=n(25581),_=n(70579);const z=e=>{let{onClose:s,records:n,nextround:t,nextRoundData:r}=e;const l=localStorage.getItem("InvestorData"),d=JSON.parse(l),[o,m]=(0,a.useState)(""),[x,h]=(0,a.useState)(0),[p,u]=(0,a.useState)(0),[b,g]=(0,a.useState)(null),[j,v]=(0,a.useState)("0"),[f,N]=(0,a.useState)(""),[y,z]=(0,a.useState)(0),[A,C]=(0,a.useState)(null),[F,E]=(0,a.useState)(!1),[R,T]=(0,a.useState)(0),[D,M]=(0,a.useState)(0),[I,P]=(0,a.useState)(""),[$,L]=(0,a.useState)("pending"),[O,W]=(0,a.useState)(0),[q,B]=(0,a.useState)(0),[J,Y]=(0,a.useState)(0),[V,H]=(0,a.useState)(0),[U,K]=(0,a.useState)(0),[G,Z]=(0,a.useState)("");var Q=S.J+"api/user/investor/";const[X,ee]=(0,a.useState)({}),[se,ne]=(0,a.useState)(0),[ae,te]=(0,a.useState)(0),[ie,re]=(0,a.useState)([]),[le,ce]=(0,a.useState)(0);(0,a.useEffect)((()=>{oe(),me(),de()}),[n]);const de=async()=>{if(n&&n.id)try{const e=parseFloat(n.issuedshares||0),s=parseFloat(n.roundsize||0);B(e);const a=e>0?s/e:0;K(a);const t={roundrecord_id:n.id,company_id:n.company_id},r=await i.A.post(Q+"getAllocatedShares",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log("API Response:",r.data);let l=0,c=0;r.data.success&&(l=parseFloat(r.data.allocated_shares||0),c=parseFloat(r.data.total_investment||0),console.log("Allocated Shares from API:",l),console.log("Allocated Investment from API:",c),0===l&&a>0&&c>0&&(l=c/a,console.log("Calculated allocated shares from investment:",l))),Y(l);const d=Math.max(0,e-l);W(d);const o=a*d;H(o),console.log("Final Calculation:"),console.log("Total Shares:",e),console.log("Allocated Shares:",l),console.log("Available Shares:",d),console.log("Price per Share:",a),console.log("Max Investment:",o)}catch(e){console.error("Error calculating available shares:",e);const s=parseFloat(n.issuedshares||0),a=parseFloat(n.roundsize||0),t=s>0?a/s:0;B(s),K(t),W(s),Y(0),H(t*s)}},oe=async()=>{let e={investor_id:d.id,company_id:n.company_id,roundrecord_id:n.id};try{const s=await i.A.post(Q+"getexistingShare",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});s.data.success?ce(s.data.existingShares):console.error("\u274c Error:",s.data.message)}catch(s){console.error("Error fetching capital round data:",s)}},me=async()=>{let e={investor_id:d.id,company_id:n.company_id,roundrecord_id:n.id};try{const n=await i.A.post(Q+"getcheckInvestorStatus",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(n.data.result.length>0){var s=n.data.result;E(!0),g(String(s[0].request_confirm))}else g(null),E(!1)}catch(a){console.error("Error fetching capital round data:",a),g(null)}},xe=()=>{try{const e=null===n||void 0===n?void 0:n.instrument_type_data;if(!e)return null;let s=e;return"string"===typeof s&&(s=JSON.parse(s)),"string"===typeof s&&(s=JSON.parse(s)),s}catch(e){return console.error("Error parsing instrument data:",e),null}};(0,a.useEffect)((()=>{var e,s,a,t,i;if(!n)return;let r=xe();if("string"===typeof r&&(r=JSON.parse(r)),n.liquidation)try{let e=n.liquidation;"string"===typeof e&&e.startsWith("[")?e=JSON.parse(e):"string"===typeof e&&(e=e.split(",").map((e=>e.trim())).filter((e=>e.length>0))),re(Array.isArray(e)?e:[e])}catch(l){console.error("Error parsing liquidation data:",l),re([])}switch(n.instrumentType){case"Common Stock":case"Preferred Equity":const l=parseFloat(n.issuedshares||0),c=parseFloat(n.roundsize||0);l>0&&c>0&&K(c/l),ee({...r,hasWarrants:(null===(e=r)||void 0===e?void 0:e.hasWarrants)||!1,hasWarrants_preferred:(null===(s=r)||void 0===s?void 0:s.hasWarrants_preferred)||!1});break;case"Safe":case"Convertible Note":ee({...r});break;case"Venture/Bank DEBT":ne(parseFloat(null===(a=r)||void 0===a?void 0:a.interestRate)||0),te(parseInt(null===(t=r)||void 0===t?void 0:t.repaymentSchedule)||12),ee({...r,hasWarrants_Bank:(null===(i=r)||void 0===i?void 0:i.hasWarrants_Bank)||!1})}}),[n]);const he="#F63C3F",pe="#FEEBEB",ue="#10B981",be="#ECFDF5",ge="#3B82F6",je="#EFF6FF",ve="#F59E0B",fe="#FEF3C7",Ne="#EF4444",ye="#FEE2E2",we="#1F2937",ke="#6B7280",Se="#E5E7EB";return n?(0,_.jsx)("div",{className:"main_popup-overlay",style:{backgroundColor:"rgba(0, 0, 0, 0.5)",position:"fixed",top:0,left:0,right:0,bottom:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1e3},children:(0,_.jsx)(w.Bs,{style:{backgroundColor:"white",borderRadius:"12px",padding:"24px",maxWidth:"850px",width:"90%",maxHeight:"90vh",overflow:"auto",boxShadow:"0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"},children:(0,_.jsxs)("div",{className:"previous-section-summary mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,_.jsx)("div",{className:"d-flex align-items-center mb-3 pb-2 border-bottom",children:(0,_.jsxs)("div",{className:"d-flex align-items-center justify-content-between gap-3 w-100",children:[(0,_.jsxs)("h3",{className:"mb-0 fw-semibold",style:{color:we},children:["Invest Now - ",n.nameOfRound||n.shareClassType]}),(0,_.jsx)("button",{type:"button",className:"bg-transparent p-1 border-0",onClick:s,style:{color:ke},children:(0,_.jsx)(c.LwM,{size:24})})]})}),(0,_.jsxs)("div",{className:"available-shares-section mb-4 p-3 rounded-3",style:{backgroundColor:je,border:`1px solid ${ge}`},children:[(0,_.jsxs)("div",{className:"d-flex justify-content-between align-items-center mb-2",children:[(0,_.jsx)("span",{className:"fw-semibold",style:{color:ge},children:"Round Availability"}),(0,_.jsx)("span",{className:"badge",style:{backgroundColor:ge,color:"white"},children:q>0?`${(J/q*100).toFixed(1)}% Filled`:"New Round"})]}),(0,_.jsx)("div",{className:"progress mb-2",style:{height:"10px",borderRadius:"5px"},children:(0,_.jsx)("div",{className:"progress-bar",role:"progressbar",style:{width:(q>0?J/q*100:0)+"%",backgroundColor:ge,borderRadius:"5px"}})}),(0,_.jsxs)("div",{className:"row text-center",children:[(0,_.jsxs)("div",{className:"col-4",children:[(0,_.jsx)("div",{className:"text-muted small",children:"Total Shares"}),(0,_.jsx)("div",{className:"fw-bold",children:q.toLocaleString()})]}),(0,_.jsxs)("div",{className:"col-4",children:[(0,_.jsx)("div",{className:"text-muted small",children:"Allocated"}),(0,_.jsx)("div",{className:"fw-bold",children:J.toLocaleString()})]}),(0,_.jsxs)("div",{className:"col-4",children:[(0,_.jsx)("div",{className:"text-muted small",children:"Available"}),(0,_.jsx)("div",{className:"fw-bold",style:{color:ue},children:O.toLocaleString()})]})]}),V>0&&(0,_.jsxs)("div",{className:"mt-3 pt-2 border-top",children:[(0,_.jsxs)("div",{className:"d-flex justify-content-between align-items-center",children:[(0,_.jsx)("span",{className:"text-muted small",children:"Maximum Investment:"}),(0,_.jsxs)("span",{className:"fw-bold",style:{color:he},children:[n.currency," ",V.toLocaleString(void 0,{minimumFractionDigits:2,maximumFractionDigits:2})]})]}),(0,_.jsxs)("div",{className:"d-flex justify-content-between align-items-center mt-1",children:[(0,_.jsx)("span",{className:"text-muted small",children:"Price per Share:"}),(0,_.jsxs)("span",{className:"fw-bold",children:[n.currency," ",U.toLocaleString(void 0,{minimumFractionDigits:3,maximumFractionDigits:3})]})]})]})]}),(0,_.jsx)("div",{className:"row g-3",children:(0,_.jsx)("div",{className:"col-md-12",children:(0,_.jsxs)("div",{className:"p-4 rounded-3 h-100",style:{backgroundColor:pe,border:`1px solid ${Se}`},children:[(0,_.jsx)("span",{className:"small fw-semibold text-uppercase",style:{color:ke},children:"Investment Details"}),ie.length>0&&!ie.includes("N/A")&&("Preferred Equity"===n.instrumentType||"Common Stock"===n.instrumentType||"Venture/Bank DEBT"===n.instrumentType)&&(0,_.jsx)("div",{className:"alert mt-3",style:{backgroundColor:fe,border:`1px solid ${ve}`,borderRadius:"8px",padding:"12px"},children:(0,_.jsxs)("div",{className:"d-flex align-items-start",children:[(0,_.jsx)("div",{className:"flex-shrink-0 me-2",children:(0,_.jsx)("svg",{width:"20",height:"20",fill:ve,viewBox:"0 0 20 20",children:(0,_.jsx)("path",{fillRule:"evenodd",d:"M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z",clipRule:"evenodd"})})}),(0,_.jsxs)("div",{className:"flex-grow-1",children:[(0,_.jsx)("strong",{style:{color:"#92400E"},children:"Liquidation Preference:"}),(0,_.jsx)("div",{className:"mt-1",style:{color:"#78350F"},children:ie.map(((e,s)=>(0,_.jsxs)("div",{className:"mb-1",children:["\u2022 ",e]},s)))})]})]})}),G&&(0,_.jsxs)("div",{className:"alert mt-3",style:{backgroundColor:ye,border:`1px solid ${Ne}`,color:Ne,borderRadius:"8px",padding:"16px"},children:[(0,_.jsx)("strong",{children:"Error:"})," ",G]}),"No"===b&&(0,_.jsx)("div",{className:"alert mt-3",style:{backgroundColor:be,border:`1px solid ${ue}`,color:ue,borderRadius:"8px",padding:"16px"},children:(0,_.jsx)("strong",{children:"Investment Submitted Successfully!"})}),"Yes"===b&&(0,_.jsx)("div",{className:"alert mt-3",style:{backgroundColor:je,border:`1px solid ${ge}`,color:ge,borderRadius:"8px",padding:"16px"},children:(0,_.jsx)("strong",{children:"Your Request Has Been Confirmed!"})}),null===b&&(0,_.jsxs)("form",{onSubmit:async e=>{e.preventDefault();const s=parseFloat(String(o).toString().replace(/,/g,""))||0;if(s<=0)return void Z("Please enter a valid investment amount");if(V>0&&s>V)return void Z(`Investment exceeds maximum allowed amount of ${n.currency}${V.toLocaleString()}`);const a=x;console.log(a,O);let t={investor_id:d.id,company_id:n.company_id,shares:parseFloat((Math.floor(100*x)/100).toFixed(2))||0,created_by_id:n.created_by_id,roundrecord_id:n.id,next_round_id:null===r||void 0===r?void 0:r.id,investment_amount:s,warrant_coverage_amount:R,warrant_exercise_price:D,warrant_shares:y,warrant_status:$};try{await i.A.post(Q+"InvestorrequestToCompany",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});g("No"),N("Investment request submitted successfully!"),Z(""),setTimeout((()=>{de(),g("No")}),4500)}catch(l){console.error("Error submitting investment:",l),g(null),Z("Error submitting investment. Please try again.")}},className:"mt-3",children:[(0,_.jsxs)("div",{className:"form-group mb-4",children:[(0,_.jsxs)("label",{className:"form-label fw-semibold mb-2 d-flex justify-content-between",style:{color:we},children:[(0,_.jsxs)("span",{children:["Enter Investment Amount (",n.currency,")"]}),V>0&&(0,_.jsxs)("span",{className:"small text-muted",children:["Max: ",n.currency," ",V.toLocaleString()]})]}),(0,_.jsx)(k.HG,{thousandSeparator:!0,decimalScale:2,fixedDecimalScale:!0,allowNegative:!1,placeholder:`Enter amount (Max: ${n.currency}${V.toLocaleString()})`,value:o,className:"form-control",onChange:e=>{Z("");let s=parseFloat(e.target.value.replace(/,/g,""))||0;V>0&&s>V&&(Z(`Maximum investment allowed: ${n.currency}${V.toLocaleString(void 0,{minimumFractionDigits:2,maximumFractionDigits:2})} (Based on available shares)`),s=V);const a=U;if(s>0&&s<a&&Z(`Minimum investment: ${n.currency}${a.toLocaleString(void 0,{minimumFractionDigits:2,maximumFractionDigits:2})} (Price for 1 share)`),m(s.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})),h(0),u(0),z(0),C(null),T(0),M(0),P(""),0===s)return;const i=parseFloat(le||0),l=parseFloat(n.roundsize||0);if(console.log(i,l),"Common Stock"===n.instrumentType||""===n.instrumentType){if(i>0&&l>0){const e=s/(l/i);h(Math.floor(100*e)/100);u(Number((e/(i+e)*100).toFixed(4)))}}else if("Preferred Equity"===n.instrumentType){if(i>0&&l>0){const e=s/(l/i);h(Math.floor(100*e)/100);u(Number((e/(i+e)*100).toFixed(4)));const a=xe();"Preferred Equity"===n.instrumentType&&((e,s)=>{if(z(0),T(0),M(0),P(""),L("pending"),!((null===s||void 0===s?void 0:s.hasWarrants_preferred)||(null===s||void 0===s?void 0:s.hasWarrants)))return;let a=0;if(s.warrant_coverage_percentage)a=parseFloat(s.warrant_coverage_percentage);else if(s.warrantRatio){const e=s.warrantRatio.split(":");if(2===e.length){const s=parseFloat(e[0]),n=parseFloat(e[1]);n>0&&(a=s/n*100)}}if(a<=0)return;const t=e*(a/100);T(t);let i=0,l="";const c=s.warrant_exercise_type||"fixed";if("next_round_adjusted"===c&&r){const e=parseFloat(r.issuedshares||0),a=parseFloat(r.roundsize||0);if(e>0&&a>0){const t=a/e,r=parseFloat(s.warrant_adjustment_percent||0),c=s.warrant_adjustment_direction||"decrease";i="decrease"===c?t*(1-r/100):t*(1+r/100),M(i),L("will_exercise"),l=`Exercise price: ${n.currency}${i.toFixed(2)} (Next round: ${n.currency}${t.toFixed(2)} ${"decrease"===c?"-":"+"} ${r}%)`}}else if("next_round"===c&&r){const e=parseFloat(r.issuedshares||0),s=parseFloat(r.roundsize||0);e>0&&s>0&&(i=s/e,M(i),L("will_exercise"),l=`Exercise price: ${n.currency}${i.toFixed(2)} (Next round price)`)}else(s.exercisePrice||s.exercisePrice_preferred)&&(i=parseFloat(s.exercisePrice||s.exercisePrice_preferred||0),M(i),L("fixed_price"),l=`Exercise price: ${n.currency}${i.toFixed(2)} (Fixed price)`);if(i>0){const e=t/i;z(Math.floor(100*e)/100)}else l="Warrant exercise price will be determined when next priced round occurs",L("pending");P(l)})(s,a)}}else if("Safe"===n.instrumentType){let e=xe();if(!e)return;const n=parseFloat(e.valuationCap||e.valuationCap_note||0),a=parseFloat(e.discountRate||e.discountRate_note||0),l=e.safeType||"POST_MONEY";if(0===n||0===i)return;let c=0;if(t&&r){const e=parseFloat(r.issuedshares||0),s=parseFloat(r.roundsize||0);if(e>0&&s>0){const t=n/i,r=s/e*(1-a/100);c=Math.min(t,r)}}else c=n/i;if(c>0){const e=s/c;if("POST_MONEY"===l){const a=s/n*100;h(Math.round(e)),u(Number(a.toFixed(2)))}else{const a=s/(n+s)*100;h(Math.round(e)),u(Number(a.toFixed(2)))}}}else if("Convertible Note"===n.instrumentType){let e=xe();if(!e)return;const n=parseFloat(e.valuationCap_note||0),a=parseFloat(e.discountRate_note||0),l=s+s*(parseFloat(e.interestRate_note||0)/100)*1;if(t&&r){const e=parseFloat(r.issuedshares||0),s=parseFloat(r.roundsize||0);if(e>0&&s>0){const t=n>0&&i>0?n/i:1/0,r=a>0?s/e*(1-a/100):1/0,c=l/Math.min(t,r),d=c/(i+c)*100;h(Number(c.toFixed(2))),u(Number(d.toFixed(4)))}}else if(n>0&&i>0){const e=l/(n/i),s=e/(i+e)*100;h(Number(e.toFixed(2))),u(Number(s.toFixed(4)))}}else if("Venture/Bank DEBT"===n.instrumentType){h(0),u(0);const e=xe();if(null!==e&&void 0!==e&&e.hasWarrants_Bank){const n=parseFloat(e.exercisePrice_bank||0),a=parseFloat(e.warrantRatio_bank||1);if(n>0){const e=s/n*a;z(Math.floor(100*e)/100)}}}},style:{borderColor:G?Ne:Se}}),O>0&&U>0&&(0,_.jsxs)("div",{className:"form-text mt-1",children:["Available: ",O.toLocaleString()," shares \xd7 ",n.currency,U.toFixed(3)," = ",n.currency,V.toLocaleString()]})]}),"Preferred Equity"===n.instrumentType&&(0,_.jsxs)(_.Fragment,{children:[(0,_.jsxs)("div",{className:"form-group mb-4",children:[(0,_.jsx)("label",{className:"form-label fw-semibold mb-2",children:"Price Per Share"}),(0,_.jsxs)("div",{className:"form-control-plaintext fw-bold",style:{color:he,fontSize:"18px"},children:[n.currency,U.toFixed(2)]})]}),(0,_.jsxs)("div",{className:"form-group mb-4",children:[(0,_.jsx)("label",{className:"form-label fw-semibold mb-2",children:"Shares You Will Receive"}),(0,_.jsxs)("div",{className:"form-control-plaintext fw-bold",style:{color:he,fontSize:"18px",backgroundColor:"white",padding:"12px",borderRadius:"8px",border:`1px solid ${Se}`},children:[x>0?x.toLocaleString():"0"," shares",O>0&&(0,_.jsx)("div",{className:"small text-muted mt-1",children:x>0?(0,_.jsxs)(_.Fragment,{children:["Uses ",(x/O*100).toFixed(1),"% of available shares"]}):(0,_.jsx)(_.Fragment,{children:"Enter investment amount to see shares"})})]})]}),(0,_.jsxs)("div",{className:"form-group mb-4",children:[(0,_.jsx)("label",{className:"form-label fw-semibold mb-2",children:"Ownership Percentage"}),(0,_.jsx)("div",{className:"form-control-plaintext fw-bold",style:{color:ge,fontSize:"18px",backgroundColor:"white",padding:"12px",borderRadius:"8px",border:`1px solid ${Se}`},children:p>0?`${p.toFixed(4)}%`:"0%"})]}),"Preferred Equity"===n.instrumentType&&(X.hasWarrants_preferred||X.hasWarrants)&&o&&parseFloat(o.replace(/,/g,""))>0&&(0,_.jsxs)("div",{className:"form-group mb-4",children:[(0,_.jsx)("label",{className:"form-label fw-semibold mb-2",children:"Warrant Information"}),(0,_.jsxs)("div",{className:"border rounded p-3 bg-white",children:[(0,_.jsxs)("div",{className:"mb-2",children:[(0,_.jsx)("strong",{children:"Warrant Coverage:"}),X.warrant_coverage_percentage?` ${X.warrant_coverage_percentage}%`:X.warrantRatio?` ${X.warrantRatio} ratio`:" Not specified",(0,_.jsxs)("div",{className:"small text-muted",children:["(",n.currency,R.toLocaleString(void 0,{minimumFractionDigits:2,maximumFractionDigits:2})," of ",o,")"]})]}),I&&(0,_.jsxs)("div",{className:"mb-2",children:[(0,_.jsx)("strong",{children:"Exercise Terms:"}),(0,_.jsx)("div",{className:"small text-success",children:I})]}),y>0&&(0,_.jsxs)("div",{className:"mb-2",children:[(0,_.jsx)("strong",{children:"Potential Warrant Shares:"}),(0,_.jsxs)("div",{className:"fw-bold",style:{color:ue},children:[y.toLocaleString()," shares"]})]}),(0,_.jsxs)("div",{className:"mt-2",children:[(0,_.jsx)("span",{className:"badge "+("will_exercise"===$?"bg-success":"fixed_price"===$?"bg-info":"bg-warning"),children:"will_exercise"===$?"Will Exercise in Next Round":"fixed_price"===$?"Fixed Price Warrants":"Pending Next Round"}),(0,_.jsxs)("div",{className:"small text-muted mt-1",children:[(0,_.jsx)("i",{className:"bi bi-info-circle me-1"}),"Warrants will automatically exercise according to the terms."]})]})]})]})]}),"Venture/Bank DEBT"===n.instrumentType&&(0,_.jsxs)(_.Fragment,{children:[(0,_.jsxs)("div",{className:"form-group mb-4",children:[(0,_.jsx)("label",{className:"form-label fw-semibold mb-2",children:"Interest Rate"}),(0,_.jsxs)("div",{className:"form-control-plaintext fw-bold",children:[se,"% per year"]})]}),(0,_.jsxs)("div",{className:"form-group mb-4",children:[(0,_.jsx)("label",{className:"form-label fw-semibold mb-2",children:"Repayment Schedule"}),(0,_.jsxs)("div",{className:"form-control-plaintext fw-bold",children:[ae," months"]})]}),X.hasWarrants_Bank&&y>0&&(0,_.jsxs)("div",{className:"form-group mb-4",children:[(0,_.jsx)("label",{className:"form-label fw-semibold mb-2",children:"Potential Warrant Shares"}),(0,_.jsxs)("div",{className:"form-control-plaintext fw-bold",style:{color:ge,fontSize:"18px",backgroundColor:"white",padding:"12px",borderRadius:"8px",border:`1px solid ${Se}`},children:[y.toLocaleString()," shares"]})]})]}),"Safe"===n.instrumentType&&(0,_.jsxs)(_.Fragment,{children:[(0,_.jsxs)("div",{className:"form-group mb-3",children:[(0,_.jsx)("label",{className:"form-label fw-semibold",children:"SAFE Type"}),(0,_.jsx)("div",{className:"form-control-plaintext",children:"POST_MONEY"===X.safeType?"Post-Money SAFE":"Pre-Money SAFE"})]}),(0,_.jsxs)("div",{className:"form-group mb-3",children:[(0,_.jsx)("label",{className:"form-label fw-semibold",children:"Estimated Shares at Conversion"}),(0,_.jsxs)("div",{className:"form-control-plaintext fw-bold",style:{color:he,fontSize:"18px",backgroundColor:"white",padding:"12px",borderRadius:"8px",border:`1px solid ${Se}`},children:[x>0?x.toLocaleString():"0"," shares"]})]}),(0,_.jsxs)("div",{className:"form-group mb-3",children:[(0,_.jsx)("label",{className:"form-label fw-semibold",children:"Estimated Ownership"}),(0,_.jsx)("div",{className:"form-control-plaintext fw-bold",style:{color:ge,fontSize:"18px",backgroundColor:"white",padding:"12px",borderRadius:"8px",border:`1px solid ${Se}`},children:p>0?`${p}%`:"0%"})]})]}),"Convertible Note"===n.instrumentType&&(0,_.jsxs)(_.Fragment,{children:[(0,_.jsxs)("div",{className:"form-group mb-3",children:[(0,_.jsx)("label",{className:"form-label fw-semibold",children:"Principal Amount"}),(0,_.jsxs)("div",{className:"form-control-plaintext fw-bold",children:[n.currency,parseFloat(o.replace(/,/g,"")||0).toLocaleString()]})]}),(0,_.jsxs)("div",{className:"form-group mb-3",children:[(0,_.jsx)("label",{className:"form-label fw-semibold",children:"Estimated Shares at Conversion"}),(0,_.jsxs)("div",{className:"form-control-plaintext fw-bold",style:{color:he,fontSize:"18px",backgroundColor:"white",padding:"12px",borderRadius:"8px",border:`1px solid ${Se}`},children:[x>0?x.toLocaleString():"0"," shares"]})]}),(0,_.jsxs)("div",{className:"form-group mb-3",children:[(0,_.jsx)("label",{className:"form-label fw-semibold",children:"Estimated Ownership"}),(0,_.jsx)("div",{className:"form-control-plaintext fw-bold",style:{color:ge,fontSize:"18px",backgroundColor:"white",padding:"12px",borderRadius:"8px",border:`1px solid ${Se}`},children:p>0?`${p}%`:"0%"})]})]}),(0,_.jsx)("button",{type:"submit",className:"btn w-100 mt-4 fw-semibold",style:{backgroundColor:he,color:"white",border:"none",padding:"12px 24px",borderRadius:"8px",fontSize:"16px"},disabled:G||!o||0===parseFloat(o.replace(/,/g,"")),children:G?"Fix Errors to Invest":"Confirm Investment"}),0===O&&(0,_.jsxs)("div",{className:"alert alert-warning mt-3",children:[(0,_.jsx)("strong",{children:"Round Full!"})," No shares available in this round."]})]})]})})})]})})}):null};var A=n(73062),C=n(44919),F=n(28646);const E=(0,u.A)("percent",[["line",{x1:"19",x2:"5",y1:"5",y2:"19",key:"1x9vlm"}],["circle",{cx:"6.5",cy:"6.5",r:"2.5",key:"4mh3h7"}],["circle",{cx:"17.5",cy:"17.5",r:"2.5",key:"1mdrzq"}]]),R=(0,u.A)("calculator",[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",key:"1nb95v"}],["line",{x1:"8",x2:"16",y1:"6",y2:"6",key:"x4nwl0"}],["line",{x1:"16",x2:"16",y1:"14",y2:"18",key:"wjye3r"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M12 10h.01",key:"1nrarc"}],["path",{d:"M8 10h.01",key:"19clt8"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M8 14h.01",key:"6423bh"}],["path",{d:"M12 18h.01",key:"mhygvu"}],["path",{d:"M8 18h.01",key:"lrp35t"}]]),T=(0,u.A)("info",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]]),D=e=>{let{records:s}=e;const n=(()=>{try{const e=null===s||void 0===s?void 0:s.instrument_type_data;if(!e)return null;let n=e;return"string"===typeof n&&(n=JSON.parse(n)),"string"===typeof n&&(n=JSON.parse(n)),n}catch(e){return console.error("Error parsing instrument data:",e),null}})(),a=s.instrumentType;if(!n)return(0,_.jsx)("div",{className:"alert alert-info",children:(0,_.jsx)("small",{children:"No additional instrument details available"})});return(0,_.jsxs)("div",{className:"mt-4",children:[(0,_.jsxs)("div",{className:"section-title",children:[(0,_.jsx)("h4",{children:"Instrument Specific Details"}),(0,_.jsxs)("p",{children:["Additional details for ",a]})]}),(()=>{switch(a){case"Common Stock":return(0,_.jsxs)("div",{className:"instrument-details-section",children:[(0,_.jsx)("h5",{className:"mb-3",children:"Common Stock Details"}),(0,_.jsx)("div",{className:"details-grid",children:(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(A.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Company Valuation:"})," ",(0,_.jsx)("span",{children:(0,_.jsxs)("b",{children:[s.currency," ",Number(n.common_stock_valuation||0).toLocaleString()]})})]})]})})]});case"Preferred Equity":return(()=>{const e=!0===(null===n||void 0===n?void 0:n.hasWarrants_preferred)||"true"===(null===n||void 0===n?void 0:n.hasWarrants_preferred),a=(null===n||void 0===n?void 0:n.exercisePrice_preferred)&&""!==n.exercisePrice_preferred,t=(null===n||void 0===n?void 0:n.warrantRatio_preferred)&&""!==n.warrantRatio_preferred,i=(null===n||void 0===n?void 0:n.expirationDate_preferred)&&""!==n.expirationDate_preferred;return(0,_.jsxs)("div",{className:"instrument-details-section",children:[(0,_.jsx)("h5",{className:"mb-3",children:"Preferred Equity Details"}),(0,_.jsxs)("div",{className:"details-grid",children:[(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(A.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Company Valuation:"})," ",(0,_.jsx)("span",{children:(0,_.jsxs)("b",{children:[(null===s||void 0===s?void 0:s.currency)||"$"," ",Number((null===n||void 0===n?void 0:n.preferred_valuation)||0).toLocaleString()]})})]})]}),e&&(0,_.jsxs)(_.Fragment,{children:[(0,_.jsx)("div",{className:"warrant-section-header",children:(0,_.jsxs)("h6",{className:"text-primary",children:[(0,_.jsx)(m.A,{className:"me-2",size:18}),"Warrant Details"]})}),a?(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(C.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Exercise Price:"})," ",(0,_.jsx)("span",{children:(0,_.jsxs)("b",{children:[(null===s||void 0===s?void 0:s.currency)||"$"," ",Number(n.exercisePrice_preferred).toLocaleString()]})})]})]}):(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(C.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Exercise Price:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{className:"text-muted",children:"To be determined at next priced round"})}),(0,_.jsx)("div",{className:"detail-note small text-muted",children:"Will be calculated based on next round price per client requirements"})]})]}),i&&(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(F.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Expiration Date:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:n.expirationDate_preferred})})]})]}),t?(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(m.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Warrant Ratio:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:n.warrantRatio_preferred})})]})]}):(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(m.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Warrant Coverage:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{className:"text-muted",children:"Will use coverage percentage"})}),(0,_.jsx)("div",{className:"detail-note small text-muted",children:"Coverage percentage will be specified in warrant agreement"})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(m.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Warrant Type:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:"CALL"===(null===n||void 0===n?void 0:n.warrantType_preferred)?"Call Warrant (investor can buy shares)":"Put Warrant (investor can sell shares)"})}),"PUT"===(null===n||void 0===n?void 0:n.warrantType_preferred)&&(0,_.jsx)("div",{className:"detail-note small text-warning",children:"\u26a0\ufe0f Rare structure in startups"})]})]}),(null===n||void 0===n?void 0:n.warrant_coverage_percentage)&&(0,_.jsxs)("div",{className:"detail-card highlight",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(E,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Warrant Coverage:"})," ",(0,_.jsx)("span",{children:(0,_.jsxs)("b",{className:"text-success",children:[n.warrant_coverage_percentage,"%"]})}),(0,_.jsxs)("div",{className:"detail-note small",children:[n.warrant_coverage_percentage,"% of investment amount"]})]})]}),(null===n||void 0===n?void 0:n.warrant_exercise_type)&&(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(R,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Exercise Price Calculation:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:"next_round_adjusted"===n.warrant_exercise_type?`Next Round Price ${"decrease"===(null===n||void 0===n?void 0:n.warrant_adjustment_direction)?"-":"+"} ${(null===n||void 0===n?void 0:n.warrant_adjustment_percent)||0}%`:"next_round"===n.warrant_exercise_type?"Next Round Price":"Fixed Price"})}),n.warrant_exercise_type.includes("next_round")&&(0,_.jsx)("div",{className:"detail-note small",children:"Automatically calculated when next priced round occurs"})]})]}),(0,_.jsxs)("div",{className:"alert alert-info mt-3 p-2 small",children:[(0,_.jsx)(T,{className:"me-2",size:16}),(0,_.jsx)("strong",{children:"Note:"})," Warrant exercise price and shares will be finalized when the next priced equity round occurs, per client requirements."]})]})]})]})})();case"Safe":return(0,_.jsxs)("div",{className:"instrument-details-section",children:[(0,_.jsx)("h5",{className:"mb-3",children:"SAFE Details"}),(0,_.jsxs)("div",{className:"details-grid",children:[(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(A.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Valuation Cap"}),(0,_.jsx)("span",{children:(0,_.jsxs)("b",{children:[s.currency," ",Number(n.valuationCap||0).toLocaleString()]})})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(E,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Conversion Discount"}),(0,_.jsx)("span",{children:(0,_.jsxs)("b",{children:[n.discountRate||0,"%"]})})]})]})]})]});case"Venture/Bank DEBT":return(0,_.jsxs)("div",{className:"instrument-details-section",children:[(0,_.jsx)("h5",{className:"mb-3",children:"Venture/Bank Debt Details"}),(0,_.jsxs)("div",{className:"details-grid",children:[(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(E,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Interest Rate:"})," ",(0,_.jsx)("span",{children:(0,_.jsxs)("b",{children:[n.interestRate||0,"%"]})})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(F.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Repayment Schedule:"})," ",(0,_.jsx)("span",{children:(0,_.jsxs)("b",{children:[n.repaymentSchedule||0," months"]})})]})]}),n.hasWarrants_Bank&&(0,_.jsxs)(_.Fragment,{children:[(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(C.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Exercise Price:"})," ",(0,_.jsx)("span",{children:(0,_.jsxs)("b",{children:[s.currency," ",Number(n.exercisePrice_bank||0).toLocaleString()]})})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(F.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Expiration Date:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:n.exercisedate_bank||"N/A"})})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(m.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Warrant Ratio:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:n.warrantRatio_bank||"N/A"})})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(m.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Warrant Type:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:"CALL"===n.warrantType_bank?"Call Warrant (buy shares)":"Put Warrant (sell shares)"})})]})]})]})]})]});case"Convertible Note":return(()=>{var e;return(0,_.jsxs)("div",{className:"instrument-details-section",children:[(0,_.jsx)("h5",{className:"mb-3",children:"Convertible Note Details"}),(0,_.jsxs)("div",{className:"details-grid",children:[(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(A.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Valuation Cap:"})," ",(0,_.jsx)("span",{children:(0,_.jsxs)("b",{children:[s.currency," ",Number(n.valuationCap_note||0).toLocaleString()]})})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(E,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Conversion Discount:"})," ",(0,_.jsx)("span",{children:(0,_.jsxs)("b",{children:[n.discountRate_note||0,"%"]})})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(F.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Maturity Date:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:n.maturityDate||"N/A"})})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(E,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Interest Rate:"})," ",(0,_.jsx)("span",{children:(0,_.jsxs)("b",{children:[n.interestRate_note||0,"%"]})})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(m.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Convertible Trigger:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:(null===(e=n.convertibleTrigger)||void 0===e?void 0:e.replace(/_/g," "))||"N/A"})})]})]})]})]})})();default:return null}})()]})};const M=function(){const{id:e,company_id:s}=(0,r.g)(),[n,u]=(0,a.useState)(""),[w,k]=(0,a.useState)("overview"),[A,C]=(0,a.useState)(!1),F=(0,a.useRef)(null),[E,R]=(0,a.useState)(null),T=(0,r.Zp)();document.title="Company Capital Round List - Investor";const[M,I]=(0,a.useState)(!1),[P,$]=(0,a.useState)(!0);var L=S.J+"api/user/capitalround/";const O=localStorage.getItem("InvestorData"),W=JSON.parse(O),[q,B]=(0,a.useState)(!1),[J,Y]=(0,a.useState)(""),[V,H]=(0,a.useState)({totalRaised:0,investorInvestment:0,remainingAmount:0,progress:0,investorsCount:0,daysLeft:0});(0,a.useEffect)((()=>{if(J){const e=parseFloat(J.roundsize||0);let s=0;J.all_investment_requests&&J.all_investment_requests.length>0&&(s=J.all_investment_requests.reduce(((e,s)=>"Yes"===s.request_confirm?e+parseFloat(s.investment_amount||0):e),0));const n=Math.max(0,e-s),a=e>0?s/e*100:0;let t=0;if(J.dateroundclosed){const e=new Date,s=new Date(J.dateroundclosed)-e;t=s>0?Math.ceil(s/864e5):0}let i=0;if(J.all_investment_requests&&J.all_investment_requests.length>0){const e=J.all_investment_requests.find((e=>e.investor_id===W.id));e&&(i=parseFloat(e.investment_amount||0))}H({totalRaised:s,investorInvestment:i,remainingAmount:n,progress:a,investorsCount:J.all_investment_requests?J.all_investment_requests.length:0,daysLeft:t})}}),[J,W.id]);const U=()=>{C(!0)},[K,G]=(0,a.useState)(""),[Z,Q]=(0,a.useState)("normal"),[X,ee]=(0,a.useState)(!1),[se,ne]=(0,a.useState)("draw");console.log(J);const ae=()=>new Promise((e=>{const s=document.createElement("canvas");s.width=600,s.height=150;const n=s.getContext("2d");n.fillStyle="white",n.fillRect(0,0,s.width,s.height),n.fillStyle="black",n.textAlign="center",n.textBaseline="middle";let a=40,t="Arial",i="normal";switch(Z){case"italic":t="Georgia",i="italic";break;case"cursive":t="Brush Script MT",a=48;break;case"bold":i="bold"}n.font=`${i} ${a}px ${t}`,n.fillText(K,s.width/2,s.height/2);e(s.toDataURL("image/png"))}));(0,a.useEffect)((()=>{te(),de()}),[]);const te=async()=>{$(!0);let n={investor_id:W.id,capital_round_id:e};try{const e=await i.A.post(L+"getcheckCapitalMotionlist",n,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(console.log(e.data.results[0]),0===e.data.results.length)T("/investor/company/capital-round-list/"+s);else{const s=e.data.results[0];Y(s),oe(s)}}catch(a){console.error("Error fetching capital round data:",a)}finally{$(!1)}},[ie,re]=(0,a.useState)(!1),[le,ce]=(0,a.useState)(""),de=async()=>{$(!0);let n={investor_id:W.id,capital_round_id:e,company_id:s,company_id:s};try{const e=await i.A.post(L+"getcheckNextRoundForInvestor",n,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(e.data),re(e.data.nextRoundExists),ce(e.data.nextRoundData)}catch(a){console.error("Error fetching capital round data:",a)}finally{$(!1)}},oe=async e=>{let s={user_id:W.id,id:e.sharerecordround_id};try{await i.A.post(L+"Capitalmotionviewed",s,{headers:{Accept:"application/json","Content-Type":"application/json"}})}catch(n){console.error("Error updating viewed status:",n)}};function me(e){const s=new Date(e);if(isNaN(s))return"";const n=s.getDate(),a=["January","February","March","April","May","June","July","August","September","October","November","December"][s.getMonth()],t=s.getFullYear();return`${a} ${n}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(n)}, ${t}`}const xe=J.roundsize&&J.issuedshares?J.roundsize/J.issuedshares:0,he=parseFloat(String(V.investorInvestment).replace(/,/g,""))||0,pe=xe>0?he/xe:0,ue=(parseFloat(String(J.founderShares||0).replace(/,/g,""))||0)+parseFloat(String(J.issuedshares).replace(/,/g,""))||0,be=ue>0?(pe/ue*100).toFixed(2):"0.00",ge=V.totalRaised||0,je=Math.max(0,J.roundsize-ge),ve=Math.max(0,J.issuedshares-ge/xe),[fe,Ne]=(Math.min(100,ge/J.roundsize*100),(0,a.useState)({termSheet:!1,subscription:!1,acceptAll:!1})),[ye,we]=(0,a.useState)(!1),[ke,Se]=(0,a.useState)(!1),_e=()=>fe.acceptAll||"true"===J.termsChecked;if(P)return(0,_.jsx)(t.mO,{className:"investor-login-wrapper",children:(0,_.jsx)("div",{className:"fullpage d-block",children:(0,_.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,_.jsx)(d.A,{isCollapsed:q,setIsCollapsed:B}),(0,_.jsx)("div",{className:"global_view "+(q?"global_view_col":""),children:(0,_.jsx)(t.$K,{className:"d-flex justify-content-center align-items-center",style:{minHeight:"400px"},children:(0,_.jsx)("div",{className:"loading-spinner",children:(0,_.jsx)("div",{className:"spinner-border text-primary",role:"status",children:(0,_.jsx)("span",{className:"visually-hidden",children:"Loading..."})})})})})]})})});(e=>{if(!e)return{};try{let s=e;return"string"===typeof s&&(s=JSON.parse(s)),"string"===typeof s&&(s=JSON.parse(s)),s}catch(s){return console.error("Error parsing instrument data:",s),{}}})(J.instrument_type_data);const ze=async function(e,s){if(e&&0!==e.length)try{const n=JSON.parse(e);for(let e=0;e<n.length;e++){const a=n[e],t=`${s}/${a}`,i=document.createElement("a");i.href=t,i.download=a,i.target="_blank",document.body.appendChild(i),i.click(),document.body.removeChild(i),e<n.length-1&&await new Promise((e=>setTimeout(e,500)))}}catch(n){console.error("Error downloading files:",n),alert("Error downloading files")}else alert("No files available for download")},Ae=(e,s,n)=>{if(!e)return null;try{const n=JSON.parse(e);return(0,_.jsx)("div",{className:"file-list",children:n.map(((e,n)=>(0,_.jsxs)("div",{className:"file-item d-flex justify-content-between align-items-center p-2 border rounded mb-2",children:[(0,_.jsxs)("div",{className:"d-flex align-items-center",children:[(0,_.jsx)(m.A,{size:14,className:"me-2"}),(0,_.jsx)("span",{className:"file-name",children:e})]}),(0,_.jsx)("button",{className:"btn btn-sm btn-outline-primary",onClick:()=>Ce(e,s),title:"Download this file",children:(0,_.jsx)(l.WCW,{size:12})})]},n)))})}catch(a){return console.error("Error parsing files JSON:",a),(0,_.jsx)("p",{className:"text-danger",children:"Error loading files"})}},Ce=(e,s)=>{const n=`${s}/${e}`,a=document.createElement("a");a.href=n,a.download=e,a.target="_blank",document.body.appendChild(a),a.click(),document.body.removeChild(a)};return console.log(J),(0,_.jsxs)(t.mO,{className:"investor-login-wrapper",children:[(0,_.jsx)("div",{className:"fullpage d-block",children:(0,_.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,_.jsx)(d.A,{isCollapsed:q,setIsCollapsed:B}),(0,_.jsx)("div",{className:"global_view "+(q?"global_view_col":""),children:(0,_.jsx)(t.$K,{className:"d-block p-md-4 p-3",children:(0,_.jsxs)("div",{className:"container-fluid",children:[(0,_.jsxs)("div",{className:"d-flex justify-content-between align-items-center mb-4",children:[(0,_.jsxs)(o.o,{type:"button",className:"backbtn",onClick:()=>{T("/investor/company/capital-round-list/"+s)},children:[(0,_.jsx)(x.A,{size:16,className:"me-1"})," Back to Rounds"]}),(0,_.jsxs)("div",{className:"d-flex gap-2",children:[(0,_.jsx)("div",{className:"round-status-badge",children:(0,_.jsx)("span",{className:"status-active",children:"Active Round"})}),(0,_.jsx)(o.o,{type:"button",disabled:!_e()||"Yes"!==J.signature_status,className:"global_btn w-fit",onClick:U,style:{opacity:_e()&&"Yes"===J.signature_status?1:.4,cursor:_e()&&"Yes"===J.signature_status?"pointer":"not-allowed"},title:_e()?"Yes"!==J.signature_status?"Complete digital signature first":"Click to invest":"Accept all terms first",children:_e()&&"Yes"===J.signature_status?(0,_.jsxs)(_.Fragment,{children:[(0,_.jsx)(l.MxO,{size:14,className:"me-1"}),"Invest Now"]}):(0,_.jsxs)(_.Fragment,{children:[(0,_.jsx)(l.JhU,{size:14,className:"me-1"}),"Invest Now (Requirements Pending)"]})})]})]}),(0,_.jsxs)("div",{className:"capital-round-card",children:[(0,_.jsxs)("div",{className:"round-header",children:[(0,_.jsxs)("div",{className:"header-content",children:[(0,_.jsx)("div",{className:"company-icon",children:(0,_.jsx)("div",{className:"icon-wrapper",children:(0,_.jsx)(c.RRN,{size:24})})}),(0,_.jsxs)("div",{className:"header-text",children:[(0,_.jsxs)("h1",{className:"round-title",children:[J.company_name," -"," ",J.nameOfRound||"Capital Round"]}),(0,_.jsx)("p",{className:"round-subtitle",children:J.description||"Investment opportunity details and documentation"}),(0,_.jsxs)("div",{className:"round-meta",children:[(0,_.jsxs)("span",{className:"meta-item",children:[(0,_.jsx)(h.A,{size:14,className:"me-1"}),"Created: ",me(J.created_at)]}),(0,_.jsxs)("span",{className:"meta-item",children:[(0,_.jsx)(p.A,{size:14,className:"me-1"}),V.investorsCount," investors participating"]}),(0,_.jsxs)("span",{className:"meta-item",children:[(0,_.jsx)(b,{size:14,className:"me-1"}),J.shareClassType," Shares"]})]})]})]}),(0,_.jsx)("div",{className:"funding-progress",children:(0,_.jsxs)("div",{className:"progress-stats",children:[(0,_.jsxs)("span",{children:["Raised: ",J.currency," ",Number(ge).toLocaleString()]}),(0,_.jsxs)("span",{children:["Target: ",J.currency," ",Number(J.roundsize).toLocaleString()]})]})})]}),n&&(0,_.jsxs)("div",{className:"alert-message "+(M?"error":"success"),children:[(0,_.jsxs)("div",{className:"alert-content",children:[M?(0,_.jsx)(g.A,{size:18}):(0,_.jsx)(j.A,{size:18}),(0,_.jsx)("span",{children:n})]}),(0,_.jsx)("button",{className:"alert-close",onClick:()=>u(""),children:"\xd7"})]}),(0,_.jsxs)("div",{className:"round-tabs",children:[(0,_.jsxs)("button",{className:"tab-button "+("overview"===w?"active":""),onClick:()=>k("overview"),children:[(0,_.jsx)(v,{size:16,className:"me-2"}),"Overview"]}),(0,_.jsxs)("button",{className:"tab-button "+("terms"===w?"active":""),onClick:()=>k("terms"),children:[(0,_.jsx)(f.A,{size:16,className:"me-2"}),"Rights"]}),(0,_.jsxs)("button",{className:"tab-button "+("excutivesummary"===w?"active":""),onClick:()=>k("excutivesummary"),children:[(0,_.jsx)(c.bMy,{size:16,className:"me-2"}),"Excutive Summary"]}),(0,_.jsxs)("button",{className:"tab-button "+("documents"===w?"active":""),onClick:()=>k("documents"),children:[(0,_.jsx)(c.zo4,{size:16,className:"me-2"}),"Terms & Subscription Documents"]})]}),(0,_.jsxs)("div",{className:"tab-content",children:["overview"===w&&(0,_.jsxs)("div",{className:"overview-content",children:[(0,_.jsxs)("div",{className:"section-title",children:[(0,_.jsx)("h4",{children:"Round Details"}),(0,_.jsx)("p",{children:"Basic information about this investment round"})]}),(0,_.jsxs)("div",{className:"details-grid",children:[(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(N,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Round Name:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:J.nameOfRound||"N/A"})})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(c.X2c,{size:20})}),(0,_.jsxs)("div",{className:"detail-content g-2",children:[(0,_.jsx)("label",{children:"Share Class Type:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:J.shareClassType||"N/A"})})]})]}),"OTHER"===J.shareClassType&&(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(f.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Custom Share Class:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:J.shareclassother||"N/A"})})]})]}),(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(l.MxO,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Investment Instrument:"})," ",(0,_.jsx)("span",{children:(0,_.jsx)("b",{children:J.instrumentType||"N/A"})})]})]}),"OTHER"===J.instrumentType&&(0,_.jsxs)("div",{className:"detail-card",children:[(0,_.jsx)("div",{className:"detail-icon",children:(0,_.jsx)(f.A,{size:20})}),(0,_.jsxs)("div",{className:"detail-content",children:[(0,_.jsx)("label",{children:"Custom Instrument"}),(0,_.jsx)("span",{children:J.customInstrument||"N/A"})]})]}),(0,_.jsx)(D,{records:J})]}),(0,_.jsxs)("div",{className:"section-title mt-5",children:[(0,_.jsx)("h4",{children:"Financial Metrics"}),(0,_.jsx)("p",{children:"Key financial information for this round"})]}),(0,_.jsxs)("div",{className:"metrics-grid",children:[(0,_.jsxs)("div",{className:"metric-card primary",children:[(0,_.jsx)("div",{className:"metric-icon",children:(0,_.jsx)(l.MxO,{size:24})}),(0,_.jsxs)("div",{className:"metric-content",children:[(0,_.jsx)("label",{children:"Target Raise Amount"}),(0,_.jsxs)("h3",{children:[J.currency," ",Number(J.roundsize).toLocaleString()]})]})]}),(0,_.jsxs)("div",{className:"metric-card success",children:[(0,_.jsx)("div",{className:"metric-icon",children:(0,_.jsx)(c.kfW,{size:24})}),(0,_.jsxs)("div",{className:"metric-content",children:[(0,_.jsx)("label",{children:"Price per Share"}),(0,_.jsxs)("h3",{children:[J.currency," ",xe.toLocaleString(void 0,{minimumFractionDigits:3,maximumFractionDigits:3})]})]})]}),(0,_.jsxs)("div",{className:"metric-card warning",children:[(0,_.jsx)("div",{className:"metric-icon",children:(0,_.jsx)(l.YXz,{size:24})}),(0,_.jsxs)("div",{className:"metric-content",children:[(0,_.jsx)("label",{children:"Total Shares"}),(0,_.jsx)("h3",{children:Number(J.issuedshares).toLocaleString("en-US",{minimumFractionDigits:3,maximumFractionDigits:3})})]})]}),(0,_.jsxs)("div",{className:"metric-card info",children:[(0,_.jsx)("div",{className:"metric-icon",children:(0,_.jsx)(l.gdQ,{size:24})}),(0,_.jsxs)("div",{className:"metric-content",children:[(0,_.jsx)("label",{children:"Your Ownership"}),(0,_.jsxs)("h3",{children:[be,"%"]})]})]})]}),J.instrumentType&&(0,_.jsxs)("div",{className:"detail-section",children:[(0,_.jsx)("h4",{children:"Investment Summary"}),(0,_.jsxs)("div",{className:"detail-list",children:[(0,_.jsxs)("div",{className:"detail-item",children:[(0,_.jsx)("label",{children:"Your Investment"}),(0,_.jsxs)("span",{children:[J.currency," ",V.investorInvestment.toLocaleString()]})]}),(0,_.jsxs)("div",{className:"detail-item",children:[(0,_.jsx)("label",{children:"Shares Allocated"}),(0,_.jsx)("span",{children:Math.floor((parseFloat(String(V.investorInvestment).replace(/,/g,""))||0)/xe).toLocaleString()})]}),(0,_.jsxs)("div",{className:"detail-item",children:[(0,_.jsx)("label",{children:"Remaining Amount"}),(0,_.jsxs)("span",{children:[J.currency," ",je.toLocaleString()]})]})]})]})]}),"terms"===w&&(0,_.jsxs)("div",{className:"terms-content",children:[(0,_.jsxs)("div",{className:"section-title mb-4",children:[(0,_.jsx)("h4",{children:"Terms & Shareholder Rights"}),(0,_.jsx)("p",{children:"Detailed terms and conditions for this investment round"})]}),(0,_.jsxs)("div",{className:"terms-grid",children:[(0,_.jsxs)("div",{className:"terms-section mb-4",children:[(0,_.jsx)("h5",{children:"Liquidation Preferences"}),(0,_.jsxs)("div",{className:"terms-list",children:[(0,_.jsxs)("div",{className:"term-item",children:[(0,_.jsx)("label",{children:"Liquidation Preference: "})," ",(0,_.jsx)("strong",{children:J.liquidationpreferences||"Standard"})]}),(0,_.jsxs)("div",{className:"term-item",children:[(0,_.jsx)("label",{children:"Participation: "})," ",(0,_.jsx)("strong",{children:J.liquidation||"Non-participating"})]}),"OTHER"===J.liquidation&&(0,_.jsxs)("div",{className:"term-item",children:[(0,_.jsx)("label",{children:"Custom Terms:"})," ",(0,_.jsx)("strong",{children:J.liquidationother||"N/A"})]})]})]}),(0,_.jsxs)("div",{className:"terms-section mb-4",children:[(0,_.jsx)("h5",{children:"Voting & Conversion Rights"}),(0,_.jsxs)("div",{className:"terms-list",children:[(0,_.jsxs)("div",{className:"term-item",children:[(0,_.jsx)("label",{children:"Voting Rights:"})," ",(0,_.jsx)("strong",{children:J.voting||"Standard"})]}),(0,_.jsxs)("div",{className:"term-item",children:[(0,_.jsx)("label",{children:"Shares Convertible:"})," ",(0,_.jsx)("strong",{children:J.convertible||"No"})]}),"Yes"===J.convertible&&(0,_.jsxs)("div",{className:"term-item",children:[(0,_.jsx)("label",{children:"Conversion Type:"})," ",(0,_.jsx)("strong",{children:J.convertibleType||"Automatic"})]})]})]}),(0,_.jsxs)("div",{className:"terms-section mb-4",children:[(0,_.jsx)("h5",{children:"Additional Rights & Preferences"}),(0,_.jsx)("div",{className:"terms-list",children:(0,_.jsxs)("div",{className:"term-item",children:[(0,_.jsx)("label",{children:"Rights & Preferences:"})," ",(0,_.jsx)("strong",{children:J.rights||"Standard rights apply"})]})})]}),(0,_.jsxs)("div",{className:"terms-section",children:[(0,_.jsx)("h5",{children:"Investment Status"}),(0,_.jsxs)("div",{className:"terms-list",children:[(0,_.jsxs)("div",{className:"term-item",children:[(0,_.jsx)("label",{children:"Remaining Amount: "})," ",(0,_.jsxs)("strong",{children:[J.currency," ",je.toLocaleString()]})]}),(0,_.jsxs)("div",{className:"term-item",children:[(0,_.jsx)("label",{children:"Remaining Shares:"})," ",(0,_.jsx)("strong",{children:Math.max(0,ve.toFixed(0)).toLocaleString()})]})]})]})]})]}),"documents"===w&&(0,_.jsxs)("div",{className:"documents-content",children:[(0,_.jsxs)("div",{className:"section-title mb-4",children:[(0,_.jsx)("h4",{children:"Investment Documents"}),(0,_.jsx)("p",{children:"Legal documents and agreements for this investment round"})]}),(0,_.jsx)("div",{className:"terms-acceptance-box mb-4",children:(0,_.jsx)("div",{className:"card border-primary",children:(0,_.jsxs)("div",{className:"card-body",children:[(0,_.jsxs)("h5",{className:"card-title text-primary",children:[(0,_.jsx)("i",{className:"bi bi-file-check me-2"}),"Terms Acceptance Required"]}),(0,_.jsx)("p",{className:"card-text",children:"Before proceeding to investment, you must:"}),(0,_.jsx)("div",{className:"terms-checklist",children:(0,_.jsxs)("div",{className:"form-check mb-3",children:[(0,_.jsx)("input",{className:"form-check-input",type:"checkbox",id:"termsCheck3",checked:fe.acceptAll||J.termsChecked,style:{cursor:fe.acceptAll?"not-allowed":"pointer"},onChange:e=>{return s="acceptAll",n=e.target.checked,void Ne("acceptAll"===s?{acceptAll:n}:e=>({...e,[s]:n}));var s,n}}),(0,_.jsxs)("label",{className:"form-check-label",htmlFor:"termsCheck3",children:[(0,_.jsx)("strong",{children:"I accept all terms and conditions"})," outlined in both documents"]})]})}),(0,_.jsx)("div",{className:"terms-status mt-3",children:_e()?(0,_.jsxs)("div",{className:"alert alert-success py-2 mb-0",children:[(0,_.jsx)("i",{className:"bi bi-check-circle-fill me-2"}),"All terms accepted. You can now proceed to investment."]}):(0,_.jsxs)("div",{className:"alert alert-warning py-2 mb-0",children:[(0,_.jsx)("i",{className:"bi bi-exclamation-circle me-2"}),"Please read and accept all terms before investing."]})})]})})}),(0,_.jsxs)("div",{className:"documents-grid row",children:[(0,_.jsx)("div",{className:"col-lg-6 mb-4",children:(0,_.jsx)("div",{className:"document-card card h-100",children:(0,_.jsxs)("div",{className:"card-body",children:[(0,_.jsxs)("div",{className:"d-flex align-items-center mb-3",children:[(0,_.jsx)("div",{className:"document-icon primary me-3",children:(0,_.jsx)(m.A,{size:24})}),(0,_.jsx)("div",{className:"document-info flex-grow-1",children:(0,_.jsx)("div",{className:"d-flex align-items-center justify-content-between",children:(0,_.jsxs)("div",{children:[(0,_.jsx)("h5",{className:"card-title",children:"Term Sheet"}),(0,_.jsx)("p",{className:"card-text text-muted",children:"Investment terms and conditions document"})]})})})]}),J.termsheetFile&&JSON.parse(J.termsheetFile).length>0?(0,_.jsx)(_.Fragment,{children:(0,_.jsxs)("div",{className:"mb-3",children:[(0,_.jsxs)("div",{className:"d-flex justify-content-between align-items-center mb-2",children:[(0,_.jsxs)("span",{className:"badge bg-primary",children:[JSON.parse(J.termsheetFile).length," ","file(s)"]}),(0,_.jsx)("div",{children:(0,_.jsxs)("button",{className:"btn btn-sm btn-outline-primary me-2",onClick:()=>ze(J.termsheetFile,`${S.J}api/upload/docs/doc_${J.company_id}/companyRound`,"termsheet"),children:[(0,_.jsx)(l.WCW,{size:12,className:"me-1"}),"Download All"]})})]}),Ae(J.termsheetFile,`${S.J}api/upload/docs/doc_${J.company_id}/companyRound`)]})}):(0,_.jsx)("div",{className:"alert alert-info",children:(0,_.jsx)("small",{children:"No term sheet files available"})})]})})}),(0,_.jsx)("div",{className:"col-lg-6 mb-4",children:(0,_.jsx)("div",{className:"document-card card h-100",children:(0,_.jsxs)("div",{className:"card-body",children:[(0,_.jsxs)("div",{className:"d-flex align-items-center mb-3",children:[(0,_.jsx)("div",{className:"document-icon success me-3",children:(0,_.jsx)(l.MTc,{size:24})}),(0,_.jsx)("div",{className:"document-info flex-grow-1",children:(0,_.jsx)("div",{className:"d-flex align-items-center justify-content-between",children:(0,_.jsxs)("div",{children:[(0,_.jsx)("h5",{className:"card-title",children:"Subscription Agreement"}),(0,_.jsx)("p",{className:"card-text text-muted",children:"Legal subscription document and agreement"})]})})})]}),J.subscriptiondocument&&JSON.parse(J.subscriptiondocument).length>0?(0,_.jsx)(_.Fragment,{children:(0,_.jsxs)("div",{className:"mb-3",children:[(0,_.jsxs)("div",{className:"d-flex justify-content-between align-items-center mb-2",children:[(0,_.jsxs)("span",{className:"badge bg-success",children:[JSON.parse(J.subscriptiondocument).length," ","file(s)"]}),(0,_.jsx)("div",{children:(0,_.jsxs)("button",{className:"btn btn-sm btn-outline-success me-2",onClick:()=>ze(J.subscriptiondocument,`${S.J}api/upload/docs/doc_${J.company_id}/companyRound`,"subscription"),children:[(0,_.jsx)(l.WCW,{size:12,className:"me-1"}),"Download All"]})})]}),Ae(J.subscriptiondocument,`${S.J}api/upload/docs/doc_${J.company_id}/companyRound`)]})}):(0,_.jsx)("div",{className:"alert alert-info",children:(0,_.jsx)("small",{children:"No subscription agreement files available"})})]})})})]}),_e()&&"No"===J.signature_status&&(0,_.jsxs)("div",{className:"signature-content",children:[(0,_.jsxs)("div",{className:"section-title",children:[(0,_.jsx)("h4",{children:"Electronic Signature"}),(0,_.jsx)("p",{children:"Provide your signature to authorize this investment"}),!_e()&&(0,_.jsx)("div",{className:"alert alert-warning mt-3",children:(0,_.jsxs)("div",{className:"d-flex align-items-center",children:[(0,_.jsx)("i",{className:"bi bi-exclamation-triangle-fill me-2"}),(0,_.jsxs)("div",{children:[(0,_.jsx)("strong",{children:"Terms Not Accepted:"})," Please accept all terms before signing.",(0,_.jsx)("div",{className:"small mt-1",children:(0,_.jsx)("a",{href:"#",onClick:e=>{e.preventDefault(),k("documents")},className:"alert-link",children:"Go back to Documents tab to accept terms"})})]})]})})]}),(0,_.jsxs)("div",{className:"signature-container",children:[(0,_.jsxs)("div",{className:"signature-instructions",children:[(0,_.jsxs)("div",{className:"instruction-item",children:[(0,_.jsx)(j.A,{size:16}),(0,_.jsx)("span",{children:"By signing below, you confirm your subscription to this investment round"})]}),(0,_.jsxs)("div",{className:"instruction-item",children:[(0,_.jsx)(j.A,{size:16}),(0,_.jsx)("span",{children:"You agree to the terms outlined in the Subscription Document"})]}),(0,_.jsxs)("div",{className:"instruction-item",children:[(0,_.jsx)(j.A,{size:16}),(0,_.jsx)("span",{children:"Your signature will be legally binding"})]}),_e()&&(0,_.jsxs)("div",{className:"instruction-item success",children:[(0,_.jsx)(j.A,{size:16,className:"text-success"}),(0,_.jsx)("span",{className:"text-success",children:(0,_.jsx)("strong",{children:"\u2713 All terms and conditions accepted"})})]})]}),(0,_.jsxs)("div",{className:"signature-pad-wrapper",children:[(0,_.jsxs)("div",{className:"signature-pad-container "+(_e()?"":"disabled"),children:[(0,_.jsx)("div",{className:"signature-tabs mb-4",children:(0,_.jsxs)("ul",{className:"nav nav-tabs",children:[(0,_.jsx)("li",{className:"nav-item",children:(0,_.jsxs)("button",{className:"nav-link "+("draw"===se?"active":""),onClick:()=>ne("draw"),disabled:!_e(),children:[(0,_.jsx)("i",{className:"bi bi-pen me-1"}),"Draw Signature"]})}),(0,_.jsx)("li",{className:"nav-item",children:(0,_.jsxs)("button",{className:"nav-link "+("text"===se?"active":""),onClick:()=>ne("text"),disabled:!_e(),children:[(0,_.jsx)("i",{className:"bi bi-fonts me-1"}),"Type Signature"]})})]})}),(0,_.jsxs)("div",{className:"tab-content",children:["draw"===se&&(0,_.jsx)("div",{className:"tab-pane fade show active",children:(0,_.jsx)("div",{className:"draw-signature-section",children:(0,_.jsx)(y.A,{ref:F,penColor:"black",canvasProps:{className:"signature-canvas",width:600,height:200,style:{cursor:_e()?"crosshair":"not-allowed",opacity:_e()?1:.5}},disabled:!_e()})})}),"text"===se&&(0,_.jsx)("div",{className:"tab-pane fade show active",children:(0,_.jsxs)("div",{className:"type-signature-section",children:[(0,_.jsxs)("div",{className:"input-group mb-3",children:[(0,_.jsx)("input",{type:"text",className:"form-control signature-text-input",placeholder:"Type your full name",value:K,onChange:e=>G(e.target.value),disabled:!_e()}),(0,_.jsx)("button",{className:"btn btn-outline-secondary",type:"button",onClick:()=>{const e=["normal","italic","cursive","bold"],s=(e.indexOf(Z)+1)%e.length;Q(e[s])},disabled:!_e()||!K,title:"Toggle font style",children:(0,_.jsx)("i",{className:"bi bi-fonts"})})]}),(0,_.jsx)("div",{className:"font-style-options mt-2 mb-3",children:(0,_.jsxs)("div",{className:"btn-group btn-group-sm",role:"group",children:[(0,_.jsx)("button",{type:"button",className:"btn "+("normal"===Z?"btn-primary":"btn-outline-primary"),onClick:()=>Q("normal"),disabled:!_e(),children:"Normal"}),(0,_.jsx)("button",{type:"button",className:"btn "+("italic"===Z?"btn-primary":"btn-outline-primary"),onClick:()=>Q("italic"),disabled:!_e(),children:"Italic"}),(0,_.jsx)("button",{type:"button",className:"btn "+("cursive"===Z?"btn-primary":"btn-outline-primary"),onClick:()=>Q("cursive"),disabled:!_e(),children:"Cursive"}),(0,_.jsx)("button",{type:"button",className:"btn "+("bold"===Z?"btn-primary":"btn-outline-primary"),onClick:()=>Q("bold"),disabled:!_e(),children:"Bold"})]})}),K&&(0,_.jsxs)("div",{className:"signature-text-preview mt-3 p-3 border rounded bg-light",children:[(0,_.jsx)("h6",{className:"mb-2",children:"Preview:"}),(0,_.jsx)("div",{className:"signature-display",style:(()=>{const e={fontSize:"24px",fontFamily:"Arial, sans-serif",color:"#000",minHeight:"50px",display:"flex",alignItems:"center",justifyContent:"center"};switch(Z){case"italic":return{...e,fontStyle:"italic",fontFamily:"Georgia, serif"};case"cursive":return{...e,fontFamily:"Brush Script MT, cursive",fontSize:"28px"};case"bold":return{...e,fontWeight:"bold"};default:return e}})(),children:K})]})]})})]}),!_e()&&(0,_.jsx)("div",{className:"signature-disabled-overlay",children:(0,_.jsxs)("div",{className:"overlay-content",children:[(0,_.jsx)("i",{className:"bi bi-lock-fill"}),(0,_.jsx)("p",{children:"Accept terms to enable signature"})]})})]}),!_e()&&(0,_.jsxs)("p",{className:"text-muted small mt-2 text-center",children:[(0,_.jsx)("i",{className:"bi bi-info-circle me-1"}),"Signature disabled until all terms are accepted"]})]}),(0,_.jsxs)("div",{className:"signature-actions",children:[(0,_.jsx)("button",{className:"btn-secondary",onClick:()=>{"draw"===se&&F.current?F.current.clear():"text"===se&&G(""),R(null)},disabled:!_e(),children:"Clear Signature"}),(0,_.jsxs)("button",{className:"btn-primary",onClick:async()=>{if(!_e())return I(!0),u("Please accept all terms and conditions before signing!"),void setTimeout((()=>{I(!1),u("")}),3500);if(console.log("klkl",se),"draw"===se){if(!F.current||F.current.isEmpty())return I(!0),u("Please draw your signature first!"),void setTimeout((()=>{I(!1),u("")}),3500)}else if("text"===se&&!K.trim())return I(!0),u("Please type your signature first!"),void setTimeout((()=>{I(!1),u("")}),3500);let e;e="draw"===se?F.current.toDataURL("image/png"):await ae();let s={user_id:W.id,id:J.sharerecordround_id,signature_authorize:e,signature_type:se,signature_text:"text"===se?K:null,company_id:J.user_id,reports:J,company_id:J.company_id,termsChecked:fe.acceptAll};try{await i.A.post(L+"investorrecordAuthorize",s,{headers:{Accept:"application/json","Content-Type":"application/json"}});te(),I(!1),u("Your subscription has been signed successfully. Please proceed with the fund transfer. Shares will be formally allocated to you once the company confirms the receipt of funds"),setTimeout((()=>{u("")}),1e4)}catch(n){}},disabled:!_e(),children:[(0,_.jsx)(l.Myc,{size:16,className:"me-2"}),"Authorize Investmenttt",!_e()&&" (Terms Required)"]})]}),!_e()&&(0,_.jsx)("div",{className:"alert alert-info mt-4",children:(0,_.jsxs)("div",{className:"d-flex align-items-center",children:[(0,_.jsx)("i",{className:"bi bi-file-text me-2"}),(0,_.jsxs)("div",{children:[(0,_.jsx)("strong",{children:"Step Required:"}),(0,_.jsxs)("div",{children:["Please go back to the ",(0,_.jsx)("strong",{children:"Documents"})," tab and:",(0,_.jsxs)("ol",{className:"mb-0 mt-1",children:[(0,_.jsx)("li",{children:"Read both Term Sheet and Subscription Agreement"}),(0,_.jsx)("li",{children:'Check "I have read" boxes for both documents'}),(0,_.jsx)("li",{children:'Check "I accept all terms and conditions"'})]})]})]})]})}),E&&(0,_.jsxs)("div",{className:"signature-preview mt-4",children:[(0,_.jsx)("h6",{children:"Signature Preview:"}),(0,_.jsx)("img",{src:E,alt:"Signature Preview",className:"preview-image"})]})]})]}),"Yes"===J.signature_status&&(0,_.jsxs)("div",{className:"signature-complete-section",children:[(0,_.jsxs)("div",{className:"section-title",children:[(0,_.jsx)("h4",{children:"Electronic Signature - Complete"}),(0,_.jsx)("p",{children:"Your investment has been successfully authorized and signed"})]}),(0,_.jsx)("div",{className:"signature-container",children:(0,_.jsxs)("div",{className:"signature-status-card success",children:[(0,_.jsxs)("div",{className:"status-header",children:[(0,_.jsx)("div",{className:"status-icon",children:(0,_.jsx)(j.A,{size:24})}),(0,_.jsxs)("div",{className:"status-text",children:[(0,_.jsx)("h5",{children:"Signature Complete"}),(0,_.jsxs)("p",{className:"text-muted",children:["Signed on: ",me(J.signature_date)]})]})]}),(0,_.jsxs)("div",{className:"terms-acceptance-status mb-4",children:[(0,_.jsxs)("div",{className:"d-flex align-items-center mb-2",children:[(0,_.jsx)("i",{className:"bi bi-check-circle-fill text-success me-2"}),(0,_.jsx)("span",{children:(0,_.jsx)("strong",{children:"Terms & Conditions Accepted"})})]}),(0,_.jsxs)("div",{className:"text-muted small",children:["Accepted on: ",me(J.terms_accepted_at)]})]}),(0,_.jsxs)("div",{className:"signature-display-card",children:[(0,_.jsx)("h6",{children:"Your Digital Signature:"}),(0,_.jsx)("div",{className:"signature-image-container",children:(0,_.jsx)("img",{src:J.signature,alt:"Your Digital Signature",className:"signature-img"})}),(0,_.jsx)("div",{className:"signature-details mt-3",children:(0,_.jsxs)("div",{className:"row",children:[(0,_.jsxs)("div",{className:"col-md-6",children:[(0,_.jsxs)("div",{className:"detail-item",children:[(0,_.jsx)("span",{className:"label",children:"Signature Type:"}),(0,_.jsx)("span",{className:"value",children:"text"===J.signature_type?"Typed Signature":"Drawn Signature"})]}),J.signature_text&&(0,_.jsxs)("div",{className:"detail-item",children:[(0,_.jsx)("span",{className:"label",children:"Signature Text:"}),(0,_.jsx)("span",{className:"value",children:J.signature_text})]})]}),(0,_.jsxs)("div",{className:"col-md-6",children:[(0,_.jsxs)("div",{className:"detail-item",children:[(0,_.jsx)("span",{className:"label",children:"Status:"}),(0,_.jsx)("span",{className:"badge bg-success",children:"Authorized"})]}),(0,_.jsxs)("div",{className:"detail-item",children:[(0,_.jsx)("span",{className:"label",children:"Investment Ready:"}),(0,_.jsx)("span",{className:"badge bg-primary",children:"Yes"})]})]})]})})]}),(0,_.jsxs)("div",{className:"next-steps mt-4",children:[(0,_.jsx)("h6",{children:"Next Steps:"}),(0,_.jsxs)("div",{className:"steps-list",children:[(0,_.jsxs)("div",{className:"step-item completed",children:[(0,_.jsx)("div",{className:"step-number",children:"1"}),(0,_.jsxs)("div",{className:"step-content",children:[(0,_.jsx)("strong",{children:"Documents Reviewed"}),(0,_.jsx)("p",{className:"mb-0",children:"Term Sheet & Subscription Agreement"})]})]}),(0,_.jsxs)("div",{className:"step-item completed",children:[(0,_.jsx)("div",{className:"step-number",children:"2"}),(0,_.jsxs)("div",{className:"step-content",children:[(0,_.jsx)("strong",{children:"Terms Accepted"}),(0,_.jsx)("p",{className:"mb-0",children:"All terms and conditions accepted"})]})]}),(0,_.jsxs)("div",{className:"step-item completed",children:[(0,_.jsx)("div",{className:"step-number",children:"3"}),(0,_.jsxs)("div",{className:"step-content",children:[(0,_.jsx)("strong",{children:"Digital Signature"}),(0,_.jsx)("p",{className:"mb-0",children:"Signature provided and authorized"})]})]}),(0,_.jsxs)("div",{className:"step-item current",children:[(0,_.jsx)("div",{className:"step-number",children:"4"}),(0,_.jsxs)("div",{className:"step-content",children:[(0,_.jsx)("strong",{children:"Proceed to Investment"}),(0,_.jsx)("p",{className:"mb-0",children:(0,_.jsxs)("button",{className:"btn btn-success btn-sm",onClick:U,children:[(0,_.jsx)(l.MxO,{size:14,className:"me-1"}),"Invest Now"]})})]})]})]})]})]})})]})]}),"excutivesummary"===w&&(0,_.jsxs)("div",{className:"executive-summary-container mt-4",children:[(0,_.jsxs)("div",{className:"summary-header d-flex align-items-center p-3 bg-primary text-white rounded-top",children:[(0,_.jsx)(c.bMy,{size:20,className:"me-2"}),(0,_.jsx)("h5",{className:"mb-0",children:"Executive Summary"})]}),(0,_.jsx)("div",{className:"summary-body p-4 bg-white rounded-bottom border border-top-0",children:J.executive_summary?(0,_.jsx)("div",{className:"summary-content",children:(0,_.jsx)("div",{className:"d-flex align-items-start",children:(0,_.jsx)("div",{className:"flex-grow-1",children:(0,_.jsx)("p",{style:{whiteSpace:"pre-line",lineHeight:"1.8",fontSize:"0.95rem"},children:J.executive_summary})})})}):(0,_.jsxs)("div",{className:"empty-state text-center py-5",children:[(0,_.jsx)(c.LQz,{size:48,className:"text-muted mb-3"}),(0,_.jsx)("h6",{className:"text-muted",children:"No summary generated yet"}),(0,_.jsx)("p",{className:"text-muted small mb-0",children:"AI-generated executive summary will appear here"})]})})]})]})]})]})})})]})}),A&&(0,_.jsx)(z,{onClose:()=>{C(!1)},records:J,nextround:ie,nextRoundData:le}),(0,_.jsx)("style",{jsx:!0,children:"\n        .capital-round-card {\n          background: #fff;\n          border-radius: 20px;\n          box-shadow: 0 4px 25px #d4d4d4ff;\n          overflow: hidden;\n          margin-bottom: 2rem;\n        }\n\n        .round-header {\n          padding: 2rem;\n          background: linear-gradient(135deg, #ff3d41 0%, #ff777a 100%);\n\n          color: white;\n        }\n\n        .header-content {\n          display: flex;\n          align-items: flex-start;\n          gap: 1rem;\n          margin-bottom: 1.5rem;\n        }\n\n        .icon-wrapper {\n          width: 50px;\n          height: 50px;\n          border-radius: 12px;\n          background: rgba(255, 255, 255, 0.2);\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          backdrop-filter: blur(10px);\n        }\n\n        .header-text {\n          flex: 1;\n        }\n\n        .round-title {\n          font-size: 1.75rem;\n          font-weight: 700;\n          margin: 0 0 0.5rem 0;\n          color: white;\n        }\n\n        .round-subtitle {\n          opacity: 0.9;\n          margin: 0 0 1rem 0;\n          font-size: 1rem;\n        }\n\n        .round-meta {\n          display: flex;\n          gap: 1.5rem;\n          flex-wrap: wrap;\n        }\n\n        .meta-item {\n          display: flex;\n          align-items: center;\n          font-size: 0.875rem;\n          opacity: 0.8;\n        }\n\n        .funding-progress {\n          background: rgba(255, 255, 255, 0.1);\n          border-radius: 12px;\n          padding: 1.25rem;\n          backdrop-filter: blur(10px);\n        }\n\n        .progress-header {\n          display: flex;\n          justify-content: space-between;\n          align-items: center;\n          margin-bottom: 0.75rem;\n        }\n\n        .progress-label {\n          font-weight: 600;\n        }\n\n        .progress-percentage {\n          font-weight: 700;\n          font-size: 1.125rem;\n        }\n\n        .progress-bar {\n          height: 8px;\n          background: rgba(255, 255, 255, 0.2);\n          border-radius: 4px;\n          overflow: hidden;\n          margin-bottom: 0.75rem;\n        }\n\n        .progress-fill {\n          height: 100%;\n          background: linear-gradient(90deg, #4ade80, #22c55e);\n          border-radius: 4px;\n          transition: width 0.3s ease;\n        }\n\n        .progress-stats {\n          display: flex;\n          justify-content: space-between;\n          font-size: 0.875rem;\n          opacity: 0.9;\n        }\n\n        .round-tabs {\n          display: flex;\n          background: #f8fafc;\n          border-bottom: 1px solid #e2e8f0;\n        }\n\n        .tab-button {\n          padding: 1rem 1.5rem;\n          background: none;\n          border: none;\n          border-bottom: 3px solid transparent;\n          color: #64748b;\n          font-weight: 500;\n          display: flex;\n          align-items: center;\n          transition: all 0.3s ease;\n          cursor: pointer;\n        }\n\n        .tab-button:hover {\n          color: #334155;\n          background: #f1f5f9;\n        }\n\n        .tab-button.active {\n          color: #f75f62;\n          border-bottom-color: #f75f62;\n          background: white;\n        }\n\n        .tab-content {\n          padding: 2rem;\n        }\n\n        .alert-message {\n          display: flex;\n          align-items: center;\n          justify-content: space-between;\n          padding: 1rem 1.25rem;\n          border-radius: 8px;\n          margin-bottom: 1.5rem;\n        }\n\n        .alert-message.success {\n          background: #f0fdf4;\n          color: #166534;\n          border: 1px solid #bbf7d0;\n        }\n\n        .alert-message.error {\n          background: #fef2f2;\n          color: #991b1b;\n          border: 1px solid #fecaca;\n        }\n\n        .alert-content {\n          display: flex;\n          align-items: center;\n          gap: 0.5rem;\n        }\n\n        .alert-close {\n          background: none;\n          border: none;\n          font-size: 1.25rem;\n          cursor: pointer;\n          opacity: 0.7;\n        }\n\n        .alert-close:hover {\n          opacity: 1;\n        }\n\n        .metrics-grid {\n          display: grid;\n          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));\n          gap: 1.5rem;\n          margin-bottom: 2rem;\n        }\n\n        .metric-card {\n          background: #f8fafc;\n          border-radius: 12px;\n          padding: 1.5rem;\n          display: flex;\n          align-items: center;\n          gap: 1rem;\n          border: 1px solid #e2e8f0;\n          transition: transform 0.2s ease;\n        }\n\n        .metric-card:hover {\n          transform: translateY(-2px);\n          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);\n        }\n\n        .metric-icon {\n          width: 50px;\n          height: 50px;\n          border-radius: 10px;\n          background: linear-gradient(135deg, #ff3d41 0%, #ff777a 100%);\n\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          color: white;\n        }\n\n        .metric-content label {\n          font-size: 0.875rem;\n          color: #64748b;\n          font-weight: 500;\n          display: block;\n          margin-bottom: 0.25rem;\n        }\n\n        .metric-content h3 {\n          margin: 0;\n          font-size: 1.5rem;\n          font-weight: 700;\n          color: #1e293b;\n        }\n\n        .details-grid {\n          display: grid;\n          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n          gap: 2rem;\n        }\n\n        .detail-section {\n          background: #f8fafc;\n          border-radius: 12px;\n          padding: 1.5rem;\n        }\n\n        .detail-section h4 {\n          margin: 0 0 1rem 0;\n          color: #1e293b;\n          font-weight: 600;\n          font-size: 1.125rem;\n        }\n\n        .detail-list {\n          display: flex;\n          flex-direction: column;\n          gap: 1rem;\n        }\n\n        .detail-item {\n          display: flex;\n          justify-content: space-between;\n          align-items: center;\n          padding-bottom: 0.75rem;\n          border-bottom: 1px solid #e2e8f0;\n        }\n\n        .detail-item:last-child {\n          border-bottom: none;\n          padding-bottom: 0;\n        }\n\n        .detail-item label {\n          font-weight: 500;\n          color: #475569;\n        }\n\n        .detail-item span {\n          font-weight: 600;\n          color: #1e293b;\n        }\n\n        .documents-grid {\n          display: grid;\n          gap: 1rem;\n        }\n\n        .document-card {\n          display: flex;\n          align-items: center;\n          gap: 1rem;\n          padding: 1.5rem;\n          background: #f8fafc;\n          border-radius: 12px;\n          border: 1px solid #e2e8f0;\n        }\n\n        .document-icon {\n          width: 50px;\n          height: 50px;\n          border-radius: 10px;\n          background: #e0f2fe;\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          color: #0369a1;\n        }\n\n        .document-info {\n          flex: 1;\n        }\n\n        .document-info h5 {\n          margin: 0 0 0.25rem 0;\n          color: #1e293b;\n        }\n\n        .document-info p {\n          margin: 0;\n          color: #64748b;\n          font-size: 0.875rem;\n        }\n\n        .download-btn {\n          display: flex;\n          align-items: center;\n          gap: 0.5rem;\n          padding: 0.75rem 1.25rem;\n          background: #f75f62;\n          color: white;\n          border: none;\n          border-radius: 8px;\n          font-weight: 500;\n          cursor: pointer;\n          transition: background 0.2s ease;\n        }\n\n        .download-btn:hover {\n          background: #2563eb;\n        }\n\n        .signature-content h4 {\n          margin: 0 0 0.5rem 0;\n          color: #1e293b;\n        }\n\n        .signature-description {\n          color: #64748b;\n          margin-bottom: 1.5rem;\n        }\n\n        .signature-container {\n          max-width: 600px;\n        }\n\n        .signature-pad-wrapper {\n          border: 2px dashed #cbd5e1;\n          border-radius: 8px;\n          margin-bottom: 1.5rem;\n          background: #fafafa;\n        }\n\n        .signature-canvas {\n          border-radius: 6px;\n          cursor: crosshair;\n        }\n\n        .signature-actions {\n          display: flex;\n          gap: 1rem;\n        }\n\n        .btn-primary {\n          background: linear-gradient(135deg, #f75f62, #1d4ed8);\n          color: white;\n          border: none;\n          padding: 0.875rem 1.5rem;\n          border-radius: 8px;\n          font-weight: 500;\n          cursor: pointer;\n          display: flex;\n          align-items: center;\n          transition: all 0.2s ease;\n        }\n\n        .btn-primary:hover {\n          transform: translateY(-1px);\n          box-shadow: 0 4px 12px #f63c3f;\n        }\n\n        .btn-secondary {\n          background: #f1f5f9;\n          color: #f63c3f;\n          border: 1px solid #cbd5e1;\n          padding: 0.875rem 1.5rem;\n          border-radius: 8px;\n          font-weight: 500;\n          cursor: pointer;\n          transition: all 0.2s ease;\n        }\n\n        .btn-secondary:hover {\n          background: #e2e8f0;\n        }\n\n        .round-status-badge .status-active {\n          background: #dcfce7;\n          color: #166534;\n          padding: 0.5rem 1rem;\n          border-radius: 20px;\n          font-size: 0.875rem;\n          font-weight: 500;\n        }\n\n        .loading-spinner {\n          display: flex;\n          justify-content: center;\n          align-items: center;\n          height: 200px;\n        }\n\n        @media (max-width: 768px) {\n          .round-header {\n            padding: 1.5rem;\n          }\n\n          .header-content {\n            flex-direction: column;\n            text-align: center;\n          }\n\n          .round-tabs {\n            flex-direction: column;\n          }\n\n          .tab-button {\n            justify-content: center;\n          }\n\n          .tab-content {\n            padding: 1.5rem;\n          }\n\n          .metrics-grid {\n            grid-template-columns: 1fr;\n          }\n\n          .details-grid {\n            grid-template-columns: 1fr;\n          }\n\n          .document-card {\n            flex-direction: column;\n            text-align: center;\n          }\n\n          .signature-actions {\n            flex-direction: column;\n          }\n        }\n      "})]})}},28646:(e,s,n)=>{n.d(s,{A:()=>a});const a=(0,n(77784).A)("calendar",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}]])},31738:(e,s,n)=>{n.d(s,{A:()=>i});var a=n(65043),t=n(70579);function i(){const[e,s]=(0,a.useState)(""),[n,i]=(0,a.useState)("");return(0,a.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),n=await e.json();s(n.ip)}catch(e){console.error("Failed to fetch IP",e)}})(),(()=>{const e=(new Date).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});i(e)})()}),[]),(0,t.jsx)(t.Fragment,{children:(0,t.jsxs)("div",{className:"d-flex flex-column gap-1 p-2 ipaddbox",children:[(0,t.jsxs)("h4",{children:["Date: ",(0,t.jsxs)("span",{children:["(",n,")"]})]}),(0,t.jsxs)("h4",{children:["IP Address: ",(0,t.jsx)("span",{children:e})]})]})})}},41680:(e,s,n)=>{n.d(s,{A:()=>a});const a=(0,n(77784).A)("file-text",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]])},44919:(e,s,n)=>{n.d(s,{A:()=>a});const a=(0,n(77784).A)("trending-up",[["polyline",{points:"22 7 13.5 15.5 8.5 10.5 2 17",key:"126l90"}],["polyline",{points:"16 7 22 7 22 13",key:"kwv8wd"}]])},53639:(e,s,n)=>{n.d(s,{A:()=>a});const a=(0,n(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},55930:(e,s,n)=>{n.d(s,{A:()=>j});var a=n(65043),t=(n(38421),n(73216)),i=n(75200),r=n(9463),l=n(53579),c=n(35475),d=n(50423),o=n(53639),m=n(14459),x=n(42983),h=n(31387),p=n(47196),u=n(31738),b=n(70579);const g=[{label:"Dashboard",href:"/investor/dashboard",icon:(0,b.jsx)(p.oeo,{size:18})},{label:"Portfolio Companies",href:"/investor/company-list",icon:(0,b.jsx)(o.A,{size:18})},{label:"Profile",href:"/investor/investor-profile",icon:(0,b.jsx)(m.A,{size:18})}];const j=function(e){let{isCollapsed:s,setIsCollapsed:n}=e;const[o,m]=(0,a.useState)(!1),[j,v]=(0,a.useState)(""),f=(0,t.Zp)(),[N,y]=(0,a.useState)(null),[w,k]=(0,a.useState)([]),[S,_]=(0,a.useState)(!1);(0,a.useEffect)((()=>{const e=()=>{window.innerWidth<786?(_(!0),F&&F(!0)):(_(!1),F&&F(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[S]);const[z,A]=(0,a.useState)(!1),C=void 0!==s?s:S,F=n||_;(0,a.useEffect)((()=>{const e=JSON.parse(localStorage.getItem("InvestorData"));if(e&&e.access_token){const s=(new Date).getTime();e.expiry&&s<e.expiry?v(e):(localStorage.removeItem("InvestorData"),f("/investor/login"))}else localStorage.removeItem("InvestorData"),f("/investor/login")}),[]),(0,a.useEffect)((()=>{const e=localStorage.getItem("selectedDropdown");e&&y(Number(e));const s=localStorage.getItem("sidebarCollapsed");if(null!==s){const e=JSON.parse(s);n?n(e):_(e)}}),[]);const E=(0,t.zy)(),R=!C||z;return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(C?"collapsed p-3":"p-4"),children:[(0,b.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(C?"justify-content-center":"justify-content-between"),children:[!C&&(0,b.jsx)("a",{href:"/",className:"logo",children:(0,b.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,b.jsx)(l.V4,{className:"d-flex justify-content-end",children:(0,b.jsxs)("button",{type:"button",onClick:()=>{const e=!C;F(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[C&&(0,b.jsx)(x.A,{strokeWidth:2}),!C&&(0,b.jsx)(r.A,{strokeWidth:2})]})})]}),(0,b.jsx)(l.vT,{isOpen:R,children:(0,b.jsx)(l.c0,{children:g.map(((e,s)=>{var n;let a=!1;var t;"/investor/company-list"===e.href?a=E.pathname===e.href||E.pathname.startsWith("/investor/company"):a=(null===(t=e.matchPaths)||void 0===t?void 0:t.some((e=>(0,h.B6)({path:e,end:!1},E.pathname))))||E.pathname===e.href;return(0,b.jsx)(l.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)(l.C,{title:e.label,onClick:()=>(e=>{const s=N===e?null:e;C&&F(!C);y(s),localStorage.setItem("selectedDropdown",null!==s?s:"")})(s),className:C&&!z?"justify-content-center px-0":"",children:(0,b.jsxs)("div",{className:"d-flex gap-2 align-items-center w-100 "+(C?"justify-content-center":"justify-content-between"),children:[(0,b.jsxs)("div",{className:"d-flex gap-2 align-items-start "+(C&&!z?"justify-content-center":""),children:[e.icon,R&&e.label]}),R&&(0,b.jsx)(l.i3,{isOpen:N===s,children:(0,b.jsx)(d.pte,{})})]})}),N===s&&R&&(0,b.jsxs)(l.rI,{children:[(0,b.jsx)("hr",{className:"my-2"}),null===(n=e.dropdown)||void 0===n?void 0:n.map(((e,s)=>{const n=E.pathname===e.href;return(0,b.jsx)("li",{className:"list-none",children:(0,b.jsxs)("a",{href:e.href,title:e.label,className:"sidebar d-flex align-items-start gap-2 "+(n?"active":""),children:[e.icon,e.label]})},s)})),"modules"===e.dynamicDropdownKey&&(0,b.jsxs)(b.Fragment,{children:[w.map(((e,s)=>{const n="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,a=E.pathname===n;return(0,b.jsx)("li",{className:"list-none",children:(0,b.jsxs)("a",{href:n,title:e.name,className:"sidebar d-flex align-items-start gap-2 "+(a?"active":""),children:[(0,b.jsx)(p.MO3,{size:16}),e.name]})},s)})),(0,b.jsx)("li",{className:"list-none",children:(0,b.jsxs)("a",{href:"/advicevideos",title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",className:"sidebar d-flex align-items-start gap-2 "+("/advicevideos"===E.pathname?"active":""),children:[(0,b.jsx)(p.xi0,{size:16}),"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,b.jsxs)("a",{href:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${a?"active":""} ${C&&!z?"justify-content-center":""}`,children:[e.icon,R&&e.label]})},s)}))})}),(0,b.jsxs)("div",{className:"d-flex flex-column gap-2 mt-auto",children:[(0,b.jsx)(u.A,{}),(0,b.jsx)("div",{className:"d-flex  align-items-end gap-2 "+(C?"justify-content-center":"justify-content-end"),children:(0,b.jsx)(c.N_,{title:"Logout",to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("InvestorData"),window.location.href="/investor/login"},className:"logout_investor_global ",children:(0,b.jsx)(i.QeK,{width:14})})})]})]}),(0,b.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 80px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,s,n)=>{n.d(s,{$K:()=>r,CB:()=>c,Cd:()=>j,I0:()=>o,Jq:()=>h,R3:()=>N,Zw:()=>x,dN:()=>b,hJ:()=>g,jh:()=>d,mO:()=>t,mg:()=>l,nj:()=>v,pd:()=>f,uM:()=>p,vE:()=>i,z6:()=>m});var a=n(5464);const t=a.default.div`
  input,
  textarea,
  select,
  a,
  p,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 0;
    text-decoration: none;
    outline: none;
    word-break: break-word;
    overflow-wrap: break-word;
  }

  input:focus,
  textarea:focus,
  select:focus {
    outline: none;
    box-shadow: none;
    border-color: inherit;
  }
`,i=a.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,r=(a.default.div`
  .react-datepicker-wrapper {
    display: block;
    width: 100%;
  }

  .react-datepicker__input-container {
    display: block;
    width: 100%;
  }

  input.react-datepicker-ignore-onclickoutside {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 14px;
    outline: none;
    background: #fff;
    color: #333;

    &:focus {
      border-color: #999;
      box-shadow: none;
    }
  }

  /* 🔻 Hide the triangle */
  .react-datepicker__triangle {
    display: none !important;
  }
`,a.default.div`
  margin-bottom: auto;
  padding: 15px 0;
  background: var(--primary);
  border-bottom: 10px solid var(--secondary-color);
  .logo {
    display: inline-block;
    width: 140px;
    img {
      width: 100%;
    }
  }
`,a.default.div`
  display: flex;
  gap: 10px;
  align-items: center;
  svg {
    stroke: #fff;
    stroke-width: 1.2; /* thinner stroke if needed */
  }

  select {
    background: #fff;
    color: #111;
    border: none;
    font-size: 14px;
  }
`,a.default.div`
  display: block;
  height: 100%;
`),l=a.default.div`
  // display: none;

  border-radius: 0px;

  &.active {
    display: block;
  }

  label {
    font-size: 0.9rem;
    font-weight: 500;
    color: #000;
    // text-transform: capitalize;
  }

  input[type="text"],
  input[type="number"],
  input[type="email"],
  input[type="tel"],
  select {
    padding: 6px 10px 6px 35px;
    font-size: 15px;
    height: 37px;
    border: none;
    width: 100%;
    border-radius: 6px;
    background: #00000012;
  }

  textarea {
    padding: 6px 8px 6px 35px;
    font-size: 0.9rem;
    border-bottom: 2px solid #ccc;
    border-top: none;
    border-left: none;
    border-right: none;
    border-radius: 0px;
    width: 100%;
    background: #fff;
  }

  .sbtn {
    border: none;
    border-radius: 10px;
    display: inline-block;
    padding: 8px 20px;
    font-size: 0.9rem;
    width: 100%;
  }

  .nextbtn {
    background: var(--primary);
    color: #fff;

    &:hover {
      background: var(--primary);
    }
  }

  .backbtn {
    background: #111;
    color: #fff;

    &:hover {
      background: #2b2b2b;
    }
  }
`,c=a.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=a.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,o=a.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,m=a.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,x=a.default.div`
  display: flex;
  align-items: start;
  gap: 12px;

  input[type="radio"] {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    width: 17px;
    height: 17px;
    border: 2px solid var(--primary);
    border-radius: 50%;
    display: grid;
    place-content: center;
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    background: #fff;
    flex-shrink: 0;
    margin-top: 2px;
  }

  input[type="radio"]::before {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 50%;
    transform: scale(0);
    transition: transform 0.2s ease-in-out;
    background-color: var(--primary);
  }

  input[type="radio"]:checked::before {
    transform: scale(1);
  }

  label {
    font-weight: 500;
    cursor: pointer;
    line-height: 1.4;
    color: var(--dark);
    font-size: 0.9rem;
  }
`,h=(a.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,a.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,a.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,a.default.div`
  position: relative;

  svg {
    position: absolute;
    z-index: 2;
    top: 9px;
    left: 12px;
    width: 16px; /* smaller width */
    height: 16px; /* smaller height */
    stroke: var(--primary-icon);
    stroke-width: 1.2;
  }
`),p=(a.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,a.default.div`
  .klogo {
    width: 50px;
  }
  .inlogo {
    width: 170px;
    img {
      width: 100%;
    }
  }

  h3 {
    color: #999;
    font-size: 14px;
    font-weight: 500;
  }

  h4 {
    color: var(--primary);
    font-weight: 600;
    font-size: 24px;
  }

  h6 {
    color: #999;
    font-size: 14px;
  }

  p {
    color: #111;
    font-size: 14px;
  }
`),u=(a.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,a.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,a.default.div`
  display: inline-block;
  margin: 0px;
  transition: all 0.3s ease;
  border: 1px solid #cecece;
  position: relative;
  flex: 1 1 300px;
  max-width: 100%;

  video {
    aspect-ratio: 16/9;
  }

  &:before {
    content: "▶";
    color: white;
    font-size: 35px;
    position: absolute;
    width: 60px;
    height: 60px;
    left: 50%;
    top: 50%;
    text-align: center;
    line-height: 60px;
    transition: all 0.3s ease;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 2;
  }

  &:hover {
    cursor: pointer;
    box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);

    .desc {
      padding-bottom: 20px;
    }
  }

  @container video-gallery (max-width: 800px) {
    flex: 1 1 100%;
  }
`,a.default.button`
  background: none;
  border: none;
  font-size: 35px;
  position: absolute;
  width: 60px;
  height: 60px;
  left: 50%;
  top: 50%;
  text-align: center;
  line-height: 60px;
  transition: all 0.3s ease;
  transform: translate(-50%, -50%);
  z-index: 5;
`,a.default.div`
  transition: all 0.3s ease;
  padding: 10px 10px;
  color: white;
  position: absolute;
  top: 0px;
  box-sizing: border-box;
  left: 0px;
  width: 100%;
  margin-top: 0px;
  font-family: arial;
  font-size: 14px;
  text-align: left;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.1) 0%,
    rgba(0, 0, 0, 0.42) 36%,
    rgb(0, 0, 0) 100%
  );
`,a.default.video`
  background-color: black;
  border: none;
`,a.default.div`
  z-index: 999;
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;

  .overlay {
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(10px);
    position: absolute;
  }

  .vid-show {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: transparent;
    padding: 0px;
    background: none;
    width: 80vw;
  }

  .close {
    font-family: arial;
    font-weight: bold;
    background-color: #111;
    color: white;
    font-size: 20px;
    position: absolute;
    right: -5px;
    top: -5px;
    display: grid;
    place-items: center;
    border-radius: 100px;
    width: 40px;
    height: 40px;
    text-align: center;
    transition: all 0.3s ease;
    cursor: pointer;
    z-index: 888;

    &:hover {
      background-color: rgba(80, 80, 80, 0.8);
    }
  }
`,a.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,a.default.button`
  display: grid;
  color: #111;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background-color: rgba(255, 255, 255, 0.8);
  border: none;
  border-radius: 10px;
  width: 40px;
  height: 40px;
  font-size: 20px;
  line-height: 40px;
  padding: 9px;
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 44;

  i {
    height: 20px;
  }

  &:hover {
    background-color: rgb(255, 255, 255);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`),b=((0,a.default)(u)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(u)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,a.default.sup`
  color: var(--primary);
`),g=a.default.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: ${e=>{let{show:s}=e;return s?"flex":"none"}};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`,j=a.default.div`
  background: #fff;
  padding: 2rem;
  border-radius: 8px;
  width: 90%;
  max-width: 400px;
  position: relative;

  input {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 14px;
    color: #333;
    background-color: #fff;
    transition: border 0.3s ease;

    &:focus {
      border-color: #999;
      outline: none;
    }

    &::placeholder {
      color: #aaa;
    }
  }
`,v=a.default.button`
  position: absolute;
  top: -8px;
  right: -8px;
  border: none;
  background: #111;
  color: #fff;
  padding: 0px;
  border-radius: 10px;
  cursor: pointer;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  height: 26px;
`,f=a.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,N=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},73062:(e,s,n)=>{n.d(s,{A:()=>a});const a=(0,n(77784).A)("dollar-sign",[["line",{x1:"12",x2:"12",y1:"2",y2:"22",key:"7eqyqh"}],["path",{d:"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",key:"1b0p4s"}]])},75088:(e,s,n)=>{n.d(s,{A:()=>a});const a=(0,n(77784).A)("clock",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polyline",{points:"12 6 12 12 16 14",key:"68esgv"}]])}}]);
//# sourceMappingURL=614.e50dc64e.chunk.js.map