"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[7700],{17700:(e,t,o)=>{o.r(t),o.d(t,{default:()=>x});var i=o(65043),n=o(62837),a=o(86213),r=o(58786),l=o(11262),s=o(81906),d=o(27836),c=o(18037),p=o(70579);const x=function(){const[e,t]=(0,i.useState)(!1),[o,x]=(0,i.useState)(""),[g,h]=(0,i.useState)(!1),[f,u]=(0,i.useState)([]),[m,b]=(0,i.useState)("all");var v="https://capavate.com/api/user/investor/";const w=localStorage.getItem("InvestorData"),y=JSON.parse(w),[k,j]=(0,i.useState)(""),[C,z]=(0,i.useState)(!1);document.title="My Contacts & Connections - Investor",console.log(y),(0,i.useEffect)((()=>{_()}),[]);const _=async()=>{let e={investor_id:y.id};try{const t=await a.A.post(v+"getContactConnection",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(t.data.data.connections),u(t.data.data.connections)}catch(t){}},N=(null===f||void 0===f?void 0:f.filter((e=>{if(!k)return!0;const t=k.toLowerCase();return`\n    ${e.first_name||""}\n    ${e.last_name||""}\n    ${e.email||""}\n    ${e.phone||""}\n    ${e.company_name||""}\n    ${e.city||""}\n    ${e.state||""}\n    ${e.country||""}\n    ${e.type_of_investor||""}\n    ${e.investor_type||""}\n    ${e.job_title||""}\n  `.toLowerCase().includes(t)})))||[],[S,M]=(0,i.useState)(null),[B,$]=(0,i.useState)(!1);var W=(null===y||void 0===y?void 0:y.first_name)+" "+(null===y||void 0===y?void 0:y.last_name);const A={id:y.id,type:"investor",name:W,email:y.email};return(0,p.jsxs)(p.Fragment,{children:[(0,p.jsx)("main",{children:(0,p.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,p.jsx)(l.A,{}),(0,p.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,p.jsx)(s.A,{}),(0,p.jsx)(n.$K,{className:"d-block p-md-4 p-3",children:(0,p.jsx)("div",{className:"container-fluid",children:(0,p.jsxs)(d.zP,{className:"d-flex flex-column gap-3",children:[(0,p.jsx)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:(0,p.jsx)("h4",{className:"mainh1",children:"My Contact & Connections"})}),o&&(0,p.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(g?"error_pop":"success_pop"),children:[(0,p.jsx)("div",{className:"d-flex align-items-center gap-2",children:(0,p.jsx)("span",{className:"d-block",children:o})}),(0,p.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>x(""),children:"\xd7"})]}),(0,p.jsx)("div",{style:{display:"flex",flexWrap:"wrap",gap:"10px",borderBottom:"2px solid #f0f0f0",paddingBottom:"0px",marginBottom:"16px"},children:[{key:"all",label:"All Contacts",icon:(0,p.jsxs)("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,p.jsx)("path",{d:"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"}),(0,p.jsx)("circle",{cx:"9",cy:"7",r:"4"}),(0,p.jsx)("path",{d:"M23 21v-2a4 4 0 0 0-3-3.87"}),(0,p.jsx)("path",{d:"M16 3.13a4 4 0 0 1 0 7.75"})]})},{key:"captable",label:"Cap Table Connections",icon:(0,p.jsxs)("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,p.jsx)("rect",{x:"3",y:"3",width:"18",height:"18",rx:"2"}),(0,p.jsx)("line",{x1:"3",y1:"9",x2:"21",y2:"9"}),(0,p.jsx)("line",{x1:"3",y1:"15",x2:"21",y2:"15"}),(0,p.jsx)("line",{x1:"9",y1:"9",x2:"9",y2:"21"})]})},{key:"social",label:"Social Media Connections",icon:(0,p.jsxs)("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,p.jsx)("circle",{cx:"18",cy:"5",r:"3"}),(0,p.jsx)("circle",{cx:"6",cy:"12",r:"3"}),(0,p.jsx)("circle",{cx:"18",cy:"19",r:"3"}),(0,p.jsx)("line",{x1:"8.59",y1:"13.51",x2:"15.42",y2:"17.49"}),(0,p.jsx)("line",{x1:"15.41",y1:"6.51",x2:"8.59",y2:"10.49"})]})},{key:"angel",label:"Capavate Angel Network Connections",icon:(0,p.jsx)("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,p.jsx)("polygon",{points:"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"})})}].map((e=>(0,p.jsxs)("button",{onClick:()=>b(e.key),style:{display:"flex",alignItems:"center",gap:"7px",padding:"9px 18px",borderRadius:"8px 8px 0 0",border:"none",borderBottom:m===e.key?"3px solid #CC0000":"3px solid transparent",backgroundColor:m===e.key?"#fff5f5":"transparent",color:m===e.key?"#CC0000":"#6b7280",fontWeight:m===e.key?"700":"500",fontSize:"13px",cursor:"pointer",transition:"all 0.2s",whiteSpace:"nowrap"},onMouseEnter:t=>{m!==e.key&&(t.currentTarget.style.backgroundColor="#fafafa",t.currentTarget.style.color="#CC0000")},onMouseLeave:t=>{m!==e.key&&(t.currentTarget.style.backgroundColor="transparent",t.currentTarget.style.color="#6b7280")},children:[e.icon,e.label,(0,p.jsx)("span",{style:{backgroundColor:m===e.key?"#CC0000":"#e5e7eb",color:m===e.key?"#fff":"#6b7280",borderRadius:"20px",padding:"1px 8px",fontSize:"11px",fontWeight:"600",minWidth:"22px",textAlign:"center"},children:"all"===e.key?N.length:"captable"===e.key?N.filter((e=>"captable"===e.connection_type||!0===e.is_captable||1===e.is_captable)).length:"social"===e.key?N.filter((e=>"social"===e.connection_type||!0===e.is_social||1===e.is_social)).length:N.filter((e=>"angel"===e.connection_type||!0===e.is_angel||1===e.is_angel)).length})]},e.key)))}),(0,p.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,p.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:k,onChange:e=>j(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,p.jsx)("div",{className:"d-flex  flex-column justify-content-between align-items-start tb-box",children:(0,p.jsx)(r.Ay,{customStyles:{table:{style:{overflow:"visible !important",minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"First Name",selector:e=>{var t;return e.first_name||(null===(t=e.name)||void 0===t?void 0:t.split(" ")[0])||""},sortable:!0,cell:e=>{var t;return(0,p.jsxs)("div",{className:"d-flex align-items-center",children:[(0,p.jsx)("div",{className:"bg-primary bg-opacity-10 p-2 rounded-circle me-3",children:(0,p.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-primary",viewBox:"0 0 16 16",children:(0,p.jsx)("path",{d:"M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4Zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10Z"})})}),(0,p.jsx)("span",{children:e.first_name||(null===(t=e.name)||void 0===t?void 0:t.split(" ")[0])||"-"})]})}},{name:"Last Name",selector:e=>{var t;return e.last_name||(null===(t=e.name)||void 0===t?void 0:t.split(" ")[1])||""},sortable:!0,cell:e=>{var t;return(0,p.jsxs)("div",{className:"d-flex align-items-center",children:[(0,p.jsx)("div",{className:"bg-secondary bg-opacity-10 p-2 rounded-circle me-3",children:(0,p.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-secondary",viewBox:"0 0 16 16",children:(0,p.jsx)("path",{d:"M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4Zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10Z"})})}),(0,p.jsx)("span",{children:e.last_name||(null===(t=e.name)||void 0===t?void 0:t.split(" ")[1])||"-"})]})}},{name:"Type of Investor",selector:e=>e.type_of_investor||"-",sortable:!0,cell:e=>(0,p.jsxs)("div",{className:"d-flex align-items-center",children:[(0,p.jsx)("div",{className:"bg-info bg-opacity-10 p-2 rounded me-2",children:(0,p.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-info",viewBox:"0 0 16 16",children:(0,p.jsx)("path",{d:"M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.811-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.16A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.488-2.48-1.007-3.994-1.16C10.413.81 8.985.936 8 1.783z"})})}),(0,p.jsx)("span",{children:e.type_of_investor||"-"})]})},{name:"Connection",selector:e=>e.company_name||"-",sortable:!0,cell:e=>(0,p.jsxs)("div",{className:"d-flex align-items-center",children:[(0,p.jsx)("div",{className:"bg-success bg-opacity-10 p-2 rounded me-2",children:(0,p.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-success",viewBox:"0 0 16 16",children:[(0,p.jsx)("path",{d:"M1 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H1zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"}),(0,p.jsx)("path",{fillRule:"evenodd",d:"M13.5 5a.5.5 0 0 1 .5.5V7h1.5a.5.5 0 0 1 0 1H14v1.5a.5.5 0 0 1-1 0V8h-1.5a.5.5 0 0 1 0-1H13V5.5a.5.5 0 0 1 .5-.5z"})]})}),(0,p.jsx)("span",{children:e.company_name||"-"})]})},{name:"Membership",selector:e=>e.membership_type||e.membership||"-",sortable:!0,cell:e=>(0,p.jsxs)("div",{className:"d-flex align-items-center",children:[(0,p.jsx)("div",{className:"bg-warning bg-opacity-10 p-2 rounded me-2",children:(0,p.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-warning",viewBox:"0 0 16 16",children:(0,p.jsx)("path",{d:"M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"})})}),(0,p.jsx)("span",{children:e.membership_type||e.membership||"Yes"})]})},{name:"Location",selector:e=>{const t=[e.city,e.state,e.country].filter(Boolean);return t.length>0?t.join(", "):"-"},sortable:!0,cell:e=>(0,p.jsxs)("div",{className:"d-flex align-items-center",children:[(0,p.jsx)("div",{className:"bg-danger bg-opacity-10 p-2 rounded me-2",children:(0,p.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-danger",viewBox:"0 0 16 16",children:(0,p.jsx)("path",{d:"M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"})})}),(0,p.jsx)("span",{children:[e.city,e.state,e.country].filter(Boolean).join(", ")||"-"})]})},{name:"Messages",sortable:!1,cell:e=>(0,p.jsxs)("button",{onClick:()=>{return t=e.investor_id,o=`${e.first_name||""} ${e.last_name||""}`.trim()||e.name,i=e.email,n=e.profile_picture,M({id:t,type:"investor",name:o,role:"investor",email:i,avatar:n}),void $(!0);var t,o,i,n},style:{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:20,background:"linear-gradient(135deg, #ff3e43, #ff6565)",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,boxShadow:"0 2px 8px rgba(255,62,67,.3)",transition:"transform .15s, box-shadow .15s",whiteSpace:"nowrap"},onMouseEnter:e=>{e.currentTarget.style.transform="scale(1.05)",e.currentTarget.style.boxShadow="0 4px 14px rgba(255,62,67,.45)"},onMouseLeave:e=>{e.currentTarget.style.transform="scale(1)",e.currentTarget.style.boxShadow="0 2px 8px rgba(255,62,67,.3)"},children:[(0,p.jsx)("svg",{width:"13",height:"13",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2.5",strokeLinecap:"round",strokeLinejoin:"round",children:(0,p.jsx)("path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"})}),"Message"]}),ignoreRowClick:!0,allowOverflow:!0}],className:"datatb-report",data:N,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})})]})})})]})]})}),B&&S&&(0,p.jsx)(c.A,{onClose:()=>{$(!1),M(null)},currentUser:A,selectedUser:S})]})}},62837:(e,t,o)=>{o.d(t,{$K:()=>r,CB:()=>s,Cd:()=>m,I0:()=>c,Jq:()=>x,R3:()=>w,dN:()=>f,hJ:()=>u,jh:()=>d,mO:()=>n,mg:()=>l,nj:()=>b,pd:()=>v,uM:()=>g,vE:()=>a,z6:()=>p});var i=o(5464);const n=i.default.div`
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
`,a=i.default.span`
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
`,x=(i.default.div`
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
`,i.default.div`
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
`),g=(i.default.div`
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
  color: var(--primary);
`),u=i.default.div`
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
`,m=i.default.div`
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
`}}]);
//# sourceMappingURL=7700.02adcd20.chunk.js.map