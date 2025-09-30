/*! For license information please see 4053.913f1153.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[4053],{7118:(e,n,s)=>{s.d(n,{A:()=>t});const t=(0,s(77784).A)("users",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["path",{d:"M16 3.13a4 4 0 0 1 0 7.75",key:"1da9ce"}]])},7365:(e,n,s)=>{s.d(n,{A:()=>t});const t=(0,s(77784).A)("settings",[["path",{d:"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",key:"1qme2f"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]])},14459:(e,n,s)=>{s.d(n,{A:()=>t});const t=(0,s(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},41680:(e,n,s)=>{s.d(n,{A:()=>t});const t=(0,s(77784).A)("file-text",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]])},53639:(e,n,s)=>{s.d(n,{A:()=>t});const t=(0,s(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},55930:(e,n,s)=>{s.d(n,{A:()=>b});var t=s(65043),i=(s(38421),s(73216)),a=s(75200),r=s(9463),l=s(53579),o=s(35475),d=s(50423),c=s(53639),m=s(14459),p=s(42983),h=s(31387),x=s(47196),u=s(70579);const g=[{label:"Dashboard",href:"/investor/dashboard",icon:(0,u.jsx)(x.oeo,{size:18})},{label:"Company",href:"/investor/company-list",icon:(0,u.jsx)(c.A,{size:18})},{label:"Profile",href:"/investor/investor-profile",icon:(0,u.jsx)(m.A,{size:18})}];const b=function(e){let{isCollapsed:n,setIsCollapsed:s}=e;const[c,m]=(0,t.useState)(!1),[b,f]=(0,t.useState)(""),v=(0,i.Zp)(),[j,y]=(0,t.useState)(null),[N,w]=(0,t.useState)([]),[k,z]=(0,t.useState)(!1);(0,t.useEffect)((()=>{const e=()=>{window.innerWidth<786?(z(!0),A&&A(!0)):(z(!1),A&&A(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[k]);const[S,C]=(0,t.useState)(!1),_=void 0!==n?n:k,A=s||z;(0,t.useEffect)((()=>{const e=localStorage.getItem("InvestorData"),n=JSON.parse(e);f(n),null===n&&(localStorage.removeItem("InvestorData"),v("/user/login"))}),[]),(0,t.useEffect)((()=>{const e=localStorage.getItem("selectedDropdown");e&&y(Number(e));const n=localStorage.getItem("sidebarCollapsed");if(null!==n){const e=JSON.parse(n);s?s(e):z(e)}}),[]);const I=(0,i.zy)(),R=!_||S;return(0,u.jsxs)(u.Fragment,{children:[(0,u.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(_?"collapsed p-3":"p-4"),children:[(0,u.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(_?"justify-content-center":"justify-content-between"),children:[!_&&(0,u.jsx)("a",{href:"/",className:"logo",children:(0,u.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,u.jsx)(l.V4,{className:"d-flex justify-content-end",children:(0,u.jsxs)("button",{type:"button",onClick:()=>{const e=!_;A(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[_&&(0,u.jsx)(p.A,{strokeWidth:2}),!_&&(0,u.jsx)(r.A,{strokeWidth:2})]})})]}),(0,u.jsx)(l.vT,{isOpen:R,children:(0,u.jsx)(l.c0,{children:g.map(((e,n)=>{var s;let t=!1;var i;"/investor/company-list"===e.href?t=I.pathname===e.href||I.pathname.startsWith("/investor/company"):t=(null===(i=e.matchPaths)||void 0===i?void 0:i.some((e=>(0,h.B6)({path:e,end:!1},I.pathname))))||I.pathname===e.href;return(0,u.jsx)(l.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,u.jsxs)(u.Fragment,{children:[(0,u.jsx)(l.C,{title:e.label,onClick:()=>(e=>{const n=j===e?null:e;_&&A(!_);y(n),localStorage.setItem("selectedDropdown",null!==n?n:"")})(n),className:_&&!S?"justify-content-center px-0":"",children:(0,u.jsxs)("div",{className:"d-flex gap-2 align-items-center w-100 "+(_?"justify-content-center":"justify-content-between"),children:[(0,u.jsxs)("div",{className:"d-flex gap-2 align-items-start "+(_&&!S?"justify-content-center":""),children:[e.icon,R&&e.label]}),R&&(0,u.jsx)(l.i3,{isOpen:j===n,children:(0,u.jsx)(d.pte,{})})]})}),j===n&&R&&(0,u.jsxs)(l.rI,{children:[(0,u.jsx)("hr",{className:"my-2"}),null===(s=e.dropdown)||void 0===s?void 0:s.map(((e,n)=>{const s=I.pathname===e.href;return(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(o.N_,{title:e.label,to:e.href,className:"sidebar d-flex align-items-start gap-2 "+(s?"active":""),children:[e.icon,e.label]})},n)})),"modules"===e.dynamicDropdownKey&&(0,u.jsxs)(u.Fragment,{children:[N.map(((e,n)=>{const s="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,t=I.pathname===s;return(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(o.N_,{title:e.name,to:s,className:"sidebar d-flex align-items-start gap-2 "+(t?"active":""),children:[(0,u.jsx)(x.MO3,{size:16}),e.name]})},n)})),(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(o.N_,{title:"VIDEO CONTENT: Investor Presentation Structure\r - Expert Advice Video",to:"/advicevideos",className:"sidebar d-flex align-items-start gap-2 "+("/advicevideos"===I.pathname?"active":""),children:[(0,u.jsx)(x.xi0,{size:16}),"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,u.jsxs)(o.N_,{to:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${t?"active":""} ${_&&!S?"justify-content-center":""}`,children:[e.icon,R&&e.label]})},n)}))})}),(0,u.jsx)("div",{className:"d-flex  align-items-end gap-2 h-100 "+(_?"justify-content-center":"justify-content-end"),children:(0,u.jsx)(o.N_,{title:"Logout",to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("InvestorData"),window.location.href="/investor/login"},className:"logout_investor_global ",children:(0,u.jsx)(a.QeK,{width:14})})})]}),(0,u.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 80px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,n,s)=>{s.d(n,{$K:()=>r,CB:()=>o,Cd:()=>f,I0:()=>c,Jq:()=>h,R3:()=>y,Zw:()=>p,dN:()=>g,hJ:()=>b,jh:()=>d,mO:()=>i,mg:()=>l,nj:()=>v,pd:()=>j,uM:()=>x,vE:()=>a,z6:()=>m});var t=s(5464);const i=t.default.div`
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
`,a=t.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,r=(t.default.div`
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
`),l=t.default.div`
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
`,p=t.default.div`
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
`,h=(t.default.div`
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
`),x=(t.default.div`
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
`),g=((0,t.default)(u)`
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
`),b=t.default.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: ${e=>{let{show:n}=e;return n?"flex":"none"}};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`,f=t.default.div`
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
`,v=t.default.button`
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
`,y=t.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},75088:(e,n,s)=>{s.d(n,{A:()=>t});const t=(0,s(77784).A)("clock",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polyline",{points:"12 6 12 12 16 14",key:"68esgv"}]])},94053:(e,n,s)=>{s.r(n),s.d(n,{default:()=>C});var t=s(65043),i=s(62837),a=s(86213),r=s(73216),l=s(60184),o=s(45394),d=s(55930),c=s(49535),m=s(41680),p=s(65469),h=s(75088),x=s(7118),u=s(77784);const g=(0,u.A)("zap",[["path",{d:"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",key:"1xq2db"}]]),b=(0,u.A)("chart-column",[["path",{d:"M3 3v16a2 2 0 0 0 2 2h16",key:"c24i48"}],["path",{d:"M18 17V9",key:"2bz60n"}],["path",{d:"M13 17V5",key:"1frdt8"}],["path",{d:"M8 17v-3",key:"17ska0"}]]);var f=s(7365);const v=(0,u.A)("circle-alert",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]]),j=(0,u.A)("circle-check-big",[["path",{d:"M21.801 10A10 10 0 1 1 17 3.335",key:"yps3ct"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]]),y=(0,u.A)("target",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"12",r:"6",key:"1vlfrh"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}]]);var N=s(39845),w=s(27836),k=s(89577),z=s(70579);const S=e=>{let{onClose:n,records:s}=e;const i=localStorage.getItem("InvestorData"),r=JSON.parse(i),[l,d]=(0,t.useState)(""),[c,m]=(0,t.useState)(0),[p,h]=(0,t.useState)(null),[x,u]=(0,t.useState)("0"),[g,b]=(0,t.useState)(""),[f,v]=(0,t.useState)(!1);var j="http://localhost:5000/api/user/investor/";(0,t.useEffect)((()=>{y()}),[]);const y=async()=>{let e={investor_id:r.id,company_id:s.company_id,roundrecord_id:s.id};try{const s=await a.A.post(j+"getcheckInvestorStatus",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(s.data.result.length>0){var n=s.data.result;v(!0),h(String(n[0].request_confirm))}else h(null),v(!1)}catch(t){console.error("Error fetching capital round data:",t),h(null)}},N=s.roundsize&&s.issuedshares?s.roundsize/s.issuedshares:0;if(!s)return null;const S="#F63C3F",C="#D42C2F",_="#FEEBEB",A="#10B981",I="#ECFDF5",R="#3B82F6",M="#EFF6FF",E="#1F2937",F="#6B7280",D="#E5E7EB";return console.log("Current submitted state:",p,typeof p),(0,z.jsx)("div",{className:"main_popup-overlay",style:{backgroundColor:"rgba(0, 0, 0, 0.5)",position:"fixed",top:0,left:0,right:0,bottom:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1e3},children:(0,z.jsx)(w.Bs,{style:{backgroundColor:"white",borderRadius:"12px",padding:"24px",maxWidth:"600px",width:"90%",maxHeight:"90vh",overflow:"auto",boxShadow:"0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",padding:"10px"},children:(0,z.jsxs)("div",{className:"previous-section-summary mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,z.jsx)("div",{className:"d-flex align-items-center mb-3 pb-2 border-bottom",children:(0,z.jsxs)("div",{className:"d-flex align-items-center justify-content-between gap-3 w-100",children:[(0,z.jsx)("h3",{className:"mb-0 fw-semibold",style:{color:E},children:"Invest Now"}),(0,z.jsx)("button",{type:"button",className:"bg-transparent p-1 border-0",onClick:n,style:{color:F},children:(0,z.jsx)(o.LwM,{size:24})})]})}),(0,z.jsx)("div",{className:"row g-3",children:(0,z.jsx)("div",{className:"col-md-12",children:(0,z.jsxs)("div",{className:"p-4 rounded-3 h-100",style:{backgroundColor:_,border:`1px solid ${D}`},children:[(0,z.jsx)("span",{className:"small fw-semibold text-uppercase",style:{color:F},children:"Investment Details"}),"No"===p&&(0,z.jsx)("div",{className:"alert mt-3",style:{backgroundColor:I,border:`1px solid ${A}`,color:A,borderRadius:"8px",padding:"16px"},children:(0,z.jsxs)("div",{className:"d-flex align-items-center",children:[(0,z.jsx)("span",{style:{backgroundColor:A,color:"white",borderRadius:"50%",width:"24px",height:"24px",display:"flex",alignItems:"center",justifyContent:"center",marginRight:"12px",fontSize:"14px",padding:"10px"},children:"\u2713"}),(0,z.jsxs)("div",{children:[(0,z.jsx)("strong",{children:"Investment Submitted Successfully!"}),(0,z.jsx)("p",{className:"mb-0 mt-1",style:{color:F},children:"Your investment commitment has been submitted. The company will contact you shortly."})]})]})}),"Yes"===p&&(0,z.jsx)("div",{className:"alert mt-3",style:{backgroundColor:M,border:`1px solid ${R}`,color:R,borderRadius:"8px",padding:"16px"},children:(0,z.jsxs)("div",{className:"d-flex align-items-center",children:[(0,z.jsx)("span",{style:{backgroundColor:R,color:"white",borderRadius:"50%",width:"24px",height:"24px",display:"flex",alignItems:"center",justifyContent:"center",marginRight:"12px",padding:"10px",fontSize:"14px"},children:"\u2713"}),(0,z.jsxs)("div",{children:[(0,z.jsx)("strong",{children:"Your Request Has Been Confirmed!"}),(0,z.jsx)("p",{className:"mb-0 mt-1",style:{color:F},children:"Congratulations! Your investment request has been confirmed by the company."})]})]})}),null===p&&(0,z.jsxs)("form",{onSubmit:async e=>{e.preventDefault();let n={investor_id:r.id,company_id:s.company_id,shares:parseInt(String(c).toString().replace(/,/g,""))||0,created_by_id:s.created_by_id,roundrecord_id:s.id,investment_amount:parseFloat(String(l).toString().replace(/,/g,""))||0};try{await a.A.post(j+"InvestorrequestToCompany",n,{headers:{Accept:"application/json","Content-Type":"application/json"}});h("No"),b("Investment request submitted successfully!"),setTimeout((()=>{h("No")}),4500)}catch(t){console.error("Error submitting investment:",t),h(null)}},className:"mt-3",method:"post",children:[(0,z.jsxs)("div",{className:"form-group mb-4",children:[(0,z.jsx)("label",{className:"form-label fw-semibold mb-2",style:{color:E},children:"Enter Investment Amount ($)"}),(0,z.jsx)(k.HG,{thousandSeparator:!0,decimalScale:2,fixedDecimalScale:!0,allowNegative:!1,placeholder:"Enter amount",value:l,className:"form-control",onChange:e=>{let n=e.target.value,t=parseFloat(n.replace(/,/g,""))||0;const i=s.roundsize&&s.issuedshares?s.roundsize/s.issuedshares:0;let a=i>0?t/i:0;const r="number"===typeof x?Math.max(0,s.issuedshares-x):s.issuedshares;a>r&&(a=r,t=a*i),d(t.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})),m(a)},style:{borderRadius:"8px",border:`1px solid ${D}`,padding:"12px",fontSize:"16px"}})]}),(0,z.jsxs)("div",{className:"form-group mb-4",children:[(0,z.jsx)("label",{className:"form-label fw-semibold mb-2",style:{color:E},children:"Price Per Share"}),(0,z.jsxs)("div",{className:"form-control-plaintext fw-bold",style:{color:S,fontSize:"18px"},children:["$",N>0?N.toFixed(2):"0.00"]})]}),(0,z.jsxs)("div",{className:"form-group mb-4",children:[(0,z.jsx)("label",{className:"form-label fw-semibold mb-2",style:{color:E},children:"Shares You Will Receive"}),(0,z.jsxs)("div",{className:"form-control-plaintext fw-bold",style:{color:S,fontSize:"18px",backgroundColor:"white",padding:"12px",borderRadius:"8px",border:`1px solid ${D}`},children:["number"===typeof c&&c>0?c.toFixed(0):0," ","shares"]})]}),(0,z.jsx)("button",{type:"submit",className:"btn w-100 mt-2 fw-semibold",style:{backgroundColor:S,color:"white",border:"none",padding:"12px 24px",borderRadius:"8px",fontSize:"16px",transition:"all 0.2s ease"},onMouseEnter:e=>e.target.style.backgroundColor=C,onMouseLeave:e=>e.target.style.backgroundColor=S,children:"Confirm Investment"})]})]})})})]})})})};const C=function(){const{id:e,company_id:n}=(0,r.g)(),[s,u]=(0,t.useState)(""),[w,k]=(0,t.useState)("overview"),[C,_]=(0,t.useState)(!1),A=(0,t.useRef)(null),[I,R]=(0,t.useState)(null),M=(0,r.Zp)();document.title="Company Capital Round List - Investor";const[E,F]=(0,t.useState)(!1),[D,T]=(0,t.useState)(!0);var O="http://localhost:5000/api/user/capitalround/";const q=localStorage.getItem("InvestorData"),L=JSON.parse(q),[$,Y]=(0,t.useState)(!1),[P,J]=(0,t.useState)(""),[H,B]=(0,t.useState)({totalRaised:0,investorInvestment:0,remainingAmount:0,progress:0,investorsCount:0,daysLeft:0});(0,t.useEffect)((()=>{if(P){const e=parseFloat(P.roundsize||0);let n=0;P.all_investment_requests&&P.all_investment_requests.length>0&&(n=P.all_investment_requests.reduce(((e,n)=>"Yes"===n.request_confirm?e+parseFloat(n.investment_amount||0):e),0));const s=Math.max(0,e-n),t=e>0?n/e*100:0;let i=0;if(P.dateroundclosed){const e=new Date,n=new Date(P.dateroundclosed)-e;i=n>0?Math.ceil(n/864e5):0}let a=0;if(P.all_investment_requests&&P.all_investment_requests.length>0){const e=P.all_investment_requests.find((e=>e.investor_id===L.id));e&&(a=parseFloat(e.investment_amount||0))}B({totalRaised:n,investorInvestment:a,remainingAmount:s,progress:t,investorsCount:P.all_investment_requests?P.all_investment_requests.length:0,daysLeft:i})}}),[P,L.id]),(0,t.useEffect)((()=>{V()}),[]);const V=async()=>{T(!0);let s={investor_id:L.id,capital_round_id:e};try{const e=await a.A.post(O+"getcheckCapitalMotionlist",s,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(console.log(e.data.results[0]),0===e.data.results.length)M("/investor/company/capital-round-list/"+n);else{const n=e.data.results[0];J(n),W(n)}}catch(t){console.error("Error fetching capital round data:",t)}finally{T(!1)}},W=async e=>{let n={user_id:L.id,id:e.sharerecordround_id};try{await a.A.post(O+"Capitalmotionviewed",n,{headers:{Accept:"application/json","Content-Type":"application/json"}})}catch(s){console.error("Error updating viewed status:",s)}},K=P.roundsize&&P.issuedshares?P.roundsize/P.issuedshares:0,Z=H.totalRaised,U=Math.max(0,P.roundsize-Z),G=Math.max(0,P.issuedshares-Z/K),Q=parseFloat(String(H.investorInvestment).replace(/,/g,""))||0,X=parseFloat(String(P.roundsize).replace(/,/g,""))||0,ee=X>0?(Q/X*100).toFixed(2):"0.00",ne=Math.min(100,Z/P.roundsize*100);if(D)return(0,z.jsx)(i.mO,{className:"investor-login-wrapper",children:(0,z.jsx)("div",{className:"fullpage d-block",children:(0,z.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,z.jsx)(d.A,{isCollapsed:$,setIsCollapsed:Y}),(0,z.jsx)("div",{className:"global_view "+($?"global_view_col":""),children:(0,z.jsx)(i.$K,{className:"d-flex justify-content-center align-items-center",style:{minHeight:"400px"},children:(0,z.jsx)("div",{className:"loading-spinner",children:(0,z.jsx)("div",{className:"spinner-border text-primary",role:"status",children:(0,z.jsx)("span",{className:"visually-hidden",children:"Loading..."})})})})})]})})});(e=>{if(!e)return{};try{let n=e;return"string"===typeof n&&(n=JSON.parse(n)),"string"===typeof n&&(n=JSON.parse(n)),n}catch(n){return console.error("Error parsing instrument data:",n),{}}})(P.instrument_type_data);const se=async function(e,n){if(e&&0!==e.length)try{const s=JSON.parse(e);for(let e=0;e<s.length;e++){const t=s[e],i=`${n}/${t}`,a=document.createElement("a");a.href=i,a.download=t,a.target="_blank",document.body.appendChild(a),a.click(),document.body.removeChild(a),e<s.length-1&&await new Promise((e=>setTimeout(e,500)))}}catch(s){console.error("Error downloading files:",s),alert("Error downloading files")}else alert("No files available for download")},te=(e,n,s)=>{if(!e)return null;try{const s=JSON.parse(e);return(0,z.jsx)("div",{className:"file-list",children:s.map(((e,s)=>(0,z.jsxs)("div",{className:"file-item d-flex justify-content-between align-items-center p-2 border rounded mb-2",children:[(0,z.jsxs)("div",{className:"d-flex align-items-center",children:[(0,z.jsx)(m.A,{size:14,className:"me-2"}),(0,z.jsx)("span",{className:"file-name",children:e})]}),(0,z.jsx)("button",{className:"btn btn-sm btn-outline-primary",onClick:()=>ie(e,n),title:"Download this file",children:(0,z.jsx)(l.WCW,{size:12})})]},s)))})}catch(t){return console.error("Error parsing files JSON:",t),(0,z.jsx)("p",{className:"text-danger",children:"Error loading files"})}},ie=(e,n)=>{const s=`${n}/${e}`,t=document.createElement("a");t.href=s,t.download=e,t.target="_blank",document.body.appendChild(t),t.click(),document.body.removeChild(t)};return(0,z.jsxs)(i.mO,{className:"investor-login-wrapper",children:[(0,z.jsx)("div",{className:"fullpage d-block",children:(0,z.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,z.jsx)(d.A,{isCollapsed:$,setIsCollapsed:Y}),(0,z.jsx)("div",{className:"global_view "+($?"global_view_col":""),children:(0,z.jsx)(i.$K,{className:"d-block p-md-4 p-3",children:(0,z.jsxs)("div",{className:"container-fluid",children:[(0,z.jsxs)("div",{className:"d-flex justify-content-between align-items-center mb-4",children:[(0,z.jsxs)(c.o,{type:"button",className:"backbtn",onClick:()=>{M("/investor/company/capital-round-list/"+n)},children:[(0,z.jsx)(p.A,{size:16,className:"me-1"})," Back to Rounds"]}),(0,z.jsxs)("div",{className:"d-flex gap-2",children:[(0,z.jsx)("div",{className:"round-status-badge",children:(0,z.jsx)("span",{className:"status-active",children:"Active Round"})}),(0,z.jsx)(c.o,{type:"button",className:"global_btn w-fit ",onClick:()=>{_(!0)},children:"Invest Now"})]})]}),(0,z.jsxs)("div",{className:"capital-round-card",children:[(0,z.jsxs)("div",{className:"round-header",children:[(0,z.jsxs)("div",{className:"header-content",children:[(0,z.jsx)("div",{className:"company-icon",children:(0,z.jsx)("div",{className:"icon-wrapper",children:(0,z.jsx)(o.RRN,{size:24})})}),(0,z.jsxs)("div",{className:"header-text",children:[(0,z.jsxs)("h1",{className:"round-title",children:[P.company_name," -"," ",P.nameOfRound||"Capital Round"]}),(0,z.jsx)("p",{className:"round-subtitle",children:P.description||"Investment opportunity details and documentation"}),(0,z.jsxs)("div",{className:"round-meta",children:[(0,z.jsxs)("span",{className:"meta-item",children:[(0,z.jsx)(h.A,{size:14,className:"me-1"}),"Created: ",function(e){const n=new Date(e);if(isNaN(n))return"";const s=n.getDate(),t=["January","February","March","April","May","June","July","August","September","October","November","December"][n.getMonth()],i=n.getFullYear();return`${t} ${s}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(s)}, ${i}`}(P.created_at)]}),(0,z.jsxs)("span",{className:"meta-item",children:[(0,z.jsx)(x.A,{size:14,className:"me-1"}),H.investorsCount," investors participating"]}),(0,z.jsxs)("span",{className:"meta-item",children:[(0,z.jsx)(g,{size:14,className:"me-1"}),P.shareClassType," Shares"]})]})]})]}),(0,z.jsxs)("div",{className:"funding-progress",children:[(0,z.jsxs)("div",{className:"progress-header",children:[(0,z.jsx)("span",{className:"progress-label",children:"Funding Progress"}),(0,z.jsxs)("span",{className:"progress-percentage",children:[ne.toFixed(1),"%"]})]}),(0,z.jsx)("div",{className:"progress-bar",children:(0,z.jsx)("div",{className:"progress-fill",style:{width:`${ne}%`}})}),(0,z.jsxs)("div",{className:"progress-stats",children:[(0,z.jsxs)("span",{children:["Raised: ",P.currency," ",Number(Z).toLocaleString()]}),(0,z.jsxs)("span",{children:["Target: ",P.currency," ",Number(P.roundsize).toLocaleString()]})]})]})]}),(0,z.jsxs)("div",{className:"round-tabs",children:[(0,z.jsxs)("button",{className:"tab-button "+("overview"===w?"active":""),onClick:()=>k("overview"),children:[(0,z.jsx)(b,{size:16,className:"me-2"}),"Overview"]}),(0,z.jsxs)("button",{className:"tab-button "+("terms"===w?"active":""),onClick:()=>k("terms"),children:[(0,z.jsx)(f.A,{size:16,className:"me-2"}),"Terms & Rights"]}),(0,z.jsxs)("button",{className:"tab-button "+("documents"===w?"active":""),onClick:()=>k("documents"),children:[(0,z.jsx)(o.zo4,{size:16,className:"me-2"}),"Documents"]})]}),s&&(0,z.jsxs)("div",{className:"alert-message "+(E?"error":"success"),children:[(0,z.jsxs)("div",{className:"alert-content",children:[E?(0,z.jsx)(v,{size:18}):(0,z.jsx)(j,{size:18}),(0,z.jsx)("span",{children:s})]}),(0,z.jsx)("button",{className:"alert-close",onClick:()=>u(""),children:"\xd7"})]}),(0,z.jsxs)("div",{className:"tab-content",children:["overview"===w&&(0,z.jsxs)("div",{className:"overview-content",children:[(0,z.jsxs)("div",{className:"section-title",children:[(0,z.jsx)("h4",{children:"Round Details"}),(0,z.jsx)("p",{children:"Basic information about this investment round"})]}),(0,z.jsxs)("div",{className:"details-grid",children:[(0,z.jsxs)("div",{className:"detail-card",children:[(0,z.jsx)("div",{className:"detail-icon",children:(0,z.jsx)(y,{size:20})}),(0,z.jsxs)("div",{className:"detail-content",children:[(0,z.jsx)("label",{children:"Round Name"}),(0,z.jsx)("span",{children:P.nameOfRound||"N/A"})]})]}),(0,z.jsxs)("div",{className:"detail-card",children:[(0,z.jsx)("div",{className:"detail-icon",children:(0,z.jsx)(o.X2c,{size:20})}),(0,z.jsxs)("div",{className:"detail-content g-2",children:[(0,z.jsx)("label",{children:"Share Class Type"}),(0,z.jsx)("span",{children:P.shareClassType||"N/A"})]})]}),"OTHER"===P.shareClassType&&(0,z.jsxs)("div",{className:"detail-card",children:[(0,z.jsx)("div",{className:"detail-icon",children:(0,z.jsx)(f.A,{size:20})}),(0,z.jsxs)("div",{className:"detail-content",children:[(0,z.jsx)("label",{children:"Custom Share Class"}),(0,z.jsx)("span",{children:P.shareclassother||"N/A"})]})]}),(0,z.jsxs)("div",{className:"detail-card",children:[(0,z.jsx)("div",{className:"detail-icon",children:(0,z.jsx)(l.MxO,{size:20})}),(0,z.jsxs)("div",{className:"detail-content",children:[(0,z.jsx)("label",{children:"Investment Instrument"}),(0,z.jsx)("span",{children:P.instrumentType||"N/A"})]})]}),"OTHER"===P.instrumentType&&(0,z.jsxs)("div",{className:"detail-card",children:[(0,z.jsx)("div",{className:"detail-icon",children:(0,z.jsx)(f.A,{size:20})}),(0,z.jsxs)("div",{className:"detail-content",children:[(0,z.jsx)("label",{children:"Custom Instrument"}),(0,z.jsx)("span",{children:P.customInstrument||"N/A"})]})]})]}),(0,z.jsxs)("div",{className:"section-title mt-5",children:[(0,z.jsx)("h4",{children:"Financial Metrics"}),(0,z.jsx)("p",{children:"Key financial information for this round"})]}),(0,z.jsxs)("div",{className:"metrics-grid",children:[(0,z.jsxs)("div",{className:"metric-card primary",children:[(0,z.jsx)("div",{className:"metric-icon",children:(0,z.jsx)(l.MxO,{size:24})}),(0,z.jsxs)("div",{className:"metric-content",children:[(0,z.jsx)("label",{children:"Target Raise Amount"}),(0,z.jsxs)("h3",{children:[P.currency," ",Number(P.roundsize).toLocaleString()]})]})]}),(0,z.jsxs)("div",{className:"metric-card success",children:[(0,z.jsx)("div",{className:"metric-icon",children:(0,z.jsx)(o.kfW,{size:24})}),(0,z.jsxs)("div",{className:"metric-content",children:[(0,z.jsx)("label",{children:"Price per Share"}),(0,z.jsxs)("h3",{children:[P.currency," ",Number(K.toFixed(2)).toLocaleString()]})]})]}),(0,z.jsxs)("div",{className:"metric-card warning",children:[(0,z.jsx)("div",{className:"metric-icon",children:(0,z.jsx)(l.YXz,{size:24})}),(0,z.jsxs)("div",{className:"metric-content",children:[(0,z.jsx)("label",{children:"Total Shares"}),(0,z.jsx)("h3",{children:Number(P.issuedshares).toLocaleString()})]})]}),(0,z.jsxs)("div",{className:"metric-card info",children:[(0,z.jsx)("div",{className:"metric-icon",children:(0,z.jsx)(l.gdQ,{size:24})}),(0,z.jsxs)("div",{className:"metric-content",children:[(0,z.jsx)("label",{children:"Your Ownership"}),(0,z.jsxs)("h3",{children:[ee,"%"]})]})]})]}),P.instrumentType&&(0,z.jsxs)("div",{className:"detail-section",children:[(0,z.jsx)("h4",{children:"Investment Summary"}),(0,z.jsxs)("div",{className:"detail-list",children:[(0,z.jsxs)("div",{className:"detail-item",children:[(0,z.jsx)("label",{children:"Your Investment"}),(0,z.jsxs)("span",{children:[P.currency," ",H.investorInvestment.toLocaleString()]})]}),(0,z.jsxs)("div",{className:"detail-item",children:[(0,z.jsx)("label",{children:"Shares Allocated"}),(0,z.jsx)("span",{children:Math.floor((parseFloat(String(H.investorInvestment).replace(/,/g,""))||0)/K).toLocaleString()})]}),(0,z.jsxs)("div",{className:"detail-item",children:[(0,z.jsx)("label",{children:"Remaining Amount"}),(0,z.jsxs)("span",{children:[P.currency," ",U.toLocaleString()]})]})]})]})]}),"terms"===w&&(0,z.jsxs)("div",{className:"terms-content",children:[(0,z.jsxs)("div",{className:"section-title mb-4",children:[(0,z.jsx)("h4",{children:"Terms & Shareholder Rights"}),(0,z.jsx)("p",{children:"Detailed terms and conditions for this investment round"})]}),(0,z.jsxs)("div",{className:"terms-grid",children:[(0,z.jsxs)("div",{className:"terms-section mb-4",children:[(0,z.jsx)("h5",{children:"Liquidation Preferences"}),(0,z.jsxs)("div",{className:"terms-list",children:[(0,z.jsxs)("div",{className:"term-item",children:[(0,z.jsx)("label",{children:"Liquidation Preference: "})," ",(0,z.jsx)("strong",{children:P.liquidationpreferences||"Standard"})]}),(0,z.jsxs)("div",{className:"term-item",children:[(0,z.jsx)("label",{children:"Participation: "})," ",(0,z.jsx)("strong",{children:P.liquidation||"Non-participating"})]}),"OTHER"===P.liquidation&&(0,z.jsxs)("div",{className:"term-item",children:[(0,z.jsx)("label",{children:"Custom Terms:"})," ",(0,z.jsx)("strong",{children:P.liquidationother||"N/A"})]})]})]}),(0,z.jsxs)("div",{className:"terms-section mb-4",children:[(0,z.jsx)("h5",{children:"Voting & Conversion Rights"}),(0,z.jsxs)("div",{className:"terms-list",children:[(0,z.jsxs)("div",{className:"term-item",children:[(0,z.jsx)("label",{children:"Voting Rights:"})," ",(0,z.jsx)("strong",{children:P.voting||"Standard"})]}),(0,z.jsxs)("div",{className:"term-item",children:[(0,z.jsx)("label",{children:"Shares Convertible:"})," ",(0,z.jsx)("strong",{children:P.convertible||"No"})]}),"Yes"===P.convertible&&(0,z.jsxs)("div",{className:"term-item",children:[(0,z.jsx)("label",{children:"Conversion Type:"})," ",(0,z.jsx)("strong",{children:P.convertibleType||"Automatic"})]})]})]}),(0,z.jsxs)("div",{className:"terms-section mb-4",children:[(0,z.jsx)("h5",{children:"Additional Rights & Preferences"}),(0,z.jsx)("div",{className:"terms-list",children:(0,z.jsxs)("div",{className:"term-item",children:[(0,z.jsx)("label",{children:"Rights & Preferences:"})," ",(0,z.jsx)("strong",{children:P.rights||"Standard rights apply"})]})})]}),(0,z.jsxs)("div",{className:"terms-section",children:[(0,z.jsx)("h5",{children:"Investment Status"}),(0,z.jsxs)("div",{className:"terms-list",children:[(0,z.jsxs)("div",{className:"term-item",children:[(0,z.jsx)("label",{children:"Remaining Amount: "})," ",(0,z.jsxs)("strong",{children:[P.currency," ",U.toLocaleString()]})]}),(0,z.jsxs)("div",{className:"term-item",children:[(0,z.jsx)("label",{children:"Remaining Shares:"})," ",(0,z.jsx)("strong",{children:Math.max(0,G.toFixed(0)).toLocaleString()})]})]})]})]})]}),"documents"===w&&(0,z.jsxs)("div",{className:"documents-content",children:[(0,z.jsxs)("div",{className:"section-title mb-4",children:[(0,z.jsx)("h4",{children:"Investment Documents"}),(0,z.jsx)("p",{children:"Legal documents and agreements for this investment round"})]}),(0,z.jsxs)("div",{className:"documents-grid row",children:[(0,z.jsx)("div",{className:"col-lg-6 mb-4",children:(0,z.jsx)("div",{className:"document-card card h-100",children:(0,z.jsxs)("div",{className:"card-body",children:[(0,z.jsxs)("div",{className:"d-flex align-items-center mb-3",children:[(0,z.jsx)("div",{className:"document-icon primary me-3",children:(0,z.jsx)(m.A,{size:24})}),(0,z.jsxs)("div",{className:"document-info flex-grow-1",children:[(0,z.jsx)("h5",{className:"card-title",children:"Term Sheet"}),(0,z.jsx)("p",{className:"card-text text-muted",children:"Investment terms and conditions document"})]})]}),P.termsheetFile&&JSON.parse(P.termsheetFile).length>0?(0,z.jsx)(z.Fragment,{children:(0,z.jsxs)("div",{className:"mb-3",children:[(0,z.jsxs)("div",{className:"d-flex justify-content-between align-items-center mb-2",children:[(0,z.jsxs)("span",{className:"badge bg-primary",children:[JSON.parse(P.termsheetFile).length," ","file(s)"]}),(0,z.jsxs)("button",{className:"btn btn-sm btn-success",onClick:()=>se(P.termsheetFile,`http://localhost:5000/api/upload/docs/doc_${P.company_id}/companyRound`,"termsheet"),children:[(0,z.jsx)(l.WCW,{size:12,className:"me-1"}),"Download All"]})]}),te(P.termsheetFile,`http://localhost:5000/api/upload/docs/doc_${P.company_id}/companyRound`)]})}):(0,z.jsx)("div",{className:"alert alert-info",children:(0,z.jsx)("small",{children:"No term sheet files available"})})]})})}),(0,z.jsx)("div",{className:"col-lg-6 mb-4",children:(0,z.jsx)("div",{className:"document-card card h-100",children:(0,z.jsxs)("div",{className:"card-body",children:[(0,z.jsxs)("div",{className:"d-flex align-items-center mb-3",children:[(0,z.jsx)("div",{className:"document-icon success me-3",children:(0,z.jsx)(l.MTc,{size:24})}),(0,z.jsxs)("div",{className:"document-info flex-grow-1",children:[(0,z.jsx)("h5",{className:"card-title",children:"Subscription Agreement"}),(0,z.jsx)("p",{className:"card-text text-muted",children:"Legal subscription document and agreement"})]})]}),P.subscriptiondocument&&JSON.parse(P.subscriptiondocument).length>0?(0,z.jsx)(z.Fragment,{children:(0,z.jsxs)("div",{className:"mb-3",children:[(0,z.jsxs)("div",{className:"d-flex justify-content-between align-items-center mb-2",children:[(0,z.jsxs)("span",{className:"badge bg-success",children:[JSON.parse(P.subscriptiondocument).length," ","file(s)"]}),(0,z.jsxs)("button",{className:"btn btn-sm btn-success",onClick:()=>se(P.subscriptiondocument,`http://localhost:5000/api/upload/docs/doc_${P.company_id}/companyRound`,"subscription"),children:[(0,z.jsx)(l.WCW,{size:12,className:"me-1"}),"Download All"]})]}),te(P.subscriptiondocument,`http://localhost:5000/api/upload/docs/doc_${P.company_id}/companyRound`)]})}):(0,z.jsx)("div",{className:"alert alert-info",children:(0,z.jsx)("small",{children:"No subscription agreement files available"})})]})})})]}),"Yes"===P.signature_status&&(0,z.jsx)("div",{className:"signature-preview mt-4 card",children:(0,z.jsxs)("div",{className:"card-body",children:[(0,z.jsx)("h5",{className:"card-title",children:"Authorized Signature"}),(0,z.jsx)("div",{className:"signature-image p-3 border rounded bg-light",children:(0,z.jsx)("img",{src:P.signature,alt:"Authorized Signature",className:"img-fluid",style:{maxHeight:"200px"}})})]})})]}),"signature"===w&&"No"===P.signature_status&&(0,z.jsxs)("div",{className:"signature-content",children:[(0,z.jsxs)("div",{className:"section-title",children:[(0,z.jsx)("h4",{children:"Electronic Signature"}),(0,z.jsx)("p",{children:"Provide your signature to authorize this investment"})]}),(0,z.jsxs)("div",{className:"signature-container",children:[(0,z.jsxs)("div",{className:"signature-instructions",children:[(0,z.jsxs)("div",{className:"instruction-item",children:[(0,z.jsx)(j,{size:16}),(0,z.jsx)("span",{children:"By signing below, you confirm your subscription to this investment round"})]}),(0,z.jsxs)("div",{className:"instruction-item",children:[(0,z.jsx)(j,{size:16}),(0,z.jsx)("span",{children:"You agree to the terms outlined in the Subscription Document"})]}),(0,z.jsxs)("div",{className:"instruction-item",children:[(0,z.jsx)(j,{size:16}),(0,z.jsx)("span",{children:"Your signature will be legally binding"})]})]}),(0,z.jsx)("div",{className:"signature-pad-wrapper",children:(0,z.jsx)(N.A,{ref:A,penColor:"black",canvasProps:{className:"signature-canvas",width:600,height:200}})}),(0,z.jsxs)("div",{className:"signature-actions",children:[(0,z.jsx)("button",{className:"btn-secondary",onClick:()=>{A.current.clear(),R(null)},children:"Clear Signature"}),(0,z.jsxs)("button",{className:"btn-primary",onClick:async()=>{const e=A.current;if(!e)return;if(e.isEmpty())return F(!0),u("Please provide a signature first!"),void setTimeout((()=>{F(!1),u("")}),3500);const n=e.toDataURL("image/png");let s={user_id:L.id,id:P.sharerecordround_id,signature_authorize:n,company_id:P.user_id,reports:P};try{await a.A.post(O+"investorrecordAuthorize",s,{headers:{Accept:"application/json","Content-Type":"application/json"}});V(),F(!1),u("Your subscription has been signed successfully. Please proceed with the fund transfer. Shares will be formally allocated to you once the company confirms the receipt of funds"),setTimeout((()=>{u("")}),1e4)}catch(t){}},children:[(0,z.jsx)(l.Myc,{size:16,className:"me-2"}),"Authorize Investment"]})]}),I&&(0,z.jsxs)("div",{className:"signature-preview mt-4",children:[(0,z.jsx)("h6",{children:"Signature Preview:"}),(0,z.jsx)("img",{src:I,alt:"Signature Preview",className:"preview-image"})]})]})]}),"signature"===w&&"Yes"===P.signature_status&&(0,z.jsx)("div",{className:"signature-complete",children:(0,z.jsxs)("div",{className:"complete-status",children:[(0,z.jsx)(j,{size:48,className:"success-icon"}),(0,z.jsx)("h4",{children:"Signature Complete"}),(0,z.jsx)("p",{children:"Your investment has been successfully authorized and signed."}),(0,z.jsx)("div",{className:"signature-preview",children:(0,z.jsx)("img",{src:P.signature,alt:"Your Signature"})})]})})]})]})]})})})]})}),C&&(0,z.jsx)(S,{onClose:()=>{_(!1)},records:P}),(0,z.jsx)("style",{jsx:!0,children:"\n        .capital-round-card {\n          background: #fff;\n          border-radius: 20px;\n          box-shadow: 0 4px 25px #d4d4d4ff;\n          overflow: hidden;\n          margin-bottom: 2rem;\n        }\n\n        .round-header {\n          padding: 2rem;\n          background: linear-gradient(135deg, #ff3d41 0%, #ff777a 100%);\n\n          color: white;\n        }\n\n        .header-content {\n          display: flex;\n          align-items: flex-start;\n          gap: 1rem;\n          margin-bottom: 1.5rem;\n        }\n\n        .icon-wrapper {\n          width: 50px;\n          height: 50px;\n          border-radius: 12px;\n          background: rgba(255, 255, 255, 0.2);\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          backdrop-filter: blur(10px);\n        }\n\n        .header-text {\n          flex: 1;\n        }\n\n        .round-title {\n          font-size: 1.75rem;\n          font-weight: 700;\n          margin: 0 0 0.5rem 0;\n          color: white;\n        }\n\n        .round-subtitle {\n          opacity: 0.9;\n          margin: 0 0 1rem 0;\n          font-size: 1rem;\n        }\n\n        .round-meta {\n          display: flex;\n          gap: 1.5rem;\n          flex-wrap: wrap;\n        }\n\n        .meta-item {\n          display: flex;\n          align-items: center;\n          font-size: 0.875rem;\n          opacity: 0.8;\n        }\n\n        .funding-progress {\n          background: rgba(255, 255, 255, 0.1);\n          border-radius: 12px;\n          padding: 1.25rem;\n          backdrop-filter: blur(10px);\n        }\n\n        .progress-header {\n          display: flex;\n          justify-content: space-between;\n          align-items: center;\n          margin-bottom: 0.75rem;\n        }\n\n        .progress-label {\n          font-weight: 600;\n        }\n\n        .progress-percentage {\n          font-weight: 700;\n          font-size: 1.125rem;\n        }\n\n        .progress-bar {\n          height: 8px;\n          background: rgba(255, 255, 255, 0.2);\n          border-radius: 4px;\n          overflow: hidden;\n          margin-bottom: 0.75rem;\n        }\n\n        .progress-fill {\n          height: 100%;\n          background: linear-gradient(90deg, #4ade80, #22c55e);\n          border-radius: 4px;\n          transition: width 0.3s ease;\n        }\n\n        .progress-stats {\n          display: flex;\n          justify-content: space-between;\n          font-size: 0.875rem;\n          opacity: 0.9;\n        }\n\n        .round-tabs {\n          display: flex;\n          background: #f8fafc;\n          border-bottom: 1px solid #e2e8f0;\n        }\n\n        .tab-button {\n          padding: 1rem 1.5rem;\n          background: none;\n          border: none;\n          border-bottom: 3px solid transparent;\n          color: #64748b;\n          font-weight: 500;\n          display: flex;\n          align-items: center;\n          transition: all 0.3s ease;\n          cursor: pointer;\n        }\n\n        .tab-button:hover {\n          color: #334155;\n          background: #f1f5f9;\n        }\n\n        .tab-button.active {\n          color: #f75f62;\n          border-bottom-color: #f75f62;\n          background: white;\n        }\n\n        .tab-content {\n          padding: 2rem;\n        }\n\n        .alert-message {\n          display: flex;\n          align-items: center;\n          justify-content: space-between;\n          padding: 1rem 1.25rem;\n          border-radius: 8px;\n          margin-bottom: 1.5rem;\n        }\n\n        .alert-message.success {\n          background: #f0fdf4;\n          color: #166534;\n          border: 1px solid #bbf7d0;\n        }\n\n        .alert-message.error {\n          background: #fef2f2;\n          color: #991b1b;\n          border: 1px solid #fecaca;\n        }\n\n        .alert-content {\n          display: flex;\n          align-items: center;\n          gap: 0.5rem;\n        }\n\n        .alert-close {\n          background: none;\n          border: none;\n          font-size: 1.25rem;\n          cursor: pointer;\n          opacity: 0.7;\n        }\n\n        .alert-close:hover {\n          opacity: 1;\n        }\n\n        .metrics-grid {\n          display: grid;\n          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));\n          gap: 1.5rem;\n          margin-bottom: 2rem;\n        }\n\n        .metric-card {\n          background: #f8fafc;\n          border-radius: 12px;\n          padding: 1.5rem;\n          display: flex;\n          align-items: center;\n          gap: 1rem;\n          border: 1px solid #e2e8f0;\n          transition: transform 0.2s ease;\n        }\n\n        .metric-card:hover {\n          transform: translateY(-2px);\n          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);\n        }\n\n        .metric-icon {\n          width: 50px;\n          height: 50px;\n          border-radius: 10px;\n          background: linear-gradient(135deg, #ff3d41 0%, #ff777a 100%);\n\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          color: white;\n        }\n\n        .metric-content label {\n          font-size: 0.875rem;\n          color: #64748b;\n          font-weight: 500;\n          display: block;\n          margin-bottom: 0.25rem;\n        }\n\n        .metric-content h3 {\n          margin: 0;\n          font-size: 1.5rem;\n          font-weight: 700;\n          color: #1e293b;\n        }\n\n        .details-grid {\n          display: grid;\n          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n          gap: 2rem;\n        }\n\n        .detail-section {\n          background: #f8fafc;\n          border-radius: 12px;\n          padding: 1.5rem;\n        }\n\n        .detail-section h4 {\n          margin: 0 0 1rem 0;\n          color: #1e293b;\n          font-weight: 600;\n          font-size: 1.125rem;\n        }\n\n        .detail-list {\n          display: flex;\n          flex-direction: column;\n          gap: 1rem;\n        }\n\n        .detail-item {\n          display: flex;\n          justify-content: space-between;\n          align-items: center;\n          padding-bottom: 0.75rem;\n          border-bottom: 1px solid #e2e8f0;\n        }\n\n        .detail-item:last-child {\n          border-bottom: none;\n          padding-bottom: 0;\n        }\n\n        .detail-item label {\n          font-weight: 500;\n          color: #475569;\n        }\n\n        .detail-item span {\n          font-weight: 600;\n          color: #1e293b;\n        }\n\n        .documents-grid {\n          display: grid;\n          gap: 1rem;\n        }\n\n        .document-card {\n          display: flex;\n          align-items: center;\n          gap: 1rem;\n          padding: 1.5rem;\n          background: #f8fafc;\n          border-radius: 12px;\n          border: 1px solid #e2e8f0;\n        }\n\n        .document-icon {\n          width: 50px;\n          height: 50px;\n          border-radius: 10px;\n          background: #e0f2fe;\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          color: #0369a1;\n        }\n\n        .document-info {\n          flex: 1;\n        }\n\n        .document-info h5 {\n          margin: 0 0 0.25rem 0;\n          color: #1e293b;\n        }\n\n        .document-info p {\n          margin: 0;\n          color: #64748b;\n          font-size: 0.875rem;\n        }\n\n        .download-btn {\n          display: flex;\n          align-items: center;\n          gap: 0.5rem;\n          padding: 0.75rem 1.25rem;\n          background: #f75f62;\n          color: white;\n          border: none;\n          border-radius: 8px;\n          font-weight: 500;\n          cursor: pointer;\n          transition: background 0.2s ease;\n        }\n\n        .download-btn:hover {\n          background: #2563eb;\n        }\n\n        .signature-content h4 {\n          margin: 0 0 0.5rem 0;\n          color: #1e293b;\n        }\n\n        .signature-description {\n          color: #64748b;\n          margin-bottom: 1.5rem;\n        }\n\n        .signature-container {\n          max-width: 600px;\n        }\n\n        .signature-pad-wrapper {\n          border: 2px dashed #cbd5e1;\n          border-radius: 8px;\n          margin-bottom: 1.5rem;\n          background: #fafafa;\n        }\n\n        .signature-canvas {\n          border-radius: 6px;\n          cursor: crosshair;\n        }\n\n        .signature-actions {\n          display: flex;\n          gap: 1rem;\n        }\n\n        .btn-primary {\n          background: linear-gradient(135deg, #f75f62, #1d4ed8);\n          color: white;\n          border: none;\n          padding: 0.875rem 1.5rem;\n          border-radius: 8px;\n          font-weight: 500;\n          cursor: pointer;\n          display: flex;\n          align-items: center;\n          transition: all 0.2s ease;\n        }\n\n        .btn-primary:hover {\n          transform: translateY(-1px);\n          box-shadow: 0 4px 12px #f63c3f;\n        }\n\n        .btn-secondary {\n          background: #f1f5f9;\n          color: #f63c3f;\n          border: 1px solid #cbd5e1;\n          padding: 0.875rem 1.5rem;\n          border-radius: 8px;\n          font-weight: 500;\n          cursor: pointer;\n          transition: all 0.2s ease;\n        }\n\n        .btn-secondary:hover {\n          background: #e2e8f0;\n        }\n\n        .round-status-badge .status-active {\n          background: #dcfce7;\n          color: #166534;\n          padding: 0.5rem 1rem;\n          border-radius: 20px;\n          font-size: 0.875rem;\n          font-weight: 500;\n        }\n\n        .loading-spinner {\n          display: flex;\n          justify-content: center;\n          align-items: center;\n          height: 200px;\n        }\n\n        @media (max-width: 768px) {\n          .round-header {\n            padding: 1.5rem;\n          }\n\n          .header-content {\n            flex-direction: column;\n            text-align: center;\n          }\n\n          .round-tabs {\n            flex-direction: column;\n          }\n\n          .tab-button {\n            justify-content: center;\n          }\n\n          .tab-content {\n            padding: 1.5rem;\n          }\n\n          .metrics-grid {\n            grid-template-columns: 1fr;\n          }\n\n          .details-grid {\n            grid-template-columns: 1fr;\n          }\n\n          .document-card {\n            flex-direction: column;\n            text-align: center;\n          }\n\n          .signature-actions {\n            flex-direction: column;\n          }\n        }\n      "})]})}}}]);
//# sourceMappingURL=4053.913f1153.chunk.js.map