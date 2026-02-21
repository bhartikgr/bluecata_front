/*! For license information please see 1211.f10b59ea.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[1211],{14459:(e,t,a)=>{a.d(t,{A:()=>n});const n=(0,a(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},31738:(e,t,a)=>{a.d(t,{A:()=>o});var n=a(65043),i=a(70579);function o(){const[e,t]=(0,n.useState)(""),[a,o]=(0,n.useState)("");return(0,n.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),a=await e.json();t(a.ip)}catch(e){console.error("Failed to fetch IP",e)}})(),(()=>{const e=(new Date).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});o(e)})()}),[]),(0,i.jsx)(i.Fragment,{children:(0,i.jsxs)("div",{className:"d-flex flex-column gap-1 p-2 ipaddbox",children:[(0,i.jsxs)("h4",{children:["Date: ",(0,i.jsxs)("span",{children:["(",a,")"]})]}),(0,i.jsxs)("h4",{children:["IP Address: ",(0,i.jsx)("span",{children:e})]})]})})}},41211:(e,t,a)=>{a.r(t),a.d(t,{default:()=>h});var n=a(65043),i=a(62837),o=a(86213),r=a(58786),s=a(73216),l=a(35475),d=a(60184),c=a(55930),p=a(27836),x=a(49535),u=a(65469),f=a(70579);const h=function(){const[e,t]=(0,n.useState)(!1),{id:a}=(0,s.g)(),h=(0,s.Zp)();document.title="Company Capital Round List - Investor";const m=localStorage.getItem("InvestorData"),g=JSON.parse(m),[b,v]=(0,n.useState)(""),[w,y]=(0,n.useState)(!1);(0,n.useEffect)((()=>{k()}),[]);const k=async()=>{let e={investor_id:g.id,company_id:Number(a)};try{const t=await o.A.post("https://capavate.com/api/user/capitalround/getInvestorCapitalMotionlist",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});N(t.data.results)}catch(t){}},[j,N]=(0,n.useState)([]),z=j.filter((e=>{const t=b.toLowerCase();return`\n    ${e.nameOfRound||""}\n    ${e.shareClassType||""}\n     ${e.roundsize||""}\n    ${e.issuedshares||""}\n  `.toLowerCase().includes(t)}));function S(e){const t=new Date(e);if(isNaN(t))return"";const a=t.getDate(),n=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],i=t.getFullYear();return`${n} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${i}`}return(0,f.jsx)(i.mO,{className:"investor-login-wrapper",children:(0,f.jsx)("div",{className:"fullpage d-block",children:(0,f.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,f.jsx)(c.A,{isCollapsed:w,setIsCollapsed:y}),(0,f.jsx)("div",{className:"global_view "+(w?"global_view_col":""),children:(0,f.jsx)(i.$K,{className:"d-block p-md-4 p-3",children:(0,f.jsx)("div",{className:"container-fluid",children:(0,f.jsxs)(p.zP,{className:"d-flex flex-column gap-3",children:[(0,f.jsxs)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:[(0,f.jsxs)(x.o,{type:"button",className:"backbtn",onClick:()=>{h("/investor/company-list")},children:[(0,f.jsx)(u.A,{size:16,className:"me-1"})," back"]}),(0,f.jsx)("h4",{className:"mainh1",children:"Investor Report List"})]}),(0,f.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,f.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:b,onChange:e=>v(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,f.jsx)("div",{className:"d-flex overflow-auto flex-column justify-content-between align-items-start tb-box",children:(0,f.jsx)(r.Ay,{customStyles:{table:{style:{minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"Share Class (Name of Round)",selector:e=>e.shareClassType+" "+e.nameOfRound,sortable:!0,cell:e=>(0,f.jsxs)("span",{children:[e.shareClassType," ",e.nameOfRound]})},{name:"Amount",selector:e=>e.currency+" "+Number(e.roundsize).toLocaleString("en-US"),sortable:!0,cell:e=>(0,f.jsx)("span",{children:e.currency+" "+Number(e.roundsize).toLocaleString("en-US")})},{name:"Issue of Share",selector:e=>Number(e.issuedshares).toLocaleString("en-US",{minimumFractionDigits:3,maximumFractionDigits:3}),sortable:!0,cell:e=>(0,f.jsx)("span",{children:Number(e.issuedshares).toLocaleString("en-US",{minimumFractionDigits:3,maximumFractionDigits:3})})},{name:"Date of Share",selector:e=>S(e.sent_date),sortable:!0,cell:e=>(0,f.jsx)("span",{children:S(e.sent_date)})},{name:"Actions",cell:e=>(0,f.jsx)("div",{className:"d-flex gap-2",children:(0,f.jsxs)(l.N_,{to:`/investor/company/capital-round-list/view/${e.company_id}/${e.id}`,title:"View Round Record",className:"icon_btn green_clr",children:[(0,f.jsx)(d.Ny1,{})," View Round"]})}),ignoreRowClick:!0,allowOverflow:!0,button:!0,width:"200px"}],className:"datatb-report",data:z,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})})]})})})})]})})})}},53639:(e,t,a)=>{a.d(t,{A:()=>n});const n=(0,a(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},55930:(e,t,a)=>{a.d(t,{A:()=>b});var n=a(65043),i=(a(38421),a(73216)),o=a(75200),r=a(9463),s=a(53579),l=a(35475),d=a(50423),c=a(53639),p=a(14459),x=a(42983),u=a(31387),f=a(47196),h=a(31738),m=a(70579);const g=[{label:"Dashboard",href:"/investor/dashboard",icon:(0,m.jsx)(f.oeo,{size:18})},{label:"Portfolio Companies",href:"/investor/company-list",icon:(0,m.jsx)(c.A,{size:18})},{label:"Profile",href:"/investor/investor-profile",icon:(0,m.jsx)(p.A,{size:18})}];const b=function(e){let{isCollapsed:t,setIsCollapsed:a}=e;const[c,p]=(0,n.useState)(!1),[b,v]=(0,n.useState)(""),w=(0,i.Zp)(),[y,k]=(0,n.useState)(null),[j,N]=(0,n.useState)([]),[z,S]=(0,n.useState)(!1);(0,n.useEffect)((()=>{const e=()=>{window.innerWidth<786?(S(!0),A&&A(!0)):(S(!1),A&&A(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[z]);const[C,I]=(0,n.useState)(!1),D=void 0!==t?t:z,A=a||S;(0,n.useEffect)((()=>{const e=JSON.parse(localStorage.getItem("InvestorData"));if(e&&e.access_token){const t=(new Date).getTime();e.expiry&&t<e.expiry?v(e):(localStorage.removeItem("InvestorData"),w("/investor/login"))}else localStorage.removeItem("InvestorData"),w("/investor/login")}),[]),(0,n.useEffect)((()=>{const e=localStorage.getItem("selectedDropdown");e&&k(Number(e));const t=localStorage.getItem("sidebarCollapsed");if(null!==t){const e=JSON.parse(t);a?a(e):S(e)}}),[]);const _=(0,i.zy)(),O=!D||C;return(0,m.jsxs)(m.Fragment,{children:[(0,m.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(D?"collapsed p-3":"p-4"),children:[(0,m.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(D?"justify-content-center":"justify-content-between"),children:[!D&&(0,m.jsx)(l.N_,{to:"/investor/dashboard",className:"logo",children:(0,m.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,m.jsx)(s.V4,{className:"d-flex justify-content-end",children:(0,m.jsxs)("button",{type:"button",onClick:()=>{const e=!D;A(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[D&&(0,m.jsx)(x.A,{strokeWidth:2}),!D&&(0,m.jsx)(r.A,{strokeWidth:2})]})})]}),(0,m.jsx)(s.vT,{isOpen:O,children:(0,m.jsx)(s.c0,{children:g.map(((e,t)=>{var a;let n=!1;var i;"/investor/company-list"===e.href?n=_.pathname===e.href||_.pathname.startsWith("/investor/company"):n=(null===(i=e.matchPaths)||void 0===i?void 0:i.some((e=>(0,u.B6)({path:e,end:!1},_.pathname))))||_.pathname===e.href;return(0,m.jsx)(s.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,m.jsxs)(m.Fragment,{children:[(0,m.jsx)(s.C,{title:e.label,onClick:()=>(e=>{const t=y===e?null:e;D&&A(!D);k(t),localStorage.setItem("selectedDropdown",null!==t?t:"")})(t),className:D&&!C?"justify-content-center px-0":"",children:(0,m.jsxs)("div",{className:"d-flex gap-2 align-items-center w-100 "+(D?"justify-content-center":"justify-content-between"),children:[(0,m.jsxs)("div",{className:"d-flex gap-2 align-items-start "+(D&&!C?"justify-content-center":""),children:[e.icon,O&&e.label]}),O&&(0,m.jsx)(s.i3,{isOpen:y===t,children:(0,m.jsx)(d.pte,{})})]})}),y===t&&O&&(0,m.jsxs)(s.rI,{children:[(0,m.jsx)("hr",{className:"my-2"}),null===(a=e.dropdown)||void 0===a?void 0:a.map(((e,t)=>{const a=_.pathname===e.href;return(0,m.jsx)("li",{className:"list-none",children:(0,m.jsxs)("a",{href:e.href,title:e.label,className:"sidebar d-flex align-items-start gap-2 "+(a?"active":""),children:[e.icon,e.label]})},t)})),"modules"===e.dynamicDropdownKey&&(0,m.jsxs)(m.Fragment,{children:[j.map(((e,t)=>{const a="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,n=_.pathname===a;return(0,m.jsx)("li",{className:"list-none",children:(0,m.jsxs)("a",{href:a,title:e.name,className:"sidebar d-flex align-items-start gap-2 "+(n?"active":""),children:[(0,m.jsx)(f.MO3,{size:16}),e.name]})},t)})),(0,m.jsx)("li",{className:"list-none",children:(0,m.jsxs)("a",{href:"/advicevideos",title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",className:"sidebar d-flex align-items-start gap-2 "+("/advicevideos"===_.pathname?"active":""),children:[(0,m.jsx)(f.xi0,{size:16}),"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,m.jsxs)("a",{href:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${n?"active":""} ${D&&!C?"justify-content-center":""}`,children:[e.icon,O&&e.label]})},t)}))})}),(0,m.jsxs)("div",{className:"d-flex flex-column gap-2 mt-auto",children:[(0,m.jsx)(h.A,{}),(0,m.jsx)("div",{className:"d-flex  align-items-end gap-2 "+(D?"justify-content-center":"justify-content-end"),children:(0,m.jsx)(l.N_,{title:"Logout",to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("InvestorData"),window.location.href="/investor/login"},className:"logout_investor_global ",children:(0,m.jsx)(o.QeK,{width:14})})})]})]}),(0,m.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 80px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,t,a)=>{a.d(t,{$K:()=>r,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>u,R3:()=>y,Zw:()=>x,dN:()=>m,hJ:()=>g,jh:()=>d,mO:()=>i,mg:()=>s,nj:()=>v,pd:()=>w,uM:()=>f,vE:()=>o,z6:()=>p});var n=a(5464);const i=n.default.div`
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
`,o=n.default.span`
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
  background: var(--primary);
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
    stroke: var(--primary-icon);
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
  color: var(--primary);
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
  font-size: 0.9rem;
`,y=n.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=1211.f10b59ea.chunk.js.map