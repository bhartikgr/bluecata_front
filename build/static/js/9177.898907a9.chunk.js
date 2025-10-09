"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[9177],{25015:()=>{},25581:(e,t,o)=>{o.d(t,{J:()=>r});const r="https://blueprintcatalyst.com/"},42552:(e,t,o)=>{o.d(t,{A:()=>g});var r=o(65043),a=(o(38421),o(73216)),n=o(53579),i=o(35475),s=o(50423),l=o(42983),d=o(9463),c=o(86213),p=o(31387),u=o(47196),m=o(70579);const h=[{label:"Dashboard",href:"/user/dashboard",icon:(0,m.jsx)(u.oeo,{size:18})},{label:"Add New Company",href:"/user/addcompany",icon:(0,m.jsx)(u.S2e,{size:18})},{label:"My Companies",href:"/user/companylist",icon:(0,m.jsx)(u.S2e,{size:18})},{label:"Manage Signatory",icon:(0,m.jsx)(u.dIq,{size:18}),dropdown:[{label:"Add New Signatory",href:"/user/add-new-signatory",icon:(0,m.jsx)(u.dIq,{size:16})},{label:"Signatory List",href:"/user/signatorylist",icon:(0,m.jsx)(u._cd,{size:16})},{label:"Approve Signatories",href:"/user/approval/signature",icon:(0,m.jsx)(u.dIq,{size:16})}]},{label:"Settings",icon:(0,m.jsx)(u.XuQ,{size:18}),dropdown:[{label:"Profile Settings",href:"/user/settings/profile",icon:(0,m.jsx)(u.dIq,{size:16})}]}],x=[{path:"/crm/addnew-investor",menuHref:"/crm/investor-directory"},{path:"/crm/edit-investor/:id",menuHref:"/crm/investor-directory"},{path:"/crm/investor-report-detail-record-round/:id",menuHref:"/crm/investorreport"},{path:"/user/signatory/activity/:id/:signatory_id",menuHref:"/user/signatorylist"},{path:"/crm/investor-report-detail/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-report-detail-due-diligence/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-record-round-reports-confirm/:id",menuHref:"/crm/investorreport"},{path:"/edit-record-round/:id",menuHref:"/record-round-list"},{path:"/createrecord",menuHref:"/record-round-list"}],f=e=>{const t=x.find((t=>(0,p.B6)({path:t.path,end:!0},e)));return t?t.menuHref:e};function g(e){let{isCollapsed:t,setIsCollapsed:o}=e;const[g,b]=(0,r.useState)(""),w=(0,a.Zp)(),[v,y]=(0,r.useState)(null),[j,k]=(0,r.useState)([]),[_,N]=(0,r.useState)(!1);(0,r.useEffect)((()=>{const e=()=>{window.innerWidth<786?(N(!0),A&&A(!0)):(N(!1),A&&A(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[_]);const[S,C]=(0,r.useState)(!1),z="https://blueprintcatalyst.com/api/user/",D=void 0!==t?t:_,A=o||N,I=localStorage.getItem("OwnerLoginData"),O=JSON.parse(I);(0,r.useEffect)((()=>{const e=localStorage.getItem("OwnerLoginData");if(e){const t=JSON.parse(e);b(t);const o=(new Date).getTime();if(!(t.expiry&&o>t.expiry)){const e=t.expiry-o,r=setTimeout((()=>{localStorage.removeItem("OwnerLoginData"),w("/user/login")}),e);return()=>clearTimeout(r)}localStorage.removeItem("OwnerLoginData"),w("/user/login")}else w("/user/login")}),[w]),(0,r.useEffect)((()=>{R()}),[]);const R=async()=>{let e={user_id:O.id};try{0===(await c.A.post(z+"checkUserLogin",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length&&(localStorage.removeItem("OwnerLoginData"),w("/user/login"))}catch(t){console.error("Error fetching modules:",t)}};(0,r.useEffect)((()=>{E();const e=localStorage.getItem("selectedDropdown");e&&y(Number(e));const t=localStorage.getItem("sidebarCollapsed");if(null!==t){const e=JSON.parse(t);o?o(e):N(e)}}),[]);const E=async()=>{let e={id:""};try{const t=await c.A.post(z+"getModules",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});k(t.data.results)}catch(t){console.error("Error fetching modules:",t)}},T=(0,a.zy)(),L=(T.pathname,!D||S),F=f(T.pathname);return(0,m.jsxs)(m.Fragment,{children:[(0,m.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(D?"collapsed p-3":"p-4"),children:[(0,m.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(D?"justify-content-center":"justify-content-between"),children:[!D&&(0,m.jsx)("a",{href:"/",className:"logo",children:(0,m.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,m.jsx)(n.V4,{className:"d-flex justify-content-end",children:(0,m.jsxs)("button",{type:"button",onClick:()=>{const e=!D;A(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[D&&(0,m.jsx)(l.A,{strokeWidth:2}),!D&&(0,m.jsx)(d.A,{strokeWidth:2})]})})]}),(0,m.jsx)(n.vT,{isOpen:L,children:(0,m.jsx)(n.c0,{children:h.map(((e,t)=>{var o;const r=v===t||e.dropdown&&e.dropdown.some((e=>{const t=f(T.pathname);return t===e.href||t.startsWith(e.href)}))||"modules"===e.dynamicDropdownKey&&j.some((e=>{const t="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return T.pathname===t})),a=(null===(o=e.matchPaths)||void 0===o?void 0:o.some((e=>(0,p.B6)({path:e,end:!1},T.pathname))))||T.pathname===e.href||e.dropdown&&e.dropdown.some((e=>(x[T.pathname]||T.pathname)===e.href||(x[T.pathname]||T.pathname).startsWith(e.href)))||"modules"===e.dynamicDropdownKey&&j.some((e=>{const t="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return T.pathname===t}));return(0,m.jsx)(n.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,m.jsxs)(m.Fragment,{children:[(0,m.jsx)(n.C,{title:e.label,onClick:()=>(e=>{const t=v===e?null:e;D&&A(!D);y(t),localStorage.setItem("selectedDropdown",null!==t?t:"")})(t),children:(0,m.jsxs)("div",{className:"d-flex gap-2 align-items-center justify-content-between w-100",children:[(0,m.jsxs)("div",{className:"d-flex gap-2 align-items-start",children:[e.icon,L&&e.label]}),L&&(0,m.jsx)(n.i3,{isOpen:r,children:(0,m.jsx)(s.pte,{})})]})}),r&&(0,m.jsxs)(n.rI,{title:e.label,className:""+(L?"":"p-0"),children:[(0,m.jsx)("hr",{className:"my-2"}),e.dropdown&&e.dropdown.map(((e,t)=>{x[T.pathname]||T.pathname;const o=F===e.href||F.startsWith(e.href);return(0,m.jsx)("li",{className:"list-none",children:(0,m.jsxs)(i.N_,{to:e.href,className:`sidebar d-flex align-items-start gap-2 ${L?"":"w-fit"} ${o?"active":""}`,children:[e.icon,L&&e.label]})},t)})),"modules"===e.dynamicDropdownKey&&(0,m.jsxs)(m.Fragment,{children:[j.map(((e,t)=>{const o="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,r=T.pathname===o;return(0,m.jsx)("li",{className:"list-none",children:(0,m.jsxs)(i.N_,{to:o,title:e.name,className:`sidebar d-flex align-items-start gap-2 ${L?"":"w-fit"} ${r?"active":""}`,children:[(0,m.jsx)(u.MO3,{size:16}),L&&e.name]})},t)})),(0,m.jsx)("li",{className:"list-none",children:(0,m.jsxs)(i.N_,{title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",to:"/advicevideos",className:`sidebar d-flex align-items-start gap-2 ${L?"":"w-fit"} ${"/advicevideos"===T.pathname?"active":""}`,children:[(0,m.jsx)(u.xi0,{size:16}),L&&"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,m.jsxs)(i.N_,{to:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${L?"":"w-fit"} ${a?"active":""}`,children:[e.icon,L&&e.label]})},t)}))})})]}),(0,m.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 71px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},49177:(e,t,o)=>{o.r(t),o.d(t,{default:()=>f});var r=o(65043),a=(o(25015),o(77266)),n=(o(38421),o(62837)),i=o(42552),s=o(86213),l=o(25581),d=o(73216),c=o(58786),p=o(35659),u=o(70579);const m=e=>{let{visibleFields:t=[],data:o=[]}=e;const r=e=>t.includes(e),a=o.length>0?o:[],n=[r("share_class")&&{name:"Share Class",selector:e=>e.share_class,sortable:!0,cell:e=>(0,u.jsx)("strong",{children:e.share_class})},r("target_raise_amount")&&{name:"Target Raise Amount",selector:e=>e.target_raise_amount,sortable:!0,cell:e=>{return t=e.target_raise_amount,new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:0}).format(t);var t},right:!0},r("number_of_shares")&&{name:"Number of Shares",selector:e=>e.number_of_shares,sortable:!0,cell:e=>{return t=e.number_of_shares,new Intl.NumberFormat("en-US").format(t);var t},right:!0},r("status")&&{name:"Status of Round",cell:e=>{const t={active:{backgroundColor:"#d4edda",color:"#155724"},pending:{backgroundColor:"#fff3cd",color:"#856404"},completed:{backgroundColor:"#d1ecf1",color:"#0c5460"},closed:{backgroundColor:"#f8d7da",color:"#721c24"}}[e.status]||{backgroundColor:"#f8f9fa",color:"#212529"};return(0,u.jsx)("div",{title:e.status||"",style:{...t,padding:"5px 10px",borderRadius:"5px",textAlign:"center",minWidth:"80px"},children:(o=e.status,o?o.charAt(0).toUpperCase()+o.slice(1).toLowerCase():"")});var o},sortable:!0},{name:"Action",cell:e=>(0,u.jsxs)("button",{className:"icon_btn blue_clr",type:"button",onClick:()=>i(e.id),title:"View Details",children:[(0,u.jsx)(p.xyf,{})," View"]}),ignoreRowClick:!0,allowOverflow:!0,button:!0,width:"150px"}].filter(Boolean),i=e=>{console.log("View details for round:",e)};return(0,u.jsx)("div",{className:"d-flex flex-column overflow-auto justify-content-between align-items-start tb-box",children:(0,u.jsx)(c.Ay,{customStyles:{table:{style:{border:"1px solid #dee2e6",borderRadius:"12px",overflow:"auto"}},headCells:{style:{backgroundColor:"#efefef",fontWeight:"600",fontSize:"0.8rem",color:"#000",textTransform:"uppercase",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500"},stripedStyle:{backgroundColor:"#fff"}},pagination:{style:{marginTop:"15px",backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:n,className:"datatb-report",data:a,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0})})},h=e=>{let{visibleFields:t=[],data:o=[]}=e;const r=e=>t.includes(e),a=o.length>0?o:[],n=[r("share_class")&&{name:"Share Class",selector:e=>e.share_class,sortable:!0,cell:e=>(0,u.jsx)("strong",{children:e.share_class})},r("target_raise_amount")&&{name:"Target Raise Amount",selector:e=>e.target_raise_amount,sortable:!0,cell:e=>{return t=e.target_raise_amount,new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:0}).format(t);var t},right:!0},r("number_of_shares")&&{name:"Number of Shares",selector:e=>e.number_of_shares,sortable:!0,cell:e=>{return t=e.number_of_shares,new Intl.NumberFormat("en-US").format(t);var t},right:!0},r("status")&&{name:"Status of Round",cell:e=>{const t={active:{backgroundColor:"#d4edda",color:"#155724"},pending:{backgroundColor:"#fff3cd",color:"#856404"},completed:{backgroundColor:"#d1ecf1",color:"#0c5460"},closed:{backgroundColor:"#f8d7da",color:"#721c24"}}[e.status]||{backgroundColor:"#f8f9fa",color:"#212529"};return(0,u.jsx)("div",{title:e.status||"",style:{...t,padding:"5px 10px",borderRadius:"5px",textAlign:"center",minWidth:"80px"},children:(o=e.status,o?o.charAt(0).toUpperCase()+o.slice(1).toLowerCase():"")});var o},sortable:!0},{name:"Action",cell:e=>(0,u.jsxs)("button",{className:"icon_btn blue_clr",type:"button",onClick:()=>i(e.id),title:"View Details",children:[(0,u.jsx)(p.xyf,{})," View"]}),ignoreRowClick:!0,allowOverflow:!0,button:!0,width:"150px"}].filter(Boolean),i=e=>{console.log("View details for round:",e)};return(0,u.jsx)("div",{className:"d-flex flex-column overflow-auto justify-content-between align-items-start tb-box",children:(0,u.jsx)(c.Ay,{customStyles:{table:{style:{border:"1px solid #dee2e6",borderRadius:"12px",overflow:"auto"}},headCells:{style:{backgroundColor:"#efefef",fontWeight:"600",fontSize:"0.8rem",color:"#000",textTransform:"uppercase",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500"},stripedStyle:{backgroundColor:"#fff"}},pagination:{style:{marginTop:"15px",backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:n,className:"datatb-report",data:a,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0})})},x=e=>{let{visibleFields:t=[],data:o=[]}=e;const r=e=>t.includes(e),a=o.length>0?o:[],n=[r("share_class")&&{name:"Share Class",selector:e=>e.share_class,sortable:!0,cell:e=>(0,u.jsx)("strong",{children:e.share_class})},r("target_raise_amount")&&{name:"Target Raise Amount",selector:e=>e.target_raise_amount,sortable:!0,cell:e=>{return t=e.target_raise_amount,new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:0}).format(t);var t},right:!0},r("number_of_shares")&&{name:"Number of Shares",selector:e=>e.number_of_shares,sortable:!0,cell:e=>{return t=e.number_of_shares,new Intl.NumberFormat("en-US").format(t);var t},right:!0},r("status")&&{name:"Status of Round",cell:e=>{const t={active:{backgroundColor:"#d4edda",color:"#155724"},pending:{backgroundColor:"#fff3cd",color:"#856404"},completed:{backgroundColor:"#d1ecf1",color:"#0c5460"},closed:{backgroundColor:"#f8d7da",color:"#721c24"}}[e.status]||{backgroundColor:"#f8f9fa",color:"#212529"};return(0,u.jsx)("div",{title:e.status||"",style:{...t,padding:"5px 10px",borderRadius:"5px",textAlign:"center",minWidth:"80px"},children:(o=e.status,o?o.charAt(0).toUpperCase()+o.slice(1).toLowerCase():"")});var o},sortable:!0},{name:"Action",cell:e=>(0,u.jsxs)("button",{className:"icon_btn blue_clr",type:"button",onClick:()=>i(e.id),title:"View Details",children:[(0,u.jsx)(p.xyf,{})," View"]}),ignoreRowClick:!0,allowOverflow:!0,button:!0,width:"150px"}].filter(Boolean),i=e=>{console.log("View details for round:",e)};return(0,u.jsx)("div",{className:"d-flex flex-column overflow-auto justify-content-between align-items-start tb-box",children:(0,u.jsx)(c.Ay,{customStyles:{table:{style:{border:"1px solid #dee2e6",borderRadius:"12px",overflow:"auto"}},headCells:{style:{backgroundColor:"#efefef",fontWeight:"600",fontSize:"0.8rem",color:"#000",textTransform:"uppercase",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500"},stripedStyle:{backgroundColor:"#fff"}},pagination:{style:{marginTop:"15px",backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:n,className:"datatb-report",data:a,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0})})};function f(){const e=l.J+"api/user/signatorydashboard/",t=localStorage.getItem("OwnerLoginData"),o=JSON.parse(t);document.title="Signatory Detail";const{id:c,signatory_id:p}=(0,d.g)(),[f,g]=(0,r.useState)("");(0,r.useEffect)((()=>{b()}),[]);const b=async()=>{const t={signatory_id:p,company_id:c,user_id:o.id};try{const o=await s.A.post(e+"getSignatoryDetails",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});g(o.data)}catch(r){console.error("Error generating summary",r)}},[w,v]=(0,r.useState)(!1);return(0,u.jsx)(u.Fragment,{children:(0,u.jsx)(n.mO,{children:(0,u.jsx)("div",{className:"fullpage d-block",children:(0,u.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,u.jsx)(i.A,{isCollapsed:w,setIsCollapsed:v}),(0,u.jsxs)("div",{className:"global_view "+(w?"global_view_col":""),children:[(0,u.jsx)(a.A,{}),(0,u.jsx)(n.$K,{className:"d-block p-md-4 p-3",children:(0,u.jsx)("div",{className:"container-fluid",children:(0,u.jsx)(n.mg,{id:"step5",children:(0,u.jsxs)("div",{className:"row",children:[(0,u.jsxs)("div",{className:"col-md-12",children:[(0,u.jsxs)("div",{className:"pb-3 bar_design d-flex justify-content-between align-items-center",children:[(0,u.jsxs)("h4",{className:"h5 mb-0",children:["Email (",(0,u.jsx)("strong",{style:{fontSize:"0.875rem"},children:f.signatory_email}),")"]}),(0,u.jsxs)("h4",{className:"h5 mb-0",children:["Company Name (",(0,u.jsx)("strong",{style:{fontSize:"0.875rem"},children:f.company_name}),")"]}),(0,u.jsx)("h4",{className:"h5 mb-0",children:(0,u.jsx)("strong",{style:{backgroundColor:"active"===f.access_status?"#d4edda":"pending"===f.access_status?"#fff3cd":"#f8f9fa",color:"active"===f.access_status?"#155724":"pending"===f.access_status?"#856404":"#212529",padding:"5px 12px",borderRadius:"5px",display:"inline-block",fontSize:"0.875rem"},children:f.access_status?f.access_status.charAt(0).toUpperCase()+f.access_status.slice(1).toLowerCase():""})})]}),(0,u.jsxs)("div",{class:"row gap-0 dashboard-top",children:[(0,u.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,u.jsxs)("div",{class:"p-3",children:[(0,u.jsx)("p",{class:"small fw-medium mb-1",children:"Total Round"}),(0,u.jsx)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:(0,u.jsx)("p",{class:"h4 fw-semibold mb-0",children:f.total_allroundrecord})})]})}),(0,u.jsx)("div",{className:"col-6 col-md-3 p-0 bor",children:(0,u.jsxs)("div",{className:"p-3",children:[(0,u.jsx)("p",{className:"small fw-medium mb-1",children:"Total Dataroom Management Report"}),(0,u.jsx)("div",{children:(0,u.jsx)("p",{className:"h4 fw-semibold mb-0",children:f.total_dataroom_reports})})]})}),(0,u.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,u.jsxs)("div",{class:"p-3",children:[(0,u.jsx)("p",{class:"small fw-medium mb-1",children:"Total Investor Reporting"}),(0,u.jsx)("p",{class:"h4 fw-semibold mb-0",children:f.total_investor_reporting})]})}),(0,u.jsx)("div",{className:"col-6 col-md-3 p-0",children:(0,u.jsxs)("div",{className:"p-3",children:[(0,u.jsx)("p",{className:"small fw-medium mb-1",children:"Total Shared Report"}),(0,u.jsx)("div",{children:(0,u.jsx)("p",{className:"h4 fw-semibold mb-0",children:f.total_shared_reports})})]})})]})]}),(0,u.jsx)("div",{className:"col-12 my-4",children:(0,u.jsxs)("div",{class:"dashboard_card  modern-chart m-0",children:[(0,u.jsxs)("div",{class:"access-logs",children:[(0,u.jsx)("h4",{class:"section-title",children:"Activity"}),(0,u.jsx)(m,{})]}),(0,u.jsxs)("div",{class:"access-logs",children:[(0,u.jsx)("h4",{class:"section-title",children:"Investor Reporting"}),(0,u.jsx)(m,{})]}),(0,u.jsxs)("div",{class:"access-logs",children:[(0,u.jsx)("h4",{class:"section-title",children:"DataRoom Management"}),(0,u.jsx)(h,{})]}),(0,u.jsxs)("div",{class:"access-logs",children:[(0,u.jsx)("h4",{class:"section-title",children:"Record Round"}),(0,u.jsx)(x,{})]})]})})]})})})})]})]})})})})}},62837:(e,t,o)=>{o.d(t,{$K:()=>i,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>m,R3:()=>y,Zw:()=>u,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>a,mg:()=>s,nj:()=>w,pd:()=>v,uM:()=>h,vE:()=>n,z6:()=>p});var r=o(5464);const a=r.default.div`
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
`,n=r.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,i=(r.default.div`
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
`),s=r.default.div`
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
`,l=r.default.div`
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
`,u=r.default.div`
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
`,m=(r.default.div`
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
`),h=(r.default.div`
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
`),x=(r.default.div`
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
`),f=((0,r.default)(x)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,r.default)(x)`
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
`,v=r.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,y=r.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},77266:(e,t,o)=>{o.d(t,{A:()=>d});var r=o(65043),a=o(35475),n=o(75200),i=o(45394),s=o(53579),l=(o(86213),o(70579));const d=function(){const[e,t]=(0,r.useState)(!1),[o,d]=(0,r.useState)(""),[c,p]=(0,r.useState)(!1);return(0,l.jsxs)("div",{className:"top_bar",children:[(0,l.jsx)(s.SD,{children:(0,l.jsx)("div",{className:"container-fluid",children:(0,l.jsx)("div",{className:"d-flex gap-4 position-relative",children:(0,l.jsx)(s.FC,{className:"d-flex align-items-center justify-content-end gap-3 w-100",children:(0,l.jsx)(a.N_,{to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("OwnerLoginData"),window.location.href="/user/login"},title:"Logout",className:"logout_btn_global",children:(0,l.jsx)(n.QeK,{})})})})})}),c&&o&&(0,l.jsx)("div",{className:"main_popup-overlay",children:(0,l.jsxs)("div",{className:"popup-container",children:[(0,l.jsxs)("div",{className:"d-flex align-items-center gap-3 mb-3 justify-content-between",children:[(0,l.jsx)("h2",{className:"popup-title",children:"Credit Balance"}),(0,l.jsx)("button",{type:"button",className:"close_btn_global",onClick:()=>{p(!1)},"aria-label":"Close",children:(0,l.jsx)(i.LwM,{size:24})})]}),(0,l.jsxs)("ul",{className:"popup-list",children:[(0,l.jsxs)("li",{children:["Access to Dataroom + Investor reporting for 1 year (till"," ",(0,l.jsx)("strong",{children:(u=o.valid_until,new Date(u).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"}))}),")"]}),(0,l.jsxs)("li",{children:["Due diligence documents generated:"," ",(0,l.jsx)("strong",{children:o.total_generated})," / 1 allowed"]}),(0,l.jsxs)("li",{children:["Credit Balance Left:"," ",(0,l.jsx)("strong",{children:o.credit_balance})]}),o.extra_generations>0&&(0,l.jsx)("li",{className:"warn",children:(0,l.jsxs)("strong",{children:[o.extra_generations," additional generation(s) will incur \u20ac100 each"]})})]})]})})]});var u}}}]);
//# sourceMappingURL=9177.898907a9.chunk.js.map