/*! For license information please see 5893.807ddc91.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[5893],{14459:(e,t,o)=>{o.d(t,{A:()=>a});const a=(0,o(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},53639:(e,t,o)=>{o.d(t,{A:()=>a});const a=(0,o(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},55893:(e,t,o)=>{o.r(t),o.d(t,{default:()=>u});var a=o(65043),n=o(62837),i=o(86213),r=o(58786),s=o(73216),l=o(60184),d=o(55930),c=o(27836),p=o(49535),x=o(65469),f=o(70579);const u=function(){const[e,t]=(0,a.useState)(!1),[o,u]=(0,a.useState)(""),{id:h}=(0,s.g)(),m=(0,s.Zp)();document.title="Company Report List - Investor";var g="https://blueprintcatalyst.com/api/user/investor/";const b=localStorage.getItem("InvestorData"),v=JSON.parse(b),[w,y]=(0,a.useState)(""),[k,j]=(0,a.useState)(!1);(0,a.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),t=await e.json();u(t.ip)}catch(e){console.error("Failed to fetch IP",e)}})()}),[]),(0,a.useEffect)((()=>{N()}),[]);const N=async()=>{let e={investor_id:v.id,type:"Investor updates",company_id:h};try{const t=await i.A.post(g+"getInvestorReportslist",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});S(t.data.results)}catch(t){}},[z,S]=(0,a.useState)([{id:1,email:"test1@company.com",discount_code:"DISC10",percentage:10,company_email_match:"Yes"},{id:2,email:"test2@company.com",discount_code:"SAVE20",percentage:20,company_email_match:"No"},{id:3,email:"demo@company.com",discount_code:"OFF50",percentage:50,company_email_match:"Yes"}]),_=z.filter((e=>{const t=w.toLowerCase();return`\n    ${e.type||""}\n    ${e.version||""}\n    ${e.document_name||""}\n    ${e.download||""}\n  `.toLowerCase().includes(t)}));function C(e){const t=new Date(e);if(isNaN(t))return"";const o=t.getDate(),a=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],n=t.getFullYear();return`${a} ${o}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(o)}, ${n}`}return(0,f.jsx)(n.mO,{className:"investor-login-wrapper",children:(0,f.jsx)("div",{className:"fullpage d-block",children:(0,f.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,f.jsx)(d.A,{isCollapsed:k,setIsCollapsed:j}),(0,f.jsx)("div",{className:"global_view "+(k?"global_view_col":""),children:(0,f.jsx)(n.$K,{className:"d-block p-md-4 p-3",children:(0,f.jsx)("div",{className:"container-fluid",children:(0,f.jsxs)(c.zP,{className:"d-flex flex-column gap-3",children:[(0,f.jsxs)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:[(0,f.jsxs)(p.o,{type:"button",className:"backbtn",onClick:()=>{m("/investor/company-list")},children:[(0,f.jsx)(x.A,{size:16,className:"me-1"})," back"]}),(0,f.jsx)("h4",{className:"mainh1",children:"Investor Report List"})]}),(0,f.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,f.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:w,onChange:e=>y(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,f.jsx)("div",{className:"d-flex overflow-auto flex-column justify-content-between align-items-start tb-box",children:(0,f.jsx)(r.Ay,{customStyles:{table:{style:{minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"Report",selector:e=>e.type,sortable:!0,cell:e=>(0,f.jsx)("span",{children:e.type})},{name:"Version",selector:e=>e.version,sortable:!0,cell:e=>(0,f.jsx)("span",{children:e.version})},{name:"Date Of Report",selector:e=>C(e.shared_date),sortable:!0,cell:e=>(0,f.jsx)("span",{children:C(e.shared_date)})},{name:"Name of Report",selector:e=>e.document_name,sortable:!0,cell:e=>(0,f.jsx)("span",{children:e.document_name})},{name:"Actions",cell:e=>(0,f.jsx)("div",{className:"d-flex gap-2",children:(0,f.jsx)("button",{type:"button",onClick:()=>(async(e,t)=>{let a={investor_id:v.id,id:e,company_id:h,ip_address:o};try{await i.A.post(g+"InvestorReportslistDownload",a,{headers:{Accept:"application/json","Content-Type":"application/json"}}),window.open(t,"_blank")}catch(n){}})(e.id,e.downloadUrl),title:"Download/View",className:"icon_download",children:(0,f.jsx)(l.WCW,{})})}),ignoreRowClick:!0,allowOverflow:!0,button:!0}],className:"datatb-report",data:_,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})})]})})})})]})})})}},55930:(e,t,o)=>{o.d(t,{A:()=>g});var a=o(65043),n=(o(38421),o(73216)),i=o(75200),r=o(9463),s=o(53579),l=o(35475),d=o(50423),c=o(53639),p=o(14459),x=o(42983),f=o(31387),u=o(47196),h=o(70579);const m=[{label:"Dashboard",href:"/investor/dashboard",icon:(0,h.jsx)(u.oeo,{size:18})},{label:"Company",href:"/investor/company-list",icon:(0,h.jsx)(c.A,{size:18})},{label:"Profile",href:"/investor/investor-profile",icon:(0,h.jsx)(p.A,{size:18})}];const g=function(e){let{isCollapsed:t,setIsCollapsed:o}=e;const[c,p]=(0,a.useState)(!1),[g,b]=(0,a.useState)(""),v=(0,n.Zp)(),[w,y]=(0,a.useState)(null),[k,j]=(0,a.useState)([]),[N,z]=(0,a.useState)(!1);(0,a.useEffect)((()=>{const e=()=>{window.innerWidth<786?(z(!0),I&&I(!0)):(z(!1),I&&I(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[N]);const[S,_]=(0,a.useState)(!1),C=void 0!==t?t:N,I=o||z;(0,a.useEffect)((()=>{const e=JSON.parse(localStorage.getItem("InvestorData"));if(e&&e.access_token){const t=(new Date).getTime();e.expiry&&t<e.expiry?b(e):(localStorage.removeItem("InvestorData"),v("/investor/login"))}else localStorage.removeItem("InvestorData"),v("/investor/login")}),[]),(0,a.useEffect)((()=>{const e=localStorage.getItem("selectedDropdown");e&&y(Number(e));const t=localStorage.getItem("sidebarCollapsed");if(null!==t){const e=JSON.parse(t);o?o(e):z(e)}}),[]);const A=(0,n.zy)(),D=!C||S;return(0,h.jsxs)(h.Fragment,{children:[(0,h.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(C?"collapsed p-3":"p-4"),children:[(0,h.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(C?"justify-content-center":"justify-content-between"),children:[!C&&(0,h.jsx)("a",{href:"/",className:"logo",children:(0,h.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,h.jsx)(s.V4,{className:"d-flex justify-content-end",children:(0,h.jsxs)("button",{type:"button",onClick:()=>{const e=!C;I(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[C&&(0,h.jsx)(x.A,{strokeWidth:2}),!C&&(0,h.jsx)(r.A,{strokeWidth:2})]})})]}),(0,h.jsx)(s.vT,{isOpen:D,children:(0,h.jsx)(s.c0,{children:m.map(((e,t)=>{var o;let a=!1;var n;"/investor/company-list"===e.href?a=A.pathname===e.href||A.pathname.startsWith("/investor/company"):a=(null===(n=e.matchPaths)||void 0===n?void 0:n.some((e=>(0,f.B6)({path:e,end:!1},A.pathname))))||A.pathname===e.href;return(0,h.jsx)(s.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,h.jsxs)(h.Fragment,{children:[(0,h.jsx)(s.C,{title:e.label,onClick:()=>(e=>{const t=w===e?null:e;C&&I(!C);y(t),localStorage.setItem("selectedDropdown",null!==t?t:"")})(t),className:C&&!S?"justify-content-center px-0":"",children:(0,h.jsxs)("div",{className:"d-flex gap-2 align-items-center w-100 "+(C?"justify-content-center":"justify-content-between"),children:[(0,h.jsxs)("div",{className:"d-flex gap-2 align-items-start "+(C&&!S?"justify-content-center":""),children:[e.icon,D&&e.label]}),D&&(0,h.jsx)(s.i3,{isOpen:w===t,children:(0,h.jsx)(d.pte,{})})]})}),w===t&&D&&(0,h.jsxs)(s.rI,{children:[(0,h.jsx)("hr",{className:"my-2"}),null===(o=e.dropdown)||void 0===o?void 0:o.map(((e,t)=>{const o=A.pathname===e.href;return(0,h.jsx)("li",{className:"list-none",children:(0,h.jsxs)("a",{href:e.href,title:e.label,className:"sidebar d-flex align-items-start gap-2 "+(o?"active":""),children:[e.icon,e.label]})},t)})),"modules"===e.dynamicDropdownKey&&(0,h.jsxs)(h.Fragment,{children:[k.map(((e,t)=>{const o="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,a=A.pathname===o;return(0,h.jsx)("li",{className:"list-none",children:(0,h.jsxs)("a",{href:o,title:e.name,className:"sidebar d-flex align-items-start gap-2 "+(a?"active":""),children:[(0,h.jsx)(u.MO3,{size:16}),e.name]})},t)})),(0,h.jsx)("li",{className:"list-none",children:(0,h.jsxs)("a",{href:"/advicevideos",title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",className:"sidebar d-flex align-items-start gap-2 "+("/advicevideos"===A.pathname?"active":""),children:[(0,h.jsx)(u.xi0,{size:16}),"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,h.jsxs)("a",{href:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${a?"active":""} ${C&&!S?"justify-content-center":""}`,children:[e.icon,D&&e.label]})},t)}))})}),(0,h.jsx)("div",{className:"d-flex  align-items-end gap-2 h-100 "+(C?"justify-content-center":"justify-content-end"),children:(0,h.jsx)(l.N_,{title:"Logout",to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("InvestorData"),window.location.href="/investor/login"},className:"logout_investor_global ",children:(0,h.jsx)(i.QeK,{width:14})})})]}),(0,h.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 80px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,t,o)=>{o.d(t,{$K:()=>r,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>f,R3:()=>y,Zw:()=>x,dN:()=>m,hJ:()=>g,jh:()=>d,mO:()=>n,mg:()=>s,nj:()=>v,pd:()=>w,uM:()=>u,vE:()=>i,z6:()=>p});var a=o(5464);const n=a.default.div`
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
`),s=a.default.div`
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
`,l=a.default.div`
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
`,c=a.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=a.default.div`
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
`,f=(a.default.div`
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
`),u=(a.default.div`
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
`),h=(a.default.div`
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
`),m=((0,a.default)(h)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(h)`
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
  display: ${e=>{let{show:t}=e;return t?"flex":"none"}};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`,b=a.default.div`
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
`,w=a.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,y=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=5893.807ddc91.chunk.js.map