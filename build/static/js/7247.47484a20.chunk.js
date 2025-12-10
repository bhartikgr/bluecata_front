/*! For license information please see 7247.47484a20.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[7247],{7247:(e,t,a)=>{a.r(t),a.d(t,{default:()=>l});var i=a(65043),s=a(62837),n=a(55930),o=a(86213),r=a(70579);const l=function(){const[e,t]=(0,i.useState)(0),[a,l]=(0,i.useState)(0),[d,c]=(0,i.useState)(0),[p,h]=(0,i.useState)(0),[x,m]=(0,i.useState)([]),[u,f]=(0,i.useState)([]),[g,b]=(0,i.useState)([]),[v,j]=(0,i.useState)(""),[y,w]=(0,i.useState)(""),k=localStorage.getItem("InvestorData"),N=JSON.parse(k);var S="https://blueprintcatalyst.com/backend/api/user/capitalround/";document.title="Investor Dashboard Page",(0,i.useEffect)((()=>{z(),C(),I(),_(),D(),A()}),[]);const z=async()=>{let e={investor_id:N.id};try{const a=await o.A.post(S+"getTotalcompany",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(t(a.data.results.length),a.data.results.length>0){a.data.results.reduce(((e,t)=>e+Number(0)),0)}}catch(a){}},D=async()=>{let e={investor_id:N.id,type:"Investor updates"};try{const t=await o.A.post(S+"getTotalInvestorReport",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});j(t.data.results.length)}catch(t){}},A=async()=>{let e={investor_id:N.id,type:"Due Diligence Document"};try{const t=await o.A.post(S+"getTotalInvestorReport",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});w(t.data.results.length)}catch(t){}},C=async()=>{let e={investor_id:N.id};try{var t=(await o.A.post(S+"getTotalCompanyIssuedShared",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results;l(t.totalRoundSize),c(t.totalIssuedShares),h(t.totalRounds)}catch(a){}},I=async()=>{let e={investor_id:N.id,type:"Investor updates"};try{var t=(await o.A.post(S+"getlatestinvestorreport",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results;m(t)}catch(a){}},_=async()=>{let e={investor_id:N.id,type:"Due Diligence Document"};try{var t=(await o.A.post(S+"getlatestinvestorDataroom",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results;f(t)}catch(a){}};(0,i.useEffect)((()=>{T()}),[]);const T=async()=>{let e={investor_id:N.id};try{const t=await o.A.post(S+"getInvestorCapitalMotionlistLatest",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});b(t.data.results)}catch(t){}},[R]=(0,i.useState)({equity:{totalShares:"10,000,000",optionPool:"15%",investorStakes:"62%",valuation:"$25M"},shareholders:{labels:["Founders","Series A Investors","Series B Investors","Option Pool","Employees"],data:[35,25,20,15,5],colors:["#081828","#092f4e","#10395c","#1a588d","#2577bd","#2577bd"]},openRound:{type:"Series B",target:"$8M",raised:"$5.2M",preMoney:"$22M",closeDate:"Dec 15, 2023"},investors:{total:24,contacts:42,messages:[{name:"John Smith",firm:"VC Partners",message:"When will the next report be available?",time:"2h ago"},{name:"Sarah Johnson",firm:"Capital Growth",message:"Request for additional metrics...",time:"1d ago"}]},dataRoom:{completion:78,recentUploads:[{name:"Financials Q3 2023",description:"Updated projections",time:"Today"},{name:"Cap Table",description:"Latest revision",time:"Yesterday"}]},accessLogs:[{name:"David Wilson",action:"Viewed Financial Reports",time:"Today, 4:00 PM"},{name:"Emily Chen",action:"Downloaded Cap Table",time:"Today, 5:00 PM"},{name:"Michael Brown",action:"Viewed Pitch Deck",time:"Yesterday, 10:00 AM"}]}),[M,O]=(0,i.useState)(!1);function E(e){const t=new Date(e);if(isNaN(t))return"";const a=t.getDate(),i=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],s=t.getFullYear();return`${i} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${s}`}return(0,r.jsx)(s.mO,{className:"investor-login-wrapper",children:(0,r.jsx)("div",{className:"fullpage d-block",children:(0,r.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,r.jsx)(n.A,{isCollapsed:M,setIsCollapsed:O}),(0,r.jsx)("div",{className:"global_view "+(M?"global_view_col":""),children:(0,r.jsx)(s.$K,{className:"d-block p-md-4 p-3",children:(0,r.jsx)("div",{className:"container-fluid",children:(0,r.jsx)(s.mg,{id:"step5",children:(0,r.jsxs)("div",{className:"row",children:[(0,r.jsxs)("div",{className:"col-md-12",children:[(0,r.jsx)("div",{className:"pb-3 bar_design",children:(0,r.jsx)("h4",{className:"h5 mb-0",children:"Dashboard"})}),(0,r.jsxs)("div",{class:"row gap-0 dashboard-top",children:[(0,r.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,r.jsxs)("div",{class:"p-3",children:[(0,r.jsx)("p",{class:"small fw-medium mb-1",children:"Total Company"}),(0,r.jsx)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:(0,r.jsx)("p",{class:"h4 fw-semibold mb-0",children:e})})]})}),(0,r.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,r.jsxs)("div",{class:"p-3",children:[(0,r.jsx)("p",{class:"small fw-medium mb-1",children:"Total Investor Report"}),(0,r.jsx)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:(0,r.jsx)("p",{class:"h4 fw-semibold mb-0",children:v})})]})}),(0,r.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,r.jsxs)("div",{class:"p-3",children:[(0,r.jsx)("p",{class:"small fw-medium mb-1",children:"Total DataRoom Management Report"}),(0,r.jsx)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:(0,r.jsx)("p",{class:"h4 fw-semibold mb-0",children:y})})]})}),(0,r.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,r.jsxs)("div",{class:"p-3",children:[(0,r.jsx)("p",{class:"small fw-medium mb-1",children:"Total Round"}),(0,r.jsx)("p",{class:"h4 fw-semibold mb-0",children:p})]})})]})]}),(0,r.jsx)("div",{className:"col-12 my-4",children:(0,r.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,r.jsx)("div",{class:"card-header",children:(0,r.jsx)("h3",{class:"card-title",children:"Latest Company Report"})}),(0,r.jsxs)("div",{class:"access-logs",children:[(0,r.jsx)("h4",{class:"section-title",children:"Investor Report"}),(0,r.jsxs)("table",{class:"log-table",children:[(0,r.jsx)("thead",{children:(0,r.jsxs)("tr",{children:[(0,r.jsx)("th",{className:"fw-bold",children:"Report"}),(0,r.jsx)("th",{className:"fw-bold",children:"Version"}),(0,r.jsx)("th",{className:"fw-bold",children:"Date Of Report"}),(0,r.jsx)("th",{className:"fw-bold",children:"Name Of Report"})]})}),(0,r.jsx)("tbody",{children:Array.isArray(x)&&x.length>0?x.map(((e,t)=>(0,r.jsxs)("tr",{children:[(0,r.jsx)("td",{children:(0,r.jsx)("small",{children:e.type})}),(0,r.jsx)("td",{children:(0,r.jsx)("small",{children:e.version})}),(0,r.jsx)("td",{children:(0,r.jsx)("small",{children:E(e.shared_date)})}),(0,r.jsx)("td",{children:(0,r.jsx)("small",{children:e.document_name})})]},t))):(0,r.jsx)("tr",{children:(0,r.jsx)("td",{colSpan:"4",children:(0,r.jsx)("small",{children:"No records found"})})})})]})]}),(0,r.jsxs)("div",{class:"access-logs",children:[(0,r.jsx)("h4",{class:"section-title",children:"DataRoom Management & Diligence"}),(0,r.jsxs)("table",{class:"log-table",children:[(0,r.jsx)("thead",{children:(0,r.jsxs)("tr",{children:[(0,r.jsx)("th",{className:"fw-bold",children:"Report"}),(0,r.jsx)("th",{className:"fw-bold",children:"Version"}),(0,r.jsx)("th",{className:"fw-bold",children:"Date Of Report"}),(0,r.jsx)("th",{className:"fw-bold",children:"Name Of Report"})]})}),(0,r.jsx)("tbody",{children:Array.isArray(u)&&u.length>0?u.map(((e,t)=>(0,r.jsxs)("tr",{children:[(0,r.jsx)("td",{children:(0,r.jsx)("small",{children:e.type})}),(0,r.jsx)("td",{children:(0,r.jsx)("small",{children:e.version})}),(0,r.jsx)("td",{children:(0,r.jsx)("small",{children:E(e.shared_date)})}),(0,r.jsx)("td",{children:(0,r.jsx)("small",{children:e.document_name})})]},t))):(0,r.jsx)("tr",{children:(0,r.jsx)("td",{colSpan:"4",children:(0,r.jsx)("small",{children:"No records found"})})})})]})]}),(0,r.jsxs)("div",{class:"access-logs",children:[(0,r.jsx)("h4",{class:"section-title",children:"Capital Round Documents"}),(0,r.jsxs)("table",{class:"log-table",children:[(0,r.jsx)("thead",{children:(0,r.jsxs)("tr",{children:[(0,r.jsx)("th",{className:"fw-bold",children:"Share Class(Name Of Round)"}),(0,r.jsx)("th",{className:"fw-bold",children:"Target Raise Amount"}),(0,r.jsx)("th",{className:"fw-bold",children:"Number Of Shares"}),(0,r.jsx)("th",{className:"fw-bold",children:"Date of Share"})]})}),(0,r.jsx)("tbody",{children:Array.isArray(g)&&g.length>0?g.map(((e,t)=>(0,r.jsxs)("tr",{children:[(0,r.jsx)("td",{children:(0,r.jsxs)("small",{children:[e.nameOfRound," ",e.shareClassType]})}),(0,r.jsx)("td",{children:(0,r.jsxs)("small",{children:[e.currency," ",Number(e.roundsize).toLocaleString("en-US")]})}),(0,r.jsx)("td",{children:(0,r.jsx)("small",{children:Number(e.issuedshares).toLocaleString("en-US")})}),(0,r.jsx)("td",{children:(0,r.jsx)("small",{children:E(e.sent_date)})})]},t))):(0,r.jsx)("tr",{children:(0,r.jsx)("td",{colSpan:"4",children:(0,r.jsx)("small",{children:"No records found"})})})})]})]})]})})]})})})})})]})})})}},14459:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},53639:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},55930:(e,t,a)=>{a.d(t,{A:()=>g});var i=a(65043),s=(a(38421),a(73216)),n=a(75200),o=a(9463),r=a(53579),l=a(35475),d=a(50423),c=a(53639),p=a(14459),h=a(42983),x=a(31387),m=a(47196),u=a(70579);const f=[{label:"Dashboard",href:"/investor/dashboard",icon:(0,u.jsx)(m.oeo,{size:18})},{label:"Company",href:"/investor/company-list",icon:(0,u.jsx)(c.A,{size:18})},{label:"Profile",href:"/investor/investor-profile",icon:(0,u.jsx)(p.A,{size:18})}];const g=function(e){let{isCollapsed:t,setIsCollapsed:a}=e;const[c,p]=(0,i.useState)(!1),[g,b]=(0,i.useState)(""),v=(0,s.Zp)(),[j,y]=(0,i.useState)(null),[w,k]=(0,i.useState)([]),[N,S]=(0,i.useState)(!1);(0,i.useEffect)((()=>{const e=()=>{window.innerWidth<786?(S(!0),C&&C(!0)):(S(!1),C&&C(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[N]);const[z,D]=(0,i.useState)(!1),A=void 0!==t?t:N,C=a||S;(0,i.useEffect)((()=>{const e=JSON.parse(localStorage.getItem("InvestorData"));if(e&&e.access_token){const t=(new Date).getTime();e.expiry&&t<e.expiry?b(e):(localStorage.removeItem("InvestorData"),v("/investor/login"))}else localStorage.removeItem("InvestorData"),v("/investor/login")}),[]),(0,i.useEffect)((()=>{const e=localStorage.getItem("selectedDropdown");e&&y(Number(e));const t=localStorage.getItem("sidebarCollapsed");if(null!==t){const e=JSON.parse(t);a?a(e):S(e)}}),[]);const I=(0,s.zy)(),_=!A||z;return(0,u.jsxs)(u.Fragment,{children:[(0,u.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(A?"collapsed p-3":"p-4"),children:[(0,u.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(A?"justify-content-center":"justify-content-between"),children:[!A&&(0,u.jsx)("a",{href:"/",className:"logo",children:(0,u.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,u.jsx)(r.V4,{className:"d-flex justify-content-end",children:(0,u.jsxs)("button",{type:"button",onClick:()=>{const e=!A;C(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[A&&(0,u.jsx)(h.A,{strokeWidth:2}),!A&&(0,u.jsx)(o.A,{strokeWidth:2})]})})]}),(0,u.jsx)(r.vT,{isOpen:_,children:(0,u.jsx)(r.c0,{children:f.map(((e,t)=>{var a;let i=!1;var s;"/investor/company-list"===e.href?i=I.pathname===e.href||I.pathname.startsWith("/investor/company"):i=(null===(s=e.matchPaths)||void 0===s?void 0:s.some((e=>(0,x.B6)({path:e,end:!1},I.pathname))))||I.pathname===e.href;return(0,u.jsx)(r.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,u.jsxs)(u.Fragment,{children:[(0,u.jsx)(r.C,{title:e.label,onClick:()=>(e=>{const t=j===e?null:e;A&&C(!A);y(t),localStorage.setItem("selectedDropdown",null!==t?t:"")})(t),className:A&&!z?"justify-content-center px-0":"",children:(0,u.jsxs)("div",{className:"d-flex gap-2 align-items-center w-100 "+(A?"justify-content-center":"justify-content-between"),children:[(0,u.jsxs)("div",{className:"d-flex gap-2 align-items-start "+(A&&!z?"justify-content-center":""),children:[e.icon,_&&e.label]}),_&&(0,u.jsx)(r.i3,{isOpen:j===t,children:(0,u.jsx)(d.pte,{})})]})}),j===t&&_&&(0,u.jsxs)(r.rI,{children:[(0,u.jsx)("hr",{className:"my-2"}),null===(a=e.dropdown)||void 0===a?void 0:a.map(((e,t)=>{const a=I.pathname===e.href;return(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)("a",{href:e.href,title:e.label,className:"sidebar d-flex align-items-start gap-2 "+(a?"active":""),children:[e.icon,e.label]})},t)})),"modules"===e.dynamicDropdownKey&&(0,u.jsxs)(u.Fragment,{children:[w.map(((e,t)=>{const a="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,i=I.pathname===a;return(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)("a",{href:a,title:e.name,className:"sidebar d-flex align-items-start gap-2 "+(i?"active":""),children:[(0,u.jsx)(m.MO3,{size:16}),e.name]})},t)})),(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)("a",{href:"/advicevideos",title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",className:"sidebar d-flex align-items-start gap-2 "+("/advicevideos"===I.pathname?"active":""),children:[(0,u.jsx)(m.xi0,{size:16}),"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,u.jsxs)("a",{href:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${i?"active":""} ${A&&!z?"justify-content-center":""}`,children:[e.icon,_&&e.label]})},t)}))})}),(0,u.jsx)("div",{className:"d-flex  align-items-end gap-2 h-100 "+(A?"justify-content-center":"justify-content-end"),children:(0,u.jsx)(l.N_,{title:"Logout",to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("InvestorData"),window.location.href="/investor/login"},className:"logout_investor_global ",children:(0,u.jsx)(n.QeK,{width:14})})})]}),(0,u.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 80px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,t,a)=>{a.d(t,{$K:()=>o,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>x,R3:()=>y,Zw:()=>h,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>s,mg:()=>r,nj:()=>v,pd:()=>j,uM:()=>m,vE:()=>n,z6:()=>p});var i=a(5464);const s=i.default.div`
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
`,n=i.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,o=(i.default.div`
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
`,i.default.div`
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
`,i.default.div`
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
`,i.default.div`
  display: block;
  height: 100%;
`),r=i.default.div`
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
`,l=i.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=i.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=i.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=i.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,h=i.default.div`
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
`,x=(i.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,i.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,i.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,i.default.div`
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
`),m=(i.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,i.default.div`
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
`),u=(i.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,i.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,i.default.div`
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
`,i.default.button`
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
`,i.default.div`
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
`,i.default.video`
  background-color: black;
  border: none;
`,i.default.div`
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
`,i.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,i.default.button`
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
`),f=((0,i.default)(u)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,i.default)(u)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,i.default.sup`
  color: var(--primary);
`),g=i.default.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: ${e=>{let{show:t}=e;return t?"flex":"none"}};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`,b=i.default.div`
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
`,v=i.default.button`
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
`,j=i.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,y=i.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=7247.47484a20.chunk.js.map