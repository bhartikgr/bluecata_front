"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[7653],{42552:(e,t,i)=>{i.d(t,{A:()=>f});var n=i(65043),o=(i(38421),i(73216)),a=i(53579),r=i(35475),s=i(50423),l=i(42983),d=i(9463),c=i(86213),p=i(31387),x=i(47196),u=i(70579);const h=[{label:"Dashboard",href:"/user/dashboard",icon:(0,u.jsx)(x.oeo,{size:18})},{label:"Add New Company",href:"/user/addcompany",icon:(0,u.jsx)(x.S2e,{size:18})},{label:"My Companies",href:"/user/companylist",icon:(0,u.jsx)(x.S2e,{size:18})},{label:"Manage Signatory",icon:(0,u.jsx)(x.dIq,{size:18}),dropdown:[{label:"Add New Signatory",href:"/user/add-new-signatory",icon:(0,u.jsx)(x.dIq,{size:16})},{label:"Signatory List",href:"/user/signatorylist",icon:(0,u.jsx)(x._cd,{size:16})}]},{label:"Settings",icon:(0,u.jsx)(x.XuQ,{size:18}),dropdown:[{label:"Profile Settings",href:"/user/settings/profile",icon:(0,u.jsx)(x.dIq,{size:16})},{label:"Approval Signature",href:"/user/approval/signature",icon:(0,u.jsx)(x.dIq,{size:16})}]}],m=[{path:"/crm/addnew-investor",menuHref:"/crm/investor-directory"},{path:"/crm/edit-investor/:id",menuHref:"/crm/investor-directory"},{path:"/crm/investor-report-detail-record-round/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-report-detail/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-report-detail-due-diligence/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-record-round-reports-confirm/:id",menuHref:"/crm/investorreport"},{path:"/edit-record-round/:id",menuHref:"/record-round-list"},{path:"/createrecord",menuHref:"/record-round-list"}],g=e=>{const t=m.find((t=>(0,p.B6)({path:t.path,end:!0},e)));return t?t.menuHref:e};function f(e){let{isCollapsed:t,setIsCollapsed:i}=e;const[f,b]=(0,n.useState)(""),v=(0,o.Zp)(),[w,y]=(0,n.useState)(null),[j,k]=(0,n.useState)([]),[N,z]=(0,n.useState)(!1);(0,n.useEffect)((()=>{const e=()=>{window.innerWidth<786?(z(!0),C&&C(!0)):(z(!1),C&&C(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[N]);const[S,D]=(0,n.useState)(!1),_="https://blueprintcatalyst.com/api/user/",I=void 0!==t?t:N,C=i||z,E=localStorage.getItem("OwnerLoginData"),O=JSON.parse(E);(0,n.useEffect)((()=>{const e=localStorage.getItem("OwnerLoginData"),t=JSON.parse(e);b(t),null===t&&(localStorage.removeItem("OwnerLoginData"),v("/user/login"))}),[]),(0,n.useEffect)((()=>{A()}),[]);const A=async()=>{let e={user_id:O.id};try{0===(await c.A.post(_+"checkUserLogin",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length&&(localStorage.removeItem("OwnerLoginData"),v("/user/login"))}catch(t){console.error("Error fetching modules:",t)}};(0,n.useEffect)((()=>{L();const e=localStorage.getItem("selectedDropdown");e&&y(Number(e));const t=localStorage.getItem("sidebarCollapsed");if(null!==t){const e=JSON.parse(t);i?i(e):z(e)}}),[]);const L=async()=>{let e={id:""};try{const t=await c.A.post(_+"getModules",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});k(t.data.results)}catch(t){console.error("Error fetching modules:",t)}},$=(0,o.zy)(),H=($.pathname,!I||S),T=g($.pathname);return(0,u.jsxs)(u.Fragment,{children:[(0,u.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(I?"collapsed p-3":"p-4"),children:[(0,u.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(I?"justify-content-center":"justify-content-between"),children:[!I&&(0,u.jsx)("a",{href:"/",className:"logo",children:(0,u.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,u.jsx)(a.V4,{className:"d-flex justify-content-end",children:(0,u.jsxs)("button",{type:"button",onClick:()=>{const e=!I;C(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[I&&(0,u.jsx)(l.A,{strokeWidth:2}),!I&&(0,u.jsx)(d.A,{strokeWidth:2})]})})]}),(0,u.jsx)(a.vT,{isOpen:H,children:(0,u.jsx)(a.c0,{children:h.map(((e,t)=>{var i;const n=w===t||e.dropdown&&e.dropdown.some((e=>{const t=g($.pathname);return t===e.href||t.startsWith(e.href)}))||"modules"===e.dynamicDropdownKey&&j.some((e=>{const t="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return $.pathname===t})),o=(null===(i=e.matchPaths)||void 0===i?void 0:i.some((e=>(0,p.B6)({path:e,end:!1},$.pathname))))||$.pathname===e.href||e.dropdown&&e.dropdown.some((e=>(m[$.pathname]||$.pathname)===e.href||(m[$.pathname]||$.pathname).startsWith(e.href)))||"modules"===e.dynamicDropdownKey&&j.some((e=>{const t="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return $.pathname===t}));return(0,u.jsx)(a.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,u.jsxs)(u.Fragment,{children:[(0,u.jsx)(a.C,{title:e.label,onClick:()=>(e=>{const t=w===e?null:e;I&&C(!I);y(t),localStorage.setItem("selectedDropdown",null!==t?t:"")})(t),children:(0,u.jsxs)("div",{className:"d-flex gap-2 align-items-center justify-content-between w-100",children:[(0,u.jsxs)("div",{className:"d-flex gap-2 align-items-start",children:[e.icon,H&&e.label]}),H&&(0,u.jsx)(a.i3,{isOpen:n,children:(0,u.jsx)(s.pte,{})})]})}),n&&(0,u.jsxs)(a.rI,{title:e.label,className:""+(H?"":"p-0"),children:[(0,u.jsx)("hr",{className:"my-2"}),e.dropdown&&e.dropdown.map(((e,t)=>{m[$.pathname]||$.pathname;const i=T===e.href||T.startsWith(e.href);return(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(r.N_,{to:e.href,className:`sidebar d-flex align-items-start gap-2 ${H?"":"w-fit"} ${i?"active":""}`,children:[e.icon,H&&e.label]})},t)})),"modules"===e.dynamicDropdownKey&&(0,u.jsxs)(u.Fragment,{children:[j.map(((e,t)=>{const i="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,n=$.pathname===i;return(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(r.N_,{to:i,title:e.name,className:`sidebar d-flex align-items-start gap-2 ${H?"":"w-fit"} ${n?"active":""}`,children:[(0,u.jsx)(x.MO3,{size:16}),H&&e.name]})},t)})),(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(r.N_,{title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",to:"/advicevideos",className:`sidebar d-flex align-items-start gap-2 ${H?"":"w-fit"} ${"/advicevideos"===$.pathname?"active":""}`,children:[(0,u.jsx)(x.xi0,{size:16}),H&&"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,u.jsxs)(r.N_,{to:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${H?"":"w-fit"} ${o?"active":""}`,children:[e.icon,H&&e.label]})},t)}))})})]}),(0,u.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 71px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,t,i)=>{i.d(t,{$K:()=>r,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>u,R3:()=>y,Zw:()=>x,dN:()=>g,hJ:()=>f,jh:()=>d,mO:()=>o,mg:()=>s,nj:()=>v,pd:()=>w,uM:()=>h,vE:()=>a,z6:()=>p});var n=i(5464);const o=n.default.div`
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
`,a=n.default.span`
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
`),h=(n.default.div`
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
`),m=(n.default.div`
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
`),g=((0,n.default)(m)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,n.default)(m)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,n.default.sup`
  color: var(--primary);
