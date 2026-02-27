/*! For license information please see 5300.5748b67d.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[5300],{14459:(e,t,a)=>{a.d(t,{A:()=>o});const o=(0,a(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},25015:()=>{},35087:(e,t,a)=>{a.d(t,{A:()=>o});const o=(0,a(77784).A)("eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]])},47984:()=>{},62837:(e,t,a)=>{a.d(t,{$K:()=>n,CB:()=>l,Cd:()=>g,I0:()=>c,Jq:()=>x,R3:()=>v,Zw:()=>m,dN:()=>b,hJ:()=>f,jh:()=>d,mO:()=>i,mg:()=>s,nj:()=>y,pd:()=>w,uM:()=>u,vE:()=>r,z6:()=>p});var o=a(5464);const i=o.default.div`
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
`,r=o.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,n=(o.default.div`
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
`,o.default.div`
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
`,o.default.div`
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
`,o.default.div`
  display: block;
  height: 100%;
`),s=o.default.div`
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
`,l=o.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=o.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=o.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=o.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,m=o.default.div`
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
`,x=(o.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,o.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,o.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,o.default.div`
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
`),u=(o.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,o.default.div`
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
`),h=(o.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,o.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,o.default.div`
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
`,o.default.button`
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
`,o.default.div`
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
`,o.default.video`
  background-color: black;
  border: none;
`,o.default.div`
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
`,o.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,o.default.button`
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
`),b=((0,o.default)(h)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,o.default)(h)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,o.default.sup`
  color: var(--primary);
`),f=o.default.div`
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
`,g=o.default.div`
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
`,y=o.default.button`
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
`,w=o.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,v=o.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},65016:()=>{},65727:(e,t,a)=>{a.d(t,{A:()=>o});const o=(0,a(77784).A)("lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]])},94651:(e,t,a)=>{a.d(t,{A:()=>o});const o=(0,a(77784).A)("eye-off",[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]])},95300:(e,t,a)=>{a.r(t),a.d(t,{default:()=>m});var o=a(65043),i=a(73216),r=a(86213),n=(a(38421),a(25015),a(65016),a(62837)),s=a(14459),l=a(65727),d=a(94651),c=a(35087),p=(a(47984),a(70579));function m(){const e=(0,i.Zp)(),[t,a]=(0,o.useState)([]),[m,x]=(0,o.useState)(!1);(0,o.useRef)(null);document.title="Investor Login Page";const[u,h]=(0,o.useState)(""),[b,f]=(0,o.useState)(""),[g,y]=(0,o.useState)(!1),[w,v]=(0,o.useState)(!1);var k="https://capavate.com/api/user/investorreport/";(0,o.useEffect)((()=>{const e=JSON.parse(localStorage.getItem("InvestorData"));if(e&&e.access_token){const t=(new Date).getTime();e.expiry&&t<e.expiry?window.location.href="/investor/dashboard":localStorage.removeItem("InvestorData")}}),[]);const[j,N]=(0,o.useState)(1),[z,_]=(0,o.useState)({first_name:"",last_name:"",role:"",email:"",confirm_email:"",linked_in:"",maimai:"",wechat:"",boss_zhipin:"",phone:"",area:"",password:""}),[S,A]=(0,o.useState)({emailMatch:""}),[C,E]=(0,o.useState)({city_step2:"",country:"",company_name:"",year_registration:"",company_website:"",employee_number:"",company_linkedin:"",company_maimai:"",company_wechat:"",company_zhipin:"",company_mail_address:"",company_state:"",company_city:"",company_postal_code:"",company_country:""}),I=e=>{const{name:t,value:a}=e.target;_((e=>({...e,[t]:a})))},[M,D]=(t.map((e=>({value:e.code,label:e.name}))),(0,o.useState)("")),[P,q]=(0,o.useState)(!1),F=()=>{q(!1)};return(0,p.jsxs)(p.Fragment,{children:[(0,p.jsx)(n.mO,{className:"investor-login-wrapper w-full d-block",children:(0,p.jsxs)("div",{className:"fullpage d-block w-full",children:[u&&(0,p.jsx)("p",{className:m?" mt-3 error_pop":"success_pop mt-3",children:u}),(0,p.jsx)(n.$K,{className:"d-block login-main-section py-5",children:(0,p.jsx)("div",{className:"container-fluid",children:(0,p.jsx)("div",{className:"row justify-content-center",children:(0,p.jsx)("div",{className:"col-xl-5 col-lg-6 col-md-8",children:(0,p.jsx)("div",{className:"card login-card shadow-lg border-0 rounded-4",children:(0,p.jsxs)("div",{className:"card-body p-5",children:[(0,p.jsxs)("div",{className:"text-center mb-5",children:[(0,p.jsx)("img",{src:"/logos/capavate.png",alt:"Capavate Logo",className:"login-logo img-fluid mb-4",style:{maxHeight:"40px"}}),(0,p.jsx)("h2",{className:"mainh1 mb-2",children:" Investor Login"}),(0,p.jsx)("p",{className:"mainp",children:"Access your investor dashboard"})]}),(0,p.jsxs)("form",{onSubmit:async t=>{t.preventDefault(),y(!0);let a={email:z.email,password:z.password};try{const t=(await r.A.post(k+"investorlogin",a,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;if("2"===t.status)return y(!1),A((e=>({...e,emailMatch:t.message}))),x(!0),h(t.message),void setTimeout((()=>{h(""),A((e=>({...e,emailMatch:""})))}),2500);const o={id:t.id,email:t.email,first_name:t.first_name,last_name:t.last_name,access_token:t.access_token,expiry:(new Date).getTime()+36e5};localStorage.setItem("InvestorData",JSON.stringify(o)),y(!1),e("/investor/dashboard")}catch(o){console.error(o),y(!1)}},children:[(0,p.jsx)(n.mg,{id:"step1",className:"pb-4",children:(0,p.jsxs)("div",{className:"row gy-3",children:[(0,p.jsx)("div",{className:"col-md-12",children:(0,p.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,p.jsxs)("label",{style:{fontSize:"14px"},htmlFor:"",children:["Email ",(0,p.jsx)(n.dN,{children:"*"})]}),(0,p.jsxs)(n.Jq,{children:[(0,p.jsx)(s.A,{}),(0,p.jsx)("input",{value:z.email,onChange:I,type:"email",name:"email",required:!0,placeholder:"Enter email"})]})]})}),(0,p.jsx)("div",{className:"col-md-12",children:(0,p.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,p.jsxs)("label",{htmlFor:"password",children:["Password ",(0,p.jsx)(n.dN,{children:"*"})]}),(0,p.jsxs)("div",{className:"iconblock position-relative",children:[(0,p.jsxs)(n.Jq,{children:[(0,p.jsx)(l.A,{className:"lock-icon"}),(0,p.jsx)("input",{id:"password",className:"passworduser",value:z.password,onChange:I,type:w?"text":"password",name:"password",required:!0,placeholder:"Enter password"})]}),(0,p.jsx)("span",{className:"eye_icon_btn",onClick:()=>v(!w),children:w?(0,p.jsx)(d.A,{size:20}):(0,p.jsx)(c.A,{size:20})})]})]})})]})}),(0,p.jsxs)("div",{className:"d-flex justify-content-between gap-3 align-items-center mb-4",children:[(0,p.jsx)("button",{type:"button",style:{fontSize:"0.9rem"},className:"btn btn-link p-0 text-decoration-none text-primary fw-medium small",onClick:()=>{q(!0)},children:"Forgot Password?"}),(0,p.jsx)("button",{disabled:g,type:"submit",className:"global_btn w-fit",children:g?(0,p.jsxs)(p.Fragment,{children:[(0,p.jsx)("span",{className:"spinner-border spinner-border-sm me-2 mt-1",role:"status","aria-hidden":"true"}),"Logging in..."]}):"Login"})]})]})]})})})})})})]})}),P&&(0,p.jsx)("div",{className:"modal fade show d-block",tabIndex:"-1",role:"dialog",style:{backgroundColor:"rgba(0, 0, 0, 0.5)"},children:(0,p.jsx)("div",{className:"modal-dialog modal-dialog-centered",children:(0,p.jsxs)("div",{className:"modal-content rounded-4 shadow-lg p-4",children:[(0,p.jsxs)("div",{className:"modal-header border-0 pb-0",children:[(0,p.jsx)("h5",{className:"modal-title fw-bold",children:"Reset Your Password"}),(0,p.jsx)("button",{type:"button",className:"btn-close",onClick:F,"aria-label":"Close"})]}),(0,p.jsxs)("div",{className:"modal-body pt-0",children:[M&&(0,p.jsxs)("div",{className:`alert ${m?"alert-danger":"alert-success"} alert-dismissible fade show mb-3`,role:"alert",children:[M,(0,p.jsx)("button",{type:"button",className:"btn-close",onClick:()=>D(""),"aria-label":"Close"})]}),(0,p.jsx)("p",{className:"text-muted mb-4",children:"Enter your email address and we'll send you instructions to reset your password."}),(0,p.jsxs)("form",{onSubmit:async e=>{e.preventDefault();let t={email:e.target.email.value};try{const a=(await r.A.post(k+"resetPasswordinvestor",t,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;1===a.status&&(e.target.reset(),x(!1),D("Password reset successfully, Please check your email")),2===a.status&&(x(!0),D("Email not found!")),setTimeout((()=>{D("")}),2500)}catch(a){}},children:[(0,p.jsxs)("div",{className:"mb-4",children:[(0,p.jsxs)("label",{htmlFor:"resetEmail",className:"form-label fw-semibold",children:["Email Address"," ",(0,p.jsx)(n.dN,{style:{color:"var(--primary)"},children:"*"})]}),(0,p.jsxs)("div",{className:"input-group",children:[(0,p.jsx)("span",{className:"input-group-text bg-light border-end-0",children:(0,p.jsx)(s.A,{size:18,className:"text-muted"})}),(0,p.jsx)("input",{id:"resetEmail",className:"form-control border-start-0 ps-2",type:"email",name:"email",required:!0,placeholder:"Enter your email"})]})]}),(0,p.jsxs)("div",{className:"d-grid gap-2",children:[(0,p.jsx)("button",{type:"submit",className:"btn btn-primary py-2 fw-semibold",children:"Send Reset Instructions"}),(0,p.jsx)("button",{type:"button",className:"btn btn-outline-secondary py-2",onClick:F,children:"Cancel"})]})]})]})]})})})]})}}}]);
//# sourceMappingURL=5300.5748b67d.chunk.js.map