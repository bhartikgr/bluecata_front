"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[6741],{21619:(e,t,a)=>{a.r(t),a.d(t,{default:()=>m});var o=a(65043),r=(a(25015),a(43328)),i=(a(38421),a(62837)),l=a(60184),n=(a(83656),a(44710)),s=a(86213),d=a(27836),c=a(26022),p=a(50423),x=a(6720),f=(a(98030),a(58786)),u=(a(53162),a(23590),a(70579));const h=e=>{let{onClose:t,returnrefresh:a}=e;const r=localStorage.getItem("UserLoginData"),i=JSON.parse(r),[l,n]=(0,o.useState)([""]),[c,f]=(0,o.useState)(!1),[h,g]=(0,o.useState)(!1),[m,b]=(0,o.useState)("");return(0,u.jsx)("div",{className:"main_popup-overlay",children:(0,u.jsxs)(d.Bs,{style:{maxWidth:"900px",maxHeight:"550px",borderRadius:"12px",overflow:"hidden",display:"flex",flexDirection:"column",padding:"0px"},children:[(0,u.jsxs)("form",{onSubmit:async e=>{e.preventDefault();const t=Array.from(new Set([...l.filter((e=>""!==e.trim()))]));let o={shared_by:"Company",discount_code:e.target.code.value,emails:t,user_id:i.id};if(0===t.length)return b("Please provide at least one email."),g(!0),void setTimeout((()=>{g(!1),b("")}),2e3);f(!0);try{const t=await s.A.post("https://blueprintcatalyst.com/api/user/checkReferralUser",o,{headers:{Accept:"application/json","Content-Type":"application/json"}});f(!1),b(t.data.message),"2"===t.data.status&&g(!0),"1"===t.data.status&&(n([""]),g(!1),setTimeout((()=>{}),2e3),a(),e.target.code.value=""),setTimeout((()=>{b("")}),2e3)}catch(r){console.error("Submit error:",r)}},method:"post",action:"javascript:void(0)",style:{height:"100%",display:"flex",flexDirection:"column"},children:[(0,u.jsxs)("div",{style:{borderBottom:"1px solid #e9ecef",backgroundColor:"#f8f9fa",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0},children:[(0,u.jsx)(d.wt,{className:"mainh1",style:{margin:0,color:"#2d3748",padding:"20px"},children:"Share Referral Code"}),(0,u.jsx)(d.Jn,{onClick:t,style:{fontSize:"1.5rem",fontWeight:"300",color:"#6c757d",background:"none",border:"none",cursor:"pointer",padding:"0.25rem 0.5rem",borderRadius:"4px",transition:"all 0.2s ease"},onMouseOver:e=>e.target.style.color="#495057",onMouseOut:e=>e.target.style.color="#6c757d",children:"\xd7"})]}),(0,u.jsxs)("div",{style:{padding:"1.5rem",flex:1,display:"flex",flexDirection:"column",overflow:"hidden"},children:[m&&(0,u.jsx)("div",{className:`alert ${h?"alert-danger":"alert-success"} mb-4`,style:{borderRadius:"8px",flexShrink:0},children:m}),(0,u.jsxs)("div",{className:"mb-4 d-flex flex-column gap-2",style:{flexShrink:0},children:[(0,u.jsxs)("label",{style:{display:"block",fontSize:"0.9rem",fontWeight:"500",color:"#374151"},children:["Code ",(0,u.jsx)("span",{className:"text-danger",children:"*"})]}),(0,u.jsx)("div",{className:"form-group",children:(0,u.jsx)("input",{type:"text",required:!0,name:"code",className:"textarea_input",placeholder:"Enter referral code...",style:{padding:"0.75rem 1rem",borderRadius:"8px",border:"1px solid #e2e8f0",fontSize:"1rem",transition:"all 0.2s ease"},onFocus:e=>e.target.style.borderColor="#0d6efd",onBlur:e=>e.target.style.borderColor="#e2e8f0"})})]}),(0,u.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,u.jsx)("div",{style:{flexShrink:0},children:(0,u.jsxs)("label",{style:{display:"block",fontWeight:"500",color:"#374151",fontSize:"0.9rem"},children:["Email Addresses ",(0,u.jsx)("span",{className:"text-danger",children:"*"})]})}),(0,u.jsx)("div",{style:{flex:1,maxHeight:"150px",overflowY:"auto",marginBottom:"0.5rem",paddingRight:"0.5rem"},className:"custom-scrollbar",children:l.map(((e,t)=>(0,u.jsxs)("div",{className:"form-group mb-3 d-flex gap-2 align-items-start",children:[(0,u.jsx)("div",{style:{position:"relative",flex:1},children:(0,u.jsx)("input",{type:"email",required:!0,className:"textarea_input",placeholder:"Enter email address...",value:e,onChange:e=>((e,t)=>{const a=[...l];a[e]=t,n(a)})(t,e.target.value),style:{padding:"0.75rem 1rem",borderRadius:"8px",border:"1px solid #e2e8f0",fontSize:"1rem",transition:"all 0.2s ease"},onFocus:e=>e.target.style.borderColor="#0d6efd",onBlur:e=>e.target.style.borderColor="#e2e8f0"})}),t>0&&(0,u.jsx)("button",{type:"button",style:{color:"rgb(255 61 65)",background:"#fff",width:"50x",border:"none",fontSize:"23px"},onClick:()=>(e=>{const t=l.filter(((t,a)=>a!==e));n(t)})(t),children:(0,u.jsx)(x.ZKV,{})})]},t)))})]})]}),(0,u.jsxs)("div",{style:{padding:"1.25rem 1.5rem",borderTop:"1px solid #e9ecef",backgroundColor:"#f8f9fa",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"1rem",flexShrink:0},children:[(0,u.jsxs)("button",{type:"button",className:"close_btn w-fit d-flex align-items-center gap-3",onClick:()=>{n([...l,""])},children:[(0,u.jsx)("span",{children:(0,u.jsx)(p.Hpy,{width:20})}),(0,u.jsx)("span",{children:"Add More Email"})]}),(0,u.jsxs)("div",{className:"d-flex gap-2",children:[(0,u.jsx)("button",{type:"button",className:"close_btn w-fit",onClick:t,children:"Cancel"}),(0,u.jsxs)(d.IY,{disabled:c,variant:"upload",type:"submit",className:"global_btn w-fit",children:["Submit",c&&(0,u.jsx)("div",{className:"white-spinner spinner-border spinneronetimepay m-0",role:"status",style:{width:"1rem",height:"1rem"},children:(0,u.jsx)("span",{className:"visually-hidden"})})]})]})]})]}),(0,u.jsx)("style",{children:"\n        .custom-scrollbar::-webkit-scrollbar {\n          width: 6px;\n        }\n        .custom-scrollbar::-webkit-scrollbar-track {\n          background: #f1f1f1;\n          border-radius: 10px;\n        }\n        .custom-scrollbar::-webkit-scrollbar-thumb {\n          background: #c1c1c1;\n          border-radius: 10px;\n        }\n        .custom-scrollbar::-webkit-scrollbar-thumb:hover {\n          background: #a8a8a8;\n        }\n      "})]})})};var g=a(35475);function m(){document.title="Share Referral Code",(0,o.useEffect)((()=>{y()}),[]);const e=localStorage.getItem("UserLoginData"),t=JSON.parse(e),[a,p]=(0,o.useState)([]),[x,m]=(0,o.useState)(""),[b,w]=(0,o.useState)(!1),y=async()=>{let e={user_id:t.id};try{var a=(await s.A.post("https://blueprintcatalyst.com/api/user/getallsharedCodeByCompany",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;p(a.results)}catch(o){o.response||(o.request?console.error("Request data:",o.request):console.error("Error message:",o.message))}},v=a.filter((e=>`${e.company_name||""} - ${e.update_date||""} - ${e.version||""}`.toLowerCase().includes(x.toLowerCase())||(e.update_date||"").toLowerCase().includes(x.toLowerCase())||(e.download||"").toLowerCase().includes(x.toLowerCase()))),[k,j]=(0,o.useState)(!1);return(0,u.jsxs)(u.Fragment,{children:[(0,u.jsx)(i.mO,{children:(0,u.jsx)("div",{className:"fullpage d-block",children:(0,u.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,u.jsx)(n.A,{isCollapsed:k,setIsCollapsed:j}),(0,u.jsxs)("div",{className:"global_view "+(k?"global_view_col":""),children:[(0,u.jsx)(r.A,{}),(0,u.jsx)(i.$K,{className:"d-block p-4",children:(0,u.jsx)("div",{className:"container-fluid",children:(0,u.jsxs)(d.zP,{className:"d-flex flex-column gap-3",children:[(0,u.jsxs)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:[(0,u.jsx)("h4",{className:"mainh1",children:"Share Referral Code List"}),(0,u.jsxs)(c.$n,{onClick:()=>{w(!0)},type:"button",className:"btn d-flex align-items-center gap-2 px-4 py-2",style:{background:"linear-gradient(135deg, #ff3d41 0%, #d40209 100%)",border:"none",borderRadius:"8px",color:"white",fontWeight:"500",boxShadow:"0 4px 6px rgba(13, 110, 253, 0.25)",transition:"all 0.2s ease"},children:[(0,u.jsx)(l.eb3,{style:{fontSize:"14px"}}),"Share Referral"]})]}),(0,u.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,u.jsx)("input",{type:"search",placeholder:"Search Here...",className:"form-control",value:x,onChange:e=>m(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,u.jsx)("div",{className:"d-flex overflow-auto flex-column justify-content-between align-items-start tb-box",children:(0,u.jsx)(f.Ay,{customStyles:{table:{style:{minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px",overflow:"hidden"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"Shared Email",selector:e=>e.email,sortable:!0,cell:e=>(0,u.jsxs)("div",{className:"d-flex align-items-center",children:[(0,u.jsx)("div",{className:"bg-primary bg-opacity-10 p-2 rounded-circle me-3",children:(0,u.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-primary",viewBox:"0 0 16 16",children:(0,u.jsx)("path",{d:"M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4Zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2Zm13 2.383-4.708 2.825L15 11.105V5.383Zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741ZM1 11.105l4.708-2.897L1 5.383v5.722Z"})})}),(0,u.jsx)("span",{children:e.email})]})},{name:"Code",selector:e=>e.discount_code,sortable:!0,cell:e=>(0,u.jsxs)("div",{className:"d-flex align-items-center",children:[(0,u.jsx)("div",{className:"bg-info bg-opacity-10 p-2 rounded me-2",children:(0,u.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-info",viewBox:"0 0 16 16",children:[(0,u.jsx)("path",{d:"M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"}),(0,u.jsx)("path",{d:"M4.5 5.5A.5.5 0 0 1 5 5h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm0 3A.5.5 0 0 1 5 8h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm0 3A.5.5 0 0 1 5 11h3a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5z"})]})}),(0,u.jsx)("code",{className:"bg-light px-2 py-1 rounded border",style:{fontSize:"13px"},children:e.discount_code})]})},{name:"Discount",selector:e=>e.percentage+"%",sortable:!0,cell:e=>(0,u.jsxs)("div",{className:"d-flex align-items-center",children:[(0,u.jsx)("div",{className:"bg-success bg-opacity-10 p-2 rounded me-2",children:(0,u.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-success",viewBox:"0 0 16 16",children:[(0,u.jsx)("path",{d:"M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"}),(0,u.jsx)("path",{d:"M8 13A5 5 0 1 1 8 3a5 5 0 0 1 0 10zm0 1A6 6 0 1 0 8 2a6 6 0 0 0 0 12z"}),(0,u.jsx)("path",{d:"M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"})]})}),(0,u.jsxs)("span",{className:"fw-semibold text-success",children:[e.percentage,"%"]})]})},{name:"Status",selector:e=>e.company_email_match,sortable:!0,cell:e=>(0,u.jsxs)("div",{className:"d-flex align-items-center justify-content-center",style:{backgroundColor:"Yes"===e.company_email_match?"rgba(34, 197, 94, 0.1)":"rgba(239, 68, 68, 0.1)",color:"Yes"===e.company_email_match?"#166534":"#991b1b",padding:"6px 12px",borderRadius:"20px",fontSize:"13px",fontWeight:"500",width:"fit-content",border:"1px solid "+("Yes"===e.company_email_match?"rgba(34, 197, 94, 0.2)":"rgba(239, 68, 68, 0.2)")},children:["Yes"===e.company_email_match?(0,u.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"me-1",viewBox:"0 0 16 16",children:(0,u.jsx)("path",{d:"M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"})}):(0,u.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"me-1",viewBox:"0 0 16 16",children:[(0,u.jsx)("path",{d:"M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"}),(0,u.jsx)("path",{d:"M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"})]}),"Yes"===e.company_email_match?"Registered":"Pending"]})},{name:"Actions",cell:e=>(0,u.jsx)("div",{className:"d-flex gap-2",children:(0,u.jsxs)(g.N_,{to:`/share/referralcodetracking/${e.id}/${e.discount_code}`,rel:"noopener noreferrer",className:"btn btn-sm d-flex align-items-center",title:"View Usage Code",style:{backgroundColor:"rgba(59, 130, 246, 0.1)",color:"#1d4ed8",border:"1px solid rgba(59, 130, 246, 0.2)",borderRadius:"6px",padding:"6px 10px",fontSize:"13px",fontWeight:"500",transition:"all 0.2s ease"},onMouseEnter:e=>{e.target.style.backgroundColor="rgba(59, 130, 246, 0.2)",e.target.style.color="#1e40af"},onMouseLeave:e=>{e.target.style.backgroundColor="rgba(59, 130, 246, 0.1)",e.target.style.color="#1d4ed8"},children:[(0,u.jsx)(l.Ny1,{className:"me-1",style:{fontSize:"12px"}}),"View"]})}),ignoreRowClick:!0,allowOverflow:!0,button:!0}],className:"datatb-report",data:v,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})})]})})})]})]})})}),b&&(0,u.jsx)(h,{onClose:()=>w(!1),returnrefresh:()=>{y()}})]})}},23590:(e,t,a)=>{a.d(t,{A:()=>r});a(65043);var o=a(70579);const r=function(e){let{message:t,onClose:a}=e;return(0,o.jsx)(o.Fragment,{children:(0,o.jsxs)("div",{className:"alert alert-danger alert-dismissible fade show mt-3",role:"alert",children:[(0,o.jsx)("strong",{children:"Error!"})," ",t,(0,o.jsx)("button",{type:"button",className:"btn-close","data-bs-dismiss":"alert","aria-label":"Close",onClick:a})]})})}},53162:(e,t,a)=>{a.d(t,{A:()=>r});a(65043);var o=a(70579);const r=function(e){let{message:t,onClose:a}=e;return(0,o.jsx)(o.Fragment,{children:(0,o.jsxs)("div",{className:"alert alert-success alert-dismissible fade show",role:"alert",children:[(0,o.jsx)("strong",{children:"Success!"})," ",t,(0,o.jsx)("button",{type:"button",className:"btn-close","data-bs-dismiss":"alert","aria-label":"Close",onClick:a})]})})}},62837:(e,t,a)=>{a.d(t,{$K:()=>l,CB:()=>s,Cd:()=>b,I0:()=>c,Jq:()=>f,R3:()=>v,Zw:()=>x,dN:()=>g,hJ:()=>m,jh:()=>d,mO:()=>r,mg:()=>n,nj:()=>w,pd:()=>y,uM:()=>u,vE:()=>i,z6:()=>p});var o=a(5464);const r=o.default.div`
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
`,i=o.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,l=(o.default.div`
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
`),n=o.default.div`
  // display: none;

  border-radius: 0px;

  &.active {
    display: block;
  }

  label {
    font-size: 1.3rem;
    font-weight: 500;
    color:#000;
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
    border-radius: 50px;
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
    border-radius: 50px;
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
`,s=o.default.div`
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
`,x=o.default.div`
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
    margin-top:2px;
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
  }
`,f=(o.default.div`
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
    stroke: #ff3c3e;
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
`),m=o.default.div`
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
`,w=o.default.button`
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
`,v=o.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=6741.81f05776.chunk.js.map