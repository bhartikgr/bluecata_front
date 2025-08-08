"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[8177],{18177:(e,t,o)=>{o.r(t),o.d(t,{default:()=>f});var a=o(65043),r=(o(25015),o(65136)),i=(o(38421),o(62837)),n=o(60184),l=(o(83656),o(44710)),s=o(86213),d=o(27836),c=(o(26022),o(58786)),p=o(70579);const x=e=>{let{onClose:t,returnrefresh:o,sharedDetail:a,sharedDetailSingleUsage:r}=e;console.log(r);const i=localStorage.getItem("UserLoginData"),n=JSON.parse(i);function l(e){const t=new Date(e);if(isNaN(t))return"";const o=t.getDate(),a=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],r=t.getFullYear();return`${a} ${o}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(o)}, ${r}`}return(0,p.jsx)(d.hJ,{children:(0,p.jsxs)(d.Bs,{style:{maxWidth:"900px",maxHeight:"550px"},children:[(0,p.jsx)(d.Jn,{onClick:t,children:"\xd7"}),(0,p.jsx)("div",{className:"d-flex flex-column justify-content-between align-items-start tb-box",children:(0,p.jsx)("div",{className:"mb-5",children:(0,p.jsxs)("div",{className:"row g-3 text-sm text-muted",children:[(0,p.jsx)("div",{className:"titleroom d-flex justify-content-between align-items-center border-bottom pb-3",children:(0,p.jsx)("h2",{className:"text-lg font-bold mb-2",children:"Referral Code Details/Tracking Code"})}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-bold",children:(0,p.jsx)("b",{children:"Referral Date:"})})," ",l(a.created_at)]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Referral Code:"})})," ",a.discount_code]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Company:"})})," ",a.company_name]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Company Email:"})})," ",a.company_email]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Referred/Partner By:"})})," ",n.email]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Discount:"})})," ",r.discounts+"%"]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Payment type:"})})," ","Dataroom_Plus_Investor_Report"===r.payment_type?"Dataroom Management & Diligence + Investor Reporting":"Academy"===r.payment_type?"International Entrepreneur Academy Program":r.payment_type]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Used Date"})})," ",l(r.used_at)]})]})})})]})})};var u=o(73216),m=o(35475);function f(){var e="https://blueprintcatalyst.com/api/user/";document.title="Tracking Referral Code";const[t,o]=(0,a.useState)(""),[f,h]=(0,a.useState)([]),[b,g]=(0,a.useState)(""),w=localStorage.getItem("UserLoginData"),v=JSON.parse(w),[y,j]=(0,a.useState)(!1),[k,N]=(0,a.useState)(""),[_,z]=(0,a.useState)(""),{id:C,discount_code:D}=(0,u.g)();(0,a.useEffect)((()=>{S()}),[]);const S=async()=>{let t={user_id:v.id,id:C,discount_code:D};try{var o=(await s.A.post(e+"getallCodetrack",t,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;g(o.shared),h(o.usage),console.log(o.usage)}catch(a){a.response||(a.request?console.error("Request data:",a.request):console.error("Error message:",a.message))}},R=[{name:"Company Email",selector:e=>e.company_email,sortable:!0},{name:"Referral Code",selector:e=>e.discount_code,sortable:!0},{name:"Discount (%)",selector:e=>e.discounts+"%",sortable:!0,right:!0},{name:"Payment Type",selector:e=>{switch(e.payment_type){case"Dataroom_Plus_Investor_Report":return"Dataroom Management & Diligence + Investor Reporting";case"Academy":return"International Entrepreneur Academy Program";default:return e.payment_type}},sortable:!0},{name:"Actions",cell:e=>(0,p.jsx)(m.N_,{to:"",onClick:()=>A(e.usage_id,e.discount_code),className:"btn btn-sm btn-outline-primary",title:"View Usage Code",children:(0,p.jsx)(n.Ny1,{})}),ignoreRowClick:!0,allowOverflow:!0,button:!0}],A=async(t,o)=>{j(!0);let a={user_id:v.id,id:C,idd:t,discount_code:o};try{var r=(await s.A.post(e+"getallCodetrackSingleDetail",a,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;N(r.shared),z(r.usage)}catch(i){i.response||(i.request?console.error("Request data:",i.request):console.error("Error message:",i.message))}},$=f.filter((e=>`${e.company_name||""} - ${e.update_date||""} - ${e.version||""}`.toLowerCase().includes(t.toLowerCase())||(e.update_date||"").toLowerCase().includes(t.toLowerCase())||(e.download||"").toLowerCase().includes(t.toLowerCase())));return(0,p.jsxs)(p.Fragment,{children:[(0,p.jsx)(i.mO,{children:(0,p.jsxs)("div",{className:"fullpage d-block",children:[(0,p.jsx)(r.A,{}),(0,p.jsx)(i.$K,{className:"d-block py-5",children:(0,p.jsx)("div",{className:"container-lg",children:(0,p.jsxs)("div",{className:"row",children:[(0,p.jsx)("div",{className:"col-md-3",children:(0,p.jsx)(l.A,{})}),(0,p.jsx)("div",{className:"col-md-9",children:(0,p.jsxs)(d.zP,{className:"d-flex flex-column gap-2",children:[(0,p.jsx)("div",{className:"titleroom d-flex justify-content-between align-items-center border-bottom pb-3",children:(0,p.jsx)("h2",{className:"text-lg font-bold mb-2",children:"Referral Code Details/Tracking Code"})}),(0,p.jsxs)("div",{className:"d-flex flex-column justify-content-between align-items-start tb-box",children:[(0,p.jsx)("div",{className:"mb-5",children:(0,p.jsxs)("div",{className:"row g-3 text-sm text-muted",children:[(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-bold",children:(0,p.jsx)("b",{children:"Referral Date:"})})," ",function(e){const t=new Date(e);if(isNaN(t))return"";const o=t.getDate(),a=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],r=t.getFullYear();return`${a} ${o}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(o)}, ${r}`}(b.created_at)]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Referral Code:"})})," ",b.discount_code]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Company:"})})," ",b.company_name]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Company Email:"})})," ",b.company_email]}),(0,p.jsxs)("div",{className:"col-12 col-md-4",children:[(0,p.jsx)("span",{className:"fw-semibold",children:(0,p.jsx)("b",{children:"Referred/Partner By:"})})," ",v.email]})]})}),(0,p.jsxs)("div",{className:"d-flex justify-content-between align-items-center p-0",children:[(0,p.jsx)("p",{}),(0,p.jsx)("input",{type:"search",placeholder:"Search Here...",className:"form-control",value:t,onChange:e=>o(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})]}),(0,p.jsx)(c.Ay,{customStyles:{rows:{style:{minHeight:"60px",overflow:" visible"}},headCells:{style:{fontSize:"14px",fontWeight:"bold",overflow:"visible","& div":{overflow:"visible"}}}},columns:R,className:"datatb-report",data:$,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0})]})]})})]})})})]})}),y&&(0,p.jsx)(x,{onClose:()=>j(!1),returnrefresh:()=>{},sharedDetail:b,sharedDetailSingleUsage:_})]})}},25015:()=>{},62837:(e,t,o)=>{o.d(t,{$K:()=>s,CB:()=>c,Cd:()=>g,FC:()=>l,Jq:()=>u,R3:()=>y,SD:()=>n,Zw:()=>x,dN:()=>h,hJ:()=>b,mO:()=>r,mg:()=>d,nj:()=>w,pd:()=>v,uM:()=>m,vE:()=>i,z6:()=>p});var a=o(5464);const r=a.default.div`
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
`,i=a.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,n=(a.default.div`
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
  background: var(--primary-color);
  border-bottom: 10px solid var(--secondary-color);
  .logo {
    display: inline-block;
    width: 140px;
    img {
      width: 100%;
    }
  }
`),l=a.default.div`
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
`,s=a.default.div`
  display: block;
  padding: 3rem 0; /* py-5 is 3rem top & bottom */
  background-color: #f3f5f7;
  min-height: 100vh;
`,d=a.default.div`
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
`,c=a.default.div`
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
`,p=a.default.div`
  display: flex;
  flex-direction: column;
  gap: 10px 0;
`,x=a.default.div`
  label {
    font-weight: 400;
    cursor: pointer;
    margin-left: 10px;
  }
`,u=(a.default.div`
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
    left: 6px;
    width: 16px; /* smaller width */
    height: 16px; /* smaller height */
    stroke: #9c9c9c;
    stroke-width: 1.2;
  }
`),m=(a.default.div`
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
`),f=(a.default.div`
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
`),h=((0,a.default)(f)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(f)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,a.default.sup`
  color: var(--primary-color);
`),b=a.default.div`
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
`,g=a.default.div`
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
`,w=a.default.button`
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
`,v=a.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 16px;
`,y=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},83656:()=>{}}]);
//# sourceMappingURL=8177.7d8ab4bd.chunk.js.map