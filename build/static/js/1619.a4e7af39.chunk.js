"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[1619],{21619:(e,t,a)=>{a.r(t),a.d(t,{default:()=>g});var r=a(65043),o=(a(25015),a(94060)),i=(a(38421),a(62837)),n=a(60184),l=(a(83656),a(44710)),s=a(86213),d=a(27836),c=a(26022),p=a(50423),x=a(6720),f=(a(98030),a(58786)),m=(a(53162),a(23590),a(70579));const u=e=>{let{onClose:t,returnrefresh:a}=e;const o=localStorage.getItem("CompanyLoginData"),i=JSON.parse(o),[n,l]=(0,r.useState)([""]),[c,f]=(0,r.useState)(!1),[u,h]=(0,r.useState)(!1),[g,b]=(0,r.useState)("");return(0,m.jsx)("div",{className:"main_popup-overlay",children:(0,m.jsxs)(d.Bs,{style:{maxWidth:"900px",maxHeight:"550px",borderRadius:"12px",overflow:"hidden",display:"flex",flexDirection:"column",padding:"0px"},children:[(0,m.jsxs)("form",{onSubmit:async e=>{e.preventDefault();const t=Array.from(new Set([...n.filter((e=>""!==e.trim()))]));let r={shared_by:"Company",discount_code:e.target.code.value,emails:t,user_id:i.id};if(0===t.length)return b("Please provide at least one email."),h(!0),void setTimeout((()=>{h(!1),b("")}),2e3);f(!0);try{const t=await s.A.post("https://blueprintcatalyst.com/api/user/checkReferralUser",r,{headers:{Accept:"application/json","Content-Type":"application/json"}});f(!1),b(t.data.message),"2"===t.data.status&&h(!0),"1"===t.data.status&&(l([""]),h(!1),setTimeout((()=>{}),2e3),a(),e.target.code.value=""),setTimeout((()=>{b("")}),2e3)}catch(o){console.error("Submit error:",o)}},method:"post",action:"javascript:void(0)",style:{height:"100%",display:"flex",flexDirection:"column"},children:[(0,m.jsxs)("div",{style:{borderBottom:"1px solid #e9ecef",backgroundColor:"#f8f9fa",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0},children:[(0,m.jsx)(d.wt,{className:"mainh1",style:{margin:0,color:"#2d3748",padding:"20px"},children:"Share Referral Code"}),(0,m.jsx)(d.Jn,{onClick:t,style:{fontSize:"1.5rem",fontWeight:"300",color:"#6c757d",background:"none",border:"none",cursor:"pointer",padding:"0.25rem 0.5rem",borderRadius:"4px",transition:"all 0.2s ease"},onMouseOver:e=>e.target.style.color="#495057",onMouseOut:e=>e.target.style.color="#6c757d",children:"\xd7"})]}),(0,m.jsxs)("div",{style:{padding:"1.5rem",flex:1,display:"flex",flexDirection:"column",overflow:"hidden"},children:[g&&(0,m.jsx)("div",{className:`alert ${u?"alert-danger":"alert-success"} mb-4`,style:{borderRadius:"8px",flexShrink:0},children:g}),(0,m.jsxs)("div",{className:"mb-4 d-flex flex-column gap-2",style:{flexShrink:0},children:[(0,m.jsxs)("label",{style:{display:"block",fontSize:"0.9rem",fontWeight:"500",color:"#374151"},children:["Code ",(0,m.jsx)("span",{style:{color:"var(--primary)"},children:"*"})]}),(0,m.jsx)("div",{className:"form-group",children:(0,m.jsx)("input",{type:"text",required:!0,name:"code",className:"textarea_input",placeholder:"Enter referral code...",style:{padding:"0.75rem 1rem",borderRadius:"8px",border:"1px solid #e2e8f0",fontSize:"1rem",transition:"all 0.2s ease"},onFocus:e=>e.target.style.borderColor="#0d6efd",onBlur:e=>e.target.style.borderColor="#e2e8f0"})})]}),(0,m.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,m.jsx)("div",{style:{flexShrink:0},children:(0,m.jsxs)("label",{style:{display:"block",fontWeight:"500",color:"#374151",fontSize:"0.9rem"},children:["Email Addresses"," ",(0,m.jsx)("span",{style:{color:"var(--primary)"},children:"*"})]})}),(0,m.jsx)("div",{style:{flex:1,maxHeight:"150px",overflowY:"auto",marginBottom:"0.5rem",paddingRight:"0.5rem"},className:"custom-scrollbar",children:n.map(((e,t)=>(0,m.jsxs)("div",{className:"form-group mb-3 d-flex gap-2 align-items-start",children:[(0,m.jsx)("div",{style:{position:"relative",flex:1},children:(0,m.jsx)("input",{type:"email",required:!0,className:"textarea_input",placeholder:"Enter email address...",value:e,onChange:e=>((e,t)=>{const a=[...n];a[e]=t,l(a)})(t,e.target.value),style:{padding:"0.75rem 1rem",borderRadius:"8px",border:"1px solid #e2e8f0",fontSize:"1rem",transition:"all 0.2s ease"},onFocus:e=>e.target.style.borderColor="#0d6efd",onBlur:e=>e.target.style.borderColor="#e2e8f0"})}),t>0&&(0,m.jsx)("button",{type:"button",style:{color:"rgb(255 61 65)",background:"#fff",width:"50x",border:"none",fontSize:"23px"},onClick:()=>(e=>{const t=n.filter(((t,a)=>a!==e));l(t)})(t),children:(0,m.jsx)(x.ZKV,{})})]},t)))})]})]}),(0,m.jsxs)("div",{style:{padding:"1.25rem 1.5rem",borderTop:"1px solid #e9ecef",backgroundColor:"#f8f9fa",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"1rem",flexShrink:0},children:[(0,m.jsxs)("button",{type:"button",className:"close_btn w-fit d-flex align-items-center gap-3",onClick:()=>{l([...n,""])},children:[(0,m.jsx)("span",{children:(0,m.jsx)(p.Hpy,{width:20})}),(0,m.jsx)("span",{children:"Add More Email"})]}),(0,m.jsxs)("div",{className:"d-flex gap-2",children:[(0,m.jsx)("button",{type:"button",className:"close_btn w-fit",onClick:t,children:"Cancel"}),(0,m.jsxs)(d.IY,{disabled:c,variant:"upload",type:"submit",className:"global_btn w-fit",children:["Submit",c&&(0,m.jsx)("div",{className:"white-spinner spinner-border spinneronetimepay m-0",role:"status",style:{width:"1rem",height:"1rem"},children:(0,m.jsx)("span",{className:"visually-hidden"})})]})]})]})]}),(0,m.jsx)("style",{children:"\n        .custom-scrollbar::-webkit-scrollbar {\n          width: 6px;\n        }\n        .custom-scrollbar::-webkit-scrollbar-track {\n          background: #f1f1f1;\n          border-radius: 10px;\n        }\n        .custom-scrollbar::-webkit-scrollbar-thumb {\n          background: #c1c1c1;\n          border-radius: 10px;\n        }\n        .custom-scrollbar::-webkit-scrollbar-thumb:hover {\n          background: #a8a8a8;\n        }\n      "})]})})};var h=a(35475);function g(){document.title="Share Referral Code",(0,r.useEffect)((()=>{y()}),[]);const e=localStorage.getItem("CompanyLoginData"),t=JSON.parse(e),[a,p]=(0,r.useState)([]),[x,g]=(0,r.useState)(""),[b,w]=(0,r.useState)(!1),y=async()=>{let e={user_id:t.id};try{var a=(await s.A.post("https://blueprintcatalyst.com/api/user/getallsharedCodeByCompany",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;p(a.results)}catch(r){r.response||(r.request?console.error("Request data:",r.request):console.error("Error message:",r.message))}},v=a.filter((e=>`${e.company_name||""} - ${e.update_date||""} - ${e.version||""}`.toLowerCase().includes(x.toLowerCase())||(e.update_date||"").toLowerCase().includes(x.toLowerCase())||(e.download||"").toLowerCase().includes(x.toLowerCase()))),[k,j]=(0,r.useState)(!1);return(0,m.jsxs)(m.Fragment,{children:[(0,m.jsx)(i.mO,{children:(0,m.jsx)("div",{className:"fullpage d-block",children:(0,m.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,m.jsx)(l.A,{isCollapsed:k,setIsCollapsed:j}),(0,m.jsxs)("div",{className:"global_view "+(k?"global_view_col":""),children:[(0,m.jsx)(o.A,{}),(0,m.jsx)(i.$K,{className:"d-block p-md-4 p-3",children:(0,m.jsx)("div",{className:"container-fluid",children:(0,m.jsxs)(d.zP,{className:"d-flex flex-column gap-3",children:[(0,m.jsxs)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:[(0,m.jsx)("h4",{className:"mainh1",children:"Share Referral Code List"}),(0,m.jsxs)(c.$n,{onClick:()=>{w(!0)},type:"button",className:"btn d-flex align-items-center gap-2 px-4 py-2",style:{background:"linear-gradient(135deg, #ff3d41 0%, #d40209 100%)",border:"none",borderRadius:"8px",color:"white",fontWeight:"500",boxShadow:"0 4px 6px rgba(13, 110, 253, 0.25)",transition:"all 0.2s ease"},children:[(0,m.jsx)(n.eb3,{style:{fontSize:"14px"}}),"Share Referral"]})]}),(0,m.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,m.jsx)("input",{type:"search",placeholder:"Search Here...",className:"form-control",value:x,onChange:e=>g(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,m.jsx)("div",{className:"d-flex overflow-auto flex-column justify-content-between align-items-start tb-box",children:(0,m.jsx)(f.Ay,{customStyles:{table:{style:{minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px",overflow:"hidden"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"Shared Email",selector:e=>e.email,sortable:!0,cell:e=>(0,m.jsxs)("div",{className:"d-flex align-items-center",children:[(0,m.jsx)("div",{className:"bg-primary bg-opacity-10 p-2 rounded-circle me-3",children:(0,m.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-primary",viewBox:"0 0 16 16",children:(0,m.jsx)("path",{d:"M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4Zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2Zm13 2.383-4.708 2.825L15 11.105V5.383Zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741ZM1 11.105l4.708-2.897L1 5.383v5.722Z"})})}),(0,m.jsx)("span",{children:e.email})]})},{name:"Code",selector:e=>e.discount_code,sortable:!0,cell:e=>(0,m.jsxs)("div",{className:"d-flex align-items-center",children:[(0,m.jsx)("div",{className:"bg-info bg-opacity-10 p-2 rounded me-2",children:(0,m.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-info",viewBox:"0 0 16 16",children:[(0,m.jsx)("path",{d:"M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"}),(0,m.jsx)("path",{d:"M4.5 5.5A.5.5 0 0 1 5 5h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm0 3A.5.5 0 0 1 5 8h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm0 3A.5.5 0 0 1 5 11h3a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5z"})]})}),(0,m.jsx)("code",{className:"bg-light px-2 py-1 rounded border",style:{fontSize:"13px"},children:e.discount_code})]})},{name:"Discount",selector:e=>e.percentage+"%",sortable:!0,cell:e=>(0,m.jsxs)("div",{className:"d-flex align-items-center",children:[(0,m.jsx)("div",{className:"bg-success bg-opacity-10 p-2 rounded me-2",children:(0,m.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-success",viewBox:"0 0 16 16",children:[(0,m.jsx)("path",{d:"M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"}),(0,m.jsx)("path",{d:"M8 13A5 5 0 1 1 8 3a5 5 0 0 1 0 10zm0 1A6 6 0 1 0 8 2a6 6 0 0 0 0 12z"}),(0,m.jsx)("path",{d:"M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"})]})}),(0,m.jsxs)("span",{className:"fw-semibold text-success",children:[e.percentage,"%"]})]})},{name:"Status",selector:e=>e.company_email_match,sortable:!0,cell:e=>(0,m.jsxs)("div",{className:"d-flex align-items-center justify-content-center",style:{backgroundColor:"Yes"===e.company_email_match?"rgba(34, 197, 94, 0.1)":"rgba(239, 68, 68, 0.1)",color:"Yes"===e.company_email_match?"#166534":"#991b1b",padding:"6px 12px",borderRadius:"20px",fontSize:"13px",fontWeight:"500",width:"fit-content",border:"1px solid "+("Yes"===e.company_email_match?"rgba(34, 197, 94, 0.2)":"rgba(239, 68, 68, 0.2)")},children:["Yes"===e.company_email_match?(0,m.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"me-1",viewBox:"0 0 16 16",children:(0,m.jsx)("path",{d:"M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"})}):(0,m.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"me-1",viewBox:"0 0 16 16",children:[(0,m.jsx)("path",{d:"M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"}),(0,m.jsx)("path",{d:"M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"})]}),"Yes"===e.company_email_match?"Registered":"Pending"]})},{name:"Actions",cell:e=>(0,m.jsx)("div",{className:"d-flex gap-2",children:(0,m.jsxs)(h.N_,{to:`/share/referralcodetracking/${e.id}/${e.discount_code}`,rel:"noopener noreferrer",className:"btn btn-sm d-flex align-items-center",title:"View Usage Code",style:{backgroundColor:"rgba(59, 130, 246, 0.1)",color:"#1d4ed8",border:"1px solid rgba(59, 130, 246, 0.2)",borderRadius:"6px",padding:"6px 10px",fontSize:"13px",fontWeight:"500",transition:"all 0.2s ease"},onMouseEnter:e=>{e.target.style.backgroundColor="rgba(59, 130, 246, 0.2)",e.target.style.color="#1e40af"},onMouseLeave:e=>{e.target.style.backgroundColor="rgba(59, 130, 246, 0.1)",e.target.style.color="#1d4ed8"},children:[(0,m.jsx)(n.Ny1,{className:"me-1",style:{fontSize:"12px"}}),"View"]})}),ignoreRowClick:!0,allowOverflow:!0,button:!0}],className:"datatb-report",data:v,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})})]})})})]})]})})}),b&&(0,m.jsx)(u,{onClose:()=>w(!1),returnrefresh:()=>{y()}})]})}},23590:(e,t,a)=>{a.d(t,{A:()=>o});a(65043);var r=a(70579);const o=function(e){let{message:t,onClose:a}=e;return(0,r.jsx)(r.Fragment,{children:(0,r.jsxs)("div",{className:"alert alert-danger alert-dismissible fade show mt-3",role:"alert",children:[(0,r.jsx)("strong",{children:"Error!"})," ",t,(0,r.jsx)("button",{type:"button",className:"btn-close","data-bs-dismiss":"alert","aria-label":"Close",onClick:a})]})})}},53162:(e,t,a)=>{a.d(t,{A:()=>o});a(65043);var r=a(70579);const o=function(e){let{message:t,onClose:a}=e;return(0,r.jsx)(r.Fragment,{children:(0,r.jsxs)("div",{className:"alert alert-success alert-dismissible fade show",role:"alert",children:[(0,r.jsx)("strong",{children:"Success!"})," ",t,(0,r.jsx)("button",{type:"button",className:"btn-close","data-bs-dismiss":"alert","aria-label":"Close",onClick:a})]})})}},62837:(e,t,a)=>{a.d(t,{$K:()=>n,CB:()=>s,Cd:()=>b,I0:()=>c,Jq:()=>f,R3:()=>v,Zw:()=>x,dN:()=>h,hJ:()=>g,jh:()=>d,mO:()=>o,mg:()=>l,nj:()=>w,pd:()=>y,uM:()=>m,vE:()=>i,z6:()=>p});var r=a(5464);const o=r.default.div`
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
`,i=r.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,n=(r.default.div`
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
`,r.default.div`
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
`,r.default.div`
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
`,r.default.div`
  display: block;
  height: 100%;
`),l=r.default.div`
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
`,s=r.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=r.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=r.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=r.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,x=r.default.div`
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
`,f=(r.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,r.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,r.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,r.default.div`
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
`),m=(r.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,r.default.div`
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
`),u=(r.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,r.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,r.default.div`
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
`,r.default.button`
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
`,r.default.div`
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
`,r.default.video`
  background-color: black;
  border: none;
`,r.default.div`
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
`,r.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,r.default.button`
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
`),h=((0,r.default)(u)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,r.default)(u)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,r.default.sup`
  color: var(--primary);
`),g=r.default.div`
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
`,b=r.default.div`
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
`,w=r.default.button`
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
`,y=r.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,v=r.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},83656:()=>{}}]);
//# sourceMappingURL=1619.a4e7af39.chunk.js.map