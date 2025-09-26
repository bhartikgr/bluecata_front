/*! For license information please see 2714.fabf5c90.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[2714],{9191:()=>{},25015:()=>{},35087:(e,a,t)=>{t.d(a,{A:()=>i});const i=(0,t(77784).A)("eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]])},35327:(e,a,t)=>{t.d(a,{A:()=>i});const i=(0,t(77784).A)("mail",[["rect",{width:"20",height:"16",x:"2",y:"4",rx:"2",key:"18n3k1"}],["path",{d:"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7",key:"1ocrg3"}]])},62837:(e,a,t)=>{t.d(a,{$K:()=>r,CB:()=>s,Cd:()=>b,I0:()=>c,Jq:()=>m,R3:()=>v,Zw:()=>x,dN:()=>u,hJ:()=>g,jh:()=>d,mO:()=>o,mg:()=>l,nj:()=>y,pd:()=>w,uM:()=>h,vE:()=>n,z6:()=>p});var i=t(5464);const o=i.default.div`
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
`),l=i.default.div`
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
`,s=i.default.div`
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
`,m=(i.default.div`
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
`),h=(i.default.div`
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
  display: ${e=>{let{show:a}=e;return a?"flex":"none"}};
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
`,y=i.default.button`
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
`,v=i.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},65727:(e,a,t)=>{t.d(a,{A:()=>i});const i=(0,t(77784).A)("lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]])},85318:(e,a,t)=>{t.r(a),t.d(a,{default:()=>u});var i=t(65043),o=t(73216),n=t(86213),r=(t(92382),t(4430),t(69078),t(60184)),l=t(35475),s=(t(38421),t(25015),t(26632)),d=(t(65016),t(94651)),c=t(35087),p=(t(9191),t(62837)),x=t(95264),m=t(35327),h=t(65727),f=t(70579);function u(){(0,o.Zp)();const[e,a]=(0,i.useState)([]),[t,u]=(0,i.useState)(!0),[g,b]=(0,i.useState)(!0),[y,w]=(0,i.useState)(!1),[v,k]=(0,i.useState)(!1),[j,N]=(0,i.useState)(!1),[z,_]=(0,i.useState)(!1),[A,C]=(0,i.useState)(""),[S,M]=(0,i.useState)(""),q=(0,o.zy)();document.title="Register Page";const E=new URLSearchParams(q.search).get("ref");var J="http://blueprintcatalyst.com/api/user/";(0,i.useEffect)((()=>{const e=localStorage.getItem("OwnerLoginData"),a=JSON.parse(e);M(a),null!==a&&(window.location.href="/dashboard")}),[S]),(0,i.useEffect)((()=>{E&&F()}),[E]);(0,i.useEffect)((()=>{const e=localStorage.getItem("primaryColor");e&&(document.documentElement.style.setProperty("--primary",e),document.documentElement.style.setProperty("--primary-icon",`${e}90`))}),[]);const F=async()=>{let e={referralCode:E};try{const a=await n.A.post(J+"checkreferralCode",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});0===a.data.results.length&&(window.location.href="/register")}catch(a){}},[P,$]=(0,i.useState)({first_name:"",last_name:"",email:"",password:"",confirm_email:"",phone:""});(0,i.useEffect)((()=>{I()}),[]);const I=async()=>{try{const e=await n.A.post(J+"getallcountry",P,{headers:{Accept:"application/json","Content-Type":"application/json"}});a(e.data.results)}catch(e){}},[L,T]=(0,i.useState)({emailMatch:"",password:""}),[Z,O]=(0,i.useState)({city_step2:"",company_street_address:"",company_industory:"",company_name:"",year_registration:"",company_website:"",employee_number:"",company_linkedin:"",company_state:"",company_postal_code:"",company_country:""}),[R,U]=(0,i.useState)({}),D=e=>{const{name:a,value:t}=e.target;$((e=>({...e,[a]:t}))),"email"!==a&&"confirm_email"!==a||("email"===a&&t!==P.confirm_email||"confirm_email"===a&&t!==P.email?""!==P.confirm_email&&""!==P.email&&T((e=>({...e,emailMatch:"Emails do not match."}))):T((e=>({...e,emailMatch:""}))))};return(0,f.jsx)(f.Fragment,{children:(0,f.jsx)("div",{className:"login_main_gradient",children:(0,f.jsx)("div",{className:"row h-100",children:(0,f.jsx)("div",{className:"col-md-7 mx-auto h-100 ",children:(0,f.jsx)("div",{className:"container-fluid h-100",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-5 p-md-5 px-3 py-5 h-100",children:[(0,f.jsxs)("div",{className:"d-flex flex-column gap-1",children:[(0,f.jsxs)("div",{className:"d-flex flex-column  align-items-center gap-4 justify-content-center",children:[(0,f.jsx)(l.N_,{to:"/",className:"logo",children:(0,f.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,f.jsxs)("p",{className:"mainp",children:["Already have an account?",(0,f.jsxs)(l.N_,{style:{color:"var(--primary)"},to:"/user/login",children:[" ","Sign In"]})]})]}),A&&(0,f.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(z?"error_pop":"success_pop"),children:[(0,f.jsxs)("div",{className:"d-flex align-items-center gap-2",children:[z?(0,f.jsx)(r._Hm,{className:"text-white text-xl"}):(0,f.jsx)(r.A7C,{className:"text-white text-xl"}),(0,f.jsx)("span",{className:"d-block",children:A})]}),(0,f.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>C(""),children:"\xd7"})]})]}),(0,f.jsx)(p.$K,{className:"d-flex m-auto  scroll_nonw overflow-auto ",children:(0,f.jsx)("div",{className:"container-fluid",children:(0,f.jsx)("div",{className:"row justify-content-center",children:(0,f.jsx)("div",{className:"col-12 m-0 p-0",children:(0,f.jsx)("form",{action:"javascript:void(0)",method:"post",onSubmit:async e=>{if(e.preventDefault(),""!==P.email&&""!==P.confirm_email&&P.email!==P.confirm_email)return void T((e=>({...e,emailMatch:"Emails do not match."})));if(!P.first_name||!P.password||!P.email||!P.confirm_email||!P.phone)return;const a=P.password;if(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/.test(a)){T((e=>({...e,password:""})));try{const e={...P,referralCode:E},a=await n.A.post(J+"checkUserEmail",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});"2"===a.data.status?_(!0):(_(!1),$({first_name:"",last_name:"",email:"",password:"",confirm_email:"",phone:""})),C(a.data.message),setTimeout((()=>{_(!1),C("")}),5500)}catch(t){}}else T((e=>({...e,password:"Password must be at least 8 characters long and include uppercase, lowercase, number, and special character."})))},children:(0,f.jsx)(p.mg,{id:"step2",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-4",children:[(0,f.jsx)("div",{className:"d-flex flex-column gap-1 justify-content-start align-items-start",children:(0,f.jsx)(p.jh,{children:"User Signup"})}),(0,f.jsxs)("div",{className:"row gy-3",children:[(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["First Name"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(x.A,{}),(0,f.jsx)("input",{value:P.first_name,onChange:D,type:"text",placeholder:"",name:"first_name",required:!0})]})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["Last Name"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(x.A,{}),(0,f.jsx)("input",{value:P.last_name,onChange:D,type:"text",placeholder:"",name:"last_name",required:!0})]})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{className:"mainp",htmlFor:"",children:["Email ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(m.A,{}),(0,f.jsx)("input",{value:P.email,onChange:D,type:"email",required:!0,name:"email",placeholder:""})]})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{className:"mainp",htmlFor:"",children:["Confirm Email"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(m.A,{}),(0,f.jsx)("input",{value:P.confirm_email,onChange:D,type:"email",required:!0,name:"confirm_email",placeholder:""}),L.emailMatch&&(0,f.jsx)("div",{style:{fontSize:"13px"},className:"text-danger text-start fw-semibold",children:L.emailMatch})]})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{className:"mainp",htmlFor:"",children:["Password"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)("div",{className:"iconblock position-relative",children:[(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(h.A,{className:"lock-icon"}),(0,f.jsx)("input",{value:P.password,onChange:D,type:j?"text":"password",required:!0,name:"password",placeholder:""})]}),(0,f.jsx)("span",{className:"eye_icon_btn",onClick:()=>N(!j),children:j?(0,f.jsx)(d.A,{size:20}):(0,f.jsx)(c.A,{size:20})})]}),L.password&&(0,f.jsx)("div",{style:{fontSize:"13px"},className:"text-danger text-start fw-semibold",children:L.password})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{className:"mainp",children:["Phone Number"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsx)(p.Jq,{children:(0,f.jsx)(s.Ay,{required:!0,name:"phone",defaultCountry:"CA",className:"phonregister",value:P.phone,onChange:e=>{$((a=>({...a,phone:e})))},placeholder:"Enter phone number"})})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,f.jsx)("div",{className:"flex-shrink-0"}),(0,f.jsx)("div",{className:"d-flex flex-row flex-shrink-0 gap-2",children:(0,f.jsx)("button",{type:"submit",className:"global_btn w-fit","data-step":"2",children:"Submit"})})]})})]})]})})})})})})})]})})})})})})}},94651:(e,a,t)=>{t.d(a,{A:()=>i});const i=(0,t(77784).A)("eye-off",[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]])},95264:(e,a,t)=>{t.d(a,{A:()=>i});const i=(0,t(77784).A)("building",[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["path",{d:"M9 22v-4h6v4",key:"r93iot"}],["path",{d:"M8 6h.01",key:"1dz90k"}],["path",{d:"M16 6h.01",key:"1x0f13"}],["path",{d:"M12 6h.01",key:"1vi96p"}],["path",{d:"M12 10h.01",key:"1nrarc"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M16 14h.01",key:"1gbofw"}],["path",{d:"M8 10h.01",key:"19clt8"}],["path",{d:"M8 14h.01",key:"6423bh"}]])}}]);
//# sourceMappingURL=2714.fabf5c90.chunk.js.map