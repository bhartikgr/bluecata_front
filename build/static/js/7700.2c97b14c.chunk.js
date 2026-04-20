"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[7700],{17700:(e,t,o)=>{o.r(t),o.d(t,{default:()=>f});var n=o(65043),i=o(62837),a=o(86213),r=o(58786),l=o(35475),s=o(11262),d=o(81906),c=o(27836),p=o(18037),x=o(70579);const f=function(){const[e,t]=(0,n.useState)(!1),[o,f]=(0,n.useState)(""),[g,u]=(0,n.useState)(!1),[h,b]=(0,n.useState)([]),[m,y]=(0,n.useState)("all");var v="https://capavate.com/api/user/investor/";const w=localStorage.getItem("InvestorData"),k=JSON.parse(w),j=null===k||void 0===k?void 0:k.access_token,[_,C]=(0,n.useState)(""),[z,S]=(0,n.useState)(!1);document.title="My Contacts & Connections - Investor",console.log(k),(0,n.useEffect)((()=>{N()}),[]);const N=async()=>{let e={investor_id:k.id};try{const t=await a.A.post(v+"getContactConnection",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${j}`}});console.log(t.data.data.connections),b(t.data.data.connections)}catch(t){}},M=(null===h||void 0===h?void 0:h.filter((e=>{if(!_)return!0;const t=_.toLowerCase();return`\n    ${e.first_name||""}\n    ${e.last_name||""}\n    ${e.email||""}\n    ${e.phone||""}\n    ${e.company_name||""}\n    ${e.city||""}\n    ${e.state||""}\n    ${e.country||""}\n    ${e.type_of_investor||""}\n    ${e.investor_type||""}\n    ${e.job_title||""}\n  `.toLowerCase().includes(t)})))||[],[T,$]=(0,n.useState)(null),[W,B]=(0,n.useState)(!1);var A=(null===k||void 0===k?void 0:k.first_name)+" "+(null===k||void 0===k?void 0:k.last_name);const L={id:k.id,type:"investor",name:A,email:k.email};return(0,x.jsxs)(x.Fragment,{children:[(0,x.jsx)("main",{children:(0,x.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,x.jsx)(s.A,{}),(0,x.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,x.jsx)(d.A,{}),(0,x.jsx)(i.$K,{className:"d-block p-md-4 p-3",children:(0,x.jsx)("div",{className:"container-fluid",children:(0,x.jsxs)(c.zP,{className:"d-flex flex-column gap-3",children:[(0,x.jsx)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:(0,x.jsx)("h4",{className:"mainh1",children:"My Contact & Connections"})}),o&&(0,x.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(g?"error_pop":"success_pop"),children:[(0,x.jsx)("div",{className:"d-flex align-items-center gap-2",children:(0,x.jsx)("span",{className:"d-block",children:o})}),(0,x.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>f(""),children:"\xd7"})]}),(0,x.jsx)("div",{style:{display:"flex",gap:"0px",borderBottom:"2px solid #f0f0f0",paddingBottom:"0px",marginBottom:"16px"},children:[{key:"all",label:"All Contacts",icon:(0,x.jsxs)("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,x.jsx)("path",{d:"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"}),(0,x.jsx)("circle",{cx:"9",cy:"7",r:"4"}),(0,x.jsx)("path",{d:"M23 21v-2a4 4 0 0 0-3-3.87"}),(0,x.jsx)("path",{d:"M16 3.13a4 4 0 0 1 0 7.75"})]})},{key:"captable",label:"Cap Table Connections",icon:(0,x.jsxs)("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,x.jsx)("rect",{x:"3",y:"3",width:"18",height:"18",rx:"2"}),(0,x.jsx)("line",{x1:"3",y1:"9",x2:"21",y2:"9"}),(0,x.jsx)("line",{x1:"3",y1:"15",x2:"21",y2:"15"}),(0,x.jsx)("line",{x1:"9",y1:"9",x2:"9",y2:"21"})]})},{key:"social",label:"Social Media Connections",icon:(0,x.jsxs)("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,x.jsx)("circle",{cx:"18",cy:"5",r:"3"}),(0,x.jsx)("circle",{cx:"6",cy:"12",r:"3"}),(0,x.jsx)("circle",{cx:"18",cy:"19",r:"3"}),(0,x.jsx)("line",{x1:"8.59",y1:"13.51",x2:"15.42",y2:"17.49"}),(0,x.jsx)("line",{x1:"15.41",y1:"6.51",x2:"8.59",y2:"10.49"})]})},{key:"angel",label:"Capavate Angel Network Connections",icon:(0,x.jsx)("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,x.jsx)("polygon",{points:"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"})})}].map((e=>(0,x.jsxs)("button",{onClick:()=>y(e.key),style:{display:"flex",alignItems:"center",gap:"7px",padding:"9px 18px",borderRadius:"8px 8px 0 0",border:"none",borderBottom:m===e.key?"3px solid #CC0000":"3px solid transparent",backgroundColor:m===e.key?"#fff5f5":"transparent",color:m===e.key?"#CC0000":"#6b7280",fontWeight:m===e.key?"700":"500",fontSize:"12px",cursor:"pointer",transition:"all 0.2s",whiteSpace:"nowrap"},onMouseEnter:t=>{m!==e.key&&(t.currentTarget.style.backgroundColor="#fafafa",t.currentTarget.style.color="#CC0000")},onMouseLeave:t=>{m!==e.key&&(t.currentTarget.style.backgroundColor="transparent",t.currentTarget.style.color="#6b7280")},children:[e.icon,e.label,(0,x.jsx)("span",{style:{backgroundColor:m===e.key?"#CC0000":"#e5e7eb",color:m===e.key?"#fff":"#6b7280",borderRadius:"20px",padding:"1px 0px",fontSize:"12px",fontWeight:"600",minWidth:"22px",textAlign:"center"},children:"all"===e.key?M.length:"captable"===e.key?M.filter((e=>"captable"===e.connection_type||!0===e.is_captable||1===e.is_captable)).length:"social"===e.key?M.filter((e=>"social"===e.connection_type||!0===e.is_social||1===e.is_social)).length:M.filter((e=>"angel"===e.connection_type||!0===e.is_angel||1===e.is_angel)).length})]},e.key)))}),(0,x.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,x.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:_,onChange:e=>C(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,x.jsx)("div",{className:"d-flex  flex-column justify-content-between align-items-start tb-box",children:(0,x.jsx)(r.Ay,{customStyles:{table:{style:{overflow:"visible !important",minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"First Name",selector:e=>{var t;return e.first_name||(null===(t=e.name)||void 0===t?void 0:t.split(" ")[0])||""},sortable:!0,cell:e=>{var t;return(0,x.jsx)("div",{className:"d-flex align-items-center",children:(0,x.jsx)("span",{children:e.first_name||(null===(t=e.name)||void 0===t?void 0:t.split(" ")[0])||"-"})})}},{name:"Last Name",selector:e=>{var t;return e.last_name||(null===(t=e.name)||void 0===t?void 0:t.split(" ")[1])||""},sortable:!0,cell:e=>{var t;return(0,x.jsx)("div",{className:"d-flex align-items-center",children:(0,x.jsx)("span",{children:e.last_name||(null===(t=e.name)||void 0===t?void 0:t.split(" ")[1])||"-"})})}},{name:"Type of Investor",selector:e=>e.type_of_investor||"-",sortable:!0,cell:e=>(0,x.jsx)("div",{className:"d-flex align-items-center",children:(0,x.jsx)("span",{children:e.type_of_investor||"-"})})},{name:"Connection",selector:e=>e.company_name||"-",sortable:!0,cell:e=>(0,x.jsx)("div",{className:"d-flex align-items-center gap-2",children:(0,x.jsxs)("div",{children:[(0,x.jsx)("div",{children:e.company_name||"-"}),"both"===e.connection_type&&(0,x.jsx)("small",{className:"text-muted",style:{fontSize:"10px"},children:"\ud83d\udcca Cap Table + \ud83d\udc7c Angel Network"}),"captable"===e.connection_type&&(0,x.jsx)("small",{className:"text-muted",style:{fontSize:"10px"},children:"\ud83d\udcca Cap Table Connection"}),"angel"===e.connection_type&&(0,x.jsx)("small",{className:"text-muted",style:{fontSize:"10px"},children:"\ud83d\udc7c Angel Network Member"})]})})},{name:"Membership",selector:e=>e.membership_status||"No",sortable:!0,cell:e=>(0,x.jsx)("div",{className:"d-flex align-items-center",children:(0,x.jsx)("span",{children:e.membership_status||"No"})})},{name:"Location",selector:e=>{const t=[e.city,e.state,e.country].filter(Boolean);return t.length>0?t.join(", "):"-"},sortable:!0,cell:e=>(0,x.jsx)("div",{className:"d-flex align-items-center",children:(0,x.jsx)("span",{children:[e.city,e.state,e.country].filter(Boolean).join(", ")||"-"})})},{name:"Messages",sortable:!1,cell:e=>(0,x.jsxs)("div",{className:"d-flex flex-wrap gap-1 py-2",children:[(0,x.jsx)("button",{title:"Message",onClick:()=>{return t=e.investor_id,o=`${e.first_name||""} ${e.last_name||""}`.trim()||e.name,n=e.email,i=e.profile_picture,$({id:t,type:"investor",name:o,role:"investor",email:n,avatar:i}),void B(!0);var t,o,n,i},style:{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:20,background:"linear-gradient(135deg, #ff3e43, #ff6565)",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,boxShadow:"0 2px 8px rgba(255,62,67,.3)",transition:"transform .15s, box-shadow .15s",whiteSpace:"nowrap"},onMouseEnter:e=>{e.currentTarget.style.transform="scale(1.05)",e.currentTarget.style.boxShadow="0 4px 14px rgba(255,62,67,.45)"},onMouseLeave:e=>{e.currentTarget.style.transform="scale(1)",e.currentTarget.style.boxShadow="0 2px 8px rgba(255,62,67,.3)"},children:(0,x.jsx)("svg",{width:"13",height:"13",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2.5",strokeLinecap:"round",strokeLinejoin:"round",children:(0,x.jsx)("path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"})})}),(0,x.jsx)(l.N_,{title:"View Profile",to:`/investor/view-profile/${e.investor_id}`,style:{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:20,background:"linear-gradient(135deg, #ff3e43, #ff6565)",color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,boxShadow:"0 2px 8px rgba(255,62,67,.3)",transition:"transform .15s, box-shadow .15s",whiteSpace:"nowrap",textDecoration:"none"},onMouseEnter:e=>{e.currentTarget.style.transform="scale(1.05)",e.currentTarget.style.boxShadow="0 4px 14px rgba(255,62,67,.45)"},onMouseLeave:e=>{e.currentTarget.style.transform="scale(1)",e.currentTarget.style.boxShadow="0 2px 8px rgba(255,62,67,.3)"},children:(0,x.jsxs)("svg",{width:"13",height:"13",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,x.jsx)("path",{d:"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"}),(0,x.jsx)("circle",{cx:"12",cy:"7",r:"4"})]})})]}),ignoreRowClick:!0,allowOverflow:!0}],className:"datatb-report",data:(()=>{switch(m){case"all":default:return M;case"captable":return M.filter((e=>"captable"===e.connection_type||!0===e.is_captable||1===e.is_captable));case"social":return M.filter((e=>"social"===e.connection_type||!0===e.is_social||1===e.is_social));case"angel":return M.filter((e=>"angel"===e.connection_type||!0===e.is_angel||1===e.is_angel))}})(),pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})})]})})})]})]})}),W&&T&&(0,x.jsx)(p.A,{onClose:()=>{B(!1),$(null)},currentUser:L,selectedUser:T})]})}},62837:(e,t,o)=>{o.d(t,{$K:()=>r,CB:()=>s,Cd:()=>b,I0:()=>c,Jq:()=>x,R3:()=>v,dN:()=>u,hJ:()=>h,jh:()=>d,mO:()=>i,mg:()=>l,nj:()=>m,pd:()=>y,uM:()=>f,vE:()=>a,z6:()=>p});var n=o(5464);const i=n.default.div`
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
`,a=n.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,r=(n.default.div`
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
`,n.default.div`
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
`,n.default.div`
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
`,n.default.div`
  display: block;
  height: 100%;
`),l=n.default.div`
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
`,s=n.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=n.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=n.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=n.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,x=(n.default.div`
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
`,n.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,n.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,n.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,n.default.div`
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
`),f=(n.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,n.default.div`
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
`),g=(n.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,n.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,n.default.div`
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
`,n.default.button`
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
`,n.default.div`
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
`,n.default.video`
  background-color: black;
  border: none;
`,n.default.div`
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
`,n.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,n.default.button`
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
`),u=((0,n.default)(g)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,n.default)(g)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,n.default.sup`
  color: var(--primary);
`),h=n.default.div`
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
`,b=n.default.div`
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
`,m=n.default.button`
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
`,y=n.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,v=n.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=7700.2c97b14c.chunk.js.map