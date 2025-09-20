/*! For license information please see 6165.3730de5b.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[6165],{14459:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},25049:(e,t,a)=>{a.r(t),a.d(t,{default:()=>g});var i=a(65043),l=a(14459),r=a(55731),n=a(53639),o=a(77784);const s=(0,o.A)("mails",[["rect",{width:"16",height:"13",x:"6",y:"4",rx:"2",key:"1drq3f"}],["path",{d:"m22 7-7.1 3.78c-.57.3-1.23.3-1.8 0L6 7",key:"xn252p"}],["path",{d:"M2 8v11c0 1.1.9 2 2 2h14",key:"n13cji"}]]),d=(0,o.A)("phone",[["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}]]);a(38421),a(47984);var c=a(53579),p=a(62837),x=a(86213),u=a(73216),h=a(24910),m=a(26632),f=(a(65016),a(70579));function g(){const e=(0,u.Zp)(),t=localStorage.getItem("InvestorData"),[a,o]=(JSON.parse(t),(0,i.useState)(!1));var g="https://blueprintcatalyst.com/api/user/investorreport/";document.title="Investor Page";const[v,b]=(0,i.useState)(""),[y,j]=(0,i.useState)(!1),[k,w]=(0,i.useState)([]),[N,z]=(0,i.useState)(""),_=(0,u.g)();(0,i.useEffect)((()=>{q(),A()}),[]);const A=async()=>{let e={};try{const t=await x.A.post("https://blueprintcatalyst.com/api/user/getallcountry",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});w(t.data.results)}catch(y){}},q=async()=>{let t={code:_};try{const a=await x.A.post(g+"checkinvestorCode",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});0===a.data.results.length||"Yes"===a.data.results[0].is_register?e("/investor/login"):z(a.data.results[0])}catch(y){}};(0,i.useEffect)((()=>{F()}),[]);const F=async()=>{const t={code:_.code};try{(await x.A.post(g+"getInvestorInfocheck",t,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length>0&&e("/investor/login/")}catch(y){console.error("Error generating summary",y)}},I=k.map((e=>({value:e.code,label:e.name}))),[C,S]=(0,i.useState)(!0),[J,M]=(0,i.useState)(null),[E,T]=(0,i.useState)({first_name:"",last_name:"",email:"",phone:"",ciyt:"",country:"",comments:""}),[P,O]=(0,i.useState)([]);return(0,f.jsx)(f.Fragment,{children:(0,f.jsx)(f.Fragment,{children:(0,f.jsx)(c.mO,{className:"investor-login-wrapper",children:(0,f.jsxs)("div",{className:"fullpage d-block w-100",children:[v&&(0,f.jsx)("p",{className:y?" mt-3 error_pop":"success_pop mt-3",children:v}),(0,f.jsx)(c.$K,{className:"d-block login-main-section py-5",children:(0,f.jsx)("div",{className:"container-fluid",children:(0,f.jsx)("div",{className:"row justify-content-center",children:(0,f.jsx)("div",{className:"col-xl-5 col-lg-6 col-md-8",children:(0,f.jsx)("div",{className:"card login-card shadow-lg border-0 rounded-4",children:(0,f.jsxs)("div",{className:"card-body p-5",children:[(0,f.jsxs)("div",{className:"text-start mb-4",children:[(0,f.jsx)("img",{src:"/logos/capavate.png",alt:"Capavate Logo",className:"login-logo img-fluid mb-4",style:{maxHeight:"40px"}}),(0,f.jsx)("h2",{className:"mainh1 mb-2",children:"Provide Information"}),(0,f.jsx)("p",{className:"mainp",children:"Access your investor dashboard"})]}),(0,f.jsx)("form",{action:"javascript:void(0)",method:"post",onSubmit:async t=>{var a,i,l,r,n,s,d;t.preventDefault(),o(!0);let c=t.target.kyc_document?t.target.kyc_document.files:null,p={first_name:t.target.first_name.value,last_name:t.target.last_name.value,email:t.target.email.value,phone:E.phone,country:t.target.country.value,city:t.target.city.value,comments:"",full_address:(null===(a=t.target.full_address)||void 0===a?void 0:a.value)||"",country_tax:(null===(i=t.target.country_tax)||void 0===i?void 0:i.value)||"",tax_id:(null===(l=t.target.tax_id)||void 0===l?void 0:l.value)||"",linkedIn_profile:(null===(r=t.target.linkedIn_profile)||void 0===r?void 0:r.value)||"",accredited_status:(null===(n=t.target.accredited_status)||void 0===n?void 0:n.value)||"",industry_expertise:(null===(s=t.target.industry_expertise)||void 0===s?void 0:s.value)||"",type_of_investor:(null===(d=t.target.type_of_investor)||void 0===d?void 0:d.value)||"",id:N.id,kyc_document:c?Array.from(c):[],code:_};try{const a=await x.A.post(g+"investorInformation",p,{headers:{"Content-Type":"multipart/form-data"}});if(o(!1),b(a.data.message),"2"===a.data.status)j(!0);else{if("1"===a.data.status){var u,h,m,f,v,k,w;j(!1);_.code,t.target.first_name.value,t.target.last_name.value,t.target.email.value,t.target.phone.value,t.target.country.value,t.target.city.value,null===(u=t.target.full_address)||void 0===u||u.value,null===(h=t.target.country_tax)||void 0===h||h.value,null===(m=t.target.tax_id)||void 0===m||m.value,null===(f=t.target.linkedIn_profile)||void 0===f||f.value,null===(v=t.target.accredited_status)||void 0===v||v.value,null===(k=t.target.industry_expertise)||void 0===k||k.value,null===(w=t.target.type_of_investor)||void 0===w||w.value,N.id;setTimeout((()=>{e("/investor/login")}),2e3)}setTimeout((()=>{e("/investor/login")}),2e3)}setTimeout((()=>{b("")}),2e3)}catch(y){}},children:(0,f.jsx)(p.mg,{id:"step1",children:(0,f.jsx)("div",{className:"d-flex flex-column gap-5",children:(0,f.jsxs)("div",{className:"row gy-3",children:[(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["First Name"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(l.A,{}),(0,f.jsx)("input",{type:"text",name:"first_name",required:!0,placeholder:""})]})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["Last Name"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(l.A,{}),(0,f.jsx)("input",{type:"text",name:"last_name",required:!0,placeholder:""})]})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["Country ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(r.A,{}),(0,f.jsxs)("select",{required:!0,name:"country",onChange:e=>{const t=e.target.value,a=e.target.options[e.target.selectedIndex].text;"Aruba"===a&&S(!1),M(a),T((t=>({...t,company_country:e.target.value})));const i=h.Ay.getStatesOfCountry(t);O(i)},placeholder:"Select or type a country",className:"form-select",children:[(0,f.jsx)("option",{value:"",children:"Select or type a country"}),I.map((e=>(0,f.jsx)("option",{value:e.value,children:e.label},e.value)))]})]})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["City ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(n.A,{}),(0,f.jsx)("input",{type:"text",name:"city",required:!0,placeholder:""})]})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["Email ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(s,{}),(0,f.jsx)("input",{value:N.email,disabled:!0,type:"text",name:"email",required:!0,placeholder:""})]})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["Phone Number"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(d,{}),(0,f.jsx)(m.Ay,{required:!0,name:"phone",defaultCountry:"CA",className:"phonregister",onChange:e=>{T((t=>({...t,phone:e})))},placeholder:"Enter phone number"})]})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["Mailing Address"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsx)(p.Jq,{children:(0,f.jsx)("textarea",{required:!0,name:"full_address",placeholder:""})})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["Country of Tax Residency"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(r.A,{}),(0,f.jsx)("input",{type:"text",name:"country_tax",required:!0,placeholder:""})]})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["Tax ID or National ID"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(l.A,{}),(0,f.jsx)("input",{required:!0,type:"text",name:"tax_id",placeholder:""})]})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["LinkedIn or Professional Profile"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(l.A,{}),(0,f.jsx)("input",{type:"text",name:"linkedIn_profile",required:!0,placeholder:""})]})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["Accredited Status"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(n.A,{}),(0,f.jsx)("input",{type:"text",name:"accredited_status",required:!0,placeholder:""})]})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["Industry Expertise"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(n.A,{}),(0,f.jsx)("input",{type:"text",name:"industry_expertise",required:!0,placeholder:""})]})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["Investor Type"," ",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsxs)(p.Jq,{children:[(0,f.jsx)(l.A,{}),(0,f.jsxs)("select",{name:"type_of_investor",required:!0,placeholder:"Select Investor Type",children:[(0,f.jsx)("option",{value:"",children:"Select Investor Type"}),(0,f.jsx)("option",{value:"Founder",children:"Founder"}),(0,f.jsx)("option",{value:"Co-Founder",children:"Co-Founder"}),(0,f.jsx)("option",{value:"Family & Friends",children:"Family & Friends"}),(0,f.jsx)("option",{value:"Advisor",children:"Advisor"}),(0,f.jsx)("option",{value:"Angel Investor",children:"Angel Investor"}),(0,f.jsx)("option",{value:"Incubator/Accelerator",children:"Incubator / Accelerator"}),(0,f.jsx)("option",{value:"Venture Capital",children:"Venture Capital (VC)"}),(0,f.jsx)("option",{value:"Private Equity",children:"Private Equity (PE)"}),(0,f.jsx)("option",{value:"Corporate Investor",children:"Corporate Investor (CVC)"}),(0,f.jsx)("option",{value:"Hedge Fund",children:"Hedge Fund"}),(0,f.jsx)("option",{value:"Bank/Financial Institution",children:"Bank / Financial Institution"}),(0,f.jsx)("option",{value:"Government/Grant",children:"Government / Grant"}),(0,f.jsx)("option",{value:"Employee (ESOP)",children:"Employee (via ESOP)"}),(0,f.jsx)("option",{value:"Other",children:"Other"})]})]})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{htmlFor:"",children:["KYC/AML Documentation (for institutional or cross-border investors)",(0,f.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,f.jsx)(p.Jq,{children:(0,f.jsx)("input",{required:!0,type:"file",name:"kyc_document",className:"form-input",accept:".pdf,.jpg,.jpeg,.png",multiple:!0})}),(0,f.jsx)("small",{className:"form-text text-muted",children:"Upload ID proof, address proof, or institutional documents"})]})}),(0,f.jsx)("div",{className:"col-12",children:(0,f.jsx)("div",{className:"d-flex justify-content-end mt-4",children:(0,f.jsx)("div",{className:"flex-shrink-0",children:(0,f.jsxs)("button",{type:"submit",className:"sbtn nextbtn","data-step":"1",children:["Submit",a&&(0,f.jsx)("div",{className:"white-spinner spinner-border spinneronetimepay m-0",role:"status",children:(0,f.jsx)("span",{className:"visually-hidden"})})]})})})})]})})})})]})})})})})})]})})})})}},47984:()=>{},53639:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},55731:(e,t,a)=>{a.d(t,{A:()=>i});const i=(0,a(77784).A)("globe",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]])},62837:(e,t,a)=>{a.d(t,{$K:()=>n,CB:()=>s,Cd:()=>v,I0:()=>c,Jq:()=>u,R3:()=>j,Zw:()=>x,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>l,mg:()=>o,nj:()=>b,pd:()=>y,uM:()=>h,vE:()=>r,z6:()=>p});var i=a(5464);const l=i.default.div`
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
`,r=i.default.span`
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
`),o=i.default.div`
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
`,u=(i.default.div`
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
`),m=(i.default.div`
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
`),f=((0,i.default)(m)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,i.default)(m)`
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
`,v=i.default.div`
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
`,b=i.default.button`
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
  font-size: 0.9rem;
`,j=i.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=6165.3730de5b.chunk.js.map