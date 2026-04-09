"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[1243],{62837:(e,t,o)=>{o.d(t,{$K:()=>a,CB:()=>s,Cd:()=>b,I0:()=>p,Jq:()=>x,R3:()=>v,dN:()=>h,hJ:()=>u,jh:()=>d,mO:()=>i,mg:()=>l,nj:()=>m,pd:()=>y,uM:()=>g,vE:()=>r,z6:()=>c});var n=o(5464);const i=n.default.div`
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
`,r=n.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,a=(n.default.div`
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
`),g=(n.default.div`
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
`),h=((0,n.default)(f)`
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
`),u=n.default.div`
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
`},81243:(e,t,o)=>{o.r(t),o.d(t,{default:()=>b});var n=o(65043),i=o(62837),r=o(86213),a=o(58786),l=o(73216),s=o(60184),d=o(86191),p=o(81906),c=o(27836),x=o(49535),g=o(65469),f=o(25581),h=o(65490),u=o(70579);const b=function(){const[e,t]=(0,n.useState)(!1),{id:o,company_id:b}=(0,l.g)(),m=(0,l.Zp)(),[y,v]=(0,n.useState)(!1),[j,w]=(0,n.useState)(null),[k,S]=(0,n.useState)({pre_money:{items:[],totals:{}},post_money:{items:[],totals:{}}}),[z,C]=(0,n.useState)(null),[N,_]=(0,n.useState)([]),[A,W]=(0,n.useState)(""),[R,T]=(0,n.useState)([]);document.title="Company Capital Round List - Investor";var E=f.J+"api/user/investmenthistory/",I=f.J+"api/user/investorreport/";const O=localStorage.getItem("InvestorData"),L=JSON.parse(O);(0,n.useEffect)((()=>{M(),D()}),[]);const M=async()=>{let e={investor_id:L.id,company_id:b,round_id:o};try{const t=await r.A.post(E+"getInvestmentHistorylist",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log("Investment History:",t.data.results),_(t.data.results)}catch(t){console.error("Error fetching investment history:",t)}},D=async()=>{let e={investor_id:L.id,round_id:o,company_id:b};try{const t=await r.A.post(I+"getRoundsDetail",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(t.data.success){const e=t.data.cap_table||{pre_money:{items:[],totals:{}},post_money:{items:[],totals:{}}};console.log("Round Detail:",t.data),S(e),C(t.data.round||null)}}catch(t){console.error("Error fetching capital round data:",t)}},B=e=>{(async e=>{let t={investor_id:L.id,company_id:b,round_id:o,investorrequest_company_id:e};try{const e=await r.A.post(E+"getInvestmentHistoryWarrantlist",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(e.data.results),T(e.data.results)}catch(n){console.error("Error fetching investment history:",n)}})(e.id),w(e),v(!0)},H=N.filter((e=>{const t=A.toLowerCase();return`\n            ${e.nameOfRound||""}\n            ${e.shareClassType||""}\n            ${e.roundsize||""}\n            ${e.issuedshares||""}\n        `.toLowerCase().includes(t)}));function P(e){const t=new Date(e);if(isNaN(t))return"";const o=t.getDate(),n=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][t.getMonth()],i=t.getFullYear();return`${n} ${o}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(o)}, ${i}`}const $=[{name:"Shares",selector:e=>Math.round(e.shares||0),sortable:!0,cell:e=>(0,u.jsx)("span",{children:(0,u.jsx)(h.A,{amount:Math.round(e.shares),currency:e.currency,digit:3})})},{name:"Investment Amount",selector:e=>e.investment_amount||0,sortable:!0,cell:e=>(0,u.jsx)("span",{children:(0,u.jsx)(h.A,{amount:e.investment_amount,currency:e.currency})})},{name:"Request Confirm",selector:e=>e.request_confirm||"No",sortable:!0},{name:"Request Sent",selector:e=>P(e.created_at),sortable:!0},{name:"Action",cell:e=>(0,u.jsxs)("button",{onClick:()=>B(e),className:"btn btn-sm",style:{padding:"4px 8px",fontSize:"12px",backgroundColor:"#CC0000",color:"white",border:"none",borderRadius:"4px",cursor:"pointer",transition:"all 0.2s"},onMouseEnter:e=>e.target.style.backgroundColor="#8B0000",onMouseLeave:e=>e.target.style.backgroundColor="#CC0000",children:[(0,u.jsx)(s.Ny1,{className:"me-1"})," View"]}),ignoreRowClick:!0,allowOverflow:!0,button:!0,width:"100px"}],q=e=>{var t;let{show:o,onClose:n,investment:i,capTable:r,warrants:a}=e;if(!o||!i)return null;const l=(null===r||void 0===r||null===(t=r.post_money)||void 0===t?void 0:t.totals)||{};return(0,u.jsxs)("div",{className:"modal-overlay",style:{position:"fixed",top:0,left:0,right:0,bottom:0,backgroundColor:"rgba(0, 0, 0, 0.6)",display:"flex",justifyContent:"center",alignItems:"center",zIndex:99999,backdropFilter:"blur(3px)"},onClick:n,children:[(0,u.jsxs)("div",{className:"modal-content",style:{backgroundColor:"#fff",borderRadius:"16px",boxShadow:"0 20px 40px rgba(0,0,0,0.2)",width:"90%",maxWidth:"800px",maxHeight:"90vh",overflow:"auto",position:"relative",animation:"slideIn 0.3s ease"},onClick:e=>e.stopPropagation(),children:[(0,u.jsx)("div",{style:{background:"linear-gradient(135deg, #CC0000 0%, #8B0000 100%)",padding:"20px 24px",borderTopLeftRadius:"16px",borderTopRightRadius:"16px",color:"white"},children:(0,u.jsxs)("div",{className:"d-flex justify-content-between align-items-center",children:[(0,u.jsxs)("div",{className:"d-flex align-items-center",children:[(0,u.jsx)("div",{style:{width:"48px",height:"48px",backgroundColor:"rgba(255,255,255,0.2)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",marginRight:"15px"},children:(0,u.jsx)(s.Ny1,{size:24,color:"white"})}),(0,u.jsxs)("div",{children:[(0,u.jsx)("h3",{style:{margin:0,fontSize:"20px",fontWeight:"600"},children:"Investment Details"}),(0,u.jsxs)("p",{style:{margin:"4px 0 0",fontSize:"14px",opacity:.9},children:["Transaction ID: ",i.id]})]})]}),(0,u.jsx)("button",{onClick:n,style:{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:"50%",width:"36px",height:"36px",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all 0.2s",color:"white",fontSize:"20px"},onMouseEnter:e=>e.target.style.backgroundColor="rgba(255,255,255,0.3)",onMouseLeave:e=>e.target.style.backgroundColor="rgba(255,255,255,0.2)",children:"\xd7"})]})}),(0,u.jsxs)("div",{style:{padding:"24px"},children:[(0,u.jsxs)("div",{style:{backgroundColor:"#f8f9fa",borderRadius:"12px",padding:"20px",marginBottom:"24px"},children:[(0,u.jsxs)("div",{className:"row",children:[(0,u.jsxs)("div",{className:"col-md-6 mb-3",children:[(0,u.jsx)("label",{style:{fontSize:"12px",color:"#666",fontWeight:"500"},children:"INVESTMENT AMOUNT"}),(0,u.jsx)("p",{style:{fontSize:"24px",fontWeight:"700",margin:"4px 0 0",color:"#CC0000"},children:(0,u.jsx)(h.A,{amount:i.investment_amount,currency:i.currency})})]}),(0,u.jsxs)("div",{className:"col-md-6 mb-3",children:[(0,u.jsx)("label",{style:{fontSize:"12px",color:"#666",fontWeight:"500"},children:"SHARES ALLOCATED"}),(0,u.jsx)("p",{style:{fontSize:"24px",fontWeight:"700",margin:"4px 0 0",color:"#2c3e50"},children:(0,u.jsx)(h.A,{amount:Math.round(i.shares),currency:i.currency,digit:0})})]})]}),(0,u.jsx)("div",{style:{height:"1px",backgroundColor:"#dee2e6",margin:"16px 0"}}),(0,u.jsxs)("div",{className:"row",children:[(0,u.jsx)("div",{className:"col-md-6",children:(0,u.jsxs)("div",{style:{marginBottom:"12px"},children:[(0,u.jsx)("label",{style:{fontSize:"11px",color:"#999",fontWeight:"500"},children:"REQUEST STATUS"}),(0,u.jsx)("div",{children:(0,u.jsx)("span",{style:{display:"inline-block",padding:"6px 16px",borderRadius:"20px",fontSize:"13px",fontWeight:"600",backgroundColor:"Yes"===i.request_confirm?"#d4edda":"#fff3cd",color:"Yes"===i.request_confirm?"#155724":"#856404"},children:"Yes"===i.request_confirm?"\u2713 Confirmed":"\u23f3 Pending"})})]})}),(0,u.jsx)("div",{className:"col-md-6",children:(0,u.jsxs)("div",{style:{marginBottom:"12px"},children:[(0,u.jsx)("label",{style:{fontSize:"11px",color:"#999",fontWeight:"500"},children:"REQUEST DATE"}),(0,u.jsx)("p",{style:{fontSize:"14px",fontWeight:"500",margin:"2px 0 0"},children:P(i.created_at)})]})})]})]}),a&&a.length>0&&(0,u.jsxs)("div",{style:{marginBottom:"24px"},children:[(0,u.jsx)("h5",{style:{fontSize:"16px",fontWeight:"600",marginBottom:"16px",color:"#333"},children:"Warrants Exercised"}),(0,u.jsx)("div",{className:"table-responsive",children:(0,u.jsxs)("table",{style:{width:"100%",borderCollapse:"collapse",backgroundColor:"white",borderRadius:"8px",overflow:"hidden",boxShadow:"0 2px 4px rgba(0,0,0,0.1)"},children:[(0,u.jsx)("thead",{children:(0,u.jsxs)("tr",{style:{backgroundColor:"#f8f9fa",borderBottom:"2px solid #dee2e6"},children:[(0,u.jsx)("th",{style:{padding:"12px",textAlign:"left",fontSize:"12px",fontWeight:"600",color:"#495057"},children:"Warrant ID"}),(0,u.jsx)("th",{style:{padding:"12px",textAlign:"right",fontSize:"12px",fontWeight:"600",color:"#495057"},children:"Shares"}),(0,u.jsx)("th",{style:{padding:"12px",textAlign:"right",fontSize:"12px",fontWeight:"600",color:"#495057"},children:"Coverage %"}),(0,u.jsx)("th",{style:{padding:"12px",textAlign:"center",fontSize:"12px",fontWeight:"600",color:"#495057"},children:"Exercise Date"}),(0,u.jsx)("th",{style:{padding:"12px",textAlign:"center",fontSize:"12px",fontWeight:"600",color:"#495057"},children:"Status"})]})}),(0,u.jsx)("tbody",{children:a.map(((e,t)=>{const o=e.is_expired;e.shares,i.share_price;return(0,u.jsxs)("tr",{style:{borderBottom:"1px solid #dee2e6",backgroundColor:t%2===0?"white":"#f8f9fa"},children:[(0,u.jsx)("td",{style:{padding:"12px",fontSize:"14px"},children:(0,u.jsxs)("span",{style:{display:"inline-block",padding:"4px 8px",backgroundColor:"#e7f3ff",borderRadius:"4px",fontSize:"12px",fontWeight:"500"},children:["#",e.warrant_id]})}),(0,u.jsx)("td",{style:{padding:"12px",textAlign:"right",fontSize:"14px",fontWeight:"600"},children:e.shares.toLocaleString()}),(0,u.jsxs)("td",{style:{padding:"12px",textAlign:"right",fontSize:"14px"},children:[e.warrant_coverage_percentage,"%"]}),(0,u.jsx)("td",{style:{padding:"12px",textAlign:"center",fontSize:"14px"},children:P(e.created_at)}),(0,u.jsx)("td",{style:{padding:"12px",textAlign:"center"},children:(0,u.jsx)("span",{style:{display:"inline-block",padding:"4px 12px",borderRadius:"12px",fontSize:"12px",fontWeight:"600",backgroundColor:o?"#fee2e2":"#d4edda",color:o?"#b91c1c":"#155724"},children:o?"Expired":"Exercised"})})]},e.id)}))}),(0,u.jsx)("tfoot",{style:{backgroundColor:"#f8f9fa",borderTop:"2px solid #dee2e6"},children:(0,u.jsxs)("tr",{children:[(0,u.jsx)("td",{style:{padding:"12px",fontWeight:"600"},colSpan:"1",children:"Total"}),(0,u.jsx)("td",{style:{padding:"12px",textAlign:"right",fontWeight:"700"},children:a.reduce(((e,t)=>e+t.shares),0).toLocaleString()}),(0,u.jsx)("td",{style:{padding:"12px"},colSpan:"2"}),(0,u.jsx)("td",{style:{padding:"12px"},colSpan:"1"})]})})]})})]}),l.total_shares>0&&(0,u.jsxs)(u.Fragment,{children:[(0,u.jsx)("h5",{style:{fontSize:"16px",fontWeight:"600",marginBottom:"16px",color:"#333"},children:"Round Summary"}),(0,u.jsxs)("div",{className:"row g-3 mb-4",children:[(0,u.jsx)("div",{className:"col-md-4",children:(0,u.jsxs)("div",{style:{backgroundColor:"#e3f2fd",borderRadius:"10px",padding:"15px",textAlign:"center"},children:[(0,u.jsx)("label",{style:{fontSize:"11px",color:"#0d47a1",fontWeight:"600"},children:"TOTAL SHARES"}),(0,u.jsx)("p",{style:{fontSize:"18px",fontWeight:"700",margin:"5px 0 0",color:"#0d47a1"},children:l.total_shares_formatted})]})}),(0,u.jsx)("div",{className:"col-md-4",children:(0,u.jsxs)("div",{style:{backgroundColor:"#e8f5e9",borderRadius:"10px",padding:"15px",textAlign:"center"},children:[(0,u.jsx)("label",{style:{fontSize:"11px",color:"#1b5e20",fontWeight:"600"},children:"TOTAL VALUE"}),(0,u.jsx)("p",{style:{fontSize:"18px",fontWeight:"700",margin:"5px 0 0",color:"#1b5e20"},children:(0,u.jsx)(h.A,{amount:l.total_value,currency:null===z||void 0===z?void 0:z.currency})})]})}),(0,u.jsx)("div",{className:"col-md-4",children:(0,u.jsxs)("div",{style:{backgroundColor:"#fff3e0",borderRadius:"10px",padding:"15px",textAlign:"center"},children:[(0,u.jsx)("label",{style:{fontSize:"11px",color:"#bf360c",fontWeight:"600"},children:"YOUR OWNERSHIP"}),(0,u.jsxs)("p",{style:{fontSize:"18px",fontWeight:"700",margin:"5px 0 0",color:"#bf360c"},children:[((i.shares||0)/l.total_shares*100).toFixed(2),"%"]})]})})]}),(0,u.jsxs)("div",{className:"row g-3",children:[(0,u.jsx)("div",{className:"col-md-6",children:(0,u.jsxs)("div",{style:{backgroundColor:"#f5f5f5",borderRadius:"8px",padding:"12px"},children:[(0,u.jsx)("label",{style:{fontSize:"11px",color:"#666",fontWeight:"600"},children:"FOUNDERS TOTAL"}),(0,u.jsx)("p",{style:{fontSize:"16px",fontWeight:"600",margin:"4px 0 0"},children:(0,u.jsx)(h.A,{amount:l.total_founders,currency:i.currency,digit:0})})]})}),(0,u.jsx)("div",{className:"col-md-6",children:(0,u.jsxs)("div",{style:{backgroundColor:"#f5f5f5",borderRadius:"8px",padding:"12px"},children:[(0,u.jsx)("label",{style:{fontSize:"11px",color:"#666",fontWeight:"600"},children:"OPTION POOL"}),(0,u.jsx)("p",{style:{fontSize:"16px",fontWeight:"600",margin:"4px 0 0"},children:(0,u.jsx)(h.A,{amount:l.total_option_pool,currency:i.currency,digit:0})})]})}),(0,u.jsx)("div",{className:"col-md-6",children:(0,u.jsxs)("div",{style:{backgroundColor:"#f5f5f5",borderRadius:"8px",padding:"12px"},children:[(0,u.jsx)("label",{style:{fontSize:"11px",color:"#666",fontWeight:"600"},children:"NEW SHARES"}),(0,u.jsx)("p",{style:{fontSize:"16px",fontWeight:"600",margin:"4px 0 0",color:"#28a745"},children:l.total_new_shares_formatted})]})})]})]})]}),(0,u.jsx)("div",{style:{padding:"16px 24px",borderTop:"1px solid #dee2e6",display:"flex",justifyContent:"flex-end"},children:(0,u.jsx)("button",{onClick:n,style:{padding:"10px 24px",backgroundColor:"#CC0000",color:"white",border:"none",borderRadius:"8px",fontSize:"14px",fontWeight:"600",cursor:"pointer",transition:"all 0.2s"},onMouseEnter:e=>e.target.style.backgroundColor="#8B0000",onMouseLeave:e=>e.target.style.backgroundColor="#CC0000",children:"Close"})})]}),(0,u.jsx)("style",{jsx:!0,children:"\n                @keyframes slideIn {\n                    from {\n                        transform: translateY(-30px);\n                        opacity: 0;\n                    }\n                    to {\n                        transform: translateY(0);\n                        opacity: 1;\n                    }\n                }\n            "})]})};return(0,u.jsxs)("main",{children:[(0,u.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,u.jsx)(d.A,{}),(0,u.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,u.jsx)(p.A,{}),(0,u.jsx)(i.$K,{className:"d-block p-md-4 p-3",children:(0,u.jsx)("div",{className:"container-fluid",children:(0,u.jsxs)(c.zP,{className:"d-flex flex-column gap-3",children:[(0,u.jsxs)("div",{className:"titleroom flex-wrap gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:[(0,u.jsxs)(x.o,{type:"button",className:"backbtn",onClick:()=>{m("/investor/company-list")},children:[(0,u.jsx)(g.A,{size:16,className:"me-1"})," back"]}),(0,u.jsx)("h4",{className:"mainh1",children:"Investment History"})]}),(0,u.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,u.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:A,onChange:e=>W(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,u.jsx)("div",{className:"d-flex flex-column justify-content-between align-items-start tb-box",children:(0,u.jsx)(a.Ay,{customStyles:{table:{style:{minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:$,className:"datatb-report",data:H,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})})]})})})]})]}),(0,u.jsx)(q,{show:y,onClose:()=>{v(!1),w(null)},investment:j,capTable:k,warrants:R})]})}}}]);
//# sourceMappingURL=1243.98691ff3.chunk.js.map