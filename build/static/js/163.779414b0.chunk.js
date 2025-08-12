"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[163],{163:(e,t,a)=>{a.r(t),a.d(t,{default:()=>x});var o=a(65043),i=(a(38421),a(35475)),l=a(53579),n=a(73216),r=a(42983),s=a(86213),d=a(70579);function c(){const[e,t]=(0,o.useState)(""),a=(0,n.g)(),[c,p]=((0,n.Zp)(),(0,o.useState)([]));const[x,u]=(0,o.useState)("");(0,o.useEffect)((()=>{m()}),[]);const m=async()=>{let e={code:a};try{const t=await s.A.post("https://blueprintcatalyst.com/api/user/investorreport/checkinvestorCode",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});0===t.data.results.length||u(t.data.results[0])}catch(t){}};(0,o.useEffect)((()=>{h()}),[]);const h=async()=>{let e={id:""};try{const t=await s.A.post("https://blueprintcatalyst.com/api/user/getModules",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});p(t.data.results)}catch(t){}},[g,f]=(0,o.useState)(!1),[b,v]=(0,o.useState)(""),[y,j]=(0,o.useState)(!1);return(0,d.jsxs)(d.Fragment,{children:[(0,d.jsx)(l.SD,{children:(0,d.jsx)("div",{className:"container-lg",children:(0,d.jsxs)("div",{className:"d-flex gap-4 position-relative",children:[(0,d.jsx)(i.N_,{href:"/",className:"logo",children:(0,d.jsx)("img",{src:"/logos/logo.png",alt:"logo"})}),(0,d.jsx)(l.V4,{children:(0,d.jsx)("button",{type:"button",onClick:()=>{f(!g)},children:(0,d.jsx)(r.A,{strokeWidth:2})})}),(0,d.jsx)(l.FC,{children:(0,d.jsx)(i.N_,{to:"/investor/logout",className:"btn bg-dark py-2 hoverbge",children:"Logout"})})]})})}),y&&b&&(0,d.jsx)("div",{className:"modal fade show d-block",style:{backgroundColor:"rgba(0, 0, 0, 0.5)"},tabIndex:"-1",role:"dialog","aria-labelledby":"paymentModalLabel","aria-hidden":"false",children:(0,d.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-lg",children:(0,d.jsxs)("div",{className:"modal-content rounded-4 shadow-lg p-4",children:[(0,d.jsx)("button",{type:"button",className:"btn-close position-absolute top-0 end-0 m-3",onClick:()=>{j(!1)},"aria-label":"Close"}),(0,d.jsxs)(d.Fragment,{children:[(0,d.jsx)("h2",{className:"modal-title text-center fw-bold text-dark mb-4 ",id:"paymentModalLabel",children:"Credit Balance"}),(0,d.jsx)("div",{className:"mb-4",children:(0,d.jsxs)("ul",{className:"list-group list-group-flush mt-3",children:[(0,d.jsxs)("li",{className:"list-group-item text-dark ps-0",children:["Access to Dataroom for 3 months (till"," ",(0,d.jsx)("strong",{children:(w=b.valid_until,new Date(w).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"}))}),")"]}),(0,d.jsxs)("li",{className:"list-group-item text-dark ps-0",children:["Due diligence documents generated:"," ",(0,d.jsx)("strong",{children:b.total_generated})," / 2 allowed"]}),(0,d.jsxs)("li",{className:"list-group-item text-dark ps-0",children:["Credit Balance Left:"," ",(0,d.jsx)("strong",{children:b.credit_balance})]}),b.extra_generations>0&&(0,d.jsx)("li",{className:"list-group-item text-danger ps-0",children:(0,d.jsxs)("strong",{children:[b.extra_generations," additional generation (s) will incur \u20ac100 each"]})})]})})]})]})})})]});var w}var p=a(62837);function x(){const e=(0,n.Zp)(),t=localStorage.getItem("InvestorData");JSON.parse(t);var a="https://blueprintcatalyst.com/api/user/investorreport/";document.title="Investor Page";const[i,r]=(0,o.useState)(""),[x,u]=(0,o.useState)(!1),[m,h]=(0,o.useState)([]),[g,f]=(0,o.useState)(""),b=(0,n.g)();(0,o.useEffect)((()=>{y(),v()}),[]);const v=async()=>{let e={};try{const t=await s.A.post("https://blueprintcatalyst.com/api/user/getallcountry",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});h(t.data.results)}catch(x){}},y=async()=>{let t={code:b};try{const o=await s.A.post(a+"checkinvestorCode",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});0===o.data.results.length?e("/investor/login"):f(o.data.results[0])}catch(x){}};(0,o.useEffect)((()=>{j()}),[]);const j=async()=>{const e={code:b.code};try{(await s.A.post(a+"getInvestorInfocheck",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length}catch(x){console.error("Error generating summary",x)}},w=m.map((e=>({value:e.code,label:e.name}))),[k,N]=(0,o.useState)(!0),[z,_]=(0,o.useState)(null),[C,S]=(0,o.useState)({first_name:"",last_name:"",email:"",phone:"",ciyt:"",country:"",comments:""});return(0,d.jsx)(d.Fragment,{children:(0,d.jsx)(l.mO,{children:(0,d.jsxs)("div",{className:"fullpage d-block",children:[(0,d.jsx)(c,{}),(0,d.jsx)(l.$K,{className:"d-block py-5",children:(0,d.jsx)("div",{className:"container-lg",children:(0,d.jsx)("div",{className:"row justify-content-center",children:(0,d.jsxs)("div",{className:"col-lg-9 col-md-10",children:[i&&(0,d.jsx)("p",{className:x?" mt-3 error_pop":"success_pop mt-3",children:i}),(0,d.jsx)("form",{action:"javascript:void(0)",method:"post",onSubmit:async t=>{t.preventDefault();let o={first_name:t.target.first_name.value,last_name:t.target.last_name.value,email:t.target.email.value,phone:t.target.phone.value,country:t.target.country.value,city:t.target.city.value,comments:t.target.comments.value,code:b};try{const i=await s.A.post(a+"investorInformation",o,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(r(i.data.message),"2"===i.data.status)u(!0);else{if("1"===i.data.status){u(!1);let e={code:b.code,first_name:t.target.first_name.value,last_name:t.target.last_name.value,email:t.target.email.value,phone:t.target.phone.value,country:t.target.country.value,city:t.target.city.value,comments:t.target.comments.value};localStorage.setItem("InvestorData",JSON.stringify(e))}setTimeout((()=>{e("/investor/documentview/"+b.code)}),2e3)}setTimeout((()=>{r("")}),2e3)}catch(x){}},children:(0,d.jsx)(p.mg,{id:"step1",children:(0,d.jsxs)("div",{className:"d-flex flex-column gap-5",children:[(0,d.jsx)(p.CB,{children:"Provide Information"}),(0,d.jsxs)("div",{className:"row gy-3",children:[(0,d.jsx)("div",{className:"col-md-6",children:(0,d.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,d.jsxs)("label",{htmlFor:"",children:["First Name ",(0,d.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,d.jsx)(p.Jq,{children:(0,d.jsx)("input",{type:"text",name:"first_name",required:!0,placeholder:""})})]})}),(0,d.jsx)("div",{className:"col-md-6",children:(0,d.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,d.jsxs)("label",{htmlFor:"",children:["Last Name ",(0,d.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,d.jsx)(p.Jq,{children:(0,d.jsx)("input",{type:"text",name:"last_name",required:!0,placeholder:""})})]})}),(0,d.jsx)("div",{className:"col-md-6",children:(0,d.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,d.jsxs)("label",{htmlFor:"",children:["Email ",(0,d.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,d.jsx)(p.Jq,{children:(0,d.jsx)("input",{type:"text",name:"email",required:!0,placeholder:""})})]})}),(0,d.jsx)("div",{className:"col-md-6",children:(0,d.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,d.jsxs)("label",{htmlFor:"",children:["Phone Number ",(0,d.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,d.jsx)(p.Jq,{children:(0,d.jsx)("input",{type:"text",name:"phone",required:!0,placeholder:""})})]})}),(0,d.jsx)("div",{className:"col-md-6",children:(0,d.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,d.jsxs)("label",{htmlFor:"",children:["Country ",(0,d.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,d.jsx)(p.Jq,{children:(0,d.jsxs)("select",{required:!0,name:"country",onChange:e=>{e.target.value;const t=e.target.options[e.target.selectedIndex].text;"Aruba"===t&&N(!1),_(t),S((t=>({...t,company_country:e.target.value})))},placeholder:"Select or type a country",className:"form-select",children:[(0,d.jsx)("option",{value:"",children:"Select or type a country"}),w.map((e=>(0,d.jsx)("option",{value:e.value,children:e.label})))]})})]})}),(0,d.jsx)("div",{className:"col-md-6",children:(0,d.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,d.jsxs)("label",{htmlFor:"",children:["City ",(0,d.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,d.jsx)(p.Jq,{children:(0,d.jsx)("input",{type:"text",name:"city",required:!0,placeholder:""})})]})}),(0,d.jsx)("div",{className:"col-md-6",children:(0,d.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,d.jsxs)("label",{htmlFor:"",children:["Comments ",(0,d.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,d.jsx)(p.Jq,{children:(0,d.jsx)("textarea",{type:"text",name:"comments",required:!0,placeholder:""})})]})}),(0,d.jsx)("div",{className:"col-12",children:(0,d.jsx)("div",{className:"d-flex justify-content-end mt-4",children:(0,d.jsx)("div",{className:"flex-shrink-0",children:(0,d.jsx)("button",{type:"submit",className:"sbtn nextbtn","data-step":"1",children:"Submit"})})})})]})]})})})]})})})})]})})})}},62837:(e,t,a)=>{a.d(t,{$K:()=>s,CB:()=>c,Cd:()=>b,FC:()=>r,Jq:()=>u,R3:()=>j,SD:()=>n,Zw:()=>x,dN:()=>g,hJ:()=>f,mO:()=>i,mg:()=>d,nj:()=>v,pd:()=>y,uM:()=>m,vE:()=>l,z6:()=>p});var o=a(5464);const i=o.default.div`
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
`,l=o.default.span`
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
  background: var(--primary-color);
  border-bottom: 10px solid var(--secondary-color);
  .logo {
    display: inline-block;
    width: 140px;
    img {
      width: 100%;
    }
  }
