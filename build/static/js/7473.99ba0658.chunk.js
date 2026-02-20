"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[7473],{25015:()=>{},31738:(e,s,a)=>{a.d(s,{A:()=>l});var t=a(65043),r=a(70579);function l(){const[e,s]=(0,t.useState)(""),[a,l]=(0,t.useState)("");return(0,t.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),a=await e.json();s(a.ip)}catch(e){console.error("Failed to fetch IP",e)}})(),(()=>{const e=(new Date).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});l(e)})()}),[]),(0,r.jsx)(r.Fragment,{children:(0,r.jsxs)("div",{className:"d-flex flex-column gap-1 p-2 ipaddbox",children:[(0,r.jsxs)("h4",{children:["Date: ",(0,r.jsxs)("span",{children:["(",a,")"]})]}),(0,r.jsxs)("h4",{children:["IP Address: ",(0,r.jsx)("span",{children:e})]})]})})}},42552:(e,s,a)=>{a.d(s,{A:()=>v});var t=a(65043),r=(a(38421),a(73216)),l=a(53579),i=a(35475),n=a(50423),o=a(42983),d=a(9463),c=a(86213),m=a(31387),x=a(31738),p=a(47196),h=a(70579);const u=[{label:"Dashboard",href:"/user/dashboard",icon:(0,h.jsx)(p.oeo,{size:18})},{label:"Add New Company",href:"/user/addcompany",icon:(0,h.jsx)(p.S2e,{size:18})},{label:"My Companies",href:"/user/companylist",icon:(0,h.jsx)(p.S2e,{size:18})},{label:"Manage Signatory",icon:(0,h.jsx)(p.dIq,{size:18}),dropdown:[{label:"Add New Signatory",href:"/user/add-new-signatory",icon:(0,h.jsx)(p.dIq,{size:16})},{label:"Signatory List",href:"/user/signatorylist",icon:(0,h.jsx)(p._cd,{size:16})},{label:"Approve Signatories",href:"/user/approval/signature",icon:(0,h.jsx)(p.dIq,{size:16})}]},{label:"Settings",icon:(0,h.jsx)(p.XuQ,{size:18}),dropdown:[{label:"Profile Settings",href:"/user/settings/profile",icon:(0,h.jsx)(p.dIq,{size:16})}]}],b=[{path:"/crm/addnew-investor",menuHref:"/crm/investor-directory"},{path:"/crm/edit-investor/:id",menuHref:"/crm/investor-directory"},{path:"/crm/investor-report-detail-record-round/:id",menuHref:"/crm/investorreport"},{path:"/user/signatory/activity/:id/:signatory_id",menuHref:"/user/signatorylist"},{path:"/crm/investor-report-detail/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-report-detail-due-diligence/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-record-round-reports-confirm/:id",menuHref:"/crm/investorreport"},{path:"/edit-record-round/:id",menuHref:"/record-round-list"},{path:"/createrecord",menuHref:"/record-round-list"}],g=e=>{const s=b.find((s=>(0,m.B6)({path:s.path,end:!0},e)));return s?s.menuHref:e};function v(e){let{isCollapsed:s,setIsCollapsed:a}=e;const[v,f]=(0,t.useState)(""),j=(0,r.Zp)(),[N,y]=(0,t.useState)(null),[w,_]=(0,t.useState)([]),[S,C]=(0,t.useState)(!1);(0,t.useEffect)((()=>{const e=()=>{window.innerWidth<786?(C(!0),z&&z(!0)):(C(!1),z&&z(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[S]);const[k,D]=(0,t.useState)(!1),A="https://capavate.com/api/user/",R=void 0!==s?s:S,z=a||C,I=localStorage.getItem("OwnerLoginData"),L=JSON.parse(I);(0,t.useEffect)((()=>{const e=localStorage.getItem("OwnerLoginData");if(e){const s=JSON.parse(e);f(s);const a=(new Date).getTime();if(!(s.expiry&&a>s.expiry)){const e=s.expiry-a,t=setTimeout((()=>{localStorage.removeItem("OwnerLoginData"),j("/user/login")}),e);return()=>clearTimeout(t)}localStorage.removeItem("OwnerLoginData"),j("/user/login")}else j("/user/login")}),[j]),(0,t.useEffect)((()=>{T()}),[]);const T=async()=>{let e={user_id:L.id};try{0===(await c.A.post(A+"checkUserLogin",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length&&(localStorage.removeItem("OwnerLoginData"),j("/user/login"))}catch(s){console.error("Error fetching modules:",s)}};(0,t.useEffect)((()=>{O();const e=localStorage.getItem("selectedDropdown");e&&y(Number(e));const s=localStorage.getItem("sidebarCollapsed");if(null!==s){const e=JSON.parse(s);a?a(e):C(e)}}),[]);const O=async()=>{let e={id:""};try{const s=await c.A.post(A+"getModules",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});_(s.data.results)}catch(s){console.error("Error fetching modules:",s)}},E=(0,r.zy)(),W=(E.pathname,!R||k),$=g(E.pathname);return(0,h.jsxs)(h.Fragment,{children:[(0,h.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(R?"collapsed p-3":"p-4"),children:[(0,h.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(R?"justify-content-center":"justify-content-between"),children:[!R&&(0,h.jsx)(i.N_,{to:"/user/dashboard",className:"logo",children:(0,h.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,h.jsx)(l.V4,{className:"d-flex justify-content-end",children:(0,h.jsxs)("button",{type:"button",onClick:()=>{const e=!R;z(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[R&&(0,h.jsx)(o.A,{strokeWidth:2}),!R&&(0,h.jsx)(d.A,{strokeWidth:2})]})})]}),(0,h.jsx)(l.vT,{isOpen:W,children:(0,h.jsx)(l.c0,{children:u.map(((e,s)=>{var a;const t=N===s||e.dropdown&&e.dropdown.some((e=>{const s=g(E.pathname);return s===e.href||s.startsWith(e.href)}))||"modules"===e.dynamicDropdownKey&&w.some((e=>{const s="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return E.pathname===s})),r=(null===(a=e.matchPaths)||void 0===a?void 0:a.some((e=>(0,m.B6)({path:e,end:!1},E.pathname))))||E.pathname===e.href||e.dropdown&&e.dropdown.some((e=>(b[E.pathname]||E.pathname)===e.href||(b[E.pathname]||E.pathname).startsWith(e.href)))||"modules"===e.dynamicDropdownKey&&w.some((e=>{const s="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return E.pathname===s}));return(0,h.jsx)(l.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,h.jsxs)(h.Fragment,{children:[(0,h.jsx)(l.C,{title:e.label,onClick:()=>(e=>{const s=N===e?null:e;R&&z(!R);y(s),localStorage.setItem("selectedDropdown",null!==s?s:"")})(s),children:(0,h.jsxs)("div",{className:"d-flex gap-2 align-items-center justify-content-between w-100",children:[(0,h.jsxs)("div",{className:"d-flex gap-2 align-items-start",children:[e.icon,W&&e.label]}),W&&(0,h.jsx)(l.i3,{isOpen:t,children:(0,h.jsx)(n.pte,{})})]})}),t&&(0,h.jsxs)(l.rI,{title:e.label,className:""+(W?"":"p-0"),children:[(0,h.jsx)("hr",{className:"my-2"}),e.dropdown&&e.dropdown.map(((e,s)=>{b[E.pathname]||E.pathname;const a=$===e.href||$.startsWith(e.href);return(0,h.jsx)("li",{className:"list-none",children:(0,h.jsxs)(i.N_,{to:e.href,className:`sidebar d-flex align-items-start gap-2 ${W?"":"w-fit"} ${a?"active":""}`,children:[e.icon,W&&e.label]})},s)})),"modules"===e.dynamicDropdownKey&&(0,h.jsxs)(h.Fragment,{children:[w.map(((e,s)=>{const a="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,t=E.pathname===a;return(0,h.jsx)("li",{className:"list-none",children:(0,h.jsxs)(i.N_,{to:a,title:e.name,className:`sidebar d-flex align-items-start gap-2 ${W?"":"w-fit"} ${t?"active":""}`,children:[(0,h.jsx)(p.MO3,{size:16}),W&&e.name]})},s)})),(0,h.jsx)("li",{className:"list-none",children:(0,h.jsxs)(i.N_,{title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",to:"/advicevideos",className:`sidebar d-flex align-items-start gap-2 ${W?"":"w-fit"} ${"/advicevideos"===E.pathname?"active":""}`,children:[(0,h.jsx)(p.xi0,{size:16}),W&&"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,h.jsxs)(i.N_,{to:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${W?"":"w-fit"} ${r?"active":""}`,children:[e.icon,W&&e.label]})},s)}))})}),(0,h.jsx)(x.A,{})]}),(0,h.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 71px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,s,a)=>{a.d(s,{$K:()=>i,CB:()=>o,Cd:()=>v,I0:()=>c,Jq:()=>p,R3:()=>N,Zw:()=>x,dN:()=>b,hJ:()=>g,jh:()=>d,mO:()=>r,mg:()=>n,nj:()=>f,pd:()=>j,uM:()=>h,vE:()=>l,z6:()=>m});var t=a(5464);const r=t.default.div`
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
`,l=t.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,i=(t.default.div`
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
`,t.default.div`
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
`,t.default.div`
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
`,t.default.div`
  display: block;
  height: 100%;
`),n=t.default.div`
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
`,o=t.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=t.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=t.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,m=t.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,x=t.default.div`
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
`,p=(t.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,t.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,t.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,t.default.div`
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
`),h=(t.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,t.default.div`
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
`),u=(t.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,t.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,t.default.div`
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
`,t.default.button`
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
`,t.default.div`
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
`,t.default.video`
  background-color: black;
  border: none;
`,t.default.div`
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
`,t.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,t.default.button`
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
`),b=((0,t.default)(u)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,t.default)(u)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,t.default.sup`
  color: var(--primary);
