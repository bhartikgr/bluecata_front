"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[6110],{62837:(e,n,t)=>{t.d(n,{$K:()=>a,CB:()=>d,Cd:()=>b,I0:()=>p,Jq:()=>h,R3:()=>v,Zw:()=>u,dN:()=>m,hJ:()=>f,jh:()=>l,mO:()=>o,mg:()=>s,nj:()=>k,pd:()=>w,uM:()=>x,vE:()=>i,z6:()=>c});var r=t(5464);const o=r.default.div`
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
`,a=(r.default.div`
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
  background: var(--primary-color);
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
`,d=r.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,l=r.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,p=r.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,c=r.default.div`
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
`,h=(r.default.div`
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
    stroke: #ff3c3e;
    stroke-width: 1.2;
  }
`),x=(r.default.div`
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
`),g=(r.default.div`
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
`),m=((0,r.default)(g)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,r.default)(g)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,r.default.sup`
  color: var(--primary-color);
`),f=r.default.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: ${e=>{let{show:n}=e;return n?"flex":"none"}};
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
`,k=r.default.button`
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
`,w=r.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 16px;
`,v=r.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},78150:(e,n,t)=>{t.r(n),t.d(n,{default:()=>u});var r=t(65043),o=(t(25015),t(43328)),i=(t(38421),t(62837)),a=t(86178),s=t.n(a),d=t(6551),l=(t(83656),t(71173),t(44710)),p=t(86213),c=t(70579);function u(){(0,d.ye)(s());const[e,n]=(0,r.useState)([]),[t,a]=(0,r.useState)("monthly"),[u,h]=(0,r.useState)(!1),[x,g]=(0,r.useState)(""),m=localStorage.getItem("UserLoginData"),f=JSON.parse(m),[b,k]=(0,r.useState)([]),[w,v]=(0,r.useState)(!1);(0,r.useEffect)((()=>{y()}),[]);const y=async()=>{try{var e;const n=(await p.A.post("https://blueprintcatalyst.com/api/user/getusersSubscriptionPlan",{user_id:f.id})).data.results;if(!n)return void console.error("No subscription data received");const t=[];n.dataroomOneTime&&t.push({name:"Dataroom Management + Investor Reporting (One-Time)",status:n.dataroomOneTime.status||"N/A",price:`\u20ac${n.dataroomOneTime.price}`,renewalDate:j(n.dataroomOneTime.end_date)||"N/A",lastPayment:j(n.dataroomOneTime.start_date)||"N/A",features:["Dataroom: Centralize documents & streamline due diligence; 1 free executive summary, additional copies \u20ac100 each","Cap Table: Track who owns what in the company","Investor Reporting: Keep investors updated; maintain engagement"],type:"dataroom",period:"Annual"}),n.investorReporting&&t.push({name:"Investor Reporting",status:n.investorReporting.status||"N/A",price:`\u20ac${n.investorReporting.price}`,renewalDate:j(n.investorReporting.end_date)||"N/A",lastPayment:j(n.investorReporting.start_date)||"N/A",features:["Monthly investor updates","Download reports","Analytics dashboard"],type:"reporting",period:"Annual"}),(null===(e=n.perInstancePurchases)||void 0===e?void 0:e.length)>0&&n.perInstancePurchases.forEach(((e,n)=>{t.push({name:`Per Instance #${n+1}`,status:e.payment_status||"N/A",price:`\u20ac${e.price}`,lastPayment:j(e.created_at)||"N/A",features:["One-time report","Single-use instance"],type:"instance",period:"Per Instance (Additional generations \u20ac100 each)"})})),n.academySubscription&&t.push({name:"International Entrepreneur Academy",status:n.academySubscription.status||"N/A",price:`\u20ac${n.academySubscription.price||0}`,lastPayment:j(n.academySubscription.created_at)||"N/A",features:["Access to all modules","One-time payment","Global entrepreneurship insights"],type:"academy",period:"Annual"}),k(t)}catch(n){console.error("Error fetching subscription plans:",n)}};function j(e){const n=new Date(e);if(isNaN(n))return"";const t=n.getDate(),r=["January","February","March","April","May","June","July","August","September","October","November","December"][n.getMonth()],o=n.getFullYear();return`${r} ${t}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(t)}, ${o}`}const C=e=>{switch(e){case"dataroom":return(0,c.jsxs)("svg",{width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,c.jsx)("path",{d:"M21 4H3C1.89543 4 1 4.89543 1 6V18C1 19.1046 1.89543 20 3 20H21C22.1046 20 23 19.1046 23 18V6C23 4.89543 22.1046 4 21 4Z",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M1 10H23",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]});case"reporting":return(0,c.jsxs)("svg",{width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,c.jsx)("path",{d:"M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M16 17H8",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M16 13H8",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M10 9H9H8",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M14 2V8H20",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]});case"academy":return(0,c.jsxs)("svg",{width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,c.jsx)("path",{d:"M12 14C15.3137 14 18 11.3137 18 8C18 4.68629 15.3137 2 12 2C8.68629 2 6 4.68629 6 8C6 11.3137 8.68629 14 12 14Z",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M4 14V16C4 17.5913 4.63214 19.1174 5.75736 20.2426C6.88258 21.3679 8.4087 22 10 22H14C15.5913 22 17.1174 21.3679 18.2426 20.2426C19.3679 19.1174 20 17.5913 20 16V14",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M8 18H16",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]});default:return(0,c.jsxs)("svg",{width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,c.jsx)("path",{d:"M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M12 16V12",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M12 8H12.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}};return(0,c.jsxs)(c.Fragment,{children:[(0,c.jsx)(i.mO,{children:(0,c.jsx)("div",{className:"fullpage d-block",children:(0,c.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,c.jsx)(l.A,{isCollapsed:w,setIsCollapsed:v}),(0,c.jsxs)("div",{className:"global_view "+(w?"global_view_col":""),children:[(0,c.jsx)(o.A,{}),(0,c.jsx)(i.$K,{className:"d-block p-4",children:(0,c.jsxs)("div",{className:"container-fluid",children:[(0,c.jsxs)("div",{className:"subscription-header",children:[(0,c.jsxs)("div",{className:"subscription-title",children:[(0,c.jsx)("h1",{children:"Your Subscriptions"}),(0,c.jsx)("p",{children:"Manage your active plans and services"})]}),(0,c.jsx)("div",{className:"subscription-count",children:(0,c.jsxs)("span",{children:[b.length," active plans"]})})]}),0===b.length?(0,c.jsxs)("div",{className:"empty-state",children:[(0,c.jsx)("div",{className:"empty-icon",children:(0,c.jsx)("svg",{width:"64",height:"64",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:(0,c.jsx)("path",{d:"M15 5V7M15 11V13M15 17V19M5 5C5 6.10457 4.10457 7 3 7C4.10457 7 5 7.89543 5 9C5 7.89543 5.89543 7 7 7C5.89543 7 5 6.10457 5 5ZM12 5C12 6.10457 11.1046 7 10 7C11.1046 7 12 7.89543 12 9C12 7.89543 12.8954 7 14 7C12.8954 7 12 6.10457 12 5ZM19 5C19 6.10457 18.1046 7 17 7C18.1046 7 19 7.89543 19 9C19 7.89543 19.8954 7 21 7C19.8954 7 19 6.10457 19 5ZM5 12C5 13.1046 4.10457 14 3 14C4.10457 14 5 14.8954 5 16C5 14.8954 5.89543 14 7 14C5.89543 14 5 13.1046 5 12ZM12 12C12 13.1046 11.1046 14 10 14C11.1046 14 12 14.8954 12 16C12 14.8954 12.8954 14 14 14C12.8954 14 12 13.1046 12 12ZM19 12C19 13.1046 18.1046 14 17 14C18.1046 14 19 14.8954 19 16C19 14.8954 19.8954 14 21 14C19.8954 14 19 13.1046 19 12Z",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})})}),(0,c.jsx)("h3",{children:"No subscriptions yet"}),(0,c.jsx)("p",{children:"You don't have any active subscriptions at the moment."})]}):(0,c.jsx)("div",{className:"subscription-grid",children:b.map(((e,n)=>{const t=e.renewalDate?e.renewalDate.replace(/(\d+)(st|nd|rd|th)/,"$1"):null,r=t?new Date(t):null,o=new Date;let i;return i="International Entrepreneur Academy"===e.name||r&&r>=o?"Active":"Inactive",(0,c.jsxs)("div",{className:"subscription-card",children:[(0,c.jsxs)("div",{className:"card-header",children:[(0,c.jsxs)("div",{className:"card-title-section",children:[(0,c.jsx)("div",{className:"card-icon",children:C(e.type)}),(0,c.jsx)("h3",{children:e.name})]}),!e.name.includes("Per Instance")&&(0,c.jsx)("span",{className:`status-badge status-${i.toLowerCase()}`,children:i})]}),(0,c.jsxs)("div",{className:"card-body",children:[(0,c.jsxs)("div",{className:"price-section",children:[(0,c.jsx)("span",{className:"price",children:e.price}),e.renewalDate&&(0,c.jsxs)("span",{className:"period",children:["/",e.period]})]}),(0,c.jsxs)("div",{className:"details-grid",children:[e.renewalDate&&(0,c.jsxs)("div",{className:"detail-item",children:[(0,c.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,c.jsx)("path",{d:"M19 4H5C3.89543 4 3 4.89543 3 6V20C3 21.1046 3.89543 22 5 22H19C20.1046 22 21 21.1046 21 20V6C21 4.89543 20.1046 4 19 4Z",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M16 2V6",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M8 2V6",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M3 10H21",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]}),(0,c.jsxs)("span",{children:["Renews: ",e.renewalDate]})]}),(0,c.jsxs)("div",{className:"detail-item",children:[(0,c.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,c.jsx)("path",{d:"M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,c.jsx)("path",{d:"M12 6V12L16 14",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]}),(0,c.jsxs)("span",{children:["Last payment: ",e.lastPayment]})]})]}),(0,c.jsxs)("div",{className:"features-section",children:[(0,c.jsx)("h4",{children:"Features"}),(0,c.jsx)("ul",{className:"features-list",children:e.features.map(((e,n)=>(0,c.jsxs)("li",{children:[(0,c.jsx)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:(0,c.jsx)("path",{d:"M20 6L9 17L4 12",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})}),e]},n)))})]})]})]},n)}))})]})})]})]})})}),(0,c.jsx)("style",{jsx:!0,children:"\n        .subscription-header {\n          display: flex;\n          justify-content: space-between;\n          align-items: flex-end;\n          margin-bottom: 2rem;\n          padding-bottom: 1rem;\n          border-bottom: 1px solid #e5e7eb;\n        }\n\n        .subscription-title h1 {\n          font-size: 2rem;\n          font-weight: 700;\n          color: #0a0a0a;\n          margin: 0 0 0.5rem 0;\n        }\n\n        .subscription-title p {\n          color: #6b7280;\n          margin: 0;\n          font-size: 1.1rem;\n        }\n\n        .subscription-count {\n          background: #f8fafc;\n          padding: 0.5rem 1rem;\n          border-radius: 20px;\n          font-size: 0.9rem;\n          color: #6b7280;\n        }\n\n        .empty-state {\n          text-align: center;\n          padding: 4rem 2rem;\n          background: #f8fafc;\n          border-radius: 12px;\n          margin: 2rem 0;\n        }\n\n        .empty-icon {\n          color: #9ca3af;\n          margin-bottom: 1.5rem;\n        }\n\n        .empty-state h3 {\n          font-size: 1.5rem;\n          color: #374151;\n          margin: 0 0 1rem 0;\n        }\n\n        .empty-state p {\n          color: #6b7280;\n          margin: 0;\n        }\n\n        .subscription-grid {\n          display: grid;\n          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));\n          gap: 1.5rem;\n          margin-top: 2rem;\n        }\n\n        .subscription-card {\n          background: #fff;\n          border-radius: 16px;\n          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);\n          overflow: hidden;\n          transition: all 0.3s ease;\n          border: 1px solid #f1f5f9;\n        }\n\n        .subscription-card:hover {\n          transform: translateY(-4px);\n          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);\n        }\n\n        .card-header {\n          display: flex;\n          justify-content: space-between;\n          align-items: flex-start;\n          padding: 1.5rem;\n          background: linear-gradient(135deg, #efefef 0%, #efefef 100%);\n          border-bottom: 1px solid #e5e7eb;\n        }\n\n        .card-title-section {\n          display: flex;\n          align-items: center;\n          gap: 0.75rem;\n        }\n\n        .card-icon {\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          width: 48px;\n          height: 48px;\n          border-radius: 12px;\n          background: linear-gradient(135deg, #f63b3b 0%, #e03535 100%);\n          color: white;\n        }\n\n        .card-header h3 {\n          font-size: 1.25rem;\n          font-weight: 600;\n          color: #0a0a0a;\n          margin: 0;\n        }\n\n        .status-badge {\n          padding: 0.25rem 0.75rem;\n          border-radius: 20px;\n          font-size: 0.75rem;\n          font-weight: 600;\n        }\n\n        .status-active {\n          background: #ecfdf5;\n          color: #065f46;\n        }\n\n        .status-inactive {\n          background: #fef2f2;\n          color: #991b1b;\n        }\n\n        .card-body {\n          padding: 1.5rem;\n        }\n\n        .price-section {\n          display: flex;\n          align-items: baseline;\n          gap: 0.25rem;\n          margin-bottom: 1.5rem;\n        }\n\n        .price {\n          font-size: 1.75rem;\n          font-weight: 700;\n          color: #0a0a0a;\n        }\n\n        .period {\n          color: #6b7280;\n          font-size: 0.9rem;\n        }\n\n        .details-grid {\n          display: flex;\n          flex-direction: column;\n          gap: 0.75rem;\n          margin-bottom: 1.5rem;\n        }\n\n        .detail-item {\n          display: flex;\n          align-items: center;\n          gap: 0.5rem;\n          color: #6b7280;\n          font-size: 0.9rem;\n        }\n\n        .detail-item svg {\n          flex-shrink: 0;\n        }\n\n        .features-section h4 {\n          font-size: 1rem;\n          font-weight: 600;\n          color: #374151;\n          margin: 0 0 1rem 0;\n        }\n\n        .features-list {\n          list-style: none;\n          padding: 0;\n          margin: 0;\n          display: flex;\n          flex-direction: column;\n          gap: 0.5rem;\n        }\n\n        .features-list li {\n          display: flex;\n          align-items: center;\n          gap: 0.5rem;\n          font-size: 0.9rem;\n          color: #4b5563;\n        }\n\n        .features-list li svg {\n          color: #10b981;\n          flex-shrink: 0;\n        }\n\n        @media (max-width: 768px) {\n          .subscription-header {\n            flex-direction: column;\n            align-items: flex-start;\n            gap: 1rem;\n          }\n\n          .subscription-title h1 {\n            font-size: 1.75rem;\n          }\n\n          .subscription-grid {\n            grid-template-columns: 1fr;\n          }\n\n          .card-header {\n            flex-direction: column;\n            align-items: flex-start;\n            gap: 1rem;\n          }\n        }\n      "})]})}}}]);
//# sourceMappingURL=6110.d8ba2f99.chunk.js.map