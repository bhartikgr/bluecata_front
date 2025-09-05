/*! For license information please see 1211.386aea06.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[1211],{14459:(e,t,o)=>{o.d(t,{A:()=>a});const a=(0,o(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},41211:(e,t,o)=>{o.r(t),o.d(t,{default:()=>h});var a=o(65043),n=o(62837),i=o(86213),r=o(58786),s=o(73216),l=o(35475),d=o(60184),c=o(55930),p=o(27836),x=o(49535),u=o(65469),f=o(70579);const h=function(){const[e,t]=(0,a.useState)(!1),{id:o}=(0,s.g)(),h=(0,s.Zp)();document.title="Company Capital Round List - Investor";const g=localStorage.getItem("InvestorData"),m=JSON.parse(g),[b,v]=(0,a.useState)(""),[w,y]=(0,a.useState)(!1);(0,a.useEffect)((()=>{k()}),[]);const k=async()=>{let e={investor_id:m.id,company_id:Number(o)};try{const t=await i.A.post("https://blueprintcatalyst.com/api/user/capitalround/getInvestorCapitalMotionlist",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});N(t.data.results)}catch(t){}},[j,N]=(0,a.useState)([]),z=j.filter((e=>{const t=b.toLowerCase();return`\n    ${e.nameOfRound||""}\n    ${e.shareClassType||""}\n     ${e.roundsize||""}\n    ${e.issuedshares||""}\n  `.toLowerCase().includes(t)}));function S(e){const t=new Date(e);if(isNaN(t))return"";const o=t.getDate(),a=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],n=t.getFullYear();return`${a} ${o}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(o)}, ${n}`}return(0,f.jsx)(n.mO,{className:"investor-login-wrapper",children:(0,f.jsx)("div",{className:"fullpage d-block",children:(0,f.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,f.jsx)(c.A,{isCollapsed:w,setIsCollapsed:y}),(0,f.jsx)("div",{className:"global_view "+(w?"global_view_col":""),children:(0,f.jsx)(n.$K,{className:"d-block p-4",children:(0,f.jsx)("div",{className:"container-fluid",children:(0,f.jsxs)(p.zP,{className:"d-flex flex-column gap-3",children:[(0,f.jsxs)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:[(0,f.jsxs)(x.o,{type:"button",className:"backbtn",onClick:()=>{h("/investor/company-list")},children:[(0,f.jsx)(u.A,{size:16,className:"me-1"})," back"]}),(0,f.jsx)("h4",{className:"mainh1",children:"Investor Report List"})]}),(0,f.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,f.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:b,onChange:e=>v(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,f.jsx)("div",{className:"d-flex overflow-auto flex-column justify-content-between align-items-start tb-box",children:(0,f.jsx)(r.Ay,{customStyles:{table:{style:{minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"Share Class (Name of Round)",selector:e=>e.shareClassType+" "+e.nameOfRound,sortable:!0,cell:e=>(0,f.jsxs)("span",{children:[e.shareClassType," ",e.nameOfRound]})},{name:"Amount",selector:e=>e.currency+" "+Number(e.roundsize).toLocaleString("en-US"),sortable:!0,cell:e=>(0,f.jsx)("span",{children:e.currency+" "+Number(e.roundsize).toLocaleString("en-US")})},{name:"Issue of Share",selector:e=>Number(e.issuedshares).toLocaleString("en-US"),sortable:!0,cell:e=>(0,f.jsx)("span",{children:Number(e.issuedshares).toLocaleString("en-US")})},{name:"Date of Share",selector:e=>S(e.sent_date),sortable:!0,cell:e=>(0,f.jsx)("span",{children:S(e.sent_date)})},{name:"Actions",cell:e=>(0,f.jsx)("div",{className:"d-flex gap-2",children:(0,f.jsxs)(l.N_,{to:`/investor/company/capital-round-list/view/${e.user_id}/${e.id}`,title:"View Round Record",className:"icon_btn green_clr",children:[(0,f.jsx)(d.Ny1,{})," View/Signature"]})}),ignoreRowClick:!0,allowOverflow:!0,button:!0,width:"200px"}],className:"datatb-report",data:z,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})})]})})})})]})})})}},53639:(e,t,o)=>{o.d(t,{A:()=>a});const a=(0,o(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},55930:(e,t,o)=>{o.d(t,{A:()=>g});var a=o(65043),n=(o(38421),o(73216)),i=o(75200),r=o(53579),s=o(35475),l=o(50423),d=o(53639),c=o(14459),p=o(42983),x=o(31387),u=o(47196),f=o(70579);const h=[{label:"Dashboard",href:"/investor/dashboard",icon:(0,f.jsx)(u.oeo,{size:18})},{label:"Company",href:"/investor/company-list",icon:(0,f.jsx)(d.A,{size:18})},{label:"Profile",href:"/investor/investor-profile",icon:(0,f.jsx)(c.A,{size:18})}];const g=function(e){let{isCollapsed:t,setIsCollapsed:o}=e;const[d,c]=(0,a.useState)(!1),[g,m]=(0,a.useState)(""),b=(0,n.Zp)(),[v,w]=(0,a.useState)(null),[y,k]=(0,a.useState)([]),[j,N]=(0,a.useState)(!1);(0,a.useEffect)((()=>{const e=()=>{window.innerWidth<786?(N(!0),_&&_(!0)):(N(!1),_&&_(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[j]);const[z,S]=(0,a.useState)(!1),C=void 0!==t?t:j,_=o||N;(0,a.useEffect)((()=>{const e=localStorage.getItem("InvestorData"),t=JSON.parse(e);m(t),null===t&&(localStorage.removeItem("InvestorData"),b("/login"))}),[]),(0,a.useEffect)((()=>{const e=localStorage.getItem("selectedDropdown");e&&w(Number(e));const t=localStorage.getItem("sidebarCollapsed");if(null!==t){const e=JSON.parse(t);o?o(e):N(e)}}),[]);const I=(0,n.zy)(),A=!C||z;return(0,f.jsxs)(f.Fragment,{children:[(0,f.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(C?"collapsed p-3":"p-4"),children:[(0,f.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(C?"justify-content-center":"justify-content-between"),children:[!C&&(0,f.jsx)("a",{href:"/",className:"logo",children:(0,f.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,f.jsx)(r.V4,{className:"d-flex justify-content-end",children:(0,f.jsx)("button",{type:"button",onClick:()=>{const e=!C;_(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:(0,f.jsx)(p.A,{strokeWidth:2})})})]}),(0,f.jsx)(r.vT,{isOpen:A,children:(0,f.jsx)(r.c0,{children:h.map(((e,t)=>{var o;let a=!1;var n;"/investor/company-list"===e.href?a=I.pathname===e.href||I.pathname.startsWith("/investor/company"):a=(null===(n=e.matchPaths)||void 0===n?void 0:n.some((e=>(0,x.B6)({path:e,end:!1},I.pathname))))||I.pathname===e.href;return(0,f.jsx)(r.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)(r.C,{onClick:()=>(e=>{const t=v===e?null:e;C&&_(!C);w(t),localStorage.setItem("selectedDropdown",null!==t?t:"")})(t),className:C&&!z?"justify-content-center px-0":"",children:(0,f.jsxs)("div",{className:"d-flex gap-2 align-items-center w-100 "+(C?"justify-content-center":"justify-content-between"),children:[(0,f.jsxs)("div",{className:"d-flex gap-2 align-items-start "+(C&&!z?"justify-content-center":""),children:[e.icon,A&&e.label]}),A&&(0,f.jsx)(r.i3,{isOpen:v===t,children:(0,f.jsx)(l.pte,{})})]})}),v===t&&A&&(0,f.jsxs)(r.rI,{children:[(0,f.jsx)("hr",{className:"my-2"}),null===(o=e.dropdown)||void 0===o?void 0:o.map(((e,t)=>{const o=I.pathname===e.href;return(0,f.jsx)("li",{className:"list-none",children:(0,f.jsxs)(s.N_,{to:e.href,className:"sidebar d-flex align-items-start gap-2 "+(o?"active":""),children:[e.icon,e.label]})},t)})),"modules"===e.dynamicDropdownKey&&(0,f.jsxs)(f.Fragment,{children:[y.map(((e,t)=>{const o="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,a=I.pathname===o;return(0,f.jsx)("li",{className:"list-none",children:(0,f.jsxs)(s.N_,{to:o,className:"sidebar d-flex align-items-start gap-2 "+(a?"active":""),children:[(0,f.jsx)(u.MO3,{size:16}),e.name]})},t)})),(0,f.jsx)("li",{className:"list-none",children:(0,f.jsxs)(s.N_,{to:"/advicevideos",className:"sidebar d-flex align-items-start gap-2 "+("/advicevideos"===I.pathname?"active":""),children:[(0,f.jsx)(u.xi0,{size:16}),"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,f.jsxs)(s.N_,{to:e.href,className:`sidebar d-flex align-items-start gap-2 ${a?"active":""} ${C&&!z?"justify-content-center":""}`,children:[e.icon,A&&e.label]})},t)}))})}),(0,f.jsx)("div",{className:"d-flex  align-items-end gap-2 h-100 "+(C?"justify-content-center":"justify-content-end"),children:(0,f.jsx)(s.N_,{to:"/investor/logout",className:"logout_investor_global ",children:(0,f.jsx)(i.QeK,{width:14})})})]}),(0,f.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 80px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,t,o)=>{o.d(t,{$K:()=>r,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>u,R3:()=>y,Zw:()=>x,dN:()=>g,hJ:()=>m,jh:()=>d,mO:()=>n,mg:()=>s,nj:()=>v,pd:()=>w,uM:()=>f,vE:()=>i,z6:()=>p});var a=o(5464);const n=a.default.div`
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
  background: var(--primary-color);
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
    font-size: 1.3rem;
    font-weight: 500;
    color:#000;
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
    border-radius: 50px;
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
    border-radius: 50px;
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
    margin-top:2px;
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
  }
`,u=(a.default.div`
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
    stroke: #ff3c3e;
    stroke-width: 1.2;
  }
`),f=(a.default.div`
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
  border-radius: 50%;
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
`),g=((0,a.default)(h)`
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
  color: var(--primary-color);
`),m=a.default.div`
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
  border-radius: 100%;
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
  font-size: 16px;
`,y=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=1211.386aea06.chunk.js.map