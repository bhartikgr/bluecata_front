/*! For license information please see 852.138df6d3.chunk.js.LICENSE.txt */
(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[852],{14459:(e,t,a)=>{"use strict";a.d(t,{A:()=>i});const i=(0,a(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},25015:()=>{},35087:(e,t,a)=>{"use strict";a.d(t,{A:()=>i});const i=(0,a(77784).A)("eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]])},38493:(e,t,a)=>{"use strict";e.exports=a.p+"static/media/login3.c16328445ee70c414029.jpg"},57e3:(e,t,a)=>{"use strict";e.exports=a.p+"static/media/login.3bffe5972687ad622ba0.jpg"},58866:(e,t,a)=>{"use strict";a.r(t),a.d(t,{default:()=>f});var i=a(65043),o=a(73216),s=a(86213),n=a(92382),r=(a(38421),a(25015),a(4430),a(69078),a(60184)),l=a(94651),d=a(35087),c=(a(65016),a(45394)),p=a(62837),x=a(35475),m=a(14459),u=a(65727),h=a(70579);function f(){const e=(0,o.Zp)();const[t,f]=(0,i.useState)([]),[g,b]=(0,i.useState)(!1);(0,i.useRef)(null);document.title="Login Page";const[v,y]=(0,i.useState)(""),[w,j]=(0,i.useState)(""),[k,N]=(0,i.useState)(!1),[_,z]=(0,i.useState)(!1);(0,i.useEffect)((()=>{const e=sessionStorage.getItem("UserLoginData"),t=JSON.parse(e);j(t),null!==t&&(window.location.href="/dashboard")}),[w]);const[S,A]=(0,i.useState)(1),[C,M]=(0,i.useState)({first_name:"",last_name:"",role:"",email:"",confirm_email:"",linked_in:"",maimai:"",wechat:"",boss_zhipin:"",phone:"",area:""});(0,i.useEffect)((()=>{E(),P()}),[]);const P=async()=>{try{await s.A.post(R+"getapidata",C,{headers:{Accept:"application/json","Content-Type":"application/json"}})}catch(e){}},E=async()=>{try{const e=await s.A.post(R+"getallcountry",C,{headers:{Accept:"application/json","Content-Type":"application/json"}});f(e.data.results)}catch(e){}},[T,L]=(0,i.useState)({emailMatch:""}),[q,J]=(0,i.useState)({city_step2:"",country:"",company_name:"",year_registration:"",company_website:"",employee_number:"",company_linkedin:"",company_maimai:"",company_wechat:"",company_zhipin:"",company_mail_address:"",company_state:"",company_city:"",company_postal_code:"",company_country:""}),[F,D]=(0,i.useState)({}),[H,I]=(0,i.useState)({}),O=e=>{const{name:t,value:a}=e.target;M((e=>({...e,[t]:a}))),J((e=>({...e,[t]:a}))),D((e=>({...e,[t]:a}))),"email"!==t&&"confirm_email"!==t||("email"===t&&a!==C.confirm_email||"confirm_email"===t&&a!==C.email?L((e=>({...e,emailMatch:"Emails do not match."}))):L((e=>({...e,emailMatch:""}))))};var R="https://blueprintcatalyst.com/api/user/";t.map((e=>({value:e.code,label:e.name})));const[B,U]=(0,i.useState)(""),[W,Y]=(0,i.useState)(!1),[Z,$]=(0,i.useState)(!1);return(0,h.jsxs)(h.Fragment,{children:[(0,h.jsx)("div",{className:"login_main_gradient",children:(0,h.jsxs)("div",{className:"row h-100",children:[(0,h.jsx)("div",{className:"col-md-5",children:(0,h.jsx)("div",{className:"container-fluid h-100",children:(0,h.jsxs)("div",{className:"d-flex flex-column gap-5 p-md-5 px-3 py-5 h-100 m-auto justify-content-center ",children:[(0,h.jsxs)("div",{className:"d-flex flex-column gap-1",children:[(0,h.jsx)("div",{className:"d-flex justify-content-center align-items-center",children:(0,h.jsx)("a",{href:"/",className:"logo",children:(0,h.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})})}),B&&(0,h.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(g?"error_pop":"success_pop"),children:[(0,h.jsxs)("div",{className:"flex items-center gap-2",children:[g?(0,h.jsx)(r._Hm,{className:"text-white text-xl"}):(0,h.jsx)(r.A7C,{className:"text-white text-xl"}),(0,h.jsx)("span",{children:B})]}),(0,h.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>U(""),children:"\xd7"})]}),v&&(0,h.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(g?"error_pop":"success_pop"),children:[(0,h.jsxs)("div",{className:"flex items-center gap-2",children:[g?(0,h.jsx)(r._Hm,{className:"text-white text-xl"}):(0,h.jsx)(r.A7C,{className:"text-white text-xl"}),(0,h.jsx)("span",{children:v})]}),(0,h.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>y(""),children:"\xd7"})]})]}),(0,h.jsx)("form",{action:"javascript:void(0)",method:"post",onSubmit:async t=>{t.preventDefault(),N(!0);let a={email:C.email,password:C.password};console.log(a);try{const t=(await s.A.post(R+"userLogin",a,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;if("2"===t.status)N(!1),L((e=>({...e,emailMatch:t.message}))),b(!0),y(t.message),setTimeout((()=>{y(""),L((e=>({...e,emailMatch:""})))}),2500);else{N(!1),L((e=>({...e,emailMatch:""})));let a={id:t.id,email:t.email,first_name:t.first_name,last_name:t.last_name,access_token:t.access_token};sessionStorage.setItem("UserLoginData",JSON.stringify(a)),e("/dashboard")}}catch(i){i.response&&i.response.data&&i.response.data.message}},children:(0,h.jsx)(p.mg,{id:"step1",children:(0,h.jsxs)("div",{className:"d-flex flex-column gap-4",children:[(0,h.jsxs)("div",{className:"d-flex flex-column gap-1 justify-content-start align-items-start",children:[(0,h.jsx)(p.CB,{children:"Welcome Back "}),(0,h.jsx)(p.I0,{children:"Plaese Enter your login detail"})]}),(0,h.jsxs)("div",{className:"row gy-3",children:[(0,h.jsx)("div",{className:"col-md-12",children:(0,h.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,h.jsxs)("label",{style:{fontSize:"14px"},htmlFor:"",children:["Email ",(0,h.jsx)(p.dN,{children:"*"})]}),(0,h.jsxs)(p.Jq,{children:[(0,h.jsx)(m.A,{}),(0,h.jsx)("input",{value:C.email,onChange:O,type:"email",name:"email",required:!0,placeholder:""})]})]})}),(0,h.jsx)("div",{className:"col-md-12",children:(0,h.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,h.jsxs)("label",{htmlFor:"password",children:["Password ",(0,h.jsx)(p.dN,{children:"*"})]}),(0,h.jsxs)("div",{className:"iconblock position-relative",children:[(0,h.jsxs)(p.Jq,{children:[(0,h.jsx)(u.A,{className:"lock-icon"}),(0,h.jsx)("input",{id:"password",className:"passworduser",value:C.password,onChange:O,type:_?"text":"password",name:"password",required:!0,placeholder:"Enter password"})]}),(0,h.jsx)("span",{className:"eye_icon_btn",onClick:()=>z(!_),children:_?(0,h.jsx)(l.A,{size:20}):(0,h.jsx)(d.A,{size:20})})]})]})}),(0,h.jsxs)("div",{className:"col-12 mt-0",children:[(0,h.jsx)("div",{className:"d-flex justify-content-end mt-4 mb-2",children:(0,h.jsx)("div",{className:"flex-shrink-0 gap-4",children:(0,h.jsx)(x.N_,{to:"javascript:void(0)",onClick:()=>{Y(!0)},className:"link_text",children:"Forgot Password?"})})}),(0,h.jsx)("div",{className:"d-flex justify-content-end  position-relative spinner_btn",children:(0,h.jsxs)("button",{disabled:k,type:"submit",className:"sbtn nextbtn","data-step":"1",children:[!k&&"Login",k&&(0,h.jsx)("div",{className:"spinner-border text-white spinneronetimepay mt-1",role:"status",children:(0,h.jsx)("span",{className:"visually-hidden"})})]})}),(0,h.jsx)("div",{className:"dont_have mt-4",children:(0,h.jsxs)("p",{children:["Don't have any account?"," ",(0,h.jsx)(x.N_,{to:"javascript:void(0)",onClick:()=>{e("/register")},children:"Sign Up"})," "]})})]})]})]})})})]})})}),(0,h.jsx)("div",{className:"col-md-7 d-md-block d-none h-100",children:(0,h.jsxs)(n.A,{dots:!1,infinite:!0,arrows:!1,speed:500,slidesToShow:1,slidesToScroll:1,autoplay:!0,autoplaySpeed:5e3,fade:!0,waitForAnimate:!1,adaptiveHeight:!0,children:[(0,h.jsx)("div",{className:"login_right",children:(0,h.jsx)("img",{className:"inverted w-100 h-100 object-center  object-fit-cover",src:a(57e3),alt:"login_page"})}),(0,h.jsx)("div",{className:"login_right",children:(0,h.jsx)("img",{className:"inverted w-100 h-100 object-center   object-fit-cover",src:a(99264),alt:"login_page"})}),(0,h.jsx)("div",{className:"login_right",children:(0,h.jsx)("img",{className:"inverted w-100 h-100 object-center   object-fit-cover",src:a(38493),alt:"login_page"})})]})})]})}),W&&(0,h.jsx)("div",{className:"modal  fade show d-block",style:{backgroundColor:"rgba(0, 0, 0, 0.5)"},tabIndex:"-1",role:"dialog","aria-labelledby":"resetPasswordModalLabel","aria-hidden":"false",children:(0,h.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-lg",style:{maxWidth:"500px"},children:(0,h.jsxs)("div",{className:"modal-content rounded-4 shadow-lg p-4 position-relative",children:[(0,h.jsxs)("div",{className:"d-flex align-items-center gap-3 mb-3 justify-content-between",children:[(0,h.jsx)("h5",{className:"modal-title ",id:"resetPasswordModalLabel",children:"Reset Your Password"}),(0,h.jsx)("button",{type:"button",className:"close_btn_global",onClick:()=>{Y(!1)},"aria-label":"Close",children:(0,h.jsx)(c.LwM,{size:24})})]}),(0,h.jsxs)("form",{method:"post",action:"javascript:void(0)",onSubmit:async e=>{e.preventDefault(),$(!0);let t={email:e.target.email.value};try{const e=(await s.A.post(R+"resetPassword",t,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;$(!1),1===e.status&&($(!1),U("Password reset successfully, Please check your email"),setTimeout((()=>{U("")}),3e3)),2===e.status&&(b(!0),U("Email not found!"),$(!1),setTimeout((()=>{U("")}),3e3))}catch(a){$(!1)}},children:[(0,h.jsxs)("div",{className:"mb-3",children:[(0,h.jsxs)("label",{className:"pb-1",htmlFor:"",children:["Email ",(0,h.jsx)(p.dN,{className:"text-danger",children:"*"})]}),(0,h.jsxs)(p.Jq,{children:[(0,h.jsx)(m.A,{}),(0,h.jsx)("input",{className:"passworduser",type:"email",name:"email",required:!0,placeholder:""})]})]}),(0,h.jsx)("div",{className:"d-flex justify-content-end mt-4 ",children:(0,h.jsx)("div",{className:"flex-shrink-0 gap-4",children:(0,h.jsx)("div",{className:"d-flex justify-content-end  position-relative spinner_btn",children:(0,h.jsxs)("button",{disabled:k,type:"submit",className:"global_btn","data-step":"1",children:[!Z&&" Reset Password",Z&&(0,h.jsx)("div",{className:"spinner-border text-white spinneronetimepay m-0 mt-1",role:"status",children:(0,h.jsx)("span",{className:"visually-hidden"})})]})})})})]})]})})})]})}},62837:(e,t,a)=>{"use strict";a.d(t,{$K:()=>n,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>m,R3:()=>w,Zw:()=>x,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>o,mg:()=>r,nj:()=>v,pd:()=>y,uM:()=>u,vE:()=>s,z6:()=>p});var i=a(5464);const o=i.default.div`
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
`,s=i.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,n=(i.default.div`
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
  background: var(--primary-color);
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
`),r=i.default.div`
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
    border-radius: 10px;
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
    stroke: #ff3c3e;
    stroke-width: 1.2;
  }
`),u=(i.default.div`
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
`),h=(i.default.div`
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
`),f=((0,i.default)(h)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,i.default)(h)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,i.default.sup`
  color: var(--primary-color);
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
`,y=i.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 16px;
`,w=i.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},65016:()=>{},65727:(e,t,a)=>{"use strict";a.d(t,{A:()=>i});const i=(0,a(77784).A)("lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]])},94651:(e,t,a)=>{"use strict";a.d(t,{A:()=>i});const i=(0,a(77784).A)("eye-off",[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]])},98139:(e,t)=>{var a;!function(){"use strict";var i={}.hasOwnProperty;function o(){for(var e="",t=0;t<arguments.length;t++){var a=arguments[t];a&&(e=n(e,s(a)))}return e}function s(e){if("string"===typeof e||"number"===typeof e)return e;if("object"!==typeof e)return"";if(Array.isArray(e))return o.apply(null,e);if(e.toString!==Object.prototype.toString&&!e.toString.toString().includes("[native code]"))return e.toString();var t="";for(var a in e)i.call(e,a)&&e[a]&&(t=n(t,a));return t}function n(e,t){return t?e?e+" "+t:e+t:e}e.exports?(o.default=o,e.exports=o):void 0===(a=function(){return o}.apply(t,[]))||(e.exports=a)}()},99264:(e,t,a)=>{"use strict";e.exports=a.p+"static/media/login2.69b8f8340a1d56e9e2fc.jpg"}}]);
//# sourceMappingURL=852.138df6d3.chunk.js.map