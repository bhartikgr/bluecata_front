"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[8177],{18177:(e,t,a)=>{a.r(t),a.d(t,{default:()=>h});var o=a(65043),r=(a(25015),a(43328)),i=(a(38421),a(62837)),n=a(60184),s=(a(83656),a(44710)),l=a(86213),d=a(27836),c=(a(26022),a(58786)),p=a(70579);const x=e=>{let{onClose:t,returnrefresh:a,sharedDetail:o,sharedDetailSingleUsage:r}=e;console.log(r);const i=sessionStorage.getItem("UserLoginData"),n=JSON.parse(i);function s(e){const t=new Date(e);if(isNaN(t))return"";const a=t.getDate(),o=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],r=t.getFullYear();return`${o} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${r}`}return(0,p.jsx)(d.hJ,{children:(0,p.jsxs)(d.Bs,{style:{maxWidth:"900px",maxHeight:"550px"},children:[(0,p.jsx)(d.Jn,{onClick:t,children:"\xd7"}),(0,p.jsx)("div",{className:"d-flex flex-column justify-content-between align-items-start tb-box",children:(0,p.jsx)("div",{className:"mb-5",children:(0,p.jsxs)("div",{className:"row g-3 text-sm text-muted",children:[(0,p.jsx)("div",{className:"titleroom d-flex justify-content-between align-items-center border-bottom pb-3",children:(0,p.jsx)("h2",{className:"text-lg font-bold mb-2",children:"Referral Code Details/Tracking Code"})}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-bold",children:(0,p.jsx)("b",{children:"Referral Date:"})})," ",s(o.created_at)]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Referral Code:"})})," ",o.discount_code]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Company:"})})," ",o.company_name]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Company Email:"})})," ",o.company_email]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Referred/Partner By:"})})," ",n.email]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Discount:"})})," ",r.discounts+"%"]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Payment type:"})})," ","Dataroom_Plus_Investor_Report"===r.payment_type?"Dataroom Management & Diligence + Investor Reporting":"Academy"===r.payment_type?"International Entrepreneur Academy Program":r.payment_type]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Used Date"})})," ",s(r.used_at)]})]})})})]})})};var u=a(73216),m=a(35475);function h(){var e="https://blueprintcatalyst.com/api/user/";document.title="Tracking Referral Code";const t=(0,u.Zp)(),[a,h]=(0,o.useState)(""),[f,g]=(0,o.useState)([]),[b,w]=(0,o.useState)(""),y=sessionStorage.getItem("UserLoginData"),v=JSON.parse(y),[j,k]=(0,o.useState)(!1),[N,z]=(0,o.useState)(""),[_,C]=(0,o.useState)(""),{id:D,discount_code:S}=(0,u.g)();(0,o.useEffect)((()=>{R()}),[]);const R=async()=>{let a={user_id:v.id,id:D,discount_code:S};try{const r=await l.A.post(e+"getallCodetrack",a,{headers:{Accept:"application/json","Content-Type":"application/json"}});var o=r.data;console.log(r),"2"===o.status&&t("/share/referralcode"),w(o.shared),g(o.usage),console.log(o.usage)}catch(r){r.response||(r.request?console.error("Request data:",r.request):console.error("Error message:",r.message))}},A=[{name:"Company Email",selector:e=>e.company_email,sortable:!0},{name:"Referral Code",selector:e=>e.discount_code,sortable:!0},{name:"Discount (%)",selector:e=>e.discounts+"%",sortable:!0,right:!0},{name:"Payment Type",selector:e=>{switch(e.payment_type){case"Dataroom_Plus_Investor_Report":return"Dataroom Management & Diligence + Investor Reporting";case"Academy":return"International Entrepreneur Academy Program";default:return e.payment_type}},sortable:!0},{name:"Actions",cell:e=>(0,p.jsx)(m.N_,{to:"",onClick:()=>$(e.usage_id,e.discount_code),className:"btn btn-sm btn-outline-primary",title:"View Usage Code",children:(0,p.jsx)(n.Ny1,{})}),ignoreRowClick:!0,allowOverflow:!0,button:!0}],$=async(t,a)=>{k(!0);let o={user_id:v.id,id:D,idd:t,discount_code:a};try{var r=(await l.A.post(e+"getallCodetrackSingleDetail",o,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;z(r.shared),C(r.usage)}catch(i){i.response||(i.request?console.error("Request data:",i.request):console.error("Error message:",i.message))}},J=f.filter((e=>`${e.company_name||""} - ${e.update_date||""} - ${e.version||""}`.toLowerCase().includes(a.toLowerCase())||(e.update_date||"").toLowerCase().includes(a.toLowerCase())||(e.download||"").toLowerCase().includes(a.toLowerCase())));const[I,E]=(0,o.useState)(!1);return(0,p.jsxs)(p.Fragment,{children:[(0,p.jsx)(i.mO,{children:(0,p.jsx)("div",{className:"fullpage d-block",children:(0,p.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,p.jsx)(s.A,{isCollapsed:I,setIsCollapsed:E}),(0,p.jsxs)("div",{className:"global_view "+(I?"global_view_col":""),children:[(0,p.jsx)(r.A,{}),(0,p.jsx)(i.$K,{className:"d-block p-4",children:(0,p.jsx)("div",{className:"container-fluid",children:(0,p.jsxs)(d.zP,{className:"d-flex flex-column gap-2",children:[(0,p.jsx)("div",{className:"titleroom d-flex justify-content-between align-items-center border-bottom pb-3",children:(0,p.jsx)("h2",{className:"mainh1",children:"Referral Code Details/Tracking Codes"})}),(0,p.jsxs)("div",{className:"d-flex flex-column justify-content-between align-items-start py-4 tb-box",children:[(0,p.jsx)("div",{className:"mb-5",children:(0,p.jsxs)("div",{className:"row g-3 text-sm text-muted",children:[(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"mainp",children:(0,p.jsx)("b",{children:"Referral Date:"})})," ",(0,p.jsxs)("span",{className:"mainp1",children:[" ",function(e){const t=new Date(e);if(isNaN(t))return"";const a=t.getDate(),o=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],r=t.getFullYear();return`${o} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${r}`}(b.created_at)]})]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"mainp",children:(0,p.jsx)("b",{children:"Referral Code:"})})," ",(0,p.jsx)("span",{className:"mainp1",children:b.discount_code})]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"mainp",children:(0,p.jsx)("b",{children:"Company:"})})," ",(0,p.jsxs)("span",{className:"mainp1",children:[" ",b.company_name]})]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"mainp",children:(0,p.jsx)("b",{children:"Company Email:"})})," ",(0,p.jsxs)("span",{className:"mainp1",children:[" ",b.company_email]})]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"mainp",children:(0,p.jsx)("b",{children:"Referred/Partner By:"})})," ",(0,p.jsx)("span",{className:"mainp1",children:v.email})]})]})}),(0,p.jsxs)("div",{className:"d-flex justify-content-between align-items-center gap-3 mb-3 p-0",children:[(0,p.jsx)("p",{}),(0,p.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:a,onChange:e=>h(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})]}),(0,p.jsx)(c.Ay,{customStyles:{table:{style:{border:"1px solid #dee2e6",borderRadius:"12px",overflow:"auto"}},headCells:{style:{backgroundColor:"#efefef",fontWeight:"600",fontSize:"0.8rem",color:"#000",textTransform:"uppercase",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500"},stripedStyle:{backgroundColor:"#fff"}},pagination:{style:{marginTop:"15px",backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:A,className:"datatb-report",data:J,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0})]})]})})})]})]})})}),j&&(0,p.jsx)(x,{onClose:()=>k(!1),returnrefresh:()=>{},sharedDetail:b,sharedDetailSingleUsage:_})]})}},25015:()=>{},62837:(e,t,a)=>{a.d(t,{$K:()=>n,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>u,R3:()=>v,Zw:()=>x,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>r,mg:()=>s,nj:()=>w,pd:()=>y,uM:()=>m,vE:()=>i,z6:()=>p});var o=a(5464);const r=o.default.div`
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
`),s=o.default.div`
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
    border-radius: 10px;
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
`,l=o.default.div`
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
    left: 12px;
    width: 16px; /* smaller width */
    height: 16px; /* smaller height */
    stroke: #ff3c3e;
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
`),f=((0,o.default)(h)`
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
`),g=o.default.div`
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
  border-radius: 10px;
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
`},83656:()=>{}}]);
//# sourceMappingURL=8177.5eded6b0.chunk.js.map