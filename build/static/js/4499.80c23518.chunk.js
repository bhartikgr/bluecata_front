"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[4499],{42552:(e,t,n)=>{n.d(t,{A:()=>f});var r=n(65043),a=(n(38421),n(73216)),i=n(53579),o=n(35475),s=n(50423),l=n(42983),d=n(9463),c=n(86213),p=n(31387),h=n(47196),x=n(70579);const u=[{label:"Dashboard",href:"/user/dashboard",icon:(0,x.jsx)(h.oeo,{size:18})},{label:"Add New Company",href:"/user/addcompany",icon:(0,x.jsx)(h.S2e,{size:18})},{label:"All Company",href:"/user/companylist",icon:(0,x.jsx)(h.S2e,{size:18})},{label:"Manage Signatory",icon:(0,x.jsx)(h.dIq,{size:18}),dropdown:[{label:"Add New Signatory",href:"/user/add-new-signatory",icon:(0,x.jsx)(h.dIq,{size:16})},{label:"Signatory List",href:"/user/signatorylist",icon:(0,x.jsx)(h._cd,{size:16})}]},{label:"Settings",icon:(0,x.jsx)(h.XuQ,{size:18}),dropdown:[{label:"Profile Settings",href:"/user/settings/profile",icon:(0,x.jsx)(h.dIq,{size:16})},{label:"Subscriptions",href:"/user/subscription",icon:(0,x.jsx)(h._cd,{size:16})},{label:"Package Subscription",href:"/user/package-subscription",icon:(0,x.jsx)(h._cd,{size:16})}]}],m=[{path:"/crm/addnew-investor",menuHref:"/crm/investor-directory"},{path:"/crm/edit-investor/:id",menuHref:"/crm/investor-directory"},{path:"/crm/investor-report-detail-record-round/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-report-detail/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-report-detail-due-diligence/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-record-round-reports-confirm/:id",menuHref:"/crm/investorreport"},{path:"/edit-record-round/:id",menuHref:"/record-round-list"},{path:"/createrecord",menuHref:"/record-round-list"}],g=e=>{const t=m.find((t=>(0,p.B6)({path:t.path,end:!0},e)));return t?t.menuHref:e};function f(e){let{isCollapsed:t,setIsCollapsed:n}=e;const[f,b]=(0,r.useState)(""),j=(0,a.Zp)(),[v,y]=(0,r.useState)(null),[w,k]=(0,r.useState)([]),[N,z]=(0,r.useState)(!1);(0,r.useEffect)((()=>{const e=()=>{window.innerWidth<786?(z(!0),A&&A(!0)):(z(!1),A&&A(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[N]);const[_,S]=(0,r.useState)(!1),D=void 0!==t?t:N,A=n||z;(0,r.useEffect)((()=>{const e=localStorage.getItem("OwnerLoginData"),t=JSON.parse(e);b(t),console.log(t),null===t&&(localStorage.removeItem("OwnerLoginData"),j("/user/login"))}),[]),(0,r.useEffect)((()=>{C();const e=localStorage.getItem("selectedDropdown");e&&y(Number(e));const t=localStorage.getItem("sidebarCollapsed");if(null!==t){const e=JSON.parse(t);n?n(e):z(e)}}),[]);const C=async()=>{let e={id:""};try{const t=await c.A.post("https://blueprintcatalyst.com/api/user/getModules",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});k(t.data.results)}catch(t){console.error("Error fetching modules:",t)}},E=(0,a.zy)(),I=(E.pathname,!D||_),O=g(E.pathname);return(0,x.jsxs)(x.Fragment,{children:[(0,x.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(D?"collapsed p-3":"p-4"),children:[(0,x.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(D?"justify-content-center":"justify-content-between"),children:[!D&&(0,x.jsx)("a",{href:"/",className:"logo",children:(0,x.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,x.jsx)(i.V4,{className:"d-flex justify-content-end",children:(0,x.jsxs)("button",{type:"button",onClick:()=>{const e=!D;A(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[D&&(0,x.jsx)(l.A,{strokeWidth:2}),!D&&(0,x.jsx)(d.A,{strokeWidth:2})]})})]}),(0,x.jsx)(i.vT,{isOpen:I,children:(0,x.jsx)(i.c0,{children:u.map(((e,t)=>{var n;const r=v===t||e.dropdown&&e.dropdown.some((e=>{const t=g(E.pathname);return t===e.href||t.startsWith(e.href)}))||"modules"===e.dynamicDropdownKey&&w.some((e=>{const t="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return E.pathname===t})),a=(null===(n=e.matchPaths)||void 0===n?void 0:n.some((e=>(0,p.B6)({path:e,end:!1},E.pathname))))||E.pathname===e.href||e.dropdown&&e.dropdown.some((e=>(m[E.pathname]||E.pathname)===e.href||(m[E.pathname]||E.pathname).startsWith(e.href)))||"modules"===e.dynamicDropdownKey&&w.some((e=>{const t="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return E.pathname===t}));return(0,x.jsx)(i.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,x.jsxs)(x.Fragment,{children:[(0,x.jsx)(i.C,{title:e.label,onClick:()=>(e=>{const t=v===e?null:e;D&&A(!D);y(t),localStorage.setItem("selectedDropdown",null!==t?t:"")})(t),children:(0,x.jsxs)("div",{className:"d-flex gap-2 align-items-center justify-content-between w-100",children:[(0,x.jsxs)("div",{className:"d-flex gap-2 align-items-start",children:[e.icon,I&&e.label]}),I&&(0,x.jsx)(i.i3,{isOpen:r,children:(0,x.jsx)(s.pte,{})})]})}),r&&(0,x.jsxs)(i.rI,{title:e.label,className:""+(I?"":"p-0"),children:[(0,x.jsx)("hr",{className:"my-2"}),e.dropdown&&e.dropdown.map(((e,t)=>{m[E.pathname]||E.pathname;const n=O===e.href||O.startsWith(e.href);return(0,x.jsx)("li",{className:"list-none",children:(0,x.jsxs)(o.N_,{to:e.href,className:`sidebar d-flex align-items-start gap-2 ${I?"":"w-fit"} ${n?"active":""}`,children:[e.icon,I&&e.label]})},t)})),"modules"===e.dynamicDropdownKey&&(0,x.jsxs)(x.Fragment,{children:[w.map(((e,t)=>{const n="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,r=E.pathname===n;return(0,x.jsx)("li",{className:"list-none",children:(0,x.jsxs)(o.N_,{to:n,title:e.name,className:`sidebar d-flex align-items-start gap-2 ${I?"":"w-fit"} ${r?"active":""}`,children:[(0,x.jsx)(h.MO3,{size:16}),I&&e.name]})},t)})),(0,x.jsx)("li",{className:"list-none",children:(0,x.jsxs)(o.N_,{title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",to:"/advicevideos",className:`sidebar d-flex align-items-start gap-2 ${I?"":"w-fit"} ${"/advicevideos"===E.pathname?"active":""}`,children:[(0,x.jsx)(h.xi0,{size:16}),I&&"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,x.jsxs)(o.N_,{to:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${I?"":"w-fit"} ${a?"active":""}`,children:[e.icon,I&&e.label]})},t)}))})})]}),(0,x.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 71px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,t,n)=>{n.d(t,{$K:()=>o,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>x,R3:()=>y,Zw:()=>h,dN:()=>g,hJ:()=>f,jh:()=>d,mO:()=>a,mg:()=>s,nj:()=>j,pd:()=>v,uM:()=>u,vE:()=>i,z6:()=>p});var r=n(5464);const a=r.default.div`
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
`,i=r.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,o=(r.default.div`
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
`,r.default.div`
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
`,r.default.div`
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
`,r.default.div`
  display: block;
  height: 100%;
