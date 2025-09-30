"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[4499],{42552:(e,t,a)=>{a.d(t,{A:()=>f});var n=a(65043),r=(a(38421),a(73216)),i=a(53579),s=a(35475),o=a(50423),l=a(42983),d=a(9463),c=a(86213),p=a(31387),h=a(47196),x=a(70579);const u=[{label:"Dashboard",href:"/user/dashboard",icon:(0,x.jsx)(h.oeo,{size:18})},{label:"Add New Company",href:"/user/addcompany",icon:(0,x.jsx)(h.S2e,{size:18})},{label:"My Companies",href:"/user/companylist",icon:(0,x.jsx)(h.S2e,{size:18})},{label:"Manage Signatory",icon:(0,x.jsx)(h.dIq,{size:18}),dropdown:[{label:"Add New Signatory",href:"/user/add-new-signatory",icon:(0,x.jsx)(h.dIq,{size:16})},{label:"Signatory List",href:"/user/signatorylist",icon:(0,x.jsx)(h._cd,{size:16})}]},{label:"Settings",icon:(0,x.jsx)(h.XuQ,{size:18}),dropdown:[{label:"Profile Settings",href:"/user/settings/profile",icon:(0,x.jsx)(h.dIq,{size:16})},{label:"Approval Signature",href:"/user/approval/signature",icon:(0,x.jsx)(h.dIq,{size:16})}]}],m=[{path:"/crm/addnew-investor",menuHref:"/crm/investor-directory"},{path:"/crm/edit-investor/:id",menuHref:"/crm/investor-directory"},{path:"/crm/investor-report-detail-record-round/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-report-detail/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-report-detail-due-diligence/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-record-round-reports-confirm/:id",menuHref:"/crm/investorreport"},{path:"/edit-record-round/:id",menuHref:"/record-round-list"},{path:"/createrecord",menuHref:"/record-round-list"}],g=e=>{const t=m.find((t=>(0,p.B6)({path:t.path,end:!0},e)));return t?t.menuHref:e};function f(e){let{isCollapsed:t,setIsCollapsed:a}=e;const[f,b]=(0,n.useState)(""),j=(0,r.Zp)(),[y,v]=(0,n.useState)(null),[w,k]=(0,n.useState)([]),[N,_]=(0,n.useState)(!1);(0,n.useEffect)((()=>{const e=()=>{window.innerWidth<786?(_(!0),C&&C(!0)):(_(!1),C&&C(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[N]);const[S,z]=(0,n.useState)(!1),A="http://localhost:5000/api/user/",D=void 0!==t?t:N,C=a||_,E=localStorage.getItem("OwnerLoginData"),I=JSON.parse(E);(0,n.useEffect)((()=>{const e=localStorage.getItem("OwnerLoginData"),t=JSON.parse(e);b(t),null===t&&(localStorage.removeItem("OwnerLoginData"),j("/user/login"))}),[]),(0,n.useEffect)((()=>{O()}),[]);const O=async()=>{let e={user_id:I.id};try{0===(await c.A.post(A+"checkUserLogin",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length&&(localStorage.removeItem("OwnerLoginData"),j("/user/login"))}catch(t){console.error("Error fetching modules:",t)}};(0,n.useEffect)((()=>{$();const e=localStorage.getItem("selectedDropdown");e&&v(Number(e));const t=localStorage.getItem("sidebarCollapsed");if(null!==t){const e=JSON.parse(t);a?a(e):_(e)}}),[]);const $=async()=>{let e={id:""};try{const t=await c.A.post(A+"getModules",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});k(t.data.results)}catch(t){console.error("Error fetching modules:",t)}},L=(0,r.zy)(),T=(L.pathname,!D||S),M=g(L.pathname);return(0,x.jsxs)(x.Fragment,{children:[(0,x.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(D?"collapsed p-3":"p-4"),children:[(0,x.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(D?"justify-content-center":"justify-content-between"),children:[!D&&(0,x.jsx)("a",{href:"/",className:"logo",children:(0,x.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,x.jsx)(i.V4,{className:"d-flex justify-content-end",children:(0,x.jsxs)("button",{type:"button",onClick:()=>{const e=!D;C(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[D&&(0,x.jsx)(l.A,{strokeWidth:2}),!D&&(0,x.jsx)(d.A,{strokeWidth:2})]})})]}),(0,x.jsx)(i.vT,{isOpen:T,children:(0,x.jsx)(i.c0,{children:u.map(((e,t)=>{var a;const n=y===t||e.dropdown&&e.dropdown.some((e=>{const t=g(L.pathname);return t===e.href||t.startsWith(e.href)}))||"modules"===e.dynamicDropdownKey&&w.some((e=>{const t="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return L.pathname===t})),r=(null===(a=e.matchPaths)||void 0===a?void 0:a.some((e=>(0,p.B6)({path:e,end:!1},L.pathname))))||L.pathname===e.href||e.dropdown&&e.dropdown.some((e=>(m[L.pathname]||L.pathname)===e.href||(m[L.pathname]||L.pathname).startsWith(e.href)))||"modules"===e.dynamicDropdownKey&&w.some((e=>{const t="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return L.pathname===t}));return(0,x.jsx)(i.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,x.jsxs)(x.Fragment,{children:[(0,x.jsx)(i.C,{title:e.label,onClick:()=>(e=>{const t=y===e?null:e;D&&C(!D);v(t),localStorage.setItem("selectedDropdown",null!==t?t:"")})(t),children:(0,x.jsxs)("div",{className:"d-flex gap-2 align-items-center justify-content-between w-100",children:[(0,x.jsxs)("div",{className:"d-flex gap-2 align-items-start",children:[e.icon,T&&e.label]}),T&&(0,x.jsx)(i.i3,{isOpen:n,children:(0,x.jsx)(o.pte,{})})]})}),n&&(0,x.jsxs)(i.rI,{title:e.label,className:""+(T?"":"p-0"),children:[(0,x.jsx)("hr",{className:"my-2"}),e.dropdown&&e.dropdown.map(((e,t)=>{m[L.pathname]||L.pathname;const a=M===e.href||M.startsWith(e.href);return(0,x.jsx)("li",{className:"list-none",children:(0,x.jsxs)(s.N_,{to:e.href,className:`sidebar d-flex align-items-start gap-2 ${T?"":"w-fit"} ${a?"active":""}`,children:[e.icon,T&&e.label]})},t)})),"modules"===e.dynamicDropdownKey&&(0,x.jsxs)(x.Fragment,{children:[w.map(((e,t)=>{const a="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,n=L.pathname===a;return(0,x.jsx)("li",{className:"list-none",children:(0,x.jsxs)(s.N_,{to:a,title:e.name,className:`sidebar d-flex align-items-start gap-2 ${T?"":"w-fit"} ${n?"active":""}`,children:[(0,x.jsx)(h.MO3,{size:16}),T&&e.name]})},t)})),(0,x.jsx)("li",{className:"list-none",children:(0,x.jsxs)(s.N_,{title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",to:"/advicevideos",className:`sidebar d-flex align-items-start gap-2 ${T?"":"w-fit"} ${"/advicevideos"===L.pathname?"active":""}`,children:[(0,x.jsx)(h.xi0,{size:16}),T&&"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,x.jsxs)(s.N_,{to:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${T?"":"w-fit"} ${r?"active":""}`,children:[e.icon,T&&e.label]})},t)}))})})]}),(0,x.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 71px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,t,a)=>{a.d(t,{$K:()=>s,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>x,R3:()=>v,Zw:()=>h,dN:()=>g,hJ:()=>f,jh:()=>d,mO:()=>r,mg:()=>o,nj:()=>j,pd:()=>y,uM:()=>u,vE:()=>i,z6:()=>p});var n=a(5464);const r=n.default.div`
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
`,s=(n.default.div`
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
`),o=n.default.div`
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
`,h=n.default.div`
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
`,x=(n.default.div`
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
`),u=(n.default.div`
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
`,j=n.default.button`
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
`,y=n.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,v=n.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},77266:(e,t,a)=>{a.d(t,{A:()=>d});var n=a(65043),r=a(35475),i=a(75200),s=a(45394),o=a(53579),l=(a(86213),a(70579));const d=function(){const[e,t]=(0,n.useState)(!1),[a,d]=(0,n.useState)(""),[c,p]=(0,n.useState)(!1);return(0,l.jsxs)("div",{className:"top_bar",children:[(0,l.jsx)(o.SD,{children:(0,l.jsx)("div",{className:"container-fluid",children:(0,l.jsx)("div",{className:"d-flex gap-4 position-relative",children:(0,l.jsx)(o.FC,{className:"d-flex align-items-center justify-content-end gap-3 w-100",children:(0,l.jsx)(r.N_,{to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("OwnerLoginData"),window.location.href="/user/login"},title:"Logout",className:"logout_btn_global",children:(0,l.jsx)(i.QeK,{})})})})})}),c&&a&&(0,l.jsx)("div",{className:"main_popup-overlay",children:(0,l.jsxs)("div",{className:"popup-container",children:[(0,l.jsxs)("div",{className:"d-flex align-items-center gap-3 mb-3 justify-content-between",children:[(0,l.jsx)("h2",{className:"popup-title",children:"Credit Balance"}),(0,l.jsx)("button",{type:"button",className:"close_btn_global",onClick:()=>{p(!1)},"aria-label":"Close",children:(0,l.jsx)(s.LwM,{size:24})})]}),(0,l.jsxs)("ul",{className:"popup-list",children:[(0,l.jsxs)("li",{children:["Access to Dataroom + Investor reporting for 1 year (till"," ",(0,l.jsx)("strong",{children:(h=a.valid_until,new Date(h).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"}))}),")"]}),(0,l.jsxs)("li",{children:["Due diligence documents generated:"," ",(0,l.jsx)("strong",{children:a.total_generated})," / 1 allowed"]}),(0,l.jsxs)("li",{children:["Credit Balance Left:"," ",(0,l.jsx)("strong",{children:a.credit_balance})]}),a.extra_generations>0&&(0,l.jsx)("li",{className:"warn",children:(0,l.jsxs)("strong",{children:[a.extra_generations," additional generation(s) will incur \u20ac100 each"]})})]})]})})]});var h}},94499:(e,t,a)=>{a.r(t),a.d(t,{default:()=>p});var n=a(65043),r=(a(25015),a(77266)),i=(a(38421),a(62837)),s=a(42552),o=a(17304),l=a(86213),d=a(73216),c=a(70579);function p(){(0,d.Zp)();const e="http://localhost:5000/api/user/company/",t=localStorage.getItem("OwnerLoginData"),a=JSON.parse(t),[o,p]=(0,n.useState)([]),[h,x]=(0,n.useState)([]),[u,m]=(0,n.useState)([]),[g,f]=(0,n.useState)(""),[b,j]=(0,n.useState)(""),[y,v]=(0,n.useState)(""),[w,k]=(0,n.useState)({}),[N,_]=(0,n.useState)(!1),[S,z]=(0,n.useState)("");(0,n.useEffect)((()=>{document.title="Dashboard Page"}),[]),(0,n.useEffect)((()=>{D()}),[]),(0,n.useEffect)((()=>{A()}),[]);const A=async()=>{const t={user_id:a.id};try{const a=await l.A.post(e+"getUserOwnerDetail",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});a.data.results.length>0&&v(a.data.results[0])}catch(n){console.error("Error generating summary",n)}},D=async()=>{const t={user_id:a.id};try{const a=await l.A.post(e+"getUserCompany",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(a.data.results),a.data.results.length>0&&(f(a.data.results[0].id),j(a.data.results[0].company_name)),p(a.data.results)}catch(n){console.error("Error generating summary",n)}};(0,n.useEffect)((()=>{g&&C()}),[g]);const C=async()=>{const e={company_id:g};try{const t=await l.A.post("http://localhost:5000/api/user/accesslogs/getCompanyLogs",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});x(t.data.results)}catch(t){console.error("Error generating summary",t)}};function E(e){const t=new Date(e);if(isNaN(t))return"";const a=t.getDate(),n=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],r=t.getFullYear();let i=t.getHours();const s=t.getMinutes().toString().padStart(2,"0"),o=(t.getSeconds().toString().padStart(2,"0"),i>=12?"PM":"AM");return i%=12,i=i||12,`${n} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${r} ${i}:${s} ${o}`}const[I,O]=(0,n.useState)(!1);return(0,c.jsx)(c.Fragment,{children:(0,c.jsx)(i.mO,{children:(0,c.jsx)("div",{className:"fullpage d-block",children:(0,c.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,c.jsx)(s.A,{isCollapsed:I,setIsCollapsed:O}),(0,c.jsxs)("div",{className:"global_view "+(I?"global_view_col":""),children:[(0,c.jsx)(r.A,{}),S&&(0,c.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(N?"error_pop":"success_pop"),children:[(0,c.jsx)("div",{className:"d-flex align-items-center gap-2",children:(0,c.jsx)("span",{className:"d-block",children:S})}),(0,c.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>z(""),children:"\xd7"})]}),(0,c.jsx)(i.$K,{className:"d-block p-md-4 p-3",children:(0,c.jsx)("div",{className:"container-fluid",children:(0,c.jsx)(i.mg,{id:"step5",children:(0,c.jsxs)("div",{className:"row",children:[(0,c.jsxs)("div",{className:"col-md-12",children:[(0,c.jsx)("div",{className:"pb-3 bar_design",children:(0,c.jsxs)("h4",{className:"h5 mb-0",children:["Welcome,"," ",y.first_name||y.last_name?(0,c.jsxs)(c.Fragment,{children:[y.first_name," ",y.last_name]}):(0,c.jsx)("span",{className:"text-muted",children:"Name not available"})]})}),(0,c.jsx)("div",{class:"row gap-0 dashboard-top p-0 border-0 bg-transparent",children:(0,c.jsx)("div",{className:"row gy-3 ",children:null===o||void 0===o?void 0:o.map(((e,t)=>(0,c.jsx)("button",{type:"button",className:"col-md-4 border-0 bg-transparent",children:(0,c.jsxs)("div",{className:"card_deisgn_register",style:{borderColor:e.company_color_code||"#ccc",backgroundColor:`${e.company_color_code}50`||"#ffffff80"},children:[(0,c.jsxs)("h5",{className:"text-center d-flex align-items-center gap-2",style:{backgroundColor:e.company_color_code||"#000",color:"#fff",padding:"10px 20px",borderRadius:"8px",fontSize:"0.9rem"},children:[(0,c.jsx)("input",{className:"checkbox_global",name:"company",checked:e.id===g,onChange:()=>(async(e,t)=>{j(t),f(e)})(e.id,e.company_name),type:"radio"}),(0,c.jsx)("span",{className:"d-block text-start",children:e.company_name})]}),(0,c.jsxs)("p",{onClick:()=>(async e=>{const t={company_id:e,user_id:a.id};k((t=>({...t,[e]:!0}))),setTimeout((async()=>{try{const n=await l.A.post("http://localhost:5000/api/user/dashboard/getCompanyAccess",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});var a=n.data;k((t=>({...t,[e]:!1}))),z(a.message),"1"===a.status?(localStorage.removeItem("SignatoryLoginData"),setTimeout((()=>{var e=a.user;localStorage.setItem("SignatoryLoginData",JSON.stringify(e)),window.open("/dashboard","_blank")}),1500)):_(!0),setTimeout((()=>{_(!1),z("")}),3500),console.log(n.data)}catch(n){console.error("Error generating summary",n),k((t=>({...t,[e]:!1})))}}),1e3)})(e.id),className:"py-3 text-center mb-0",style:{fontSize:"0.9rem",fontWeight:"600",position:"relative",cursor:"pointer"},children:["Access this account.",w[e.id]&&(0,c.jsx)("div",{className:"spinner-border spinneronetimepay",role:"status",style:{position:"absolute",top:"60%",left:"42%",width:"1rem",height:"1rem"},children:(0,c.jsx)("span",{className:"visually-hidden"})})]})]})},t)))})})]}),(0,c.jsx)("div",{className:"col-12 my-4",children:(0,c.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,c.jsx)("div",{class:"card-header",children:(0,c.jsx)("h3",{class:"card-title",children:"Recent Activity Investor (Round)"})}),(0,c.jsxs)("div",{class:"access-logs",children:[(0,c.jsxs)("h4",{class:"section-title",children:["Comapny (",b,")"]}),(0,c.jsxs)("table",{class:"log-table",children:[(0,c.jsx)("thead",{children:(0,c.jsxs)("tr",{children:[(0,c.jsx)("th",{children:"Name"}),(0,c.jsx)("th",{children:"Action"}),(0,c.jsx)("th",{children:"Status"}),(0,c.jsx)("th",{children:"Time"})]})}),(0,c.jsx)("tbody",{children:o.length>0&&u.length>0?u.map(((e,t)=>"active"===e.access_status&&(0,c.jsxs)("tr",{children:[(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:"Test investor"})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:" Seed A"})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:" Download"})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:"September 11th, 2025"})})]}))):(0,c.jsx)("tr",{children:(0,c.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No result found"})})})]})]})]})}),(0,c.jsx)("div",{className:"col-12 my-4",children:(0,c.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,c.jsx)("div",{class:"card-header",children:(0,c.jsx)("h3",{class:"card-title",children:"Recent Activity Signatory"})}),(0,c.jsxs)("div",{class:"access-logs",children:[(0,c.jsxs)("h4",{class:"section-title",children:["Company (",b,")"]}),(0,c.jsxs)("table",{className:"log-table",children:[(0,c.jsx)("thead",{children:(0,c.jsxs)("tr",{children:[(0,c.jsx)("th",{children:"Signatory Name"}),(0,c.jsx)("th",{children:"Module"}),(0,c.jsx)("th",{children:"Action"}),(0,c.jsx)("th",{children:"Entity Name / Details"}),(0,c.jsx)("th",{children:"IP Address"}),(0,c.jsx)("th",{children:"Date"})]})}),(0,c.jsx)("tbody",{children:h.length>0?h.map(((e,t)=>{let a=e.details;if("string"===typeof a)try{a=JSON.parse(a)}catch(n){a={}}return(0,c.jsxs)("tr",{children:[(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.signatory_first_name," ",e.signatory_last_name]})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:e.module})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:e.action})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:e.entity_type})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:e.ip_address})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:E(e.created_at)})})]},t)})):(0,c.jsx)("tr",{children:(0,c.jsx)("td",{colSpan:"5",style:{textAlign:"center"},children:"No result found"})})})]})]})]})})]})})})})]})]})})})})}o.t1.register(o.PP,o.kc,o.E8,o.No,o.FN,o.Bs,o.hE,o.m_,o.s$)}}]);
//# sourceMappingURL=4499.8d1cdebf.chunk.js.map