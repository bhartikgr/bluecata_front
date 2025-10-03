/*! For license information please see 6165.7c9c2d76.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[6165],{14459:(e,t,i)=>{i.d(t,{A:()=>a});const a=(0,i(77784).A)("user",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]])},25049:(e,t,i)=>{i.r(t),i.d(t,{default:()=>g});var a=i(65043),n=i(14459),l=i(53639),o=i(77784);const r=(0,o.A)("mails",[["rect",{width:"16",height:"13",x:"6",y:"4",rx:"2",key:"1drq3f"}],["path",{d:"m22 7-7.1 3.78c-.57.3-1.23.3-1.8 0L6 7",key:"xn252p"}],["path",{d:"M2 8v11c0 1.1.9 2 2 2h14",key:"n13cji"}]]),s=(0,o.A)("phone",[["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}]]);var d=i(55731),c=(i(38421),i(47984),i(53579)),p=i(62837),u=i(86213),x=i(73216),h=i(24910),m=i(26632),v=(i(65016),i(70579));function g(){const e=(0,x.Zp)(),t=localStorage.getItem("InvestorData"),[i,o]=(JSON.parse(t),(0,a.useState)(!1));var g="https://blueprintcatalyst.com/api/user/investorreport/";document.title="Investor Page";const[f,j]=(0,a.useState)({}),[y,b]=(0,a.useState)(""),[k,w]=(0,a.useState)(!1),[N,A]=(0,a.useState)([]),[S,_]=(0,a.useState)(""),z=(0,x.g)();(0,a.useEffect)((()=>{I(),C()}),[]);const C=async()=>{let e={};try{const t=await u.A.post("https://blueprintcatalyst.com/api/user/getallcountry",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});A(t.data.results)}catch(k){}},I=async()=>{let t={code:z};try{const i=await u.A.post(g+"checkinvestorCode",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});0===i.data.results.length||"Yes"===i.data.results[0].is_register?e("/investor/login"):_(i.data.results[0])}catch(k){}};(0,a.useEffect)((()=>{F()}),[]);const F=async()=>{const t={code:z.code};try{(await u.A.post(g+"getInvestorInfocheck",t,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length>0&&e("/investor/login/")}catch(k){console.error("Error generating summary",k)}},E=N.map((e=>({value:e.code,label:e.name}))),[M,q]=(0,a.useState)(!0),[T,P]=(0,a.useState)(null),[J,D]=(0,a.useState)({first_name:"",last_name:"",email:"",phone:"",ciyt:"",country:"",comments:""}),[G,L]=(0,a.useState)([]);return(0,v.jsx)(v.Fragment,{children:(0,v.jsx)(v.Fragment,{children:(0,v.jsx)(c.mO,{className:"investor-login-wrapper",children:(0,v.jsxs)("div",{className:"fullpage d-block w-100",children:[y&&(0,v.jsx)("p",{className:k?" mt-3 error_pop":"success_pop mt-3",children:y}),(0,v.jsx)(c.$K,{className:"d-block login-main-section py-5",children:(0,v.jsx)("div",{className:"container-fluid",children:(0,v.jsx)("div",{className:"row justify-content-center",children:(0,v.jsx)("div",{className:"col-xl-5 col-lg-6 col-md-8",children:(0,v.jsx)("div",{className:"card login-card shadow-lg border-0 rounded-4",children:(0,v.jsxs)("div",{className:"card-body p-5",children:[(0,v.jsxs)("div",{className:"text-start mb-4",children:[(0,v.jsx)("img",{src:"/logos/capavate.png",alt:"Capavate Logo",className:"login-logo img-fluid mb-4",style:{maxHeight:"40px"}}),(0,v.jsx)("h2",{className:"mainh1 mb-2",children:"Provide Information"}),(0,v.jsx)("p",{className:"mainp",children:"Access your investor dashboard"})]}),(0,v.jsx)("form",{action:"javascript:void(0)",method:"post",onSubmit:async t=>{var i,a,n,l,r,s,d;t.preventDefault();let c=t.target.kyc_document?t.target.kyc_document.files:null;if(J.phone.replace(/\D/g,"").length<10)return void j((e=>({...e,phone:"Phone number must be at least 10 digits"})));o(!0);let p={first_name:t.target.first_name.value,last_name:t.target.last_name.value,email:t.target.email.value,phone:J.phone,country:t.target.country.value,city:t.target.city.value,comments:"",full_address:(null===(i=t.target.full_address)||void 0===i?void 0:i.value)||"",country_tax:(null===(a=t.target.country_tax)||void 0===a?void 0:a.value)||"",tax_id:(null===(n=t.target.tax_id)||void 0===n?void 0:n.value)||"",linkedIn_profile:(null===(l=t.target.linkedIn_profile)||void 0===l?void 0:l.value)||"",accredited_status:(null===(r=t.target.accredited_status)||void 0===r?void 0:r.value)||"",industry_expertise:(null===(s=t.target.industry_expertise)||void 0===s?void 0:s.value)||"",type_of_investor:(null===(d=t.target.type_of_investor)||void 0===d?void 0:d.value)||"",id:S.id,kyc_document:c?Array.from(c):[],code:z};try{const i=await u.A.post(g+"investorInformation",p,{headers:{"Content-Type":"multipart/form-data"}});if(o(!1),b(i.data.message),"2"===i.data.status)w(!0);else{if("1"===i.data.status){var x,h,m,v,f,y,N;w(!1);z.code,t.target.first_name.value,t.target.last_name.value,t.target.email.value,t.target.phone.value,t.target.country.value,t.target.city.value,null===(x=t.target.full_address)||void 0===x||x.value,null===(h=t.target.country_tax)||void 0===h||h.value,null===(m=t.target.tax_id)||void 0===m||m.value,null===(v=t.target.linkedIn_profile)||void 0===v||v.value,null===(f=t.target.accredited_status)||void 0===f||f.value,null===(y=t.target.industry_expertise)||void 0===y||y.value,null===(N=t.target.type_of_investor)||void 0===N||N.value,S.id;setTimeout((()=>{e("/investor/login")}),2e3)}setTimeout((()=>{e("/investor/login")}),2e3)}setTimeout((()=>{b("")}),2e3)}catch(k){}},children:(0,v.jsx)(p.mg,{id:"step1",children:(0,v.jsx)("div",{className:"d-flex flex-column gap-5",children:(0,v.jsxs)("div",{className:"row gy-3",children:[(0,v.jsx)("div",{className:"col-md-6",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["First Name"," ",(0,v.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(n.A,{}),(0,v.jsx)("input",{type:"text",name:"first_name",required:!0,placeholder:""})]})]})}),(0,v.jsx)("div",{className:"col-md-6",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["Last Name"," ",(0,v.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(n.A,{}),(0,v.jsx)("input",{type:"text",name:"last_name",required:!0,placeholder:""})]})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["City ",(0,v.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(l.A,{}),(0,v.jsx)("input",{type:"text",name:"city",required:!0,placeholder:""})]})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["Email ",(0,v.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(r,{}),(0,v.jsx)("input",{value:S.email,disabled:!0,type:"text",name:"email",required:!0,placeholder:""})]})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["Phone Number"," ",(0,v.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(s,{}),(0,v.jsx)(m.Ay,{required:!0,name:"phone",defaultCountry:"CA",className:"phonregister",onChange:e=>{D((t=>({...t,phone:e})))},placeholder:"Enter phone number"}),f.phone&&(0,v.jsx)("div",{className:"text-danger",style:{fontSize:"13px"},children:f.phone})]})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["Mailing Address"," ",(0,v.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,v.jsx)(p.Jq,{children:(0,v.jsx)("textarea",{required:!0,name:"full_address",placeholder:""})})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["Country ",(0,v.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(d.A,{}),(0,v.jsxs)("select",{required:!0,name:"country",onChange:e=>{const t=e.target.value,i=e.target.options[e.target.selectedIndex].text;"Aruba"===i&&q(!1),P(i),D((t=>({...t,company_country:e.target.value})));const a=h.Ay.getStatesOfCountry(t);L(a)},placeholder:"Select or type a country",className:"form-select",children:[(0,v.jsx)("option",{value:"",children:"Select or type a country"}),E.map((e=>(0,v.jsx)("option",{value:e.value,children:e.label},e.value)))]})]})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["Country of Tax Residency"," ",(0,v.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(d.A,{}),(0,v.jsx)("input",{type:"text",name:"country_tax",required:!0,placeholder:""})]})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["Tax ID or National ID"," "]}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(n.A,{}),(0,v.jsx)("input",{type:"text",name:"tax_id",placeholder:""})]})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["LinkedIn or Professional Profile"," "]}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(n.A,{}),(0,v.jsx)("input",{type:"text",name:"linkedIn_profile",placeholder:""})]})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsx)("label",{htmlFor:"",children:"Accredited Status "}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(l.A,{}),(0,v.jsxs)("select",{name:"accredited_status",required:!0,placeholder:"Select Accredited Status",children:[(0,v.jsx)("option",{value:"",children:"--Select--"}),(0,v.jsx)("option",{value:"Accredited Investor",children:"Accredited Investor"}),(0,v.jsx)("option",{value:"Non-Accredited",children:"Non-Accredited"}),(0,v.jsx)("option",{value:"Does not apply",children:"Does not apply"}),(0,v.jsx)("option",{value:"Unknow",children:"Unknow"}),(0,v.jsx)("option",{})]})]})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["Industry Expertise"," "]}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(l.A,{}),(0,v.jsxs)("select",{name:"industry_expertise",placeholder:"",children:[(0,v.jsx)("option",{value:"",children:"--Select--"}),(0,v.jsx)("option",{value:"Aerospace & Defense",children:"Aerospace & Defense"}),(0,v.jsx)("option",{value:"Agriculture & Farming",children:"Agriculture & Farming"}),(0,v.jsx)("option",{value:"Artificial Intelligence & Machine Learning",children:"Artificial Intelligence & Machine Learning"}),(0,v.jsx)("option",{value:"Automotive",children:"Automotive"}),(0,v.jsx)("option",{value:"Banking & Financial Services",children:"Banking & Financial Services"}),(0,v.jsx)("option",{value:"Biotechnology",children:"Biotechnology"}),(0,v.jsx)("option",{value:"Chemical Industry",children:"Chemical Industry"}),(0,v.jsx)("option",{value:"Construction & Engineering",children:"Construction & Engineering"}),(0,v.jsx)("option",{value:"Consumer Goods",children:"Consumer Goods"}),(0,v.jsx)("option",{value:"Cybersecurity",children:"Cybersecurity"}),(0,v.jsx)("option",{value:"Data Storage & Management",children:"Data Storage & Management"}),(0,v.jsx)("option",{value:"Education & Training",children:"Education & Training"}),(0,v.jsx)("option",{value:"Electric Vehicles & Sustainable Transportation",children:"Electric Vehicles & Sustainable Transportation"}),(0,v.jsx)("option",{value:"Energy & Utilities",children:"Energy & Utilities"}),(0,v.jsx)("option",{value:"Entertainment & Media",children:"Entertainment & Media"}),(0,v.jsx)("option",{value:"Environmental Services & Sustainability",children:"Environmental Services & Sustainability"}),(0,v.jsx)("option",{value:"Fashion & Apparel",children:"Fashion & Apparel"}),(0,v.jsx)("option",{value:"Fintech & Digital Payments",children:"Fintech & Digital Payments"}),(0,v.jsx)("option",{value:"Food & Beverage",children:"Food & Beverage"}),(0,v.jsx)("option",{value:"Gaming & Esports",children:"Gaming & Esports"}),(0,v.jsx)("option",{value:"Healthcare & Pharmaceuticals",children:"Healthcare & Pharmaceuticals"}),(0,v.jsx)("option",{value:"Heavy Industry",children:"Heavy Industry"}),(0,v.jsx)("option",{value:"Hospitality & Tourism",children:"Hospitality & Tourism"}),(0,v.jsx)("option",{value:"Information Technology (IT)",children:"Information Technology (IT)"}),(0,v.jsx)("option",{value:"Insurance",children:"Insurance"}),(0,v.jsx)("option",{value:"Jewelry & Luxury Goods",children:"Jewelry & Luxury Goods"}),(0,v.jsx)("option",{value:"Legal Services",children:"Legal Services"}),(0,v.jsx)("option",{value:"Logistics & Supply Chain",children:"Logistics & Supply Chain"}),(0,v.jsx)("option",{value:"Manufacturing",children:"Manufacturing"}),(0,v.jsx)("option",{value:"Mining & Metals",children:"Mining & Metals"}),(0,v.jsx)("option",{value:"Nanotechnology",children:"Nanotechnology"}),(0,v.jsx)("option",{value:"Pet Care & Supplies",children:"Pet Care & Supplies"}),(0,v.jsx)("option",{value:"Public Administration & Government Services",children:"Public Administration & Government Services"}),(0,v.jsx)("option",{value:"Quantum Computing",children:"Quantum Computing"}),(0,v.jsx)("option",{value:"Real Estate & Property Management",children:"Real Estate & Property Management"}),(0,v.jsx)("option",{value:"Retail & E-commerce",children:"Retail & E-commerce"}),(0,v.jsx)("option",{value:"Robotics",children:"Robotics"}),(0,v.jsx)("option",{value:"Security & Surveillance",children:"Security & Surveillance"}),(0,v.jsx)("option",{value:"Social Media & Digital Marketing",children:"Social Media & Digital Marketing"}),(0,v.jsx)("option",{value:"Space Exploration & Satellite Technology",children:"Space Exploration & Satellite Technology"}),(0,v.jsx)("option",{value:"Sports & Fitness",children:"Sports & Fitness"}),(0,v.jsx)("option",{value:"Supply Chain & Procurement",children:"Supply Chain & Procurement"}),(0,v.jsx)("option",{value:"Telecommunications",children:"Telecommunications"}),(0,v.jsx)("option",{value:"Traditional Crafts & Artisanal Goods",children:"Traditional Crafts & Artisanal Goods"}),(0,v.jsx)("option",{value:"Transportation & Logistics",children:"Transportation & Logistics"}),(0,v.jsx)("option",{value:"Venture Capital & Private Equity",children:"Venture Capital & Private Equity"}),(0,v.jsx)("option",{value:"Video Game Industry",children:"Video Game Industry"}),(0,v.jsx)("option",{value:"Waste Management",children:"Waste Management"})]})]})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsxs)("label",{htmlFor:"",children:["Investor Type"," ",(0,v.jsx)(p.dN,{className:"labelsize",children:"*"})]}),(0,v.jsxs)(p.Jq,{children:[(0,v.jsx)(n.A,{}),(0,v.jsxs)("select",{name:"type_of_investor",required:!0,placeholder:"Select Investor Type",children:[(0,v.jsx)("option",{value:"",children:"Select Investor Type"}),(0,v.jsx)("option",{value:"Founder",children:"Founder"}),(0,v.jsx)("option",{value:"Co-Founder",children:"Co-Founder"}),(0,v.jsx)("option",{value:"Family & Friends",children:"Family & Friends"}),(0,v.jsx)("option",{value:"Advisor",children:"Advisor"}),(0,v.jsx)("option",{value:"Angel Investor",children:"Angel Investor"}),(0,v.jsx)("option",{value:"Incubator/Accelerator",children:"Incubator / Accelerator"}),(0,v.jsx)("option",{value:"Venture Capital",children:"Venture Capital (VC)"}),(0,v.jsx)("option",{value:"Private Equity",children:"Private Equity (PE)"}),(0,v.jsx)("option",{value:"Corporate Investor",children:"Corporate Investor (CVC)"}),(0,v.jsx)("option",{value:"Hedge Fund",children:"Hedge Fund"}),(0,v.jsx)("option",{value:"Bank/Financial Institution",children:"Bank / Financial Institution"}),(0,v.jsx)("option",{value:"Government/Grant",children:"Government / Grant"}),(0,v.jsx)("option",{value:"Employee (ESOP)",children:"Employee (via ESOP)"}),(0,v.jsx)("option",{value:"Other",children:"Other"})]})]})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,v.jsx)("label",{htmlFor:"",children:"KYC/AML Documentation (for institutional or cross-border investors)"}),(0,v.jsx)(p.Jq,{children:(0,v.jsx)("input",{type:"file",name:"kyc_document",className:"form-input",accept:".pdf,.jpg,.jpeg,.png",multiple:!0})}),(0,v.jsx)("small",{className:"form-text text-muted",children:"Upload ID proof, address proof, or institutional documents"})]})}),(0,v.jsx)("div",{className:"col-12",children:(0,v.jsx)("div",{className:"d-flex justify-content-end mt-4",children:(0,v.jsx)("div",{className:"flex-shrink-0",children:(0,v.jsxs)("button",{type:"submit",className:"sbtn nextbtn","data-step":"1",children:["Submit",i&&(0,v.jsx)("div",{className:"white-spinner spinner-border spinneronetimepay m-0",role:"status",children:(0,v.jsx)("span",{className:"visually-hidden"})})]})})})})]})})})})]})})})})})})]})})})})}},47984:()=>{},53639:(e,t,i)=>{i.d(t,{A:()=>a});const a=(0,i(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},55731:(e,t,i)=>{i.d(t,{A:()=>a});const a=(0,i(77784).A)("globe",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]])},62837:(e,t,i)=>{i.d(t,{$K:()=>o,CB:()=>s,Cd:()=>f,I0:()=>c,Jq:()=>x,R3:()=>b,Zw:()=>u,dN:()=>v,hJ:()=>g,jh:()=>d,mO:()=>n,mg:()=>r,nj:()=>j,pd:()=>y,uM:()=>h,vE:()=>l,z6:()=>p});var a=i(5464);const n=a.default.div`
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
`,l=a.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,o=(a.default.div`
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
`,a.default.div`
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
`,a.default.div`
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
`,a.default.div`
  display: block;
  height: 100%;
`),r=a.default.div`
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
`,s=a.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=a.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=a.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=a.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,u=a.default.div`
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
`,x=(a.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,a.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,a.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,a.default.div`
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
`),h=(a.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,a.default.div`
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
`),m=(a.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,a.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,a.default.div`
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
`,a.default.button`
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
`,a.default.div`
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
`,a.default.video`
  background-color: black;
  border: none;
`,a.default.div`
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
`,a.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,a.default.button`
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
`),v=((0,a.default)(m)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(m)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,a.default.sup`
  color: var(--primary);
`),g=a.default.div`
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
`,f=a.default.div`
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
`,j=a.default.button`
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
`,y=a.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,b=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=6165.7c9c2d76.chunk.js.map