`),s=r.default.div`
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
`,l=r.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=r.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=r.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=r.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,h=r.default.div`
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
`,x=(r.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,r.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,r.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,r.default.div`
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
`),u=(r.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,r.default.div`
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
`),m=(r.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,r.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,r.default.div`
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
`,r.default.button`
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
`,r.default.div`
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
`,r.default.video`
  background-color: black;
  border: none;
`,r.default.div`
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
`,r.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,r.default.button`
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
`),g=((0,r.default)(m)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,r.default)(m)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,r.default.sup`
  color: var(--primary);
`),f=r.default.div`
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
`,b=r.default.div`
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
`,j=r.default.button`
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
`,v=r.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,y=r.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},77266:(e,t,n)=>{n.d(t,{A:()=>d});var r=n(65043),a=n(35475),i=n(75200),o=n(45394),s=n(53579),l=(n(86213),n(70579));const d=function(){const[e,t]=(0,r.useState)(!1),[n,d]=(0,r.useState)(""),[c,p]=(0,r.useState)(!1);return(0,l.jsxs)("div",{className:"top_bar",children:[(0,l.jsx)(s.SD,{children:(0,l.jsx)("div",{className:"container-fluid",children:(0,l.jsx)("div",{className:"d-flex gap-4 position-relative",children:(0,l.jsx)(s.FC,{className:"d-flex align-items-center justify-content-end gap-3 w-100",children:(0,l.jsx)(a.N_,{to:"/logout",title:"Logout",className:"logout_btn_global",children:(0,l.jsx)(i.QeK,{})})})})})}),c&&n&&(0,l.jsx)("div",{className:"main_popup-overlay",children:(0,l.jsxs)("div",{className:"popup-container",children:[(0,l.jsxs)("div",{className:"d-flex align-items-center gap-3 mb-3 justify-content-between",children:[(0,l.jsx)("h2",{className:"popup-title",children:"Credit Balance"}),(0,l.jsx)("button",{type:"button",className:"close_btn_global",onClick:()=>{p(!1)},"aria-label":"Close",children:(0,l.jsx)(o.LwM,{size:24})})]}),(0,l.jsxs)("ul",{className:"popup-list",children:[(0,l.jsxs)("li",{children:["Access to Dataroom + Investor reporting for 1 year (till"," ",(0,l.jsx)("strong",{children:(h=n.valid_until,new Date(h).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"}))}),")"]}),(0,l.jsxs)("li",{children:["Due diligence documents generated:"," ",(0,l.jsx)("strong",{children:n.total_generated})," / 1 allowed"]}),(0,l.jsxs)("li",{children:["Credit Balance Left:"," ",(0,l.jsx)("strong",{children:n.credit_balance})]}),n.extra_generations>0&&(0,l.jsx)("li",{className:"warn",children:(0,l.jsxs)("strong",{children:[n.extra_generations," additional generation(s) will incur \u20ac100 each"]})})]})]})})]});var h}},94499:(e,t,n)=>{n.r(t),n.d(t,{default:()=>c});var r=n(65043),a=(n(25015),n(77266)),i=(n(38421),n(62837)),o=n(42552),s=n(17304),l=n(86213),d=n(70579);function c(){const e=localStorage.getItem("OwnerLoginData"),t=JSON.parse(e),[n,s]=(0,r.useState)([]),[c,p]=(0,r.useState)([]),[h,x]=(0,r.useState)(""),[u,m]=(0,r.useState)("");(0,r.useEffect)((()=>{document.title="Dashboard Page"}),[]),(0,r.useEffect)((()=>{g()}),[]);const g=async()=>{const e={user_id:t.id};try{const t=await l.A.post("https://blueprintcatalyst.com/api/user/company/getUserCompany",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});t.data.results.length>0&&(x(t.data.results[0].id),m(t.data.results[0].company_name)),s(t.data.results)}catch(n){console.error("Error generating summary",n)}};(0,r.useEffect)((()=>{h&&f()}),[h]);const f=async()=>{const e={user_id:t.id,companyId:h};try{const t=await l.A.post("https://blueprintcatalyst.com/api/user/dashboard/getSignatoryActivity",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(t.data.results),p(t.data.results)}catch(n){console.error("Error generating summary",n)}};function b(e){const t=new Date(e);if(isNaN(t))return"";const n=t.getDate(),r=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],a=t.getFullYear();return`${r} ${n}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(n)}, ${a}`}const[j,v]=(0,r.useState)(!1);return(0,d.jsx)(d.Fragment,{children:(0,d.jsx)(i.mO,{children:(0,d.jsx)("div",{className:"fullpage d-block",children:(0,d.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,d.jsx)(o.A,{isCollapsed:j,setIsCollapsed:v}),(0,d.jsxs)("div",{className:"global_view "+(j?"global_view_col":""),children:[(0,d.jsx)(a.A,{}),(0,d.jsx)(i.$K,{className:"d-block p-md-4 p-3",children:(0,d.jsx)("div",{className:"container-fluid",children:(0,d.jsx)(i.mg,{id:"step5",children:(0,d.jsxs)("div",{className:"row",children:[(0,d.jsxs)("div",{className:"col-md-12",children:[(0,d.jsx)("div",{className:"pb-3 bar_design",children:(0,d.jsx)("h4",{className:"h5 mb-0",children:"User Dashboard"})}),(0,d.jsx)("div",{class:"row gap-0 dashboard-top p-0 border-0 bg-transparent",children:(0,d.jsx)("div",{className:"row gy-3 ",children:null===n||void 0===n?void 0:n.map(((e,t)=>(0,d.jsx)("button",{type:"button",className:"col-md-4 border-0 bg-transparent",children:(0,d.jsxs)("div",{className:"card_deisgn_register",style:{borderColor:e.company_color_code||"#ccc",backgroundColor:`${e.company_color_code}50`||"#ffffff80"},children:[(0,d.jsxs)("h5",{className:"text-center d-flex align-items-center gap-2",style:{backgroundColor:e.company_color_code||"#000",color:"#fff",padding:"10px 20px",borderRadius:"8px",fontSize:"0.9rem"},children:[(0,d.jsx)("input",{className:"checkbox_global",name:"company",checked:e.id===h,onChange:()=>(async(e,t)=>{m(t),x(e)})(e.id,e.company_name),type:"radio"}),(0,d.jsx)("span",{className:"d-block text-start",children:e.company_name})]}),(0,d.jsx)("p",{className:"py-3 text-center mb-0",style:{fontSize:"0.9rem",fontWeight:"600"},children:"Access this account."})]})},t)))})})]}),(0,d.jsx)("div",{className:"col-12 my-4",children:(0,d.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,d.jsx)("div",{class:"card-header",children:(0,d.jsx)("h3",{class:"card-title",children:"Recent Activity Investor (Round)"})}),(0,d.jsxs)("div",{class:"access-logs",children:[(0,d.jsxs)("h4",{class:"section-title",children:["Comapny (",u,")"]}),(0,d.jsxs)("table",{class:"log-table",children:[(0,d.jsx)("thead",{children:(0,d.jsxs)("tr",{children:[(0,d.jsx)("th",{children:"Name"}),(0,d.jsx)("th",{children:"Action"}),(0,d.jsx)("th",{children:"Status"}),(0,d.jsx)("th",{children:"Time"})]})}),(0,d.jsxs)("tbody",{children:[(0,d.jsxs)("tr",{children:[(0,d.jsx)("td",{children:(0,d.jsx)("small",{children:"Test investor"})}),(0,d.jsx)("td",{children:(0,d.jsx)("small",{children:" Seed A"})}),(0,d.jsx)("td",{children:(0,d.jsx)("small",{children:" Download"})}),(0,d.jsx)("td",{children:(0,d.jsx)("small",{children:"September 11th, 2025"})})]}),(0,d.jsxs)("tr",{children:[(0,d.jsx)("td",{children:(0,d.jsx)("small",{children:"Abc"})}),(0,d.jsx)("td",{children:(0,d.jsx)("small",{children:" Series C Extension"})}),(0,d.jsx)("td",{children:(0,d.jsx)("small",{children:" View Documents"})}),(0,d.jsx)("td",{children:(0,d.jsx)("small",{children:"September 5th, 2025"})})]})]})]})]})]})}),(0,d.jsx)("div",{className:"col-12 my-4",children:(0,d.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,d.jsx)("div",{class:"card-header",children:(0,d.jsx)("h3",{class:"card-title",children:"Recent Activity Signatory"})}),(0,d.jsxs)("div",{class:"access-logs",children:[(0,d.jsxs)("h4",{class:"section-title",children:["Company (",u,")"]}),(0,d.jsxs)("table",{class:"log-table",children:[(0,d.jsx)("thead",{children:(0,d.jsxs)("tr",{children:[(0,d.jsx)("th",{children:"Name"}),(0,d.jsx)("th",{children:"Action"}),(0,d.jsx)("th",{children:"Time"})]})}),(0,d.jsx)("tbody",{children:c.length>0?c.map(((e,t)=>"active"===e.access_status&&(0,d.jsxs)("tr",{children:[(0,d.jsx)("td",{children:(0,d.jsxs)("small",{children:[e.first_name," ",e.last_name]})}),(0,d.jsx)("td",{children:(0,d.jsx)("small",{children:"Joined the Company"})}),(0,d.jsx)("td",{children:(0,d.jsx)("small",{children:b(e.accepted_at)})})]},t))):(0,d.jsx)("tr",{children:(0,d.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No result found"})})})]})]})]})})]})})})})]})]})})})})}s.t1.register(s.PP,s.kc,s.E8,s.No,s.FN,s.Bs,s.hE,s.m_,s.s$)}}]);
//# sourceMappingURL=4499.80c23518.chunk.js.map