/*! For license information please see 5893.b2baa745.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[5893],{14459:(e,t,o)=>{o.d(t,{A:()=>n});const n=(0,o(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},53639:(e,t,o)=>{o.d(t,{A:()=>n});const n=(0,o(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},55893:(e,t,o)=>{o.r(t),o.d(t,{default:()=>f});var n=o(65043),a=o(62837),i=o(86213),r=o(58786),s=o(73216),l=o(60184),d=o(55930),c=o(27836),p=o(49535),x=o(65469),u=o(70579);const f=function(){const[e,t]=(0,n.useState)(!1),{id:o}=(0,s.g)(),f=(0,s.Zp)();document.title="Company Report List - Investor";var h="https://blueprintcatalyst.com/api/user/investor/";const m=sessionStorage.getItem("InvestorData"),g=JSON.parse(m),[b,v]=(0,n.useState)(""),[w,y]=(0,n.useState)(!1);(0,n.useEffect)((()=>{k()}),[]);const k=async()=>{let e={user_id:g.id,type:"Investor updates",company_id:o};try{const t=await i.A.post(h+"getInvestorReportslist",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});N(t.data.results)}catch(t){}},[j,N]=(0,n.useState)([{id:1,email:"test1@company.com",discount_code:"DISC10",percentage:10,company_email_match:"Yes"},{id:2,email:"test2@company.com",discount_code:"SAVE20",percentage:20,company_email_match:"No"},{id:3,email:"demo@company.com",discount_code:"OFF50",percentage:50,company_email_match:"Yes"}]),z=j.filter((e=>{const t=b.toLowerCase();return`\n    ${e.type||""}\n    ${e.version||""}\n    ${e.document_name||""}\n    ${e.download||""}\n  `.toLowerCase().includes(t)}));function _(e){const t=new Date(e);if(isNaN(t))return"";const o=t.getDate(),n=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],a=t.getFullYear();return`${n} ${o}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(o)}, ${a}`}return(0,u.jsx)(a.mO,{className:"investor-login-wrapper",children:(0,u.jsx)("div",{className:"fullpage d-block",children:(0,u.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,u.jsx)(d.A,{isCollapsed:w,setIsCollapsed:y}),(0,u.jsx)("div",{className:"global_view "+(w?"global_view_col":""),children:(0,u.jsx)(a.$K,{className:"d-block p-4",children:(0,u.jsx)("div",{className:"container-fluid",children:(0,u.jsxs)(c.zP,{className:"d-flex flex-column gap-3",children:[(0,u.jsxs)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:[(0,u.jsxs)(p.o,{type:"button",className:"backbtn",onClick:()=>{f("/investor/company-list")},children:[(0,u.jsx)(x.A,{size:16,className:"me-1"})," back"]}),(0,u.jsx)("h4",{className:"mainh1",children:"Investor Report List"})]}),(0,u.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,u.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:b,onChange:e=>v(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,u.jsx)("div",{className:"d-flex overflow-auto flex-column justify-content-between align-items-start tb-box",children:(0,u.jsx)(r.Ay,{customStyles:{table:{style:{minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"Report",selector:e=>e.type,sortable:!0,cell:e=>(0,u.jsx)("span",{children:e.type})},{name:"Version",selector:e=>e.version,sortable:!0,cell:e=>(0,u.jsx)("span",{children:e.version})},{name:"Date Of Report",selector:e=>_(e.shared_date),sortable:!0,cell:e=>(0,u.jsx)("span",{children:_(e.shared_date)})},{name:"Name of Report",selector:e=>e.document_name,sortable:!0,cell:e=>(0,u.jsx)("span",{children:e.document_name})},{name:"Actions",cell:e=>(0,u.jsx)("div",{className:"d-flex gap-2",children:(0,u.jsx)("button",{type:"button",onClick:()=>(async(e,t)=>{let o={user_id:g.id,id:e};try{await i.A.post(h+"InvestorReportslistDownload",o,{headers:{Accept:"application/json","Content-Type":"application/json"}}),window.open(t,"_blank")}catch(n){}})(e.id,e.downloadUrl),title:"Download/View",className:"icon_download",children:(0,u.jsx)(l.WCW,{})})}),ignoreRowClick:!0,allowOverflow:!0,button:!0}],className:"datatb-report",data:z,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})})]})})})})]})})})}},55930:(e,t,o)=>{o.d(t,{A:()=>g});var n=o(65043),a=(o(38421),o(73216)),i=o(75200),r=o(9463),s=o(53579),l=o(35475),d=o(50423),c=o(53639),p=o(14459),x=o(42983),u=o(31387),f=o(47196),h=o(70579);const m=[{label:"Dashboard",href:"/investor/dashboard",icon:(0,h.jsx)(f.oeo,{size:18})},{label:"Company",href:"/investor/company-list",icon:(0,h.jsx)(c.A,{size:18})},{label:"Profile",href:"/investor/investor-profile",icon:(0,h.jsx)(p.A,{size:18})}];const g=function(e){let{isCollapsed:t,setIsCollapsed:o}=e;const[c,p]=(0,n.useState)(!1),[g,b]=(0,n.useState)(""),v=(0,a.Zp)(),[w,y]=(0,n.useState)(null),[k,j]=(0,n.useState)([]),[N,z]=(0,n.useState)(!1);(0,n.useEffect)((()=>{const e=()=>{window.innerWidth<786?(z(!0),I&&I(!0)):(z(!1),I&&I(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[N]);const[_,S]=(0,n.useState)(!1),C=void 0!==t?t:N,I=o||z;(0,n.useEffect)((()=>{const e=sessionStorage.getItem("InvestorData"),t=JSON.parse(e);b(t),null===t&&(sessionStorage.removeItem("InvestorData"),v("/login"))}),[]),(0,n.useEffect)((()=>{const e=sessionStorage.getItem("selectedDropdown");e&&y(Number(e));const t=sessionStorage.getItem("sidebarCollapsed");if(null!==t){const e=JSON.parse(t);o?o(e):z(e)}}),[]);const A=(0,a.zy)(),O=!C||_;return(0,h.jsxs)(h.Fragment,{children:[(0,h.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(C?"collapsed p-3":"p-4"),children:[(0,h.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(C?"justify-content-center":"justify-content-between"),children:[!C&&(0,h.jsx)("a",{href:"/",className:"logo",children:(0,h.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,h.jsx)(s.V4,{className:"d-flex justify-content-end",children:(0,h.jsxs)("button",{type:"button",onClick:()=>{const e=!C;I(e),sessionStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[C&&(0,h.jsx)(x.A,{strokeWidth:2}),!C&&(0,h.jsx)(r.A,{strokeWidth:2})]})})]}),(0,h.jsx)(s.vT,{isOpen:O,children:(0,h.jsx)(s.c0,{children:m.map(((e,t)=>{var o;let n=!1;var a;"/investor/company-list"===e.href?n=A.pathname===e.href||A.pathname.startsWith("/investor/company"):n=(null===(a=e.matchPaths)||void 0===a?void 0:a.some((e=>(0,u.B6)({path:e,end:!1},A.pathname))))||A.pathname===e.href;return(0,h.jsx)(s.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,h.jsxs)(h.Fragment,{children:[(0,h.jsx)(s.C,{title:e.label,onClick:()=>(e=>{const t=w===e?null:e;C&&I(!C);y(t),sessionStorage.setItem("selectedDropdown",null!==t?t:"")})(t),className:C&&!_?"justify-content-center px-0":"",children:(0,h.jsxs)("div",{className:"d-flex gap-2 align-items-center w-100 "+(C?"justify-content-center":"justify-content-between"),children:[(0,h.jsxs)("div",{className:"d-flex gap-2 align-items-start "+(C&&!_?"justify-content-center":""),children:[e.icon,O&&e.label]}),O&&(0,h.jsx)(s.i3,{isOpen:w===t,children:(0,h.jsx)(d.pte,{})})]})}),w===t&&O&&(0,h.jsxs)(s.rI,{children:[(0,h.jsx)("hr",{className:"my-2"}),null===(o=e.dropdown)||void 0===o?void 0:o.map(((e,t)=>{const o=A.pathname===e.href;return(0,h.jsx)("li",{className:"list-none",children:(0,h.jsxs)(l.N_,{title:e.label,to:e.href,className:"sidebar d-flex align-items-start gap-2 "+(o?"active":""),children:[e.icon,e.label]})},t)})),"modules"===e.dynamicDropdownKey&&(0,h.jsxs)(h.Fragment,{children:[k.map(((e,t)=>{const o="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,n=A.pathname===o;return(0,h.jsx)("li",{className:"list-none",children:(0,h.jsxs)(l.N_,{title:e.name,to:o,className:"sidebar d-flex align-items-start gap-2 "+(n?"active":""),children:[(0,h.jsx)(f.MO3,{size:16}),e.name]})},t)})),(0,h.jsx)("li",{className:"list-none",children:(0,h.jsxs)(l.N_,{title:"VIDEO CONTENT: Investor Presentation Structure\r - Expert Advice Video",to:"/advicevideos",className:"sidebar d-flex align-items-start gap-2 "+("/advicevideos"===A.pathname?"active":""),children:[(0,h.jsx)(f.xi0,{size:16}),"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,h.jsxs)(l.N_,{to:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${n?"active":""} ${C&&!_?"justify-content-center":""}`,children:[e.icon,O&&e.label]})},t)}))})}),(0,h.jsx)("div",{className:"d-flex  align-items-end gap-2 h-100 "+(C?"justify-content-center":"justify-content-end"),children:(0,h.jsx)(l.N_,{title:"Logout",to:"/investor/logout",className:"logout_investor_global ",children:(0,h.jsx)(i.QeK,{width:14})})})]}),(0,h.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 80px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,t,o)=>{o.d(t,{$K:()=>r,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>u,R3:()=>y,Zw:()=>x,dN:()=>m,hJ:()=>g,jh:()=>d,mO:()=>a,mg:()=>s,nj:()=>v,pd:()=>w,uM:()=>f,vE:()=>i,z6:()=>p});var n=o(5464);const a=n.default.div`
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
`,i=n.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,r=(n.default.div`
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
`,n.default.div`
  margin-bottom: auto;
  padding: 15px 0;
  background: var(--primary-color);
  border-bottom: 10px solid var(--secondary-color);
  .logo {
    display: inline-block;
    width: 140px;
    img {
      width: 100%;
    }
  }
`,n.default.div`
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
`,n.default.div`
  display: block;
  height: 100%;
`),s=n.default.div`
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
    font-size: 16px;
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
    font-size: 16px;
    width: 100%;
  }

  .nextbtn {
    background: var(--primary-color);
    color: #fff;

    &:hover {
      background: var(--primary-color);
    }
  }

  .backbtn {
    background: #111;
    color: #fff;

    &:hover {
      background: #2b2b2b;
    }
  }
`,l=n.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=n.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=n.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=n.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,x=n.default.div`
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
`,u=(n.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,n.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,n.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,n.default.div`
  position: relative;

  svg {
    position: absolute;
    z-index: 2;
    top: 9px;
    left: 12px;
    width: 16px; /* smaller width */
    height: 16px; /* smaller height */
    stroke: #ff3c3e;
    stroke-width: 1.2;
  }
`),f=(n.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,n.default.div`
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
    color: var(--primary-color);
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
`),h=(n.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,n.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,n.default.div`
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
`,n.default.button`
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
`,n.default.div`
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
`,n.default.video`
  background-color: black;
  border: none;
`,n.default.div`
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
`,n.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,n.default.button`
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
`),m=((0,n.default)(h)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,n.default)(h)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,n.default.sup`
  color: var(--primary-color);
`),g=n.default.div`
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
`,b=n.default.div`
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
`,v=n.default.button`
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
`,w=n.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 16px;
`,y=n.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=5893.b2baa745.chunk.js.map