`),r=o.default.div`
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
`,s=o.default.div`
  display: block;
  padding: 3rem 0; /* py-5 is 3rem top & bottom */
  background-color: #f3f5f7;
  min-height: 100vh;
`,d=o.default.div`
  // display: none;
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;

  &.active {
    display: block;
  }

  label {
    font-size: 16px;
    font-weight: 600;
    text-transform: capitalize;
  }

  input[type="text"],
  input[type="number"],
  input[type="email"],
  input[type="tel"],
  select {
    padding: 6px 8px 6px 35px;
    font-size: 16px;
    height: 37px;
    border-bottom: 2px solid #ccc;
    border-top: none;
    border-left: none;
    border-right: none;
    border-radius: 0px;
    width: 100%;
    background: #fff;
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
    border-radius: 4px;
    display: inline-block;
    padding: 6px 20px;
    text-transform: capitalize;
    font-size: 16px;
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
`,c=o.default.div`
  color: var(--primary-color);
  font-size: 30px;
  text-align: center;
  text-transform: uppercase;
  font-weight: 600;
  text-decoration: underline;
  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,p=o.default.div`
  display: flex;
  flex-direction: column;
  gap: 10px 0;
`,x=o.default.div`
  label {
    font-weight: 400;
    cursor: pointer;
    margin-left: 10px;
  }
`,u=(o.default.div`
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
    left: 6px;
    width: 16px; /* smaller width */
    height: 16px; /* smaller height */
    stroke: #9c9c9c;
    stroke-width: 1.2;
  }
`),m=(o.default.div`
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
  border-radius: 50%;
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
`),g=((0,o.default)(h)`
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
  color: var(--primary-color);
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
`,b=o.default.div`
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
`,v=o.default.button`
  position: absolute;
  top: -8px;
  right: -8px;
  border: none;
  background: #111;
  color: #fff;
  padding: 0px;
  border-radius: 100%;
  cursor: pointer;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  height: 26px;
`,y=o.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 16px;
`,j=o.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=163.779414b0.chunk.js.map