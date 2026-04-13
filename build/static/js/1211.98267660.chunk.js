"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[1211],{41211:(e,t,o)=>{o.r(t),o.d(t,{default:()=>m});var n=o(65043),i=o(62837),a=o(86213),r=o(58786),l=o(35475),s=o(60184),d=o(86191),p=o(81906),c=o(27836),x=o(49535),u=o(65469),f=o(73216),g=(o(65490),o(37022)),b=o(70579);const m=function(){const[e,t]=(0,n.useState)(null),o=(0,f.Zp)();document.title="Company New Invitation - Investor";const[m,h]=(0,n.useState)(""),[v,w]=(0,n.useState)(!1),y=localStorage.getItem("InvestorData"),k=JSON.parse(y),[j,C]=(0,n.useState)(""),[z,_]=(0,n.useState)(!1),[N,S]=(0,n.useState)([]);(0,n.useEffect)((()=>{I()}),[]);const I=async()=>{let e={investor_id:k.id};try{const t=await a.A.post("https://capavate.com/api/user/capitalround/getInvestorCapitalMotionlist",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(t.data.results),S(t.data.results)}catch(t){console.error("Error fetching data:",t)}},A=n.useMemo((()=>{if(!N||0===N.length)return[];if(!j||""===j.trim())return N;const e=j.toLowerCase().trim();return N.filter((t=>(t.company_name||"").toLowerCase().includes(e)||(t.nameOfRound||"").toLowerCase().includes(e)||(t.shareClassType||"").toLowerCase().includes(e)||(t.instrumentType||"").toLowerCase().includes(e)||(t.roundStatus||"").toLowerCase().includes(e)||(t.company_city||"").toLowerCase().includes(e)||(t.company_country||"").toLowerCase().includes(e)||(t.roundsize||"").toLowerCase().includes(e)))}),[N,j]);(0,n.useEffect)((()=>{const o=()=>{null!==e&&t(null)};return document.addEventListener("click",o),()=>{document.removeEventListener("click",o)}}),[e]);const[R,T]=(0,n.useState)(""),[L,O]=(0,n.useState)("");return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("style",{children:"\n  .tb-box {\n    overflow: visible !important;\n  }\n\n  .rdt_Table {\n    overflow: visible !important;\n  }\n\n  .rdt_TableRow {\n    overflow: visible !important;\n    position: relative;\n  }\n\n  .rdt_TableCell {\n    overflow: visible !important;\n  }\n\n  .dropdown-menu {\n    position: absolute !important;\n    z-index: 99999 !important;\n  }\n\n  /* For the table container */\n  .datatb-report {\n    overflow: visible !important;\n  }\n\n  /* Ensure the action cell can contain absolute positioned dropdown */\n  .rdt_TableCell:last-child {\n    overflow: visible !important;\n    position: relative;\n  }\n"}),(0,b.jsx)("main",{children:(0,b.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,b.jsx)(d.A,{}),(0,b.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,b.jsx)(p.A,{}),(0,b.jsx)(i.$K,{className:"d-block p-md-4 p-3",children:(0,b.jsx)("div",{className:"container-fluid",children:(0,b.jsxs)(c.zP,{className:"d-flex flex-column gap-3",children:[(0,b.jsxs)("div",{className:"titleroom flex-wrap gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:[(0,b.jsxs)(x.o,{type:"button",className:"backbtn",onClick:()=>{o("/investor/company-list")},children:[(0,b.jsx)(u.A,{size:16,className:"me-1"})," back"]}),(0,b.jsx)("h4",{className:"mainh1",children:"Investor Round List"})]}),R&&(0,b.jsx)(g.A,{message:R,onConfirm:async()=>{try{const e=await a.A.post("https://capavate.com/api/user/investorround/archiveInvitation",{company_investor_id_id:L,investor_id:k.id},{headers:{Accept:"application/json","Content-Type":"application/json"}});e.data.status?(h("Archived successfully."),w(!1),I(),setTimeout((()=>{T(""),h("")}),3e3)):(T(""),h(e.data.message||"Failed to archive invitation."),w(!1))}catch(e){T(""),h("Something went wrong. Please try again."),w(!1)}},onCancel:()=>{T("")}}),m&&(0,b.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(v?"error_pop":"success_pop"),children:[(0,b.jsx)("div",{className:"d-flex align-items-center gap-2",children:(0,b.jsx)("span",{className:"d-block",children:m})}),(0,b.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>h(""),children:"\xd7"})]}),(0,b.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,b.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:j,onChange:e=>C(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,b.jsx)("div",{className:"d-flex flex-column justify-content-between align-items-start tb-box",children:(0,b.jsx)(r.Ay,{customStyles:{table:{style:{minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px",overflow:"visible"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap",overflow:"visible"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important",overflow:"visible"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500",position:"relative","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"Company Name",selector:e=>e.company_name,sortable:!0,cell:e=>(0,b.jsx)("span",{children:e.company_name})},{name:"City",selector:e=>e.company_city,sortable:!0,cell:e=>(0,b.jsx)("span",{children:e.company_city})},{name:"Round Status",selector:e=>e.dateroundclosed,sortable:!0,cell:e=>{const t="ACTIVE"===e.roundStatus;let o;return o=t?"Open Round (Active)":(e.dateroundclosed,"No Active Round"),(0,b.jsx)("span",{style:{padding:"4px 12px",borderRadius:"12px",fontWeight:"600",color:t?"#065f46":"#b91c1c",backgroundColor:t?"#d1fae5":"#fee2e2",fontSize:"12px",display:"inline-block"},children:o})}},{name:"Investment History",selector:e=>e.company_city,sortable:!0,cell:e=>(0,b.jsx)("span",{style:{display:"flex",alignItems:"center",gap:"8px"},children:(0,b.jsx)(l.N_,{to:`/investor/company/capital-round-list/history/${e.company_id}/${e.id}`,target:"_blank",className:"dropdown-item",style:{display:"flex",alignItems:"center",gap:"8px",padding:"8px 16px",color:"#333",textDecoration:"none"},onClick:()=>t(null),children:(0,b.jsx)(s.Ny1,{style:{cursor:"pointer",color:"#CC0000"}})})})},{name:"Company Overview & Deal Terms",sortable:!0,cell:e=>(0,b.jsx)("span",{style:{display:"flex",alignItems:"center",gap:"8px"},children:(0,b.jsx)(l.N_,{to:`/investor/company/company-round-list/view/${e.company_id}/${e.id}`,target:"_blank",className:"dropdown-item",style:{display:"flex",alignItems:"center",gap:"8px",padding:"8px 16px",color:"#333",textDecoration:"none"},onClick:()=>t(null),children:(0,b.jsx)(s.Ny1,{style:{cursor:"pointer",color:"#CC0000"}})})})},{name:"Actions",cell:o=>(0,b.jsxs)("div",{className:"position-relative",style:{position:"relative",zIndex:9999},children:[(0,b.jsx)("button",{className:"btn btn-light btn-sm",onClick:n=>((o,n)=>{n.stopPropagation(),t(e===o?null:o)})(o.id,n),style:{border:"1px solid #ddd",borderRadius:"6px",padding:"4px 8px",cursor:"pointer"},children:(0,b.jsx)(s.H_v,{})}),e===o.id&&(0,b.jsxs)("div",{className:"dropdown-menu show",style:{position:"absolute",top:"100%",right:0,left:"auto",minWidth:"220px",zIndex:99999,borderRadius:"8px",background:"#fff",boxShadow:"0 4px 12px rgba(0,0,0,0.15)",display:"block",marginTop:"4px"},children:[(0,b.jsx)("div",{className:"dropdown-divider",style:{margin:"4px 0"}}),(0,b.jsxs)(l.N_,{to:"",className:"dropdown-item",style:{display:"flex",alignItems:"center",gap:"8px",padding:"8px 16px",color:"#333",textDecoration:"none"},onClick:()=>(async e=>{O(e),T("Are you sure you want to archive this invitation?")})(o.company_investor_id),children:[(0,b.jsx)(s.OKX,{})," Archive Company"]})]})]}),ignoreRowClick:!0,allowOverflow:!0,button:!0,width:"100px"}],className:"datatb-report",data:A,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})})]})})})]})]})})]})}},62837:(e,t,o)=>{o.d(t,{$K:()=>r,CB:()=>s,Cd:()=>m,I0:()=>p,Jq:()=>x,R3:()=>w,dN:()=>g,hJ:()=>b,jh:()=>d,mO:()=>i,mg:()=>l,nj:()=>h,pd:()=>v,uM:()=>u,vE:()=>a,z6:()=>c});var n=o(5464);const i=n.default.div`
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
`,p=n.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,c=n.default.div`
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
`),u=(n.default.div`
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
`),f=(n.default.div`
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
`),g=((0,n.default)(f)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,n.default)(f)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,n.default.sup`
  color: var(--primary);
`),b=n.default.div`
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
`,m=n.default.div`
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
`,h=n.default.button`
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
`,v=n.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,w=n.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=1211.98267660.chunk.js.map