`),f=n.default.div`
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
`},77266:(e,t,i)=>{i.d(t,{A:()=>d});var n=i(65043),o=i(35475),a=i(75200),r=i(45394),s=i(53579),l=(i(86213),i(70579));const d=function(){const[e,t]=(0,n.useState)(!1),[i,d]=(0,n.useState)(""),[c,p]=(0,n.useState)(!1);return(0,l.jsxs)("div",{className:"top_bar",children:[(0,l.jsx)(s.SD,{children:(0,l.jsx)("div",{className:"container-fluid",children:(0,l.jsx)("div",{className:"d-flex gap-4 position-relative",children:(0,l.jsx)(s.FC,{className:"d-flex align-items-center justify-content-end gap-3 w-100",children:(0,l.jsx)(o.N_,{to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("OwnerLoginData"),window.location.href="/user/login"},title:"Logout",className:"logout_btn_global",children:(0,l.jsx)(a.QeK,{})})})})})}),c&&i&&(0,l.jsx)("div",{className:"main_popup-overlay",children:(0,l.jsxs)("div",{className:"popup-container",children:[(0,l.jsxs)("div",{className:"d-flex align-items-center gap-3 mb-3 justify-content-between",children:[(0,l.jsx)("h2",{className:"popup-title",children:"Credit Balance"}),(0,l.jsx)("button",{type:"button",className:"close_btn_global",onClick:()=>{p(!1)},"aria-label":"Close",children:(0,l.jsx)(r.LwM,{size:24})})]}),(0,l.jsxs)("ul",{className:"popup-list",children:[(0,l.jsxs)("li",{children:["Access to Dataroom + Investor reporting for 1 year (till"," ",(0,l.jsx)("strong",{children:(x=i.valid_until,new Date(x).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"}))}),")"]}),(0,l.jsxs)("li",{children:["Due diligence documents generated:"," ",(0,l.jsx)("strong",{children:i.total_generated})," / 1 allowed"]}),(0,l.jsxs)("li",{children:["Credit Balance Left:"," ",(0,l.jsx)("strong",{children:i.credit_balance})]}),i.extra_generations>0&&(0,l.jsx)("li",{className:"warn",children:(0,l.jsxs)("strong",{children:[i.extra_generations," additional generation(s) will incur \u20ac100 each"]})})]})]})})]});var x}},87653:(e,t,i)=>{i.r(t),i.d(t,{default:()=>d});var n=i(65043),o=(i(25015),i(77266)),a=(i(38421),i(62837)),r=i(42552),s=i(17304),l=i(70579);function d(){const e=localStorage.getItem("OwnerLoginData");JSON.parse(e);(0,n.useEffect)((()=>{document.title="Subscription Page"}),[]);const[t,i]=(0,n.useState)(!1);return(0,l.jsx)(l.Fragment,{children:(0,l.jsx)(a.mO,{children:(0,l.jsx)("div",{className:"fullpage d-block",children:(0,l.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,l.jsx)(r.A,{isCollapsed:t,setIsCollapsed:i}),(0,l.jsxs)("div",{className:"global_view "+(t?"global_view_col":""),children:[(0,l.jsx)(o.A,{}),(0,l.jsx)(a.$K,{className:"d-block p-md-4 p-3",children:(0,l.jsx)("div",{className:"container-fluid",children:(0,l.jsx)(a.mg,{id:"step5",children:(0,l.jsx)("div",{className:"row",children:(0,l.jsxs)("div",{className:"col-md-12",children:[(0,l.jsx)("div",{className:"pb-3 bar_design",children:(0,l.jsx)("h4",{className:"h5 mb-0",children:"Subscription Page"})}),(0,l.jsx)("div",{class:"row gap-0 dashboard-top p-0 border-0 bg-transparent"})]})})})})})]})]})})})})}s.t1.register(s.PP,s.kc,s.E8,s.No,s.FN,s.Bs,s.hE,s.m_,s.s$)}}]);
//# sourceMappingURL=7653.6e13eb5c.chunk.js.map