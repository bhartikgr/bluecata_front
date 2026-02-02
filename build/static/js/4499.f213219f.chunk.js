"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[4499],{31738:(e,t,a)=>{a.d(t,{A:()=>r});var n=a(65043),s=a(70579);function r(){const[e,t]=(0,n.useState)(""),[a,r]=(0,n.useState)("");return(0,n.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),a=await e.json();t(a.ip)}catch(e){console.error("Failed to fetch IP",e)}})(),(()=>{const e=(new Date).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});r(e)})()}),[]),(0,s.jsx)(s.Fragment,{children:(0,s.jsxs)("div",{className:"d-flex flex-column gap-1 p-2 ipaddbox",children:[(0,s.jsxs)("h4",{children:["Date: ",(0,s.jsxs)("span",{children:["(",a,")"]})]}),(0,s.jsxs)("h4",{children:["IP Address: ",(0,s.jsx)("span",{children:e})]})]})})}},42552:(e,t,a)=>{a.d(t,{A:()=>b});var n=a(65043),s=(a(38421),a(73216)),r=a(53579),i=a(35475),o=a(50423),l=a(42983),d=a(9463),c=a(86213),p=a(31387),h=a(31738),m=a(47196),x=a(70579);const u=[{label:"Dashboard",href:"/user/dashboard",icon:(0,x.jsx)(m.oeo,{size:18})},{label:"Add New Company",href:"/user/addcompany",icon:(0,x.jsx)(m.S2e,{size:18})},{label:"My Companies",href:"/user/companylist",icon:(0,x.jsx)(m.S2e,{size:18})},{label:"Manage Signatory",icon:(0,x.jsx)(m.dIq,{size:18}),dropdown:[{label:"Add New Signatory",href:"/user/add-new-signatory",icon:(0,x.jsx)(m.dIq,{size:16})},{label:"Signatory List",href:"/user/signatorylist",icon:(0,x.jsx)(m._cd,{size:16})},{label:"Approve Signatories",href:"/user/approval/signature",icon:(0,x.jsx)(m.dIq,{size:16})}]},{label:"Settings",icon:(0,x.jsx)(m.XuQ,{size:18}),dropdown:[{label:"Profile Settings",href:"/user/settings/profile",icon:(0,x.jsx)(m.dIq,{size:16})}]}],g=[{path:"/crm/addnew-investor",menuHref:"/crm/investor-directory"},{path:"/crm/edit-investor/:id",menuHref:"/crm/investor-directory"},{path:"/crm/investor-report-detail-record-round/:id",menuHref:"/crm/investorreport"},{path:"/user/signatory/activity/:id/:signatory_id",menuHref:"/user/signatorylist"},{path:"/crm/investor-report-detail/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-report-detail-due-diligence/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-record-round-reports-confirm/:id",menuHref:"/crm/investorreport"},{path:"/edit-record-round/:id",menuHref:"/record-round-list"},{path:"/createrecord",menuHref:"/record-round-list"}],f=e=>{const t=g.find((t=>(0,p.B6)({path:t.path,end:!0},e)));return t?t.menuHref:e};function b(e){let{isCollapsed:t,setIsCollapsed:a}=e;const[b,j]=(0,n.useState)(""),y=(0,s.Zp)(),[v,w]=(0,n.useState)(null),[k,N]=(0,n.useState)([]),[S,_]=(0,n.useState)(!1);(0,n.useEffect)((()=>{const e=()=>{window.innerWidth<786?(_(!0),I&&I(!0)):(_(!1),I&&I(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[S]);const[A,z]=(0,n.useState)(!1),D="https://capavate.com/api/user/",C=void 0!==t?t:S,I=a||_,E=localStorage.getItem("OwnerLoginData"),O=JSON.parse(E);(0,n.useEffect)((()=>{const e=localStorage.getItem("OwnerLoginData");if(e){const t=JSON.parse(e);j(t);const a=(new Date).getTime();if(!(t.expiry&&a>t.expiry)){const e=t.expiry-a,n=setTimeout((()=>{localStorage.removeItem("OwnerLoginData"),y("/user/login")}),e);return()=>clearTimeout(n)}localStorage.removeItem("OwnerLoginData"),y("/user/login")}else y("/user/login")}),[y]),(0,n.useEffect)((()=>{T()}),[]);const T=async()=>{let e={user_id:O.id};try{0===(await c.A.post(D+"checkUserLogin",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length&&(localStorage.removeItem("OwnerLoginData"),y("/user/login"))}catch(t){console.error("Error fetching modules:",t)}};(0,n.useEffect)((()=>{L();const e=localStorage.getItem("selectedDropdown");e&&w(Number(e));const t=localStorage.getItem("sidebarCollapsed");if(null!==t){const e=JSON.parse(t);a?a(e):_(e)}}),[]);const L=async()=>{let e={id:""};try{const t=await c.A.post(D+"getModules",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});N(t.data.results)}catch(t){console.error("Error fetching modules:",t)}},$=(0,s.zy)(),P=($.pathname,!C||A),M=f($.pathname);return(0,x.jsxs)(x.Fragment,{children:[(0,x.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(C?"collapsed p-3":"p-4"),children:[(0,x.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(C?"justify-content-center":"justify-content-between"),children:[!C&&(0,x.jsx)(i.N_,{to:"/user/dashboard",className:"logo",children:(0,x.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,x.jsx)(r.V4,{className:"d-flex justify-content-end",children:(0,x.jsxs)("button",{type:"button",onClick:()=>{const e=!C;I(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[C&&(0,x.jsx)(l.A,{strokeWidth:2}),!C&&(0,x.jsx)(d.A,{strokeWidth:2})]})})]}),(0,x.jsx)(r.vT,{isOpen:P,children:(0,x.jsx)(r.c0,{children:u.map(((e,t)=>{var a;const n=v===t||e.dropdown&&e.dropdown.some((e=>{const t=f($.pathname);return t===e.href||t.startsWith(e.href)}))||"modules"===e.dynamicDropdownKey&&k.some((e=>{const t="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return $.pathname===t})),s=(null===(a=e.matchPaths)||void 0===a?void 0:a.some((e=>(0,p.B6)({path:e,end:!1},$.pathname))))||$.pathname===e.href||e.dropdown&&e.dropdown.some((e=>(g[$.pathname]||$.pathname)===e.href||(g[$.pathname]||$.pathname).startsWith(e.href)))||"modules"===e.dynamicDropdownKey&&k.some((e=>{const t="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return $.pathname===t}));return(0,x.jsx)(r.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,x.jsxs)(x.Fragment,{children:[(0,x.jsx)(r.C,{title:e.label,onClick:()=>(e=>{const t=v===e?null:e;C&&I(!C);w(t),localStorage.setItem("selectedDropdown",null!==t?t:"")})(t),children:(0,x.jsxs)("div",{className:"d-flex gap-2 align-items-center justify-content-between w-100",children:[(0,x.jsxs)("div",{className:"d-flex gap-2 align-items-start",children:[e.icon,P&&e.label]}),P&&(0,x.jsx)(r.i3,{isOpen:n,children:(0,x.jsx)(o.pte,{})})]})}),n&&(0,x.jsxs)(r.rI,{title:e.label,className:""+(P?"":"p-0"),children:[(0,x.jsx)("hr",{className:"my-2"}),e.dropdown&&e.dropdown.map(((e,t)=>{g[$.pathname]||$.pathname;const a=M===e.href||M.startsWith(e.href);return(0,x.jsx)("li",{className:"list-none",children:(0,x.jsxs)(i.N_,{to:e.href,className:`sidebar d-flex align-items-start gap-2 ${P?"":"w-fit"} ${a?"active":""}`,children:[e.icon,P&&e.label]})},t)})),"modules"===e.dynamicDropdownKey&&(0,x.jsxs)(x.Fragment,{children:[k.map(((e,t)=>{const a="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,n=$.pathname===a;return(0,x.jsx)("li",{className:"list-none",children:(0,x.jsxs)(i.N_,{to:a,title:e.name,className:`sidebar d-flex align-items-start gap-2 ${P?"":"w-fit"} ${n?"active":""}`,children:[(0,x.jsx)(m.MO3,{size:16}),P&&e.name]})},t)})),(0,x.jsx)("li",{className:"list-none",children:(0,x.jsxs)(i.N_,{title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",to:"/advicevideos",className:`sidebar d-flex align-items-start gap-2 ${P?"":"w-fit"} ${"/advicevideos"===$.pathname?"active":""}`,children:[(0,x.jsx)(m.xi0,{size:16}),P&&"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,x.jsxs)(i.N_,{to:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${P?"":"w-fit"} ${s?"active":""}`,children:[e.icon,P&&e.label]})},t)}))})}),(0,x.jsx)(h.A,{})]}),(0,x.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 71px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,t,a)=>{a.d(t,{$K:()=>i,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>m,R3:()=>v,Zw:()=>h,dN:()=>g,hJ:()=>f,jh:()=>d,mO:()=>s,mg:()=>o,nj:()=>j,pd:()=>y,uM:()=>x,vE:()=>r,z6:()=>p});var n=a(5464);const s=n.default.div`
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
`,r=n.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,i=(n.default.div`
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
`,m=(n.default.div`
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
`),x=(n.default.div`
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
`),u=(n.default.div`
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
`),g=((0,n.default)(u)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,n.default)(u)`
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
`},77266:(e,t,a)=>{a.d(t,{A:()=>d});var n=a(65043),s=a(35475),r=a(75200),i=a(45394),o=a(53579),l=(a(86213),a(70579));const d=function(){const[e,t]=(0,n.useState)(!1),[a,d]=(0,n.useState)(""),[c,p]=(0,n.useState)(!1);return(0,l.jsxs)("div",{className:"top_bar",children:[(0,l.jsx)(o.SD,{children:(0,l.jsx)("div",{className:"container-fluid",children:(0,l.jsx)("div",{className:"d-flex gap-4 position-relative",children:(0,l.jsx)(o.FC,{className:"d-flex align-items-center justify-content-end gap-3 w-100",children:(0,l.jsx)(s.N_,{to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("OwnerLoginData"),window.location.href="/user/login"},title:"Logout",className:"logout_btn_global",children:(0,l.jsx)(r.QeK,{})})})})})}),c&&a&&(0,l.jsx)("div",{className:"main_popup-overlay",children:(0,l.jsxs)("div",{className:"popup-container",children:[(0,l.jsxs)("div",{className:"d-flex align-items-center gap-3 mb-3 justify-content-between",children:[(0,l.jsx)("h2",{className:"popup-title",children:"Credit Balance"}),(0,l.jsx)("button",{type:"button",className:"close_btn_global",onClick:()=>{p(!1)},"aria-label":"Close",children:(0,l.jsx)(i.LwM,{size:24})})]}),(0,l.jsxs)("ul",{className:"popup-list",children:[(0,l.jsxs)("li",{children:["Access to Dataroom + Investor reporting for 1 year (till"," ",(0,l.jsx)("strong",{children:(h=a.valid_until,new Date(h).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"}))}),")"]}),(0,l.jsxs)("li",{children:["Due diligence documents generated:"," ",(0,l.jsx)("strong",{children:a.total_generated})," / 1 allowed"]}),(0,l.jsxs)("li",{children:["Credit Balance Left:"," ",(0,l.jsx)("strong",{children:a.credit_balance})]}),a.extra_generations>0&&(0,l.jsx)("li",{className:"warn",children:(0,l.jsxs)("strong",{children:[a.extra_generations," additional generation(s) will incur \u20ac100 each"]})})]})]})})]});var h}},94499:(e,t,a)=>{a.r(t),a.d(t,{default:()=>j});var n=a(65043),s=(a(25015),a(77266)),r=(a(38421),a(62837)),i=a(42552),o=a(14459),l=a(65727),d=a(94651),c=a(35087),p=a(17304),h=a(86213),m=a(26907),x=a(21072),u=a(40876),g=a(85e3),f=a(73216),b=a(70579);function j(){(0,f.Zp)();const e="https://capavate.com/api/user/company/",t="https://capavate.com/api/user/dashboard/",a=localStorage.getItem("OwnerLoginData"),p=JSON.parse(a),[j,y]=(0,n.useState)([]),[v,w]=(0,n.useState)([]),[k,N]=(0,n.useState)([]),[S,_]=(0,n.useState)(""),[A,z]=(0,n.useState)(""),[D,C]=(0,n.useState)(""),[I,E]=(0,n.useState)({}),[O,T]=(0,n.useState)(!1),[L,$]=(0,n.useState)("");(0,n.useEffect)((()=>{document.title="Dashboard Page"}),[]),(0,n.useEffect)((()=>{M()}),[]),(0,n.useEffect)((()=>{P()}),[]);const P=async()=>{const t={user_id:p.id};try{const a=await h.A.post(e+"getUserOwnerDetail",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});a.data.results.length>0&&C(a.data.results[0])}catch(a){console.error("Error generating summary",a)}},M=async()=>{const t={user_id:p.id};try{const a=await h.A.post(e+"getUserCompany",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(a.data.results),a.data.results.length>0&&(_(a.data.results[0].id),z(a.data.results[0].company_name)),y(a.data.results)}catch(a){console.error("Error generating summary",a)}};(0,n.useEffect)((()=>{S&&J()}),[S]);const J=async()=>{const e={company_id:S};try{const t=await h.A.post("https://capavate.com/api/user/accesslogs/getCompanyLogs",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});w(t.data.results)}catch(t){console.error("Error generating summary",t)}};function F(e){const t=new Date(e);if(isNaN(t))return"";const a=t.getDate(),n=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],s=t.getFullYear();let r=t.getHours();const i=t.getMinutes().toString().padStart(2,"0"),o=(t.getSeconds().toString().padStart(2,"0"),r>=12?"PM":"AM");return r%=12,r=r||12,`${n} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${s} ${r}:${i} ${o}`}const[H,R]=(0,n.useState)(!1),[W,q]=(0,n.useState)(!1),[B,K]=(0,n.useState)({email:"",password:""}),[U,V]=(0,n.useState)(null),[G,Z]=(0,n.useState)(""),Q=e=>{const{name:t,value:a}=e.target;K((e=>({...e,[t]:a})))},[Y,X]=(0,n.useState)(!1);return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)(r.mO,{children:(0,b.jsx)("div",{className:"fullpage d-block",children:(0,b.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,b.jsx)(i.A,{isCollapsed:Y,setIsCollapsed:X}),(0,b.jsxs)("div",{className:"global_view "+(Y?"global_view_col":""),children:[(0,b.jsx)(s.A,{}),L&&(0,b.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(O?"error_pop":"success_pop"),children:[(0,b.jsx)("div",{className:"d-flex align-items-center gap-2",children:(0,b.jsx)("span",{className:"d-block",children:L})}),(0,b.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>$(""),children:"\xd7"})]}),(0,b.jsx)(r.$K,{className:"d-block p-md-4 p-3",children:(0,b.jsx)("div",{className:"container-fluid",children:(0,b.jsx)(r.mg,{id:"step5",children:(0,b.jsxs)("div",{className:"row",children:[(0,b.jsxs)("div",{className:"col-md-12",children:[(0,b.jsx)("div",{className:"pb-3 bar_design",children:(0,b.jsxs)("h4",{className:"h5 mb-0",children:["Welcome,"," ",D.first_name||D.last_name?(0,b.jsxs)(b.Fragment,{children:[D.first_name," ",D.last_name]}):(0,b.jsx)("span",{className:"text-muted",children:"Name not available"})]})}),(0,b.jsx)("div",{class:"row gap-0 dashboard-top p-0 border-0 bg-transparent",children:(0,b.jsx)("div",{className:"row gy-3 ",children:null===j||void 0===j?void 0:j.map(((e,a)=>(0,b.jsx)("button",{type:"button",className:"col-md-4 border-0 bg-transparent",children:(0,b.jsxs)("div",{className:"card_deisgn_register",style:{borderColor:e.company_color_code||"#ccc",backgroundColor:`${e.company_color_code}50`||"#ffffff80"},children:[(0,b.jsxs)("h5",{className:"text-center d-flex align-items-center gap-2",style:{backgroundColor:e.company_color_code||"#000",color:"#fff",padding:"10px 20px",borderRadius:"8px",fontSize:"0.9rem"},children:[(0,b.jsx)("input",{className:"checkbox_global",name:"company",checked:e.id===S,onChange:()=>(async(e,t)=>{z(t),_(e)})(e.id,e.company_name),type:"radio"}),(0,b.jsx)("span",{className:"d-block text-start",children:e.company_name})]}),(0,b.jsxs)("p",{onClick:()=>(async e=>{const a={company_id:e,user_id:p.id};try{const e=(await h.A.post(t+"getCompanyAccess",a,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;if($(e.message),"1"===e.status){localStorage.removeItem("SignatoryLoginData");const t={...e.user,access_token:e.token,expiry:(new Date).getTime()+36e5};localStorage.setItem("SignatoryLoginData",JSON.stringify(t)),setTimeout((()=>{window.open("/dashboard","_blank"),R(!1)}),1500)}else T(!0);setTimeout((()=>{T(!1),$("")}),3500),console.log("Response Data:",e)}catch(n){console.error("Login Error:",n),$("Something went wrong. Please try again."),T(!0),setTimeout((()=>{T(!1),$("")}),3500)}})(e.id,e.company_name),className:"py-3 text-center mb-0",style:{fontSize:"0.9rem",fontWeight:"600",position:"relative",cursor:"pointer"},children:["Access this account.",I[e.id]&&(0,b.jsx)("div",{className:"spinner-border spinneronetimepay",role:"status",style:{position:"absolute",top:"60%",left:"42%",width:"1rem",height:"1rem"},children:(0,b.jsx)("span",{className:"visually-hidden"})})]})]})},a)))})})]}),(0,b.jsx)("div",{className:"col-12 my-4",children:(0,b.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,b.jsx)("div",{class:"card-header",children:(0,b.jsx)("h3",{class:"card-title",children:"Recent Activity Investor (Round)"})}),(0,b.jsxs)("div",{class:"access-logs",children:[(0,b.jsxs)("h4",{class:"section-title",children:["Company (",A,")"]}),(0,b.jsxs)("table",{class:"log-table",children:[(0,b.jsx)("thead",{children:(0,b.jsxs)("tr",{children:[(0,b.jsx)("th",{children:"Name"}),(0,b.jsx)("th",{children:"Action"}),(0,b.jsx)("th",{children:"Status"}),(0,b.jsx)("th",{children:"Time"})]})}),(0,b.jsx)("tbody",{children:j.length>0&&k.length>0?k.map(((e,t)=>"active"===e.access_status&&(0,b.jsxs)("tr",{children:[(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:"Test investor"})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:" Seed A"})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:" Download"})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:"September 11th, 2025"})})]}))):(0,b.jsx)("tr",{children:(0,b.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No result found"})})})]})]})]})}),(0,b.jsx)("div",{className:"col-12 my-4",children:(0,b.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,b.jsx)("div",{class:"card-header",children:(0,b.jsx)("h3",{class:"card-title",children:"Recent Activity Signatory"})}),(0,b.jsxs)("div",{class:"access-logs",children:[(0,b.jsxs)("h4",{class:"section-title",children:["Company (",A,")"]}),(0,b.jsxs)("table",{className:"log-table",children:[(0,b.jsx)("thead",{children:(0,b.jsxs)("tr",{children:[(0,b.jsx)("th",{children:"Signatory Name"}),(0,b.jsx)("th",{children:"Module"}),(0,b.jsx)("th",{children:"Action"}),(0,b.jsx)("th",{children:"Entity Name / Details"}),(0,b.jsx)("th",{children:"IP Address"}),(0,b.jsx)("th",{children:"Date"})]})}),(0,b.jsx)("tbody",{children:v.length>0?v.map(((e,t)=>{let a=e.details;if("string"===typeof a)try{a=JSON.parse(a)}catch(n){a={}}return(0,b.jsxs)("tr",{children:[(0,b.jsx)("td",{children:(0,b.jsxs)("small",{children:[e.signatory_first_name," ",e.signatory_last_name]})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:e.module})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:e.action})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:e.entity_type})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:e.ip_address})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:F(e.created_at)})})]},t)})):(0,b.jsx)("tr",{children:(0,b.jsx)("td",{colSpan:"5",style:{textAlign:"center"},children:"No result found"})})})]})]})]})})]})})})})]})]})})}),(0,b.jsxs)(m.A,{open:H,onCancel:()=>R(!1),footer:null,centered:!0,width:400,children:[(0,b.jsxs)("h2",{className:"text-xl font-semibold mb-1",children:["Welcome ",G?`to ${G}`:""]}),(0,b.jsx)("p",{className:"text-gray-500 mb-4",children:"Please enter your login details"}),(0,b.jsxs)(x.A,{layout:"vertical",onFinish:async()=>{const e={...B,company_id:U};try{const a=(await h.A.post(t+"getCompanyAccess",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;if($(a.message),"1"===a.status){localStorage.removeItem("SignatoryLoginData");const e={...a.user,access_token:a.token,expiry:(new Date).getTime()+36e5};localStorage.setItem("SignatoryLoginData",JSON.stringify(e)),setTimeout((()=>{window.open("/dashboard","_blank"),R(!1)}),1500)}else T(!0);setTimeout((()=>{T(!1),$("")}),3500),console.log("Response Data:",a)}catch(a){console.error("Login Error:",a),$("Something went wrong. Please try again."),T(!0),setTimeout((()=>{T(!1),$("")}),3500)}},action:"javascript:void(0)",method:"post",children:[(0,b.jsx)(x.A.Item,{label:"Email",name:"email",rules:[{required:!0,message:"Please enter your email!"}],children:(0,b.jsx)(u.A,{prefix:(0,b.jsx)(o.A,{size:16,style:{marginRight:4}}),type:"email",placeholder:"Enter email",name:"email",value:B.email,onChange:Q})}),(0,b.jsx)(x.A.Item,{label:"Password",name:"password",rules:[{required:!0,message:"Please enter your password!"}],children:(0,b.jsx)(u.A,{prefix:(0,b.jsx)(l.A,{size:16,style:{marginRight:4}}),type:W?"text":"password",placeholder:"Enter password",name:"password",value:B.password,onChange:Q,suffix:(0,b.jsx)("span",{onClick:()=>q(!W),style:{cursor:"pointer",color:"#555"},children:W?(0,b.jsx)(d.A,{size:16}):(0,b.jsx)(c.A,{size:16})})})}),(0,b.jsx)(x.A.Item,{children:(0,b.jsx)(g.Ay,{type:"primary",htmlType:"submit",className:"global_btn px-4 py-2 fn_size_sm active d-flex align-items-center gap-2",block:!0,children:"Login"})})]})]})]})}p.t1.register(p.PP,p.kc,p.E8,p.No,p.FN,p.Bs,p.hE,p.m_,p.s$)}}]);
//# sourceMappingURL=4499.f213219f.chunk.js.map