`),g=t.default.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: ${e=>{let{show:s}=e;return s?"flex":"none"}};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`,v=t.default.div`
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
`,f=t.default.button`
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
`,j=t.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,N=t.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},77266:(e,s,a)=>{a.d(s,{A:()=>d});var t=a(65043),r=a(35475),l=a(75200),i=a(45394),n=a(53579),o=(a(86213),a(70579));const d=function(){const[e,s]=(0,t.useState)(!1),[a,d]=(0,t.useState)(""),[c,m]=(0,t.useState)(!1);return(0,o.jsxs)("div",{className:"top_bar",children:[(0,o.jsx)(n.SD,{children:(0,o.jsx)("div",{className:"container-fluid",children:(0,o.jsx)("div",{className:"d-flex gap-4 position-relative",children:(0,o.jsx)(n.FC,{className:"d-flex align-items-center justify-content-end gap-3 w-100",children:(0,o.jsx)(r.N_,{to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("OwnerLoginData"),window.location.href="/user/login"},title:"Logout",className:"logout_btn_global",children:(0,o.jsx)(l.QeK,{})})})})})}),c&&a&&(0,o.jsx)("div",{className:"main_popup-overlay",children:(0,o.jsxs)("div",{className:"popup-container",children:[(0,o.jsxs)("div",{className:"d-flex align-items-center gap-3 mb-3 justify-content-between",children:[(0,o.jsx)("h2",{className:"popup-title",children:"Credit Balance"}),(0,o.jsx)("button",{type:"button",className:"close_btn_global",onClick:()=>{m(!1)},"aria-label":"Close",children:(0,o.jsx)(i.LwM,{size:24})})]}),(0,o.jsxs)("ul",{className:"popup-list",children:[(0,o.jsxs)("li",{children:["Access to Dataroom + Investor reporting for 1 year (till"," ",(0,o.jsx)("strong",{children:(x=a.valid_until,new Date(x).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"}))}),")"]}),(0,o.jsxs)("li",{children:["Due diligence documents generated:"," ",(0,o.jsx)("strong",{children:a.total_generated})," / 1 allowed"]}),(0,o.jsxs)("li",{children:["Credit Balance Left:"," ",(0,o.jsx)("strong",{children:a.credit_balance})]}),a.extra_generations>0&&(0,o.jsx)("li",{className:"warn",children:(0,o.jsxs)("strong",{children:[a.extra_generations," additional generation(s) will incur \u20ac100 each"]})})]})]})})]});var x}},77473:(e,s,a)=>{a.r(s),a.d(s,{default:()=>D});var t=a(65043),r=(a(25015),a(77266)),l=(a(38421),a(62837)),i=a(42552),n=a(86213),o=a(25581),d=a(73216),c=a(58786),m=a(23156),x=a(35475),p=a(35659),h=a(60184),u=a(45394),b=a(6720),g=a(70579);const v=e=>{var s,a;let{onClose:t,recordViewData:r}=e;const l=e=>{if(!e)return"N/A";return new Date(e).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})},i=e=>{let{label:s,value:a}=e;return(0,g.jsx)("div",{className:"col-md-6",children:(0,g.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,g.jsxs)("span",{className:"text-secondary small fw-semibold text-uppercase",children:[s,":"]}),(0,g.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:a||(0,g.jsx)("span",{className:"text-muted",children:"Not provided"})})]})})},n=e=>{let{label:s,value:a}=e;return(0,g.jsx)("div",{className:"col-12",children:(0,g.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,g.jsxs)("span",{className:"text-secondary small fw-semibold text-uppercase",children:[s,":"]}),(0,g.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:a||(0,g.jsx)("span",{className:"text-muted",children:"Not provided"})})]})})},o=e=>{let{label:s,value:a,description:t}=e;return(0,g.jsxs)("div",{className:"mb-3",children:[(0,g.jsx)("label",{className:"form-label fw-semibold",children:s}),(0,g.jsx)("p",{className:"mb-1 fw-medium text-dark fs-6",children:a||(0,g.jsx)("span",{className:"text-muted",children:"Not provided"})}),t&&(0,g.jsx)("small",{className:"text-muted d-block",children:t})]})};let d={};try{null!==r&&void 0!==r&&r.instrument_type_data&&(d="string"===typeof r.instrument_type_data?JSON.parse(r.instrument_type_data):r.instrument_type_data)}catch(c){console.error("Error parsing instrument_type_data:",c)}return(0,g.jsx)("div",{className:"main_popup-overlay",children:(0,g.jsxs)("div",{style:{backgroundColor:"white",borderRadius:"12px",width:"95%",maxWidth:"1400px",maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 10px 40px rgba(0, 0, 0, 0.2)",margin:"20px auto"},children:[(0,g.jsx)("div",{className:"p-4 border-bottom bg-light",children:(0,g.jsxs)("div",{className:"d-flex align-items-center",children:[(0,g.jsx)("div",{style:{width:"50px",height:"50px"},className:"bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 rounded-circle me-3",children:(0,g.jsx)(p.xyf,{size:24,className:"text-success"})}),(0,g.jsxs)("div",{className:"d-flex align-items-center justify-content-between gap-3 w-100",children:[(0,g.jsxs)("div",{children:[(0,g.jsx)("h3",{className:"mb-1 fw-bold text-dark",children:(null===r||void 0===r?void 0:r.nameOfRound)||"Round Details"}),(0,g.jsxs)("small",{className:"text-muted",children:["Record ID: #",null===r||void 0===r?void 0:r.id,(0,g.jsx)("br",{}),"Create Date: ",function(e){if(!e)return"N/A";const s=new Date(e);if(isNaN(s))return"N/A";const a=s.getDate(),t=["January","February","March","April","May","June","July","August","September","October","November","December"][s.getMonth()],r=s.getFullYear();return`${t} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${r}`}(r.created_at)]})]}),(0,g.jsx)("button",{type:"button",className:"bg-transparent text-danger border-0 p-0",onClick:t,style:{cursor:"pointer"},children:(0,g.jsx)(u.LwM,{size:28})})]})]})}),(0,g.jsxs)("div",{style:{flex:1,overflowY:"auto",padding:"24px"},children:[(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsxs)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:[(0,g.jsx)(b.Wxz,{className:"me-2"}),"Basic Round Information"]}),(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsx)(i,{label:"Name of Round",value:`${(null===r||void 0===r?void 0:r.nameOfRound)||""} ${(null===r||void 0===r?void 0:r.shareClassType)||""}`}),(0,g.jsx)(i,{label:"Share Class Type",value:null===r||void 0===r?void 0:r.shareClassType}),"OTHER"===(null===r||void 0===r?void 0:r.shareClassType)&&(0,g.jsx)(i,{label:"Custom Share Class Name",value:null===r||void 0===r?void 0:r.shareclassother}),(0,g.jsx)(n,{label:"Description",value:null===r||void 0===r?void 0:r.description}),(0,g.jsx)("div",{className:"col-md-6",children:(0,g.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,g.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Status:"}),(0,g.jsxs)("div",{className:"mt-2 d-flex gap-2",children:[(0,g.jsxs)("span",{className:"badge "+("Yes"===(null===r||void 0===r?void 0:r.is_shared)?"bg-info":"bg-secondary"),children:[(0,g.jsx)(h.Zzu,{className:"me-1",size:12}),"Yes"===(null===r||void 0===r?void 0:r.is_shared)?"Shared":"Not Shared"]}),(0,g.jsxs)("span",{className:"badge "+("Yes"===(null===r||void 0===r?void 0:r.is_locked)?"bg-danger":"bg-success"),children:[(0,g.jsx)(h.JhU,{className:"me-1",size:12}),"Yes"===(null===r||void 0===r?void 0:r.is_locked)?"Locked":"Unlocked"]})]})]})}),(0,g.jsx)(i,{label:"Created At",value:l(null===r||void 0===r?void 0:r.created_at)})]})]}),(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"Investment Instrument"}),(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsx)(i,{label:"Investment Instrument",value:null===r||void 0===r?void 0:r.instrumentType}),"OTHER"===(null===r||void 0===r?void 0:r.instrumentType)&&(0,g.jsx)(i,{label:"Custom Investment Instrument Name",value:null===r||void 0===r?void 0:r.customInstrument})]}),(()=>{var e;if(null===r||void 0===r||!r.instrumentType)return null;let s={};try{r.instrument_type_data&&(s=r.instrument_type_data,"string"===typeof s&&(s=JSON.parse(s)),"string"===typeof s&&(s=JSON.parse(s)))}catch(t){console.error(`Error parsing ${r.instrumentType} data:`,t),s={}}const a=e=>void 0===e||null===e||""===e?"Not provided":Number(e).toLocaleString("en-US");switch(r.instrumentType){case"Common Stock":return(0,g.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,g.jsx)("h5",{className:"fw-bold mb-3",children:"Common Stock Details"}),(0,g.jsx)(o,{label:"Company Valuation",value:a(s.common_stock_valuation)}),(0,g.jsx)(o,{label:"Add Warrants (optional)",value:s.hasWarrants?"Yes":"No"}),s.hasWarrants&&(0,g.jsxs)(g.Fragment,{children:[(0,g.jsx)(o,{label:"Exercise Price (Strike Price)",value:a(s.exercisePrice)}),(0,g.jsx)(o,{label:"Expiration Date",value:s.expirationDate||"Not provided"}),(0,g.jsx)(o,{label:"Warrant Ratio",value:s.warrantRatio||"Not provided"}),(0,g.jsx)(o,{label:"Type of Warrant",value:s.warrantType||"CALL"})]})]});case"Preferred Equity":return(0,g.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,g.jsx)("h5",{className:"fw-bold mb-3",children:"Preferred Equity Details"}),(0,g.jsx)(o,{label:"Company Valuation",value:a(s.preferred_valuation)}),(0,g.jsx)(o,{label:"Add Warrants (optional)",value:s.hasWarrants_preferred?"Yes":"No"}),s.hasWarrants_preferred&&(0,g.jsxs)(g.Fragment,{children:[(0,g.jsx)(o,{label:"Exercise Price (Strike Price)",value:a(s.exercisePrice_preferred)}),(0,g.jsx)(o,{label:"Expiration Date",value:s.expirationDate_preferred||"Not provided"}),(0,g.jsx)(o,{label:"Warrant Ratio",value:s.warrantRatio_preferred||"Not provided"}),(0,g.jsx)(o,{label:"Type of Warrant",value:s.warrantType_preferred||"CALL"})]})]});case"Convertible Note":return(0,g.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,g.jsx)("h5",{className:"fw-bold mb-3",children:"Convertible Note Details"}),(0,g.jsx)(o,{label:"Valuation Cap",value:a(s.valuationCap_note)}),(0,g.jsx)(o,{label:"Discount Rate (%)",value:s.discountRate_note?`${s.discountRate_note}%`:"Not provided"}),(0,g.jsx)(o,{label:"Maturity Date",value:s.maturityDate||"Not provided"}),(0,g.jsx)(o,{label:"Interest Rate (%)",value:s.interestRate_note?`${s.interestRate_note}%`:"Not provided"}),(0,g.jsx)(o,{label:"Convertible Trigger",value:(null===(e=s.convertibleTrigger)||void 0===e?void 0:e.replace(/_/g," & "))||"Not provided"})]});case"Safe":return(0,g.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,g.jsx)("h5",{className:"fw-bold mb-3",children:"SAFE Details"}),(0,g.jsx)(o,{label:"Valuation Cap",value:a(s.valuationCap)}),(0,g.jsx)(o,{label:"Discount Rate (%)",value:s.discountRate?`${s.discountRate}%`:"Not provided"}),(0,g.jsx)(o,{label:"SAFE Type",value:s.safeType?s.safeType.replace(/_/g,"-").toLowerCase().replace(/\b\w/g,(e=>e.toUpperCase())):"Not provided"})]});case"Venture/Bank DEBT":return(0,g.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,g.jsx)("h5",{className:"fw-bold mb-3",children:"Venture/Bank Debt Details"}),(0,g.jsx)(o,{label:"Interest Rate (%)",value:s.interestRate?`${s.interestRate}%`:"Not provided"}),(0,g.jsx)(o,{label:"Repayment Schedule (months)",value:s.repaymentSchedule||"Not provided"}),(0,g.jsx)(o,{label:"Add Warrants (optional)",value:s.hasWarrants_Bank?"Yes":"No"}),s.hasWarrants_Bank&&(0,g.jsxs)(g.Fragment,{children:[(0,g.jsx)(o,{label:"Exercise Price (Strike Price)",value:a(s.exercisePrice_bank)}),(0,g.jsx)(o,{label:"Expiration Date",value:s.exercisedate_bank||"Not provided"}),(0,g.jsx)(o,{label:"Warrant Ratio",value:s.warrantRatio_bank||"Not provided"}),(0,g.jsx)(o,{label:"Type of Warrant",value:s.warrantType_bank||"CALL"})]})]});default:return null}})()]}),(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"Financial Details"}),(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsx)(i,{label:"Amount",value:((e,s)=>{if(!e)return"N/A";return`${"USD"===s?"$":"EUR"===s?"\u20ac":s||""}${parseFloat(e).toLocaleString()}`})(null===r||void 0===r?void 0:r.roundsize,null===r||void 0===r?void 0:r.currency)}),(0,g.jsx)(i,{label:"Currency",value:null===r||void 0===r?void 0:r.currency}),(0,g.jsx)(i,{label:"Total Shares",value:null!==r&&void 0!==r&&r.issuedshares?Number(r.issuedshares).toLocaleString("en-US"):null}),(0,g.jsx)(i,{label:"Is this round closed or active",value:"CLOSED"===(null===r||void 0===r?void 0:r.roundStatus)?"CLOSED":"ACTIVE"}),"CLOSED"===(null===r||void 0===r?void 0:r.roundStatus)&&(0,g.jsx)(i,{label:"Date Round Closed",value:l(null===r||void 0===r?void 0:r.dateroundclosed)})]})]}),(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"Rights & Preferences"}),(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsx)(n,{label:"Rights & Preferences",value:null===r||void 0===r?void 0:r.rights}),(0,g.jsx)(i,{label:"Liquidation Preference Details",value:null===r||void 0===r?void 0:r.liquidationpreferences}),(0,g.jsx)(i,{label:"Liquidation Participating",value:null!==r&&void 0!==r&&r.liquidation?"string"===typeof r.liquidation?r.liquidation:Array.isArray(r.liquidation)?r.liquidation.join(", "):r.liquidation:null}),(null===r||void 0===r?void 0:r.liquidation)&&((null===(s=(a=r.liquidation).includes)||void 0===s?void 0:s.call(a,"OTHER"))||"OTHER"===r.liquidation)&&(0,g.jsx)(i,{label:"Other",value:null===r||void 0===r?void 0:r.liquidationOther}),(0,g.jsx)(i,{label:"Shares are convertible",value:null===r||void 0===r?void 0:r.convertible}),"Yes"===(null===r||void 0===r?void 0:r.convertible)&&(0,g.jsx)(i,{label:"Convertible Type",value:null===r||void 0===r?void 0:r.convertibleType}),(0,g.jsx)(i,{label:"Shareholders Voting Rights",value:null===r||void 0===r?void 0:r.voting})]})]}),((null===r||void 0===r?void 0:r.termsheetFile)&&r.termsheetFile.length>0||(null===r||void 0===r?void 0:r.subscriptiondocument)&&r.subscriptiondocument.length>0)&&(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsxs)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:[(0,g.jsx)(h.t69,{className:"me-2"}),"Documents"]}),(0,g.jsxs)("div",{className:"row g-3",children:[(null===r||void 0===r?void 0:r.termsheetFile)&&r.termsheetFile.length>0&&(0,g.jsx)("div",{className:"col-12",children:(0,g.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,g.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Term Sheet Name(s):"}),(0,g.jsx)("ul",{className:"mb-0 mt-2 ps-3",children:("string"===typeof r.termsheetFile?JSON.parse(r.termsheetFile):r.termsheetFile).map(((e,s)=>(0,g.jsxs)("li",{className:"mb-1 fw-medium text-dark",children:[(0,g.jsx)("i",{className:"bi bi-file-earmark-text me-2 text-primary"}),e.name||e]},s)))})]})}),(null===r||void 0===r?void 0:r.subscriptiondocument)&&r.subscriptiondocument.length>0&&(0,g.jsx)("div",{className:"col-12",children:(0,g.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,g.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Subscription Document:"}),(0,g.jsx)("ul",{className:"mb-0 mt-2 ps-3",children:("string"===typeof r.subscriptiondocument?JSON.parse(r.subscriptiondocument):r.subscriptiondocument).map(((e,s)=>(0,g.jsxs)("li",{className:"mb-1 fw-medium text-dark",children:[(0,g.jsx)("i",{className:"bi bi-file-earmark-text me-2 text-primary"}),e.name||e]},s)))})]})})]})]}),(null===r||void 0===r?void 0:r.generalnotes)&&(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"General Notes"}),(0,g.jsx)("div",{className:"p-3 bg-light rounded-3",style:{whiteSpace:"pre-wrap",lineHeight:"1.8"},children:r.generalnotes})]}),(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"Record Information"}),(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsx)(i,{label:"Created By Role",value:null===r||void 0===r?void 0:r.created_by_role}),(0,g.jsx)(i,{label:"Updated By Role",value:null===r||void 0===r?void 0:r.updated_by_role})]})]})]}),(0,g.jsx)("div",{className:"p-3 border-top bg-light d-flex justify-content-end gap-2",children:(0,g.jsx)("button",{onClick:t,className:"btn btn-secondary px-4",style:{minWidth:"100px"},children:"Close"})})]})})},f=e=>{let{onClose:s,ReportId:a}=e;const r=o.J+"api/user/signatorydashboard/",[l,i]=(0,t.useState)([]),[d,m]=(0,t.useState)(!1);(0,t.useEffect)((()=>{x()}),[]);const x=async()=>{const e={id:a};m(!0);try{const s=await n.A.post(r+"getShareRecordreport",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});i(s.data.results)}catch(s){console.error("Error fetching data",s)}finally{m(!1)}},v=e=>{if(!e)return(0,g.jsx)("span",{className:"text-muted",children:"N/A"});return new Date(e).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"})},f=function(e){var s;const a=(null===(s={access:{"Not View":"bg-secondary","Only View":"bg-warning",Download:"bg-success"},download:{"Not Download":"bg-danger",Download:"bg-success"},signature:{No:"bg-danger",Yes:"bg-success"}}[arguments.length>1&&void 0!==arguments[1]?arguments[1]:"default"])||void 0===s?void 0:s[e])||"bg-secondary";return(0,g.jsx)("span",{className:`badge ${a} text-white px-3 py-2`,children:e})},j=[{name:"Investor Name",selector:e=>`${e.first_name||""} ${e.last_name||""}`.trim()||"N/A",sortable:!0,minWidth:"180px",cell:e=>(0,g.jsxs)("div",{className:"fw-medium",children:[(0,g.jsx)("div",{className:"text-dark",children:`${e.first_name||""} ${e.last_name||""}`.trim()||"N/A"}),(0,g.jsx)("div",{className:"text-muted small",children:e.email||"No email"})]})},{name:"Round Name",selector:e=>e.nameOfRound,sortable:!0,minWidth:"180px",cell:e=>(0,g.jsxs)("div",{className:"fw-medium",children:[(0,g.jsx)("div",{className:"text-dark",children:e.nameOfRound||"N/A"}),e.shareClassType&&(0,g.jsx)("div",{className:"text-muted small",children:e.shareClassType})]})},{name:"Instrument Type",selector:e=>e.instrumentType,sortable:!0,minWidth:"150px",cell:e=>(0,g.jsx)("span",{className:"badge bg-primary text-white px-3 py-2",children:e.instrumentType||"N/A"})},{name:"Round Size",selector:e=>e.roundsize,sortable:!0,minWidth:"150px",cell:e=>(0,g.jsxs)("div",{className:"fw-medium",children:[(0,g.jsx)("div",{className:"text-dark",children:e.roundsize?Number(e.roundsize).toLocaleString("en-US"):"N/A"}),e.currency&&(0,g.jsx)("div",{className:"text-muted small",children:e.currency})]})},{name:"Issued Shares",selector:e=>e.issuedshares,sortable:!0,minWidth:"140px",cell:e=>(0,g.jsx)("div",{className:"fw-medium text-dark",children:e.issuedshares?Number(e.issuedshares).toLocaleString("en-US"):"N/A"})},{name:"Sent Date",selector:e=>e.sent_date,sortable:!0,minWidth:"120px",cell:e=>(0,g.jsxs)("div",{className:"d-flex align-items-center gap-2",children:[(0,g.jsx)(h.itz,{className:"text-primary"}),v(e.sent_date)]})},{name:"Date Viewed",selector:e=>e.date_view,sortable:!0,minWidth:"120px",cell:e=>(0,g.jsxs)("div",{className:"d-flex align-items-center gap-2",children:[(0,g.jsx)(h.Ny1,{className:"text-info"}),v(e.date_view)]})},{name:"Access Status",selector:e=>e.access_status,sortable:!0,minWidth:"140px",cell:e=>f(e.access_status,"access")},{name:"Termsheet",selector:e=>e.termsheet_status,sortable:!0,minWidth:"140px",cell:e=>(0,g.jsx)("div",{className:"d-flex align-items-center gap-2",children:f(e.termsheet_status,"download")})},{name:"Report Status",selector:e=>e.report_status,sortable:!0,minWidth:"150px",cell:e=>(0,g.jsx)("span",{className:"badge bg-info text-white px-3 py-2",children:e.report_status||"N/A"})}];return(0,g.jsx)("div",{className:"main_popup-overlay",children:(0,g.jsxs)("div",{style:{backgroundColor:"white",borderRadius:"12px",width:"98%",maxWidth:"1600px",maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 10px 40px rgba(0, 0, 0, 0.2)",margin:"20px auto"},children:[(0,g.jsx)("div",{className:"px-4 py-3 border-bottom bg-gradient-to-r from-primary to-primary-dark",children:(0,g.jsxs)("div",{className:"d-flex align-items-center justify-content-between",children:[(0,g.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[(0,g.jsx)("div",{style:{width:"48px",height:"48px",backgroundColor:"rgba(255, 255, 255, 0.2)",borderRadius:"12px",display:"flex",alignItems:"center",justifyContent:"center"},children:(0,g.jsx)(p.xyf,{className:"text-white",size:24})}),(0,g.jsxs)("div",{children:[(0,g.jsx)("h3",{className:"mb-0 fw-bold text-white",children:"Share Record Report"}),(0,g.jsx)("p",{className:"mb-0 text-white-50 small mt-1",children:"Investor activity and document tracking"})]})]}),(0,g.jsxs)("button",{onClick:s,className:"btn btn-light btn-sm d-flex align-items-center gap-2",style:{borderRadius:"8px",padding:"8px 16px"},children:[(0,g.jsx)(u.LwM,{size:20}),"Close"]})]})}),(0,g.jsx)("div",{className:"px-4 py-3 bg-light border-bottom",children:(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsx)("div",{className:"col-md-3",children:(0,g.jsx)("div",{className:"card border-0 shadow-sm h-100",children:(0,g.jsx)("div",{className:"card-body",children:(0,g.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[(0,g.jsx)("div",{className:"bg-primary bg-opacity-10 p-3 rounded",children:(0,g.jsx)(h.maD,{className:"text-primary fs-4"})}),(0,g.jsxs)("div",{children:[(0,g.jsx)("div",{className:"text-muted small",children:"Total Records"}),(0,g.jsx)("div",{className:"fs-4 fw-bold",children:l.length})]})]})})})}),(0,g.jsx)("div",{className:"col-md-3",children:(0,g.jsx)("div",{className:"card border-0 shadow-sm h-100",children:(0,g.jsx)("div",{className:"card-body",children:(0,g.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[(0,g.jsx)("div",{className:"bg-info bg-opacity-10 p-3 rounded",children:(0,g.jsx)(h.Ny1,{className:"text-info fs-4"})}),(0,g.jsxs)("div",{children:[(0,g.jsx)("div",{className:"text-muted small",children:"Viewed"}),(0,g.jsx)("div",{className:"fs-4 fw-bold",children:l.filter((e=>null!==e.date_view)).length})]})]})})})}),(0,g.jsx)("div",{className:"col-md-3",children:(0,g.jsx)("div",{className:"card border-0 shadow-sm h-100",children:(0,g.jsx)("div",{className:"card-body",children:(0,g.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[(0,g.jsx)("div",{className:"bg-warning bg-opacity-10 p-3 rounded",children:(0,g.jsx)(h.WCW,{className:"text-warning fs-4"})}),(0,g.jsxs)("div",{children:[(0,g.jsx)("div",{className:"text-muted small",children:"Downloads"}),(0,g.jsx)("div",{className:"fs-4 fw-bold",children:l.filter((e=>"Download"===e.access_status)).length})]})]})})})})]})}),(0,g.jsx)("div",{className:"flex-1 overflow-auto p-4",children:(0,g.jsx)(c.Ay,{columns:j,data:l,pagination:!0,paginationPerPage:10,paginationRowsPerPageOptions:[10,20,30,50],progressPending:d,progressComponent:(0,g.jsx)("div",{className:"text-center py-5",children:(0,g.jsx)("div",{className:"spinner-border text-primary",role:"status",children:(0,g.jsx)("span",{className:"visually-hidden",children:"Loading..."})})}),noDataComponent:(0,g.jsxs)("div",{className:"text-center py-5",children:[(0,g.jsx)(b.Wxz,{className:"text-muted mb-3",size:48}),(0,g.jsx)("p",{className:"text-muted",children:"No records found"})]}),customStyles:{headRow:{style:{backgroundColor:"#f8f9fa",borderBottom:"2px solid #dee2e6",fontSize:"14px",fontWeight:"600",color:"#495057"}},headCells:{style:{paddingLeft:"16px",paddingRight:"16px"}},rows:{style:{fontSize:"14px","&:hover":{backgroundColor:"#f8f9fa",cursor:"pointer"}}},cells:{style:{paddingLeft:"16px",paddingRight:"16px",paddingTop:"12px",paddingBottom:"12px"}}},highlightOnHover:!0,pointerOnHover:!0,responsive:!0,dense:!0})})]})})},j=e=>{let{id:s,signatory_id:a}=e;const r=localStorage.getItem("OwnerLoginData"),l=JSON.parse(r),[i,d]=(0,t.useState)([]),[p,u]=(0,t.useState)(!1),b=o.J+"api/user/signatorydashboard/",[j,N]=(0,t.useState)(""),[y,w]=(0,t.useState)(null),[_,S]=(0,t.useState)(null),[C,k]=(0,t.useState)(!1);(0,t.useEffect)((()=>{D()}),[]);const D=async()=>{const e={signatory_id:a,company_id:s,user_id:l.id};u(!0);try{const s=await n.A.post(b+"getRecordRoundList",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});d(s.data.results)}catch(t){console.error("Error fetching round records",t)}finally{u(!1)}};const A=(e,s)=>{if(!e)return"N/A";return`${"USD"===s?"$":"EUR"===s?"\u20ac":s||""}${parseFloat(e).toLocaleString()}`},R=[{name:"Round Name",selector:e=>e.nameOfRound||"N/A",sortable:!0,width:"180px",cell:e=>(0,g.jsxs)("div",{children:[(0,g.jsx)("div",{className:"fw-semibold",children:e.nameOfRound||"N/A"}),(0,g.jsx)("small",{className:"text-muted",children:e.shareClassType||""})]})},{name:"Round Size",selector:e=>e.roundsize,sortable:!0,width:"140px",cell:e=>(0,g.jsx)("div",{className:"fw-semibold",children:A(e.roundsize,e.currency)})},{name:"Instrument Type",selector:e=>e.instrumentType||"N/A",sortable:!0,width:"150px",cell:e=>(0,g.jsx)("span",{className:"badge bg-info",children:e.instrumentType||e.customInstrument||"N/A"})},{name:"Issued Shares",selector:e=>e.issuedshares||"N/A",sortable:!0,width:"120px",cell:e=>(0,g.jsx)("span",{children:e.issuedshares?parseFloat(e.issuedshares).toLocaleString():"N/A"})},{name:"Date Closed",selector:e=>e.dateroundclosed,sortable:!0,width:"150px",cell:e=>function(e){if(!e)return"N/A";const s=new Date(e);if(isNaN(s))return"N/A";const a=s.getDate(),t=["January","February","March","April","May","June","July","August","September","October","November","December"][s.getMonth()],r=s.getFullYear();return`${t} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${r}`}(e.dateroundclosed)},{name:"Status",selector:e=>e.roundStatus,sortable:!0,width:"130px",center:!0,cell:e=>{const s={Open:"success",Closed:"secondary","In Progress":"warning",Pending:"info"}[e.roundStatus]||"secondary";return(0,g.jsx)("span",{className:`badge bg-${s}`,children:e.roundStatus||"N/A"})}},{name:"Actions",width:"80px",cell:e=>(0,g.jsxs)("div",{className:"position-relative",children:[(0,g.jsx)("button",{className:"btn btn-sm bg-transparent border-0",onClick:()=>(e=>{w(y===e?null:e)})(e.id),children:(0,g.jsx)(m.JTy,{})}),y===e.id&&(0,g.jsxs)("div",{className:"dropdown-menu show",style:{position:"absolute",top:"calc(100% + 4px)",right:0,minWidth:"200px",zIndex:9999,borderRadius:"8px",boxShadow:"0 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)",backgroundColor:"#ffffff",padding:"6px",animation:"fadeInDown 0.2s ease-out"},children:[(0,g.jsxs)(x.N_,{to:"#",className:"dropdown-item",onClick:()=>(S(e),void k(!0)),title:"View Details",style:{display:"flex",alignItems:"center",gap:"12px",padding:"10px 12px",fontSize:"14px",fontWeight:"500",color:"#374151",textDecoration:"none",borderRadius:"6px",transition:"all 0.15s ease",cursor:"pointer"},onMouseEnter:e=>{e.currentTarget.style.backgroundColor="#f3f4f6",e.currentTarget.style.color="#111827"},onMouseLeave:e=>{e.currentTarget.style.backgroundColor="transparent",e.currentTarget.style.color="#374151"},children:[(0,g.jsx)(m.Ny1,{style:{fontSize:"16px",color:"#10b981"}}),(0,g.jsx)("span",{children:"View Details"})]}),(0,g.jsxs)(x.N_,{onClick:()=>W(e.id),to:"javascript:void(0)",className:"dropdown-item",title:"Share Report",style:{display:"flex",alignItems:"center",gap:"12px",padding:"10px 12px",fontSize:"14px",fontWeight:"500",color:"#374151",textDecoration:"none",borderRadius:"6px",transition:"all 0.15s ease",cursor:"pointer"},onMouseEnter:e=>{e.currentTarget.style.backgroundColor="#f3f4f6",e.currentTarget.style.color="#111827"},onMouseLeave:e=>{e.currentTarget.style.backgroundColor="transparent",e.currentTarget.style.color="#374151"},children:[(0,g.jsx)(h.eb3,{style:{fontSize:"16px",color:"#6366f1"}}),(0,g.jsx)("span",{children:"Share Report"})]})]})]}),ignoreRowClick:!0,allowOverflow:!0,button:!0}],z=(null===i||void 0===i?void 0:i.filter((e=>{if(!e)return!1;const s=j.toLowerCase();return(e.nameOfRound||"").toLowerCase().includes(s)||(e.shareClassType||"").toLowerCase().includes(s)||(e.instrumentType||"").toLowerCase().includes(s)||(e.roundStatus||"").toLowerCase().includes(s)||(e.roundsize||"").toString().toLowerCase().includes(s)})))||[],[I,L]=(0,t.useState)(""),[T,O]=(0,t.useState)(!1),E=()=>{k(!1),O(!1),S(null)},W=e=>{L(e),O(!0)};return(0,g.jsxs)(g.Fragment,{children:[(0,g.jsx)("div",{className:"d-flex flex-column overflow-auto justify-content-between align-items-start tb-box",children:p?(0,g.jsxs)("div",{className:"text-center w-100 py-5",children:[(0,g.jsx)("div",{className:"spinner-border text-primary",role:"status",children:(0,g.jsx)("span",{className:"visually-hidden",children:"Loading..."})}),(0,g.jsx)("p",{className:"mt-3 text-muted",children:"Loading round records..."})]}):(0,g.jsx)(c.Ay,{customStyles:{table:{style:{overflow:"visible !important",minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},conditionalRowStyles:[{when:e=>!0,style:{"&:hover":{backgroundColor:"#e8f0fe"}}}],columns:R,className:"datatb-report",data:z,pagination:!0,paginationPerPage:10,paginationRowsPerPageOptions:[5,10,25,50,100],highlightOnHover:!0,striped:!0,responsive:!0,noDataComponent:(0,g.jsxs)("div",{className:"text-center py-5",children:[(0,g.jsx)("h5",{className:"text-muted",children:"No Round Records Found"}),(0,g.jsx)("p",{className:"text-muted",children:j?"No records match your search criteria.":"There are no round records available."})]})})}),C&&(0,g.jsx)(v,{recordViewData:_,onClose:E}),T&&(0,g.jsx)(f,{ReportId:I,onClose:E})]})},N=e=>{let{onClose:s,recordViewData:a}=e;const t=e=>{if(!e)return"N/A";return new Date(e).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"})};return(0,g.jsx)("div",{className:"main_popup-overlay",children:(0,g.jsxs)("div",{style:{backgroundColor:"white",borderRadius:"12px",width:"95%",maxWidth:"1200px",maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 10px 40px rgba(0, 0, 0, 0.2)",margin:"20px auto"},children:[(0,g.jsx)("div",{className:"p-4 border-bottom bg-light",children:(0,g.jsxs)("div",{className:"d-flex align-items-center",children:[(0,g.jsx)("div",{style:{width:"50px",height:"50px"},className:"bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 rounded-circle me-3",children:(0,g.jsx)(p.xyf,{size:24,className:"text-success"})}),(0,g.jsxs)("div",{className:"d-flex align-items-center justify-content-between gap-3 w-100",children:[(0,g.jsxs)("div",{children:[(0,g.jsx)("h3",{className:"mb-1 fw-bold text-dark",children:(null===a||void 0===a?void 0:a.document_name)||"Investor Report"}),(0,g.jsxs)("small",{className:"text-muted",children:["Document ID: #",null===a||void 0===a?void 0:a.id,(0,g.jsx)("br",{}),"Create Date: ",function(e){if(!e)return"N/A";const s=new Date(e);if(isNaN(s))return"N/A";const a=s.getDate(),t=["January","February","March","April","May","June","July","August","September","October","November","December"][s.getMonth()],r=s.getFullYear();return`${t} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${r}`}(a.created_at)]})]}),(0,g.jsx)("button",{type:"button",className:"bg-transparent text-danger border-0 p-0",onClick:s,style:{cursor:"pointer"},children:(0,g.jsx)(u.LwM,{size:28})})]})]})}),(0,g.jsxs)("div",{style:{flex:1,overflowY:"auto",padding:"24px"},children:[(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsxs)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:[(0,g.jsx)(b.Wxz,{className:"me-2"}),"Basic Information"]}),(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsx)("div",{className:"col-md-6",children:(0,g.jsxs)("div",{className:"mb-3",children:[(0,g.jsx)("label",{className:"text-muted small mb-1",children:"Document Type"}),(0,g.jsx)("div",{className:"fw-semibold",children:(null===a||void 0===a?void 0:a.type)||"N/A"})]})}),(0,g.jsx)("div",{className:"col-md-6",children:(0,g.jsxs)("div",{className:"mb-3",children:[(0,g.jsx)("label",{className:"text-muted small mb-1",children:"Version"}),(0,g.jsx)("div",{className:"fw-semibold",children:(null===a||void 0===a?void 0:a.version)||"N/A"})]})}),(0,g.jsx)("div",{className:"col-md-6",children:(0,g.jsxs)("div",{className:"mb-3",children:[(0,g.jsx)("label",{className:"text-muted small mb-1",children:"Company ID"}),(0,g.jsx)("div",{className:"fw-semibold",children:(null===a||void 0===a?void 0:a.company_id)||"N/A"})]})}),(0,g.jsx)("div",{className:"col-md-6",children:(0,g.jsxs)("div",{className:"mb-3",children:[(0,g.jsx)("label",{className:"text-muted small mb-1",children:"Created By"}),(0,g.jsxs)("div",{className:"fw-semibold",children:["ID: ",(null===a||void 0===a?void 0:a.created_by_id)||"N/A",(0,g.jsx)("span",{className:"ms-2 badge bg-info",children:(null===a||void 0===a?void 0:a.created_by_role)||"N/A"})]})]})}),(0,g.jsx)("div",{className:"col-md-6",children:(0,g.jsxs)("div",{className:"mb-3",children:[(0,g.jsx)("label",{className:"text-muted small mb-1",children:"Update Date"}),(0,g.jsx)("div",{className:"fw-semibold",children:t(null===a||void 0===a?void 0:a.update_date)})]})}),(0,g.jsx)("div",{className:"col-md-6",children:(0,g.jsxs)("div",{className:"mb-3",children:[(0,g.jsx)("label",{className:"text-muted small mb-1",children:"Status"}),(0,g.jsxs)("div",{children:[(0,g.jsxs)("span",{className:"badge me-2 "+(null!==a&&void 0!==a&&a.is_locked?"bg-danger":"bg-success"),children:[(0,g.jsx)(h.JhU,{className:"me-1",size:12}),null!==a&&void 0!==a&&a.is_locked?"Locked":"Unlocked"]}),(0,g.jsxs)("span",{className:"badge "+("Yes"===(null===a||void 0===a?void 0:a.is_shared)?"bg-info":"bg-secondary"),children:[(0,g.jsx)(h.Zzu,{className:"me-1",size:12}),"Yes"===(null===a||void 0===a?void 0:a.is_shared)?"Shared":"Not Shared"]})]})]})}),(0,g.jsx)("div",{className:"col-md-6",children:(0,g.jsxs)("div",{className:"mb-3",children:[(0,g.jsx)("label",{className:"text-muted small mb-1",children:"Created At"}),(0,g.jsx)("div",{className:"fw-semibold",children:t(null===a||void 0===a?void 0:a.created_at)})]})}),(0,g.jsx)("div",{className:"col-md-6",children:(0,g.jsxs)("div",{className:"mb-3",children:[(0,g.jsx)("label",{className:"text-muted small mb-1",children:"Updated At"}),(0,g.jsx)("div",{className:"fw-semibold",children:t(null===a||void 0===a?void 0:a.updated_at)})]})})]})]}),(null===a||void 0===a?void 0:a.executive_summary)&&(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"Executive Summary"}),(0,g.jsx)("div",{className:"p-3 bg-light border rounded-3",style:{whiteSpace:"pre-wrap",lineHeight:"1.8"},children:a.executive_summary})]}),"Investor updates"===a.type&&(0,g.jsxs)(g.Fragment,{children:[(null===a||void 0===a?void 0:a.financial_performance)&&(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"\ud83d\udcb0 Financial Performance"}),(0,g.jsx)("div",{className:"p-3 bg-light border rounded-3",style:{whiteSpace:"pre-wrap",lineHeight:"1.8"},children:a.financial_performance})]}),(null===a||void 0===a?void 0:a.operational_updates)&&(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"\u2699\ufe0f Operational Updates"}),(0,g.jsx)("div",{className:"p-3 bg-light border rounded-3",style:{whiteSpace:"pre-wrap",lineHeight:"1.8"},children:a.operational_updates})]}),(null===a||void 0===a?void 0:a.market_competitive)&&(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"\ud83d\udcca Market & Competitive Analysis"}),(0,g.jsx)("div",{className:"p-3 bg-light border rounded-3",style:{whiteSpace:"pre-wrap",lineHeight:"1.8"},children:a.market_competitive})]}),(null===a||void 0===a?void 0:a.customer_product)&&(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"\ud83d\udc65 Customer & Product Updates"}),(0,g.jsx)("div",{className:"p-3 bg-light border rounded-3",style:{whiteSpace:"pre-wrap",lineHeight:"1.8"},children:a.customer_product})]}),(null===a||void 0===a?void 0:a.fundraising_financial)&&(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"\ud83d\udcb5 Fundraising & Financial Status"}),(0,g.jsx)("div",{className:"p-3 bg-light border rounded-3",style:{whiteSpace:"pre-wrap",lineHeight:"1.8"},children:a.fundraising_financial})]}),(null===a||void 0===a?void 0:a.future_outlook)&&(0,g.jsxs)("div",{className:"mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,g.jsx)("h5",{className:"mb-3 pb-2 border-bottom fw-bold text-dark",children:"\ud83d\udd2e Future Outlook"}),(0,g.jsx)("div",{className:"p-3 bg-light border rounded-3",style:{whiteSpace:"pre-wrap",lineHeight:"1.8"},children:a.future_outlook})]})]})]}),(0,g.jsxs)("div",{className:"p-3 border-top bg-light d-flex justify-content-end gap-2",children:[(0,g.jsx)("button",{onClick:s,className:"btn btn-secondary px-4",style:{minWidth:"100px"},children:"Close"}),(null===a||void 0===a?void 0:a.downloadUrl)&&(0,g.jsxs)("button",{onClick:()=>(e=>{if(!e)return void console.error("No download URL provided");const s=document.createElement("a");s.href=e,s.download="",s.target="_blank",document.body.appendChild(s),s.click(),document.body.removeChild(s)})(a.downloadUrl),className:"btn btn-primary px-4 d-flex align-items-center gap-2",children:[(0,g.jsx)(h.WCW,{size:14}),"Download"]})]})]})})},y=e=>{let{onClose:s,ReportId:a}=e;const[r,l]=(0,t.useState)([]),[i,d]=(0,t.useState)(!1),[m,x]=(0,t.useState)(""),v=o.J+"api/user/signatorydashboard/";(0,t.useEffect)((()=>{f()}),[]);const f=async()=>{const e={id:a};d(!0);try{const s=await n.A.post(v+"getShareInvestorreport",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});l(s.data.results)}catch(s){console.error("Error fetching data",s)}finally{d(!1)}},j=e=>{if(!e)return"N/A";return new Date(e).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"})},N=e=>{if(!e)return"N/A";return new Date(e).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})},y=[{name:"#",selector:(e,s)=>s+1,sortable:!1,width:"60px",center:!0},{name:"Investor Name",selector:e=>`${e.first_name||""} ${e.last_name||""}`,sortable:!0,width:"180px",cell:e=>(0,g.jsxs)("div",{className:"d-flex align-items-center py-2",children:[(0,g.jsx)("div",{className:"bg-primary bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center me-2",style:{width:"32px",height:"32px",flexShrink:0},children:(0,g.jsx)(h.Ny1,{className:"text-primary",size:14})}),(0,g.jsxs)("div",{children:[(0,g.jsxs)("div",{className:"fw-semibold",children:[e.first_name||""," ",e.last_name||""]}),(0,g.jsxs)("small",{className:"text-muted",children:["ID: ",e.investor_id]})]})]})},{name:"Email",selector:e=>e.email||e.investor_email||"N/A",sortable:!0,width:"220px",cell:e=>(0,g.jsxs)("div",{className:"d-flex align-items-center",children:[(0,g.jsx)(h.maD,{className:"me-2 text-muted",size:14}),(0,g.jsx)("small",{children:e.email||e.investor_email||"N/A"})]})},{name:"Document",selector:e=>e.document_name||"N/A",sortable:!0,width:"200px",cell:e=>(0,g.jsx)("div",{className:"fw-semibold",children:e.document_name||"N/A"})},{name:"Version",selector:e=>e.version||"N/A",sortable:!0,width:"100px",center:!0,cell:e=>(0,g.jsx)("span",{className:"badge bg-secondary",children:e.version||"N/A"})},{name:"Report Type",selector:e=>e.report_type||"N/A",sortable:!0,width:"150px"},{name:"Sent Date",selector:e=>e.sent_date,sortable:!0,width:"140px",cell:e=>(0,g.jsxs)("div",{className:"d-flex align-items-center",children:[(0,g.jsx)(h.itz,{className:"me-2 text-muted",size:12}),(0,g.jsx)("small",{children:j(e.sent_date)})]})},{name:"Date Viewed",selector:e=>e.date_view,sortable:!0,width:"160px",cell:e=>e.date_view?(0,g.jsx)("small",{children:N(e.date_view)}):(0,g.jsx)("span",{className:"text-muted",children:"Not viewed"})},{name:"Status",selector:e=>e.access_status,sortable:!0,width:"130px",center:!0,cell:e=>{return s=e.access_status,{"Not View":(0,g.jsx)("span",{className:"badge bg-secondary",children:"Not Viewed"}),"Only View":(0,g.jsx)("span",{className:"badge bg-info",children:"Viewed"}),Download:(0,g.jsx)("span",{className:"badge bg-success",children:"Downloaded"})}[s]||(0,g.jsx)("span",{className:"badge bg-secondary",children:s});var s}},{name:"IP Address",selector:e=>e.investor_ip||"N/A",sortable:!0,width:"150px",cell:e=>(0,g.jsx)("small",{className:"font-monospace",children:e.investor_ip||"N/A"})}],w=r.filter((e=>{var s,a,t,r,l,i,n;const o=m.toLowerCase();return(null===(s=e.first_name)||void 0===s?void 0:s.toLowerCase().includes(o))||(null===(a=e.last_name)||void 0===a?void 0:a.toLowerCase().includes(o))||(null===(t=e.email)||void 0===t?void 0:t.toLowerCase().includes(o))||(null===(r=e.investor_email)||void 0===r?void 0:r.toLowerCase().includes(o))||(null===(l=e.document_name)||void 0===l?void 0:l.toLowerCase().includes(o))||(null===(i=e.unique_code)||void 0===i?void 0:i.toLowerCase().includes(o))||(null===(n=e.report_type)||void 0===n?void 0:n.toLowerCase().includes(o))||!1})),_=(0,g.jsxs)("div",{className:"w-100 d-flex justify-content-between align-items-center mb-3",children:[(0,g.jsx)("div",{children:(0,g.jsxs)("h5",{className:"mb-0",children:["Total Records: ",w.length]})}),(0,g.jsx)("div",{style:{width:"300px"},children:(0,g.jsx)("input",{type:"text",className:"form-control",placeholder:"Search records...",value:m,onChange:e=>x(e.target.value)})})]});return(0,g.jsx)("div",{className:"main_popup-overlay",children:(0,g.jsxs)("div",{style:{backgroundColor:"white",borderRadius:"12px",width:"95%",maxWidth:"1600px",maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 10px 40px rgba(0, 0, 0, 0.2)",margin:"20px auto"},children:[(0,g.jsx)("div",{className:"p-4 border-bottom bg-light",children:(0,g.jsxs)("div",{className:"d-flex align-items-center",children:[(0,g.jsx)("div",{style:{width:"50px",height:"50px"},className:"bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 rounded-circle me-3",children:(0,g.jsx)(p.xyf,{size:24,className:"text-success"})}),(0,g.jsxs)("div",{className:"d-flex align-items-center justify-content-between gap-3 w-100",children:[(0,g.jsxs)("div",{children:[(0,g.jsx)("h3",{className:"mb-1 fw-bold text-dark",children:"Shared Investor Reports"}),(0,g.jsx)("small",{className:"text-muted",children:"View all shared reports"})]}),(0,g.jsx)("button",{type:"button",className:"bg-transparent text-danger border-0 p-0",onClick:s,style:{cursor:"pointer"},children:(0,g.jsx)(u.LwM,{size:28})})]})]})}),(0,g.jsx)("div",{style:{flex:1,overflowY:"auto",padding:"24px"},children:i?(0,g.jsxs)("div",{className:"text-center py-5",children:[(0,g.jsx)("div",{className:"spinner-border text-primary",role:"status",children:(0,g.jsx)("span",{className:"visually-hidden",children:"Loading..."})}),(0,g.jsx)("p",{className:"mt-3 text-muted",children:"Loading records..."})]}):r.length>0?(0,g.jsx)(c.Ay,{columns:y,data:w,pagination:!0,paginationPerPage:10,paginationRowsPerPageOptions:[5,10,25,50,100],highlightOnHover:!0,striped:!0,responsive:!0,customStyles:{headRow:{style:{backgroundColor:"#f8f9fa",borderBottom:"2px solid #dee2e6",fontWeight:"600"}},headCells:{style:{fontSize:"14px",fontWeight:"600",color:"#495057",paddingLeft:"12px",paddingRight:"12px"}},rows:{style:{fontSize:"13px","&:hover":{backgroundColor:"#f8f9fa",cursor:"pointer"}}},cells:{style:{paddingLeft:"12px",paddingRight:"12px"}}},subHeader:!0,subHeaderComponent:_,noDataComponent:(0,g.jsxs)("div",{className:"text-center py-5",children:[(0,g.jsx)(b.Wxz,{size:40,className:"text-muted mb-3"}),(0,g.jsx)("h5",{className:"text-muted",children:"No Records Found"}),(0,g.jsx)("p",{className:"text-muted",children:"No records match your search criteria."})]})}):(0,g.jsxs)("div",{className:"text-center py-5",children:[(0,g.jsx)("div",{className:"bg-light rounded-circle d-inline-flex align-items-center justify-content-center mb-3",style:{width:"80px",height:"80px"},children:(0,g.jsx)(b.Wxz,{size:40,className:"text-muted"})}),(0,g.jsx)("h5",{className:"text-muted",children:"No Records Found"}),(0,g.jsx)("p",{className:"text-muted",children:"There are no shared reports for this investor update."})]})}),(0,g.jsx)("div",{className:"p-3 border-top bg-light d-flex justify-content-end gap-2",children:(0,g.jsx)("button",{onClick:s,className:"btn btn-secondary px-4",style:{minWidth:"100px"},children:"Close"})})]})})},w=e=>{let{id:s,signatory_id:a,type:r,visibleFields:l=[],data:i=[]}=e;const d=localStorage.getItem("OwnerLoginData"),p=JSON.parse(d),[u,b]=(0,t.useState)([]),v=o.J+"api/user/signatorydashboard/";(0,t.useEffect)((()=>{f()}),[]);const f=async()=>{const e={signatory_id:a,company_id:s,user_id:p.id,type:r};try{const s=await n.A.post(v+"getInvestorreportList",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(s.data.results),b(s.data.results)}catch(t){console.error("Error generating summary",t)}},[j,w]=(0,t.useState)(""),[_,S]=(0,t.useState)(null),C=[{name:"Name of Report",selector:e=>e.document_name,sortable:!0},{name:"Date of Report",selector:e=>function(e){const s=new Date(e);if(isNaN(s))return"";const a=["January","February","March","April","May","June","July","August","September","October","November","December"],t=s.getDate(),r=a[s.getMonth()],l=s.getFullYear();return`${r} ${t}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(t)}, ${l}`}(e.created_at),sortable:!0},{name:"Version",selector:e=>e.version,sortable:!0},{name:"Actions",cell:e=>(0,g.jsxs)("div",{className:"position-relative",children:[(0,g.jsx)("button",{className:"block bg-transprent border-0",onClick:()=>(e=>{S(_===e?null:e)})(e.id),children:(0,g.jsx)(m.JTy,{})}),_===e.id&&(0,g.jsxs)("div",{className:"dropdown-menu show",style:{position:"absolute",top:"calc(100% + 4px)",right:0,minWidth:"200px",zIndex:9999,borderRadius:"8px",boxShadow:"0 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)",backgroundColor:"#ffffff",padding:"6px",animation:"fadeInDown 0.2s ease-out"},children:[(0,g.jsxs)(x.N_,{to:"javascript:void(0)",className:"dropdown-item",onClick:()=>L(e),title:"View Details",style:{display:"flex",alignItems:"center",gap:"12px",padding:"10px 12px",fontSize:"14px",fontWeight:"500",color:"#374151",textDecoration:"none",borderRadius:"6px",transition:"all 0.15s ease",cursor:"pointer"},onMouseEnter:e=>{e.currentTarget.style.backgroundColor="#f3f4f6",e.currentTarget.style.color="#111827"},onMouseLeave:e=>{e.currentTarget.style.backgroundColor="transparent",e.currentTarget.style.color="#374151"},children:[(0,g.jsx)(h.Ny1,{style:{fontSize:"16px",color:"#10b981"}}),(0,g.jsx)("span",{children:"View Details"})]}),(0,g.jsxs)(x.N_,{onClick:()=>E(e.id),to:"javascript:void(0)",className:"dropdown-item",title:"Share Report",style:{display:"flex",alignItems:"center",gap:"12px",padding:"10px 12px",fontSize:"14px",fontWeight:"500",color:"#374151",textDecoration:"none",borderRadius:"6px",transition:"all 0.15s ease",cursor:"pointer"},onMouseEnter:e=>{e.currentTarget.style.backgroundColor="#f3f4f6",e.currentTarget.style.color="#111827"},onMouseLeave:e=>{e.currentTarget.style.backgroundColor="transparent",e.currentTarget.style.color="#374151"},children:[(0,g.jsx)(h.eb3,{style:{fontSize:"16px",color:"#6366f1"}}),(0,g.jsx)("span",{children:"Share Report"})]})]})]}),ignoreRowClick:!0,allowOverflow:!0,button:!0}],[k,D]=(0,t.useState)(null),[A,R]=(0,t.useState)(!1),[z,I]=(0,t.useState)(""),L=e=>{D(e),R(!0)},T=()=>{$(!1),R(!1),D(null)};const O=(null===u||void 0===u?void 0:u.filter((e=>{if(!e)return!1;const s=`${e.company_name||""} - ${e.update_date||""} - ${e.version||""}`,a=j.toLowerCase();return s.toLowerCase().includes(a)||(e.update_date||"").toLowerCase().includes(a)||(e.download||"").toLowerCase().includes(a)})))||[],E=e=>{I(e),$(!0)},[W,$]=(0,t.useState)(!1);return(0,g.jsxs)("div",{className:"d-flex flex-column overflow-auto justify-content-between align-items-start tb-box",children:[(0,g.jsx)(c.Ay,{customStyles:{table:{style:{overflow:"visible !important",minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},conditionalRowStyles:[{when:e=>!0,style:{"&:hover":{backgroundColor:"var(--lightRed)"}}}],columns:C,className:"datatb-report",data:O,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0}),A&&(0,g.jsx)(N,{recordViewData:k,onClose:T}),W&&(0,g.jsx)(y,{ReportId:z,onClose:T})]})},_=e=>{let{id:s,signatory_id:a,visibleFields:r=[],data:l=[]}=e;const i=localStorage.getItem("OwnerLoginData"),d=JSON.parse(i),[m,x]=(0,t.useState)([]),p=o.J+"api/user/signatorydashboard/";(0,t.useEffect)((()=>{h()}),[]);const h=async()=>{const e={signatory_id:a,company_id:s,user_id:d.id};try{const s=await n.A.post(p+"getSignatoryActivity",e,{headers:{Accept:"application/json","Content-Type":"application/json"}}),a=await n.A.post(p+"getCompanyRoundAccessLogs",e,{headers:{Accept:"application/json","Content-Type":"application/json"}}),t=[...s.data.results.map((e=>({...e,source:"Audit Logs"}))),...a.data.results.map((e=>({...e,source:"Round Logs",module:e.module||"Round Record",action:e.action||"Accessed Round",entity_type:e.entity_type||"Round Access"})))];t.sort(((e,s)=>new Date(s.created_at).getTime()-new Date(e.created_at).getTime())),console.log(t),x(t)}catch(t){console.error("Error fetching activity logs",t)}},[u,b]=(0,t.useState)(""),[v,f]=(0,t.useState)(null),j=[{name:"Action",selector:e=>e.action,sortable:!0},{name:"Module",selector:e=>e.module,sortable:!0},{name:"Ip Address",selector:e=>e.ip_address,sortable:!0},{name:"Date",selector:e=>function(e){const s=new Date(e);if(isNaN(s))return"";const a=["January","February","March","April","May","June","July","August","September","October","November","December"],t=s.getDate(),r=a[s.getMonth()],l=s.getFullYear();return`${r} ${t}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(t)}, ${l}`}(e.created_at),sortable:!0}];const N=(null===m||void 0===m?void 0:m.filter((e=>{if(!e)return!1;const s=`${e.company_name||""} - ${e.update_date||""} - ${e.version||""}`,a=u.toLowerCase();return s.toLowerCase().includes(a)||(e.update_date||"").toLowerCase().includes(a)||(e.download||"").toLowerCase().includes(a)})))||[],[y,w]=(0,t.useState)(!1);return(0,g.jsx)("div",{className:"d-flex flex-column overflow-auto justify-content-between align-items-start tb-box",children:(0,g.jsx)(c.Ay,{customStyles:{table:{style:{overflow:"visible !important",minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},conditionalRowStyles:[{when:e=>!0,style:{"&:hover":{backgroundColor:"var(--lightRed)"}}}],columns:j,className:"datatb-report",data:N,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0})})},S=e=>{let{onClose:s,signatory_id:a,id:r}=e;const l=o.J+"api/user/signatorydashboard/",[i,d]=(0,t.useState)(null),[c,m]=(0,t.useState)(!1);(0,t.useEffect)((()=>{x()}),[]);const x=async()=>{const e={id:a,company_id:r};m(!0);try{const s=await n.A.post(l+"getSigantoryInformation",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(s.data.results),d(s.data.results)}catch(s){console.error("Error fetching data",s)}finally{m(!1)}},p=e=>{if(!e)return(0,g.jsx)("span",{className:"text-muted",children:"N/A"});const s=new Date(e);return(0,g.jsxs)("div",{children:[(0,g.jsx)("div",{children:s.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"})}),(0,g.jsx)("div",{className:"text-muted small",children:s.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})})]})},v=e=>{let{icon:s,label:a,value:t,iconColor:r="text-primary"}=e;return(0,g.jsx)("div",{className:"col-md-6",children:(0,g.jsx)("div",{className:"card border-0 shadow-sm h-100 hover-shadow",children:(0,g.jsx)("div",{className:"card-body p-3",children:(0,g.jsxs)("div",{className:"d-flex align-items-start gap-3",children:[(0,g.jsx)("div",{className:`bg-light p-2 rounded ${r}`,children:(0,g.jsx)(s,{size:20})}),(0,g.jsxs)("div",{className:"flex-grow-1",children:[(0,g.jsx)("div",{className:"text-muted small mb-1",children:a}),(0,g.jsx)("div",{className:"fw-semibold text-dark",children:t||(0,g.jsx)("span",{className:"text-muted fst-italic",children:"Not provided"})})]})]})})})})},f=e=>{let{status:s}=e;const a="pending"===s;return(0,g.jsx)("span",{className:`badge ${a?"bg-warning":"bg-success"} text-white px-3 py-2 fs-6`,children:a?(0,g.jsxs)(g.Fragment,{children:[(0,g.jsx)(h.w_X,{className:"me-2"}),"Pending"]}):(0,g.jsxs)(g.Fragment,{children:[(0,g.jsx)(h.A7C,{className:"me-2"}),"Active"]})})};return c?(0,g.jsx)("div",{className:"main_popup-overlay",children:(0,g.jsx)("div",{className:"d-flex justify-content-center align-items-center",style:{height:"100vh"},children:(0,g.jsxs)("div",{className:"text-center",children:[(0,g.jsx)("div",{className:"spinner-border text-primary",role:"status",style:{width:"3rem",height:"3rem"},children:(0,g.jsx)("span",{className:"visually-hidden",children:"Loading..."})}),(0,g.jsx)("p",{className:"mt-3 text-muted",children:"Loading signatory information..."})]})})}):i?(0,g.jsxs)("div",{className:"main_popup-overlay",children:[(0,g.jsxs)("div",{style:{backgroundColor:"white",borderRadius:"12px",width:"98%",maxWidth:"1200px",maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 10px 40px rgba(0, 0, 0, 0.2)",margin:"20px auto"},children:[(0,g.jsx)("div",{className:"px-4 py-4 border-bottom",style:{background:"linear-gradient(135deg, #667eea 0%, #764ba2 100%)"},children:(0,g.jsxs)("div",{className:"d-flex align-items-center justify-content-between",children:[(0,g.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[(0,g.jsx)("div",{style:{width:"56px",height:"56px",backgroundColor:"rgba(255, 255, 255, 0.2)",borderRadius:"12px",display:"flex",alignItems:"center",justifyContent:"center"},children:(0,g.jsx)(h.e7y,{className:"text-white",size:28})}),(0,g.jsxs)("div",{children:[(0,g.jsx)("h3",{className:"mb-1 fw-bold text-white",children:"Signatory Information"}),(0,g.jsxs)("p",{className:"mb-0 text-white opacity-75 small",children:[i.first_name," ",i.last_name]})]})]}),(0,g.jsxs)("button",{onClick:s,className:"btn btn-light btn-sm d-flex align-items-center gap-2",style:{borderRadius:"8px",padding:"10px 20px"},children:[(0,g.jsx)(u.LwM,{size:20}),"Close"]})]})}),(0,g.jsx)("div",{className:"px-4 py-3 bg-light border-bottom",children:(0,g.jsx)("div",{className:"d-flex align-items-center justify-content-between flex-wrap gap-3",children:(0,g.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[(0,g.jsxs)("div",{children:[(0,g.jsx)("span",{className:"text-muted small",children:"Access Status:"}),(0,g.jsx)("div",{className:"mt-1",children:(0,g.jsx)(f,{status:i.access_status})})]}),(0,g.jsx)("div",{className:"vr",style:{height:"40px"}})]})})}),(0,g.jsx)("div",{className:"flex-grow-1 overflow-auto p-4",children:(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsx)("div",{className:"col-12",children:(0,g.jsxs)("h5",{className:"fw-bold text-dark mb-3 pb-2 border-bottom",children:[(0,g.jsx)(h.x$1,{className:"me-2 text-primary"}),"Personal Information"]})}),(0,g.jsx)(v,{icon:h.x$1,label:"First Name",value:i.first_name,iconColor:"text-primary"}),(0,g.jsx)(v,{icon:h.x$1,label:"Last Name",value:i.last_name,iconColor:"text-primary"}),(0,g.jsx)(v,{icon:h.maD,label:"Email Address",value:i.signatory_email,iconColor:"text-info"}),(0,g.jsx)(v,{icon:h.Cab,label:"Phone Number",value:i.signatory_phone,iconColor:"text-success"}),(0,g.jsx)(v,{icon:h.QEs,label:"LinkedIn Profile",value:i.linked_in?(0,g.jsx)("a",{href:i.linked_in,target:"_blank",rel:"noopener noreferrer",className:"text-decoration-none",children:i.linked_in}):null,iconColor:"text-primary"}),(0,g.jsx)(v,{icon:h.Myc,label:"Signature Role",value:i.signature_role,iconColor:"text-purple"}),(0,g.jsx)("div",{className:"col-12 mt-4",children:(0,g.jsxs)("h5",{className:"fw-bold text-dark mb-3 pb-2 border-bottom",children:[(0,g.jsx)(h.pXu,{className:"me-2 text-warning"}),"Account Information"]})}),(0,g.jsx)(v,{icon:b.tpc,label:"Company Name",value:i.company_name,iconColor:"text-secondary"}),(0,g.jsx)(v,{icon:h.pXu,label:"View Password",value:i.viewpassword?(0,g.jsx)("span",{className:"font-monospace bg-light px-2 py-1 rounded",children:i.viewpassword}):null,iconColor:"text-warning"}),(0,g.jsx)(v,{icon:h.e7y,label:"Invited By",value:`${i.invited_by_first_name||""} ${i.invited_by_last_name||""}`,iconColor:"text-info"}),(0,g.jsx)("div",{className:"col-12 mt-4",children:(0,g.jsxs)("h5",{className:"fw-bold text-dark mb-3 pb-2 border-bottom",children:[(0,g.jsx)(h.w_X,{className:"me-2 text-danger"}),"Activity Timeline"]})}),(0,g.jsx)("div",{className:"col-md-4",children:(0,g.jsx)("div",{className:"card border-0 shadow-sm h-100",children:(0,g.jsx)("div",{className:"card-body p-3",children:(0,g.jsxs)("div",{className:"d-flex align-items-start gap-3",children:[(0,g.jsx)("div",{className:"bg-light p-2 rounded text-success",children:(0,g.jsx)(h.bfZ,{size:20})}),(0,g.jsxs)("div",{className:"flex-grow-1",children:[(0,g.jsx)("div",{className:"text-muted small mb-1",children:"Invited At"}),(0,g.jsx)("div",{className:"fw-semibold text-dark",children:p(i.invited_at)})]})]})})})}),(0,g.jsx)("div",{className:"col-md-4",children:(0,g.jsx)("div",{className:"card border-0 shadow-sm h-100",children:(0,g.jsx)("div",{className:"card-body p-3",children:(0,g.jsxs)("div",{className:"d-flex align-items-start gap-3",children:[(0,g.jsx)("div",{className:"bg-light p-2 rounded text-primary",children:(0,g.jsx)(h.A7C,{size:20})}),(0,g.jsxs)("div",{className:"flex-grow-1",children:[(0,g.jsx)("div",{className:"text-muted small mb-1",children:"Accepted At"}),(0,g.jsx)("div",{className:"fw-semibold text-dark",children:p(i.accepted_at)})]})]})})})}),(0,g.jsx)("div",{className:"col-md-4",children:(0,g.jsx)("div",{className:"card border-0 shadow-sm h-100",children:(0,g.jsx)("div",{className:"card-body p-3",children:(0,g.jsxs)("div",{className:"d-flex align-items-start gap-3",children:[(0,g.jsx)("div",{className:"bg-light p-2 rounded text-warning",children:(0,g.jsx)(b.VP9,{size:20})}),(0,g.jsxs)("div",{className:"flex-grow-1",children:[(0,g.jsx)("div",{className:"text-muted small mb-1",children:"Last Login"}),(0,g.jsx)("div",{className:"fw-semibold text-dark",children:p(i.last_login)})]})]})})})})]})}),(0,g.jsx)("div",{className:"px-4 py-3 border-top bg-light d-flex justify-content-end",children:(0,g.jsx)("button",{onClick:s,className:"btn btn-secondary px-4",children:"Close"})})]}),(0,g.jsx)("style",{jsx:!0,children:"\n        .hover-shadow:hover {\n          transform: translateY(-2px);\n          transition: all 0.3s ease;\n          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;\n        }\n        .hover-shadow {\n          transition: all 0.3s ease;\n        }\n      "})]}):(0,g.jsx)("div",{className:"main_popup-overlay",children:(0,g.jsx)("div",{className:"d-flex justify-content-center align-items-center",style:{height:"100vh"},children:(0,g.jsxs)("div",{className:"text-center",children:[(0,g.jsx)("p",{className:"text-muted",children:"No signatory information found"}),(0,g.jsx)("button",{onClick:s,className:"btn btn-primary mt-3",children:"Close"})]})})})},C=e=>{let{onClose:s,recordViewData:a}=e;const t=a||{};return console.log(t),(0,g.jsx)("div",{className:"main_popup-overlay",style:{position:"fixed",top:0,left:0,right:0,bottom:0,backgroundColor:"rgba(0, 0, 0, 0.6)",display:"flex",justifyContent:"center",alignItems:"center",zIndex:1050,padding:"20px"},children:(0,g.jsxs)("div",{style:{backgroundColor:"white",borderRadius:"12px",width:"95%",maxWidth:"1200px",maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 10px 40px rgba(0, 0, 0, 0.2)",margin:"20px auto"},children:[(0,g.jsxs)("div",{className:"p-4 border-bottom bg-light d-flex justify-content-between align-items-center",children:[(0,g.jsxs)("div",{className:"d-flex align-items-center",children:[(0,g.jsx)("div",{style:{width:"50px",height:"50px"},className:"bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 rounded-circle me-3",children:(0,g.jsx)(p.xyf,{size:24,className:"text-success"})}),(0,g.jsxs)("div",{children:[(0,g.jsx)("h4",{className:"mb-0 fw-bold text-dark",children:"Investor Details"}),(0,g.jsx)("p",{className:"mb-0 text-muted",children:"Complete investor information"})]})]}),(0,g.jsx)("button",{onClick:s,className:"btn btn-light rounded-circle p-2",style:{width:"40px",height:"40px"},children:(0,g.jsx)(u.LwM,{size:20})})]}),(0,g.jsx)("div",{style:{flex:1,overflowY:"auto",padding:"24px"},children:(0,g.jsxs)("div",{className:"row g-4",children:[(0,g.jsx)("div",{className:"col-12 col-md-6",children:(0,g.jsxs)("div",{className:"card h-100 border-0 shadow-sm",children:[(0,g.jsx)("div",{className:"card-header bg-transparent border-bottom py-3",children:(0,g.jsxs)("h6",{className:"mb-0 fw-bold d-flex align-items-center",children:[(0,g.jsx)(h.x$1,{className:"me-2 text-primary"}),"Personal Information"]})}),(0,g.jsx)("div",{className:"card-body",children:(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"Full Name"}),(0,g.jsxs)("p",{className:"mb-0 fw-semibold",children:[t.first_name||"N/A"," ",t.last_name||""]})]}),(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsxs)("label",{className:"form-label text-muted small mb-1 d-flex align-items-center",children:[(0,g.jsx)(b.mm2,{className:"me-1"}),"Email Address"]}),(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:t.email||"N/A"})]}),(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsxs)("label",{className:"form-label text-muted small mb-1 d-flex align-items-center",children:[(0,g.jsx)(h.Cab,{className:"me-1"}),"Phone Number"]}),(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:t.phone||"N/A"})]}),(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"Investor Type"}),(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:t.type_of_investor||"N/A"})]}),(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"Accredited Status"}),(0,g.jsx)("span",{className:"badge "+("Yes"===t.accredited_status?"bg-success":"bg-warning"),children:t.accredited_status||"Not Specified"})]})]})})]})}),(0,g.jsx)("div",{className:"col-12 col-md-6",children:(0,g.jsxs)("div",{className:"card h-100 border-0 shadow-sm",children:[(0,g.jsx)("div",{className:"card-header bg-transparent border-bottom py-3",children:(0,g.jsxs)("h6",{className:"mb-0 fw-bold d-flex align-items-center",children:[(0,g.jsx)(h.vq8,{className:"me-2 text-primary"}),"Location Details"]})}),(0,g.jsx)("div",{className:"card-body",children:(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"City"}),(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:t.city||"N/A"})]}),(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"Country"}),(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:t.country||"N/A"})]}),(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"Full Address"}),(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:t.full_address||"N/A"})]})]})})]})}),(0,g.jsx)("div",{className:"col-12 col-md-6",children:(0,g.jsxs)("div",{className:"card h-100 border-0 shadow-sm",children:[(0,g.jsx)("div",{className:"card-header bg-transparent border-bottom py-3",children:(0,g.jsxs)("h6",{className:"mb-0 fw-bold d-flex align-items-center",children:[(0,g.jsx)(h.ymh,{className:"me-2 text-primary"}),"Tax Information"]})}),(0,g.jsx)("div",{className:"card-body",children:(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"Tax Country"}),(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:t.country_tax||"N/A"})]}),(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"Tax ID"}),(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:t.tax_id||"N/A"})]})]})})]})}),(0,g.jsx)("div",{className:"col-12 col-md-6",children:(0,g.jsxs)("div",{className:"card h-100 border-0 shadow-sm",children:[(0,g.jsx)("div",{className:"card-header bg-transparent border-bottom py-3",children:(0,g.jsxs)("h6",{className:"mb-0 fw-bold d-flex align-items-center",children:[(0,g.jsx)(h.f35,{className:"me-2 text-primary"}),"Professional Details"]})}),(0,g.jsx)("div",{className:"card-body",children:(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsxs)("label",{className:"form-label text-muted small mb-1 d-flex align-items-center",children:[(0,g.jsx)(h.AnD,{className:"me-1"}),"LinkedIn Profile"]}),t.linkedIn_profile?(0,g.jsx)("a",{href:t.linkedIn_profile,target:"_blank",rel:"noopener noreferrer",className:"text-primary text-decoration-none",children:"View Profile"}):(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:"N/A"})]}),(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"Industry Expertise"}),t.industry_expertise?(0,g.jsx)("div",{className:"d-flex flex-wrap gap-1",children:t.industry_expertise.split(",").map(((e,s)=>(0,g.jsx)("span",{className:"badge bg-light text-dark border",children:e.trim()},s)))}):(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:"N/A"})]})]})})]})}),(0,g.jsx)("div",{className:"col-12 col-md-6",children:(0,g.jsxs)("div",{className:"card h-100 border-0 shadow-sm",children:[(0,g.jsx)("div",{className:"card-header bg-transparent border-bottom py-3",children:(0,g.jsxs)("h6",{className:"mb-0 fw-bold d-flex align-items-center",children:[(0,g.jsx)(b.Ueo,{className:"me-2 text-primary"}),"Security & Documents"]})}),(0,g.jsx)("div",{className:"card-body",children:(0,g.jsxs)("div",{className:"row g-3",children:[(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"Registration Status"}),(0,g.jsx)("span",{className:"badge "+("Yes"===t.is_register?"bg-success":"bg-secondary"),children:t.is_register||"No"})]}),(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"KYC Document"}),(()=>{let e=[];try{if(t.kyc_document&&"null"!==t.kyc_document&&"[]"!==t.kyc_document){const s=JSON.parse(t.kyc_document);e=Array.isArray(s)?s:[s]}}catch(a){console.error("Error parsing KYC document:",a)}const s=e.filter((e=>e&&""!==e.trim()&&"null"!==e));return 0===s.length?(0,g.jsxs)("div",{className:"text-center py-3 border rounded",children:[(0,g.jsx)(h.t69,{size:24,className:"text-muted mb-2"}),(0,g.jsx)("p",{className:"mb-0 fw-semibold text-muted",children:"No Document Available"})]}):(0,g.jsx)("div",{className:"d-flex flex-column gap-2",children:s.map(((e,s)=>{const a=e.includes("/")?e.split("/").pop():e,r=`http://localhost:5000/api/upload/investor/inv_${t.id}/${encodeURIComponent(e)}`;return(0,g.jsxs)("div",{className:"d-flex align-items-center justify-content-between p-2 border rounded",children:[(0,g.jsxs)("div",{className:"d-flex align-items-center gap-2",children:[(0,g.jsx)(h.t69,{className:"text-muted"}),(0,g.jsxs)("div",{children:[(0,g.jsx)("div",{className:"fw-semibold small text-truncate",style:{maxWidth:"200px"},children:a}),(0,g.jsxs)("div",{className:"text-muted",style:{fontSize:"0.7rem"},children:["KYC Document ",s+1]})]})]}),(0,g.jsxs)("a",{href:r,target:"_blank",rel:"noopener noreferrer",className:"btn btn-sm btn-outline-primary d-flex align-items-center gap-1",download:a,children:[(0,g.jsx)(h.WCW,{size:12}),"View"]})]},s)}))})})()]}),(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"IP Address"}),(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:t.ip_address||"N/A"})]})]})})]})}),(0,g.jsx)("div",{className:"col-12 col-md-6",children:(0,g.jsxs)("div",{className:"card h-100 border-0 shadow-sm",children:[(0,g.jsx)("div",{className:"card-header bg-transparent border-bottom py-3",children:(0,g.jsxs)("h6",{className:"mb-0 fw-bold d-flex align-items-center",children:[(0,g.jsx)(h.itz,{className:"me-2 text-primary"}),"System Information"]})}),(0,g.jsx)("div",{className:"card-body",children:(0,g.jsx)("div",{className:"row g-3",children:(0,g.jsxs)("div",{className:"col-12",children:[(0,g.jsx)("label",{className:"form-label text-muted small mb-1",children:"Created At"}),(0,g.jsx)("p",{className:"mb-0 fw-semibold",children:(e=>{if(!e)return"N/A";return new Date(e).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"})})(t.created_at)})]})})})]})})]})}),(0,g.jsxs)("div",{className:"p-3 border-top bg-light d-flex justify-content-between align-items-center",children:[(0,g.jsx)("div",{children:(0,g.jsxs)("span",{className:"text-muted small",children:["Investor ID: ",(0,g.jsx)("strong",{children:t.id||"N/A"})]})}),(0,g.jsx)("div",{className:"d-flex justify-content-end gap-2",children:(0,g.jsx)("button",{onClick:s,className:"btn btn-secondary px-4",style:{minWidth:"100px"},children:"Close"})})]})]})})},k=e=>{let{id:s,signatory_id:a,visibleFields:r=[],data:l=[]}=e;const i=localStorage.getItem("OwnerLoginData"),d=JSON.parse(i),[p,u]=(0,t.useState)([]),b=o.J+"api/user/signatorydashboard/";(0,t.useEffect)((()=>{v()}),[]);const v=async()=>{const e={signatory_id:a,company_id:s,user_id:d.id};try{const s=await n.A.post(b+"getCompanyInvestorList",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});u(s.data.results)}catch(t){console.error("Error generating summary",t)}},[f,j]=(0,t.useState)(""),[N,y]=(0,t.useState)(null),w=[{name:"First Name",selector:e=>e.first_name,sortable:!0},{name:"Last Name",selector:e=>e.last_name,sortable:!0},{name:"Email",selector:e=>e.email,sortable:!0},{name:"Phone",selector:e=>e.phone,sortable:!0},{name:"Actions",cell:e=>(0,g.jsxs)("div",{className:"position-relative",children:[(0,g.jsx)("button",{className:"block bg-transprent border-0",onClick:()=>(e=>{y(N===e?null:e)})(e.id),children:(0,g.jsx)(m.JTy,{})}),N===e.id&&(0,g.jsx)("div",{className:"dropdown-menu show",style:{position:"absolute",top:"calc(100% + 4px)",right:0,minWidth:"200px",zIndex:9999,borderRadius:"8px",boxShadow:"0 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)",backgroundColor:"#ffffff",padding:"6px",animation:"fadeInDown 0.2s ease-out"},children:(0,g.jsxs)(x.N_,{to:"javascript:void(0)",className:"dropdown-item",onClick:()=>z(e),title:"View Details",style:{display:"flex",alignItems:"center",gap:"12px",padding:"10px 12px",fontSize:"14px",fontWeight:"500",color:"#374151",textDecoration:"none",borderRadius:"6px",transition:"all 0.15s ease",cursor:"pointer"},onMouseEnter:e=>{e.currentTarget.style.backgroundColor="#f3f4f6",e.currentTarget.style.color="#111827"},onMouseLeave:e=>{e.currentTarget.style.backgroundColor="transparent",e.currentTarget.style.color="#374151"},children:[(0,g.jsx)(h.Ny1,{style:{fontSize:"16px",color:"#10b981"}}),(0,g.jsx)("span",{children:"View Details"})]})})]}),ignoreRowClick:!0,allowOverflow:!0,button:!0}],[_,S]=(0,t.useState)(null),[k,D]=(0,t.useState)(!1),[A,R]=(0,t.useState)(""),z=e=>{y(null),S(e),D(!0)};const I=(null===p||void 0===p?void 0:p.filter((e=>{if(!e)return!1;const s=`${e.company_name||""} - ${e.update_date||""} - ${e.version||""}`,a=f.toLowerCase();return s.toLowerCase().includes(a)||(e.update_date||"").toLowerCase().includes(a)||(e.download||"").toLowerCase().includes(a)})))||[],[L,T]=(0,t.useState)(!1);return(0,g.jsxs)("div",{className:"d-flex flex-column overflow-auto justify-content-between align-items-start tb-box",children:[(0,g.jsx)(c.Ay,{customStyles:{table:{style:{overflow:"visible !important",minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},conditionalRowStyles:[{when:e=>!0,style:{"&:hover":{backgroundColor:"var(--lightRed)"}}}],columns:w,className:"datatb-report",data:I,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0}),k&&(0,g.jsx)(C,{recordViewData:_,onClose:()=>{D(!1),S(null)}})]})};function D(){const e=o.J+"api/user/signatorydashboard/",s=localStorage.getItem("OwnerLoginData"),a=JSON.parse(s);document.title="Signatory Detail";const{id:c,signatory_id:m}=(0,d.g)(),[x,p]=(0,t.useState)("");(0,t.useEffect)((()=>{h()}),[]);const h=async()=>{const s={signatory_id:m,company_id:c,user_id:a.id};try{const a=await n.A.post(e+"getSignatoryDetails",s,{headers:{Accept:"application/json","Content-Type":"application/json"}});p(a.data)}catch(t){console.error("Error generating summary",t)}},[u,b]=(0,t.useState)(!1),[v,f]=(0,t.useState)(!1);return(0,g.jsxs)(g.Fragment,{children:[(0,g.jsx)(l.mO,{children:(0,g.jsx)("div",{className:"fullpage d-block",children:(0,g.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,g.jsx)(i.A,{isCollapsed:v,setIsCollapsed:f}),(0,g.jsxs)("div",{className:"global_view "+(v?"global_view_col":""),children:[(0,g.jsx)(r.A,{}),(0,g.jsx)(l.$K,{className:"d-block p-md-4 p-3",children:(0,g.jsx)("div",{className:"container-fluid",children:(0,g.jsx)(l.mg,{id:"step5",children:(0,g.jsxs)("div",{className:"row",children:[(0,g.jsxs)("div",{className:"col-md-12",children:[(0,g.jsxs)("div",{className:"pb-3 bar_design d-flex justify-content-between align-items-center",children:[(0,g.jsxs)("h4",{className:"h5 mb-0",children:["Email (",(0,g.jsx)("strong",{style:{fontSize:"0.875rem"},children:x.signatory_email}),")"]}),(0,g.jsxs)("h4",{className:"h5 mb-0",children:["Company Name (",(0,g.jsx)("strong",{style:{fontSize:"0.875rem"},children:x.company_name}),")"]}),(0,g.jsx)("h4",{className:"h5 mb-0",children:(0,g.jsx)("strong",{style:{backgroundColor:"active"===x.access_status?"#d4edda":"pending"===x.access_status?"#fff3cd":"#f8f9fa",color:"active"===x.access_status?"#155724":"pending"===x.access_status?"#856404":"#212529",padding:"5px 12px",borderRadius:"5px",display:"inline-block",fontSize:"0.875rem"},children:x.access_status?x.access_status.charAt(0).toUpperCase()+x.access_status.slice(1).toLowerCase():""})}),(0,g.jsx)("button",{className:"global_btn w-fit",type:"button",onClick:()=>{b(!0)},children:"Signtory Information"})]}),(0,g.jsxs)("div",{class:"row gap-0 dashboard-top",children:[(0,g.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,g.jsxs)("div",{class:"p-3",children:[(0,g.jsx)("p",{class:"small fw-medium mb-1",children:"Total Round"}),(0,g.jsx)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:(0,g.jsx)("p",{class:"h4 fw-semibold mb-0",children:x.total_allroundrecord})})]})}),(0,g.jsx)("div",{className:"col-6 col-md-3 p-0 bor",children:(0,g.jsxs)("div",{className:"p-3",children:[(0,g.jsx)("p",{className:"small fw-medium mb-1",children:"Total Dataroom Management Report"}),(0,g.jsx)("div",{children:(0,g.jsx)("p",{className:"h4 fw-semibold mb-0",children:x.total_dataroom_reports})})]})}),(0,g.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,g.jsxs)("div",{class:"p-3",children:[(0,g.jsx)("p",{class:"small fw-medium mb-1",children:"Total Investor Reporting"}),(0,g.jsx)("p",{class:"h4 fw-semibold mb-0",children:x.total_investor_reporting})]})}),(0,g.jsx)("div",{className:"col-6 col-md-3 p-0",children:(0,g.jsxs)("div",{className:"p-3",children:[(0,g.jsx)("p",{className:"small fw-medium mb-1",children:"Total Shared Report"}),(0,g.jsx)("div",{children:(0,g.jsx)("p",{className:"h4 fw-semibold mb-0",children:x.total_shared_reports})})]})})]})]}),(0,g.jsxs)("div",{className:"col-12 my-4",children:[(0,g.jsx)("div",{class:"dashboard_card  modern-chart mb-3",children:(0,g.jsxs)("div",{class:"access-logs",children:[(0,g.jsx)("h4",{class:"section-title",children:"Activity"}),(0,g.jsx)(_,{id:c,signatory_id:m})]})}),(0,g.jsx)("div",{class:"dashboard_card  modern-chart mb-3",children:(0,g.jsxs)("div",{class:"access-logs",children:[(0,g.jsx)("h4",{class:"section-title",children:"Investor Reporting"}),(0,g.jsx)(w,{id:c,signatory_id:m,type:"Investor updates"})]})}),(0,g.jsx)("div",{class:"dashboard_card  modern-chart mb-3",children:(0,g.jsxs)("div",{class:"access-logs",children:[(0,g.jsx)("h4",{class:"section-title",children:"Dataroom Management"}),(0,g.jsx)(w,{id:c,signatory_id:m,type:"Due Diligence Document"})]})}),(0,g.jsx)("div",{class:"dashboard_card  modern-chart mb-3",children:(0,g.jsxs)("div",{class:"access-logs",children:[(0,g.jsx)("h4",{class:"section-title",children:"Record Round"}),(0,g.jsx)(j,{id:c,signatory_id:m})]})}),(0,g.jsx)("div",{class:"dashboard_card  modern-chart mb-3",children:(0,g.jsxs)("div",{class:"access-logs",children:[(0,g.jsx)("h4",{class:"section-title",children:"Company Investor"}),(0,g.jsx)(k,{id:c,signatory_id:m})]})})]})]})})})})]})]})})}),u&&(0,g.jsx)(S,{signatory_id:m,id:c,onClose:()=>{b(!1)}})]})}}}]);
//# sourceMappingURL=7473.99ba0658.chunk.js.map