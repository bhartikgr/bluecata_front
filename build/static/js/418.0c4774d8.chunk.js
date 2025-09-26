/*! For license information please see 418.0c4774d8.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[418],{4430:()=>{},9191:()=>{},25015:()=>{},35087:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]])},35327:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("mail",[["rect",{width:"20",height:"16",x:"2",y:"4",rx:"2",key:"18n3k1"}],["path",{d:"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7",key:"1ocrg3"}]])},62837:(e,t,a)=>{a.d(t,{$K:()=>r,CB:()=>s,Cd:()=>b,I0:()=>c,Jq:()=>h,R3:()=>w,Zw:()=>x,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>o,mg:()=>l,nj:()=>y,pd:()=>v,uM:()=>m,vE:()=>n,z6:()=>p});var i=a(5464);const o=i.default.div`
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
`),u=(i.default.div`
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
`),f=((0,i.default)(u)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,i.default)(u)`
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
`,v=i.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,w=i.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},65016:()=>{},65727:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]])},69078:()=>{},90418:(e,t,a)=>{a.r(t),a.d(t,{default:()=>u});var i=a(65043),o=a(73216),n=a(86213),r=(a(4430),a(69078),a(60184)),l=a(35475),s=(a(38421),a(25015),a(94651)),d=a(35087),c=(a(65016),a(9191),a(62837)),p=a(95264),x=a(35327),h=a(65727),m=a(70579);function u(){const e=(0,o.Zp)(),[t,a]=(0,i.useState)(!1),[u,f]=(0,i.useState)(!1),[g,b]=(0,i.useState)(""),[y,v]=(0,i.useState)(""),[w,k]=((0,o.zy)(),(0,i.useState)("")),{code:j}=(0,o.g)();document.title="Accept Invition Link";var N="http://blueprintcatalyst.com/api/user/signatory/";localStorage.removeItem("SignatoryLoginData"),(0,i.useEffect)((()=>{j&&z()}),[]);const z=async()=>{try{let t={code:j};const a=(await n.A.post(N+"signatoryinvitationLink",t,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;console.log(a),0===a.results.length?e("/signatory/login"):(v(a.results),k(a.status))}catch(t){}};(0,i.useEffect)((()=>{const e=localStorage.getItem("primaryColor");e&&(document.documentElement.style.setProperty("--primary",e),document.documentElement.style.setProperty("--primary-icon",`${e}90`))}),[]);const[_,A]=(0,i.useState)({name:"",email:"",password:"",confirm_email:"",phone:""}),[C,M]=(0,i.useState)({emailMatch:"",password:""}),S=e=>{const{name:t,value:a}=e.target;A((e=>({...e,[t]:a}))),"email"!==t&&"confirm_email"!==t||("email"===t&&a!==_.confirm_email||"confirm_email"===t&&a!==_.email?M((e=>({...e,emailMatch:"Emails do not match."}))):M((e=>({...e,emailMatch:""}))))};return(0,m.jsx)(m.Fragment,{children:(0,m.jsx)("div",{className:"login_main_gradient",children:(0,m.jsx)("div",{className:"row h-100",children:(0,m.jsx)("div",{className:"col-md-7 mx-auto h-100 ",children:(0,m.jsx)("div",{className:"container-fluid h-100",children:(0,m.jsxs)("div",{className:"d-flex flex-column gap-5 p-md-5 px-3 py-5 h-100",children:[(0,m.jsxs)("div",{className:"d-flex flex-column gap-1",children:[(0,m.jsxs)("div",{className:"d-flex flex-column  align-items-center gap-4 justify-content-center",children:[(0,m.jsx)(l.N_,{to:"/",className:"logo",children:(0,m.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,m.jsxs)("p",{className:"mainp",children:["Already have an account?",(0,m.jsxs)(l.N_,{style:{color:"var(--primary)"},to:"/signatory/login",children:[" ","Sign In"]})]})]}),g&&(0,m.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(u?"error_pop":"success_pop"),children:[(0,m.jsxs)("div",{className:"d-flex align-items-center gap-2",children:[u?(0,m.jsx)(r._Hm,{className:"text-white text-xl"}):(0,m.jsx)(r.A7C,{className:"text-white text-xl"}),(0,m.jsx)("span",{className:"d-block",children:g})]}),(0,m.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>b(""),children:"\xd7"})]})]}),(0,m.jsx)(c.$K,{className:"d-flex m-auto  scroll_nonw overflow-auto ",children:(0,m.jsx)("div",{className:"container-fluid",children:(0,m.jsx)("div",{className:"row justify-content-center",children:(0,m.jsx)("div",{className:"col-12 m-0 p-0",children:"already_active"!==w?(0,m.jsx)("form",{action:"javascript:void(0)",method:"post",onSubmit:async t=>{t.preventDefault();var a=t.target.password.value;if(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/.test(a)){M((e=>({...e,password:""})));try{let t={code:j,password:a};const i=await n.A.post(N+"acceptInvitationSignatory",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});"2"===i.data.status?f(!0):(f(!1),A({name:"",email:"",password:"",confirm_email:"",phone:""}),setTimeout((()=>{e("/signatory/login")}),3500)),b(i.data.message),setTimeout((()=>{f(!1),b("")}),5500)}catch(i){}}else M((e=>({...e,password:"Password must be at least 8 characters long and include uppercase, lowercase, number, and special character."})))},children:(0,m.jsx)(c.mg,{id:"step2",children:(0,m.jsxs)("div",{className:"d-flex flex-column gap-4",children:[(0,m.jsxs)("div",{className:"d-flex flex-column gap-1 justify-content-start align-items-start",children:[(0,m.jsx)(c.jh,{children:"Sign Up"}),(0,m.jsxs)("p",{children:["Company Name"," ",(0,m.jsxs)("strong",{children:["(",y.company_name,")"]})]})]}),(0,m.jsxs)("div",{className:"row gy-3",children:[(0,m.jsx)("div",{className:"col-md-12",children:(0,m.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,m.jsxs)("label",{htmlFor:"",children:["Name ",(0,m.jsx)(c.dN,{className:"labelsize",children:"*"})]}),(0,m.jsxs)(c.Jq,{children:[(0,m.jsx)(p.A,{}),(0,m.jsx)("input",{disabled:!0,value:y.first_name+" "+y.last_name,onChange:S,type:"text",placeholder:"",name:"name",required:!0})]})]})}),(0,m.jsx)("div",{className:"col-md-6",children:(0,m.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,m.jsxs)("label",{className:"mainp",htmlFor:"",children:["Email ",(0,m.jsx)(c.dN,{className:"labelsize",children:"*"})]}),(0,m.jsxs)(c.Jq,{children:[(0,m.jsx)(x.A,{}),(0,m.jsx)("input",{disabled:!0,value:y.signatory_email,onChange:S,type:"email",required:!0,name:"email",placeholder:""})]})]})}),(0,m.jsx)("div",{className:"col-md-6",children:(0,m.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,m.jsxs)("label",{className:"mainp",htmlFor:"",children:["Password"," ",(0,m.jsx)(c.dN,{className:"labelsize",children:"*"})]}),(0,m.jsxs)("div",{className:"iconblock position-relative",children:[(0,m.jsxs)(c.Jq,{children:[(0,m.jsx)(h.A,{}),(0,m.jsx)("input",{value:_.password,onChange:S,type:t?"text":"password",required:!0,name:"password",placeholder:""})]}),(0,m.jsx)("span",{className:"eye_icon_btn",onClick:()=>a(!t),children:t?(0,m.jsx)(s.A,{size:20}):(0,m.jsx)(d.A,{size:20})})]}),C.password&&(0,m.jsx)("div",{style:{fontSize:"13px"},className:"text-danger text-start fw-semibold",children:C.password})]})}),(0,m.jsx)("div",{className:"col-12",children:(0,m.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,m.jsx)("div",{className:"flex-shrink-0"}),(0,m.jsx)("div",{className:"d-flex flex-row flex-shrink-0 gap-2",children:(0,m.jsx)("button",{type:"submit",className:"global_btn w-fit","data-step":"2",children:"Submit"})})]})})]})]})})}):(0,m.jsx)("div",{className:"joined-companies",children:"pending"===y.access_status?(0,m.jsxs)("button",{type:"button",className:"global_btn w-fit",onClick:async()=>{let t={code:j,company_name:y.company_name};try{(await n.A.post(N+"joinedCompany",t,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;b("Signatory account activated successfully"),setTimeout((()=>{e("/signatory/login")}),2500)}catch(a){}},children:["Join the Company"," ",(0,m.jsx)("b",{children:y.company_name})]}):(0,m.jsxs)("p",{className:"text-danger",children:["You have already joined"," ",y.company_name,"."]})})})})})})]})})})})})})}},94651:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("eye-off",[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]])},95264:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("building",[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["path",{d:"M9 22v-4h6v4",key:"r93iot"}],["path",{d:"M8 6h.01",key:"1dz90k"}],["path",{d:"M16 6h.01",key:"1x0f13"}],["path",{d:"M12 6h.01",key:"1vi96p"}],["path",{d:"M12 10h.01",key:"1nrarc"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M16 14h.01",key:"1gbofw"}],["path",{d:"M8 10h.01",key:"19clt8"}],["path",{d:"M8 14h.01",key:"6423bh"}]])}}]);
//# sourceMappingURL=418.0c4774d8.chunk.js.map