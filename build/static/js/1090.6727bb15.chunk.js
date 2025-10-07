/*! For license information please see 1090.6727bb15.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[1090],{14459:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},53639:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},55930:(e,t,a)=>{a.d(t,{A:()=>g});var i=a(65043),o=(a(38421),a(73216)),n=a(75200),r=a(9463),s=a(53579),l=a(35475),d=a(50423),c=a(53639),p=a(14459),x=a(42983),h=a(31387),m=a(47196),f=a(70579);const u=[{label:"Dashboard",href:"/investor/dashboard",icon:(0,f.jsx)(m.oeo,{size:18})},{label:"Company",href:"/investor/company-list",icon:(0,f.jsx)(c.A,{size:18})},{label:"Profile",href:"/investor/investor-profile",icon:(0,f.jsx)(p.A,{size:18})}];const g=function(e){let{isCollapsed:t,setIsCollapsed:a}=e;const[c,p]=(0,i.useState)(!1),[g,b]=(0,i.useState)(""),v=(0,o.Zp)(),[w,y]=(0,i.useState)(null),[j,k]=(0,i.useState)([]),[N,z]=(0,i.useState)(!1);(0,i.useEffect)((()=>{const e=()=>{window.innerWidth<786?(z(!0),I&&I(!0)):(z(!1),I&&I(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[N]);const[C,S]=(0,i.useState)(!1),_=void 0!==t?t:N,I=a||z;(0,i.useEffect)((()=>{const e=JSON.parse(localStorage.getItem("InvestorData"));if(e&&e.access_token){const t=(new Date).getTime();e.expiry&&t<e.expiry?b(e):(localStorage.removeItem("InvestorData"),v("/investor/login"))}else localStorage.removeItem("InvestorData"),v("/investor/login")}),[]),(0,i.useEffect)((()=>{const e=localStorage.getItem("selectedDropdown");e&&y(Number(e));const t=localStorage.getItem("sidebarCollapsed");if(null!==t){const e=JSON.parse(t);a?a(e):z(e)}}),[]);const A=(0,o.zy)(),D=!_||C;return(0,f.jsxs)(f.Fragment,{children:[(0,f.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(_?"collapsed p-3":"p-4"),children:[(0,f.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(_?"justify-content-center":"justify-content-between"),children:[!_&&(0,f.jsx)("a",{href:"/",className:"logo",children:(0,f.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,f.jsx)(s.V4,{className:"d-flex justify-content-end",children:(0,f.jsxs)("button",{type:"button",onClick:()=>{const e=!_;I(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[_&&(0,f.jsx)(x.A,{strokeWidth:2}),!_&&(0,f.jsx)(r.A,{strokeWidth:2})]})})]}),(0,f.jsx)(s.vT,{isOpen:D,children:(0,f.jsx)(s.c0,{children:u.map(((e,t)=>{var a;let i=!1;var o;"/investor/company-list"===e.href?i=A.pathname===e.href||A.pathname.startsWith("/investor/company"):i=(null===(o=e.matchPaths)||void 0===o?void 0:o.some((e=>(0,h.B6)({path:e,end:!1},A.pathname))))||A.pathname===e.href;return(0,f.jsx)(s.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)(s.C,{title:e.label,onClick:()=>(e=>{const t=w===e?null:e;_&&I(!_);y(t),localStorage.setItem("selectedDropdown",null!==t?t:"")})(t),className:_&&!C?"justify-content-center px-0":"",children:(0,f.jsxs)("div",{className:"d-flex gap-2 align-items-center w-100 "+(_?"justify-content-center":"justify-content-between"),children:[(0,f.jsxs)("div",{className:"d-flex gap-2 align-items-start "+(_&&!C?"justify-content-center":""),children:[e.icon,D&&e.label]}),D&&(0,f.jsx)(s.i3,{isOpen:w===t,children:(0,f.jsx)(d.pte,{})})]})}),w===t&&D&&(0,f.jsxs)(s.rI,{children:[(0,f.jsx)("hr",{className:"my-2"}),null===(a=e.dropdown)||void 0===a?void 0:a.map(((e,t)=>{const a=A.pathname===e.href;return(0,f.jsx)("li",{className:"list-none",children:(0,f.jsxs)("a",{href:e.href,title:e.label,className:"sidebar d-flex align-items-start gap-2 "+(a?"active":""),children:[e.icon,e.label]})},t)})),"modules"===e.dynamicDropdownKey&&(0,f.jsxs)(f.Fragment,{children:[j.map(((e,t)=>{const a="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,i=A.pathname===a;return(0,f.jsx)("li",{className:"list-none",children:(0,f.jsxs)("a",{href:a,title:e.name,className:"sidebar d-flex align-items-start gap-2 "+(i?"active":""),children:[(0,f.jsx)(m.MO3,{size:16}),e.name]})},t)})),(0,f.jsx)("li",{className:"list-none",children:(0,f.jsxs)("a",{href:"/advicevideos",title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",className:"sidebar d-flex align-items-start gap-2 "+("/advicevideos"===A.pathname?"active":""),children:[(0,f.jsx)(m.xi0,{size:16}),"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,f.jsxs)("a",{href:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${i?"active":""} ${_&&!C?"justify-content-center":""}`,children:[e.icon,D&&e.label]})},t)}))})}),(0,f.jsx)("div",{className:"d-flex  align-items-end gap-2 h-100 "+(_?"justify-content-center":"justify-content-end"),children:(0,f.jsx)(l.N_,{title:"Logout",to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("InvestorData"),window.location.href="/investor/login"},className:"logout_investor_global ",children:(0,f.jsx)(n.QeK,{width:14})})})]}),(0,f.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 80px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,t,a)=>{a.d(t,{$K:()=>r,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>h,R3:()=>y,Zw:()=>x,dN:()=>u,hJ:()=>g,jh:()=>d,mO:()=>o,mg:()=>s,nj:()=>v,pd:()=>w,uM:()=>m,vE:()=>n,z6:()=>p});var i=a(5464);const o=i.default.div`
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
`,r=(i.default.div`
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
`),s=i.default.div`
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
`,x=i.default.div`
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
`,h=(i.default.div`
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
`),f=(i.default.div`
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
`),u=((0,i.default)(f)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,i.default)(f)`
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
`,w=i.default.input`
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
`},71090:(e,t,a)=>{a.r(t),a.d(t,{default:()=>x});var i=a(65043),o=a(62837),n=a(86213),r=a(58786),s=a(35475),l=a(60184),d=a(55930),c=a(27836),p=a(70579);const x=function(){const[e,t]=(0,i.useState)(!1),a=localStorage.getItem("InvestorData"),x=JSON.parse(a),[h,m]=(0,i.useState)(""),[f,u]=(0,i.useState)(!1);document.title="Company List - Investor",(0,i.useEffect)((()=>{g()}),[]);const g=async()=>{let e={investor_id:x.id};try{const t=await n.A.post("https://blueprintcatalyst.com/api/user/investor/getInvestorCompany",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});v(t.data.results)}catch(t){}},[b,v]=(0,i.useState)([]),w=b.filter((e=>{const t=h.toLowerCase();return`\n    ${e.company_name||""}\n    ${e.update_date||""}\n    ${e.version||""}\n    ${e.document_name||""}\n    ${e.company_city||""}\n    ${e.phone||""}\n    ${e.company_country||""}\n  `.toLowerCase().includes(t)}));return(0,p.jsx)(o.mO,{className:"investor-login-wrapper",children:(0,p.jsx)("div",{className:"fullpage d-block",children:(0,p.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,p.jsx)(d.A,{isCollapsed:f,setIsCollapsed:u}),(0,p.jsx)("div",{className:"global_view "+(f?"global_view_col":""),children:(0,p.jsx)(o.$K,{className:"d-block p-md-4 p-3",children:(0,p.jsx)("div",{className:"container-fluid",children:(0,p.jsxs)(c.zP,{className:"d-flex flex-column gap-3",children:[(0,p.jsx)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:(0,p.jsx)("h4",{className:"mainh1",children:"Company List"})}),(0,p.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,p.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:h,onChange:e=>m(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,p.jsxs)("div",{className:"d-flex  flex-column justify-content-between align-items-start tb-box",children:[(0,p.jsx)("style",{children:"\n                        .datatb-report {\n                          overflow: visible !important;\n                        }\n                      "}),(0,p.jsx)(r.Ay,{customStyles:{table:{style:{overflow:"visible !important",minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"Company Name",selector:e=>e.company_name,sortable:!0,cell:e=>(0,p.jsxs)("div",{className:"d-flex align-items-center",children:[(0,p.jsx)("div",{className:"bg-primary bg-opacity-10 p-2 rounded-circle me-3",children:(0,p.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-primary",viewBox:"0 0 16 16",children:(0,p.jsx)("path",{d:"M14.763.075A.5.5 0 0 1 15 .5v15a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5V14h-1v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V10H.5a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5H2V.5a.5.5 0 0 1 .5-.5h12a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H14v8.5a.5.5 0 0 1 .5.5h2a.5.5 0 0 1 .5-.5V.575a.5.5 0 0 1-.237.5zM3 1.5v13h8V1.5H3zm10.5 0v13h1V1.5h-1z"})})}),(0,p.jsx)("span",{children:e.company_name})," "]})},{name:"Company Contact",selector:e=>e.phone,sortable:!0,cell:e=>(0,p.jsxs)("div",{className:"d-flex align-items-center",children:[(0,p.jsx)("div",{className:"bg-info bg-opacity-10 p-2 rounded me-2",children:(0,p.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-info",viewBox:"0 0 16 16",children:(0,p.jsx)("path",{d:"M3.654 1.328a.678.678 0 0 1 .736-.128l2.261.904c.329.131.445.507.249.777L5.08 4.58a.678.678 0 0 1-.746.225l-1.01-.303a11.72 11.72 0 0 0 5.516 5.516l.303-1.01a.678.678 0 0 1 .225-.746l1.195-1.195c.27-.196.646-.08.777.249l.904 2.261a.678.678 0 0 1-.128.736l-2.307 2.307c-.329.329-.888.329-1.217 0l-1.927-1.927a13.134 13.134 0 0 1-6.29-6.29L1.328 2.545c-.329-.329-.329-.888 0-1.217L3.654 1.328z"})})}),(0,p.jsx)("span",{children:e.phone})]})},{name:"Country",selector:e=>e.company_country,sortable:!0,cell:e=>(0,p.jsxs)("div",{className:"d-flex align-items-center",children:[(0,p.jsx)("div",{className:"bg-success bg-opacity-10 p-2 rounded me-2",children:(0,p.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-success",viewBox:"0 0 16 16",children:(0,p.jsx)("path",{d:"M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM4.882 1.731a.482.482 0 0 0 .14.291.487.487 0 0 0 .292.14.49.49 0 0 0 .356 0 .487.487 0 0 0 .292-.14.482.482 0 0 0 .14-.291.484.484 0 0 0-.14-.292.483.483 0 0 0-.292-.14.484.484 0 0 0-.356 0 .483.483 0 0 0-.292.14.484.484 0 0 0-.14.292zM7.5 11.5V12h-4v-1h1v-1h1v-1h1v-1h-1V8h1V7h1V6h1V5h-1V4h1V3h1V2h1v9h-1z"})})}),(0,p.jsx)("span",{children:e.company_country})," "]})},{name:"City",selector:e=>e.company_city,sortable:!0,cell:e=>(0,p.jsxs)("div",{className:"d-flex align-items-center",children:[(0,p.jsx)("div",{className:"bg-warning bg-opacity-10 p-2 rounded me-2",children:(0,p.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-warning",viewBox:"0 0 16 16",children:(0,p.jsx)("path",{d:"M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"})})}),(0,p.jsx)("span",{children:e.company_city})," "]})},{name:"Actions",cell:a=>(0,p.jsxs)("div",{className:"position-relative",children:[(0,p.jsx)("button",{className:"btn btn-light btn-sm",onClick:()=>t(e===a.id?null:a.id),style:{border:"1px solid #ddd",borderRadius:"6px",padding:"4px 8px"},children:(0,p.jsx)(l.H_v,{})}),e===a.id&&(0,p.jsxs)("div",{className:"dropdown-menu show",style:{position:"absolute",top:"100%",right:0,minWidth:"220px",zIndex:9999,borderRadius:"8px",boxShadow:"0 2px 6px rgba(0,0,0,0.15)"},children:[(0,p.jsxs)(s.N_,{to:`/investor/company/reportlist/${a.id}`,className:"dropdown-item",children:[(0,p.jsx)(l.Ny1,{className:"me-2",style:{fontSize:"14px"}})," ","Investor Report"]}),(0,p.jsxs)(s.N_,{to:`/investor/company/duediligence-reportlist/${a.id}`,className:"dropdown-item",children:[(0,p.jsx)(l.Ny1,{className:"me-2",style:{fontSize:"14px"}})," ","DataRoom Report"]}),(0,p.jsxs)("a",{to:`/investor/company/capital-round-list/${a.id}`,className:"dropdown-item",children:[(0,p.jsx)(l.Ny1,{className:"me-2",style:{fontSize:"14px"}})," ","Capital Round Documents"]})]})]}),ignoreRowClick:!0,allowOverflow:!0,button:!0}],className:"datatb-report",data:w,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})]})]})})})})]})})})}}}]);
//# sourceMappingURL=1090.6727bb15.chunk.js.map