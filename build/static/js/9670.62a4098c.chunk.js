/*! For license information please see 9670.62a4098c.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[9670],{9333:(e,t,s)=>{s.d(t,{A:()=>a});const a=(0,s(77784).A)("video",[["path",{d:"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5",key:"ftymec"}],["rect",{x:"2",y:"6",width:"14",height:"12",rx:"2",key:"158x01"}]])},11508:(e,t,s)=>{s.d(t,{A:()=>c});var a=s(65043),i=s(86213),o=s(26022),n=s(69677),r=s(63393),l=s(70579);const d=(0,n.c)("pk_test_51RUJzWAx6rm2q3pys9SgKUPRxNxPZ4P1X6EazNQvnPuHKOOfzGsbylaTLUktId9ANHULkwBk67jnp5aqZ9Dlm6PR00jKdDwvSq"),c=e=>{let{moduledata:t,paytmmodule:s,show:n,onClose:c,onSubmit:p}=e;var m="https://blueprintcatalyst.com/api/user/aifile/";document.title="Dataroom Management & Diligence";const u=localStorage.getItem("UserLoginData"),h=JSON.parse(u),x=()=>{(0,a.useEffect)((()=>{t(s)}),[s]);const[e,t]=(0,a.useState)(s),[n,d]=(0,a.useState)(""),c=(0,r.useStripe)(),p=(0,r.useElements)(),[u,x]=(0,a.useState)(""),[f,g]=(0,a.useState)(!1),[b,y]=(0,a.useState)(""),[j,v]=(0,a.useState)(!1),[w,k]=(0,a.useState)("Onetime"),[N,S]=(0,a.useState)(""),[C,z]=(0,a.useState)(""),M=async e=>{try{await i.A.post(`${m}CreateuserSubscription_Academy`,e,{headers:{Accept:"application/json","Content-Type":"application/json"}}),y("Payment successful! \ud83c\udf89"),v(!1),setTimeout((()=>{window.location.reload()}),2e3)}catch(j){console.error("Success handler error:",j),y("Payment was captured, but post-process failed."),v(!0)}finally{g(!1)}};return(0,l.jsxs)("form",{onSubmit:async t=>{if(t.preventDefault(),!c||!p)return;const s=p.getElement(r.CardElement);if(!s)return y("Payment form is not ready. Please reload the page."),void v(!0);g(!0);try{const{data:t}=await i.A.post(`${m}CreateuserSubscription_AcademyCheck`,{user_id:h.id,amount:e}),a=await c.confirmCardPayment(t.clientSecret,{payment_method:{card:s}});if(a.error)y(a.error.message),v(!0),g(!1);else if("succeeded"===a.paymentIntent.status){const s={code:u,user_id:h.id,amount:e,clientSecret:t.clientSecret,PayidOnetime:N,payment_status:a.paymentIntent.status,discount:n};await M(s)}else y("Payment failed. Try again."),v(!0),g(!1)}catch(a){y("Unexpected error occurred."),v(!0),g(!1)}},children:[(0,l.jsx)("div",{className:"form-control rounded-3",style:{padding:"0.75rem",border:"1px solid #000",borderColor:"#ced4da"},children:(0,l.jsx)(r.CardElement,{options:{style:{base:{fontSize:"16px",color:"#32325d",fontFamily:'"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',"::placeholder":{color:"#a0aec0"},padding:"0.75rem"},invalid:{color:"#e5424d"}},classes:{base:"stripe-card-element",focus:"border-primary",invalid:"border-danger"}}})}),(0,l.jsxs)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:[(0,l.jsxs)("div",{className:"d-flex flex-column",children:[(0,l.jsx)("input",{type:"text",name:"refferal_code",defaultValue:u,onChange:async e=>{const t=e.target.value.toUpperCase();x(t)},className:"form-control w-auto",placeholder:"Apply Referral Code",autoComplete:"off",style:{textTransform:"uppercase"}}),C&&(0,l.jsx)("span",{className:"text-danger mt-1",style:{fontSize:"0.875rem"},children:C})]}),(0,l.jsx)(o.$n,{type:"button",onClick:async()=>{if(""===u)z("Enter the code");else{let a={code:u,type:"Academy",email:h.email};console.log(a);try{const o=await i.A.post(`${m}checkreferCode`,a,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(o.data.results.length>0){var e=o.data.results[0];if(e.usage_limit>e.used_count){d(e.percentage);const a=s*e.percentage/100;t(s-a),z("")}else d(""),t(s),z("This code already used")}else d(""),t(s),z("Invalid code!")}catch(j){}}},className:"submit d-flex align-items-center gap-2",style:{background:"#5C636B",height:"fit-content"},children:"Apply Code"})]}),n&&(0,l.jsxs)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:[(0,l.jsx)("b",{children:"Discount:"})," ",n,"%"]}),(0,l.jsx)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:(0,l.jsxs)(o.$n,{disabled:!c||f,type:"submit",className:"submit d-flex align-items-center gap-2",style:{background:"#003b21"},children:[!f&&(0,l.jsxs)("span",{children:["Pay \u20ac",e]}),f&&(0,l.jsx)("div",{className:"spinner-border text-white spinneronetimepay m-0",role:"status",children:(0,l.jsx)("span",{className:"visually-hidden"})})]})}),b&&(0,l.jsx)("p",{className:j?" mt-3 error_pop":"success_pop mt-3",children:b})]})},[f,g]=(0,a.useState)(!1);return n?(0,l.jsx)("div",{className:"modal fade show d-block",style:{backgroundColor:"rgba(0, 0, 0, 0.5)"},tabIndex:"-1",role:"dialog","aria-labelledby":"paymentModalLabel","aria-hidden":"false",children:(0,l.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-lg",children:(0,l.jsxs)("div",{className:"modal-content rounded-4 shadow-lg p-4",children:[(0,l.jsx)("button",{type:"button",className:"btn-close position-absolute top-0 end-0 m-3",onClick:c,"aria-label":"Close"}),(0,l.jsxs)(l.Fragment,{children:[(0,l.jsx)("h2",{className:"modal-title text-center fw-bold text-dark mb-4",id:"paymentModalLabel",children:"Payment"}),(0,l.jsx)("div",{className:"mb-4",children:(0,l.jsx)("h5",{className:"fw-bold text-dark mb-2",children:t.name})}),(0,l.jsxs)("div",{className:"mb-4",children:[(0,l.jsxs)("div",{className:"fs-4 fw-semibold text-dark",children:["Fee:",(0,l.jsxs)("span",{style:{color:"#2e5692"},className:"fw-bold",children:["\u20ac",s]})]}),(0,l.jsx)("ul",{className:"list-group list-group-flush mt-3",children:(0,l.jsx)("li",{className:"list-group-item text-dark ps-0",children:(0,l.jsx)("strong",{children:"1,200 Euros. ONE-TIME. This will include participation in all modules for each company."})})})]})]}),(0,l.jsx)("div",{className:"text-center mb-4",children:(0,l.jsx)("img",{src:"/assets/user/images/cardimage.jpg",alt:"cards",className:"img-fluid rounded",style:{maxWidth:"200px"}})}),(0,l.jsx)(r.Elements,{stripe:d,children:(0,l.jsx)(x,{})})]})})}):null}},18622:(e,t,s)=>{s.d(t,{A:()=>o});var a=s(65043),i=s(70579);const o=function(e){let{message:t,onClose:s}=e;const[o,n]=(0,a.useState)("show");return(0,a.useEffect)((()=>{const e=setTimeout((()=>{n("")}),2500),t=setTimeout((()=>{s()}),3e3);return()=>{clearTimeout(e),clearTimeout(t)}}),[s]),(0,i.jsxs)("div",{className:`alert alert-success alert-dismissible fade ${o}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:9999,minWidth:"300px",maxWidth:"90%"},children:[(0,i.jsx)("strong",{children:"Success!"})," ",t,(0,i.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:s})]})}},25015:()=>{},34939:(e,t,s)=>{s.d(t,{A:()=>o});var a=s(65043),i=s(70579);const o=function(e){let{message:t,onClose:s}=e;const[o,n]=(0,a.useState)("show");return(0,a.useEffect)((()=>{const e=setTimeout((()=>{n("")}),3500),t=setTimeout((()=>{s()}),3e3);return()=>{clearTimeout(e),clearTimeout(t)}}),[s]),(0,i.jsxs)("div",{className:`alert alert-danger alert-dismissible fade ${o}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:999999,minWidth:"300px",maxWidth:"90%"},children:[(0,i.jsx)("strong",{children:"Error!"})," ",t,(0,i.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:s})]})}},37022:(e,t,s)=>{s.d(t,{A:()=>i});s(65043);var a=s(70579);const i=function(e){let{message:t,onConfirm:s,onCancel:i}=e;return(0,a.jsx)("div",{className:"position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center",style:{backgroundColor:"rgba(0, 0, 0, 0.5)",zIndex:9999},children:(0,a.jsxs)("div",{className:"bg-white p-4 rounded d-flex flex-column gap-2 shadow-lg alert-pop-mess",style:{maxWidth:"40%"},children:[(0,a.jsx)("p",{children:t}),(0,a.jsxs)("div",{className:"d-flex justify-content-end gap-2",children:[(0,a.jsx)("button",{type:"button",className:"btn btn-secondary",onClick:i,children:"No"}),(0,a.jsx)("button",{type:"button",className:"btn btn-danger",onClick:s,children:"Yes"})]})]})})}},62837:(e,t,s)=>{s.d(t,{$K:()=>l,CB:()=>c,Cd:()=>b,FC:()=>r,Jq:()=>u,R3:()=>v,SD:()=>n,Zw:()=>m,dN:()=>f,hJ:()=>g,mO:()=>i,mg:()=>d,nj:()=>y,pd:()=>j,uM:()=>h,vE:()=>o,z6:()=>p});var a=s(5464);const i=a.default.div`
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
`,o=a.default.span`
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
`),r=a.default.div`
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
`,l=a.default.div`
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
`,m=a.default.div`
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
`),h=(a.default.div`
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
`),x=(a.default.div`
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
`),f=((0,a.default)(x)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(x)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,a.default.sup`
  color: var(--primary-color);
`),g=a.default.div`
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
`,b=a.default.div`
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
`,y=a.default.button`
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
`,j=a.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 16px;
`,v=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},86078:(e,t,s)=>{s.r(t),s.d(t,{default:()=>k});var a=s(65043),i=(s(25015),s(65136)),o=s(34939),n=s(18622),r=s(70579);const l=function(e){let{children:t,onClose:s}=e;const[i,o]=(0,a.useState)("show");return(0,r.jsxs)("div",{className:`alert alert-success alert-dismissible fade ${i}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:9999,minWidth:"300px",maxWidth:"90%"},children:[t,(0,r.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:s})]})};const d=function(e){let{children:t,onClose:s}=e;const[i,o]=(0,a.useState)("show");return(0,r.jsxs)("div",{className:`alert alert-danger alert-dismissible fade ${i}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:9999,minWidth:"300px",maxWidth:"90%"},children:[t,(0,r.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:s})]})};s(38421);var c=s(34348),p=s.n(c),m=s(62837),u=s(11508),h=s(73216),x=s(35475),f=s(37022);const g=(0,s(77784).A)("clock",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polyline",{points:"12 6 12 12 16 14",key:"68esgv"}]]);var b=s(9333),y=s(95264),j=s(87268),v=(s(83656),s(44710)),w=s(86213);function k(){const e=(0,h.Zp)(),[t,s]=(0,a.useState)([]),[c,k]=(0,a.useState)([]),[N,S]=(0,a.useState)(Intl.DateTimeFormat().resolvedOptions().timeZone),[C,z]=(0,a.useState)(null),[M,A]=(0,a.useState)(null),[_,D]=(0,a.useState)(null),[T,Y]=(0,a.useState)(!1),[E,$]=(0,a.useState)(!1),[I,P]=(0,a.useState)(!1),[O,Z]=(0,a.useState)({name:"",email:""}),R=(0,j.ye)(p()),[F,H]=(0,a.useState)(""),[J,q]=(0,a.useState)([]),[W,L]=(0,a.useState)(""),[B,U]=(0,a.useState)(""),[V,K]=(0,a.useState)(""),[G,Q]=(0,a.useState)(""),{id:X}=(0,h.g)(),ee=localStorage.getItem("UserLoginData"),te=JSON.parse(ee),[se,ae]=(0,a.useState)(""),ie="https://blueprintcatalyst.com/api/user/",[oe,ne]=(0,a.useState)(null),[re,le]=(0,a.useState)(null),[de,ce]=(0,a.useState)(null),[pe,me]=(0,a.useState)([]),[ue,he]=(0,a.useState)({name:"",email:""}),[xe,fe]=(0,a.useState)([]);document.title="Module Page",(0,a.useEffect)((()=>{if(Intl.supportedValuesOf){const e=Intl.supportedValuesOf("timeZone");s(e)}}),[]);const[ge,be]=(0,a.useState)([]);(0,a.useEffect)((()=>{ye()}),[X]),(0,a.useEffect)((()=>{je()}),[X]);const ye=async()=>{try{const[e,t]=await Promise.all([w.A.post(ie+"get_combined_zoom_meetings",{module_id:X,user_id:te.id}),w.A.post(ie+"get_SessionMeeting",{module_id:X,user_id:te.id})]),s=e.data.meetings||[],a=t.data.meetings||[],i=Intl.DateTimeFormat().resolvedOptions().timeZone,o=s.map((e=>ve(e.originalMeeting,e.isRegistered,i,e.meet_type,e.zoom_link,e.morevng))),n=a.map((e=>e.originalMeeting?ve(e.originalMeeting,!1,i,e.meet_type,e.zoom_link,e.morevng):{...e,start:p().tz(`${e.meeting_date} ${e.time}`,"YYYY-MM-DD HH:mm:ss",e.timezone).tz(i).toDate(),end:p().tz(`${e.meeting_date} ${e.time}`,"YYYY-MM-DD HH:mm:ss",e.timezone).tz(i).add(30,"minutes").toDate(),isRegistered:!1})),r=[...o,...n];r.sort(((e,t)=>e.start-t.start));const l=r.filter((e=>e.isRegistered));fe(r),be(l)}catch(e){console.error("Failed to fetch meetings",e)}},je=async()=>{try{await w.A.post(ie+"get_SessionMeeting",{module_id:X,user_id:te.id})}catch(e){console.error("Failed to fetch combined meetings",e)}},ve=(e,t,s,a,i,o)=>{const n=`${p()(e.meeting_date).format("YYYY-MM-DD")} ${e.time}:00`,r=p().tz(n,"YYYY-MM-DD HH:mm:ss",e.timezone).clone().tz(s);return{id:e.id,topic:e.topic,time:e.time,datee:e.meeting_date_time,moduleId:e.module_id,zoom_link:i,isRegistered:t,allDay:!1,start:r.toDate(),end:r.clone().add(30,"minutes").toDate(),title:`${r.format("hh:mm A")} ${e.topic}`,meet_type:a,morevng:o}};(0,a.useEffect)((()=>{we()}),[]);const we=async()=>{let e={user_id:""};try{var t=(await w.A.post("https://blueprintcatalyst.com/api/admin/module/getDataroompayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;ae(t[0].academy_Fee)}catch(s){s.response||(s.request?console.error("Request data:",s.request):console.error("Error message:",s.message))}};(0,a.useEffect)((()=>{"undefined"!==X&&ke()}),[X]);const ke=async()=>{let e={id:X,user_id:te.id};try{(await w.A.post(ie+"checkmodulesubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length>0&&Q("1")}catch(t){}};(0,a.useEffect)((()=>{X&&Ne()}),[X]);const Ne=async()=>{let t={id:X};try{const s=await w.A.post(ie+"selectModule",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});s.data.results.length>0?(ke(),K(s.data.results[0]),q(s.data.zoomMeetings)):e("/dataroom-Duediligence")}catch(s){}};(0,a.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),t=await e.json();H(t.ip)}catch(e){console.error("Failed to fetch IP",e)}})()}),[]),(0,a.useEffect)((()=>{if(Intl.supportedValuesOf){const e=Intl.supportedValuesOf("timeZone");s(e)}}),[]),(0,a.useEffect)((()=>{if(Intl.supportedValuesOf){const e=Intl.supportedValuesOf("timeZone"),t=p()(),s=e.map((e=>({value:e,label:`${e} (${t.clone().tz(e).format("hh:mm A")})`})));k(s)}}),[]);(new Date).setHours(0,0,0,0);p()().format("YYYY-MM-DD");const[Se,Ce]=(0,a.useState)([]),ze=(0,a.useRef)(null);(0,a.useEffect)((()=>{if(null!==J&&void 0!==J&&J.length&&null!==t&&void 0!==t&&t.length){const e=p()().format("YYYY-MM-DD"),s=J.find((t=>p()(t.start).format("YYYY-MM-DD")===e));if(s){const e=`${X}_${s.id}_${p()(s.start).format()}`;if(ze.current===e)return;ze.current=e;const a=p()(s.start),i=t.map((e=>({value:e,label:`${e} (${a.clone().tz(e).format("hh:mm A")})`})));Ce(i)}}else Ce(c)}),[J,t,X,c]);const[Me,Ae]=(0,a.useState)(!0);(0,a.useEffect)((()=>{pe.length>0&&!re?Ae(!1):(he({name:"",email:""}),Ae(!0))}),[pe,re]);const[_e,De]=(0,a.useState)(null),[Te,Ye]=(0,a.useState)(!1);return(0,r.jsxs)(r.Fragment,{children:[(0,r.jsxs)(m.mO,{children:[(0,r.jsxs)("div",{className:"fullpage d-block",children:[(0,r.jsx)(i.A,{}),Te&&_e&&(0,r.jsx)("div",{dangerouslySetInnerHTML:{__html:_e},style:{width:"100%",height:"80vh"}}),(0,r.jsx)(m.$K,{className:"d-block py-5",children:(0,r.jsx)("div",{className:"container-lg",children:(0,r.jsxs)("div",{className:"row justify-content-center",children:[(0,r.jsx)("div",{className:"col-md-3",children:(0,r.jsx)(v.A,{})}),(0,r.jsx)("div",{className:"col-md-9",children:(0,r.jsx)("form",{action:"",children:(0,r.jsx)(m.mg,{id:"step5",children:(0,r.jsxs)("div",{className:"d-flex flex-column gap-5",children:[M&&(0,r.jsx)(f.A,{message:(0,r.jsxs)("div",{className:"alert alert-warning mt-3",children:[(0,r.jsx)("h5",{children:"\ud83d\udcdd Confirm Meeting Registration"}),(0,r.jsx)("p",{children:"You're about to register for the following Zoom meeting. Please review the details carefully before proceeding:"}),(0,r.jsxs)("ul",{children:[(0,r.jsxs)("li",{children:[(0,r.jsx)("strong",{children:"Topic:"})," ",M.topic]}),(0,r.jsxs)("li",{children:[(0,r.jsx)("strong",{children:"Date & Time:"})," ",p()(M.start).format("DD MMM, hh:mm A")]})]}),(0,r.jsxs)("p",{className:"mt-3",children:["\ud83d\udc49 Once you confirm, the"," ",(0,r.jsx)("strong",{children:'"Register For Zoom"'})," button will be enabled."]}),(0,r.jsx)("p",{className:"mt-2",children:"Do you want to continue with the registration?"})]}),onConfirm:()=>{const e=C;if(pe.find((t=>t.id===e.id)))me(pe.filter((t=>t.id!==e.id)));else{if(pe.length>=3)return L("Only 3 meetings allowed."),void setTimeout((()=>L("")),2e3);me([...pe,e])}A(null)},onCancel:()=>A(null)}),W&&(0,r.jsx)(o.A,{message:W,onClose:()=>L("")}),B&&(0,r.jsx)(n.A,{message:B,onClose:()=>U("")}),oe&&(0,r.jsx)(d,{onClose:()=>ne(null),children:(0,r.jsxs)("div",{className:"alert alert-danger mt-3",children:[(0,r.jsx)("h5",{children:"\u274c Meeting Scheduling Failed!"}),(0,r.jsx)("p",{children:"There was an issue with your meeting schedule. Please review the following details:"}),(0,r.jsxs)("ul",{children:[(0,r.jsxs)("li",{children:[(0,r.jsx)("strong",{children:"Topic:"})," ",oe.topic," \u2014"," "]}),(0,r.jsxs)("li",{children:[(0,r.jsx)("strong",{children:"DateTime:"})," ",p()(oe.start).format("DD MMM, hh:mm A")]})]}),(0,r.jsx)("p",{className:"mt-2",children:"The selected meeting time may have already passed or is invalid. Please choose a future date and time, and try again."})]})}),re&&(0,r.jsx)(l,{onClose:()=>(le(null),void setTimeout((()=>{$(!1)}),5)),children:(0,r.jsxs)("div",{className:"alert alert-success mt-3",children:[(0,r.jsx)("h5",{children:"\u2705 Registered Successfully!"}),(0,r.jsx)("p",{children:"Your scheduled Zoom meetings are listed below on the calendar:"}),(0,r.jsx)("ul",{children:re.map(((e,t)=>(0,r.jsxs)("li",{children:[(0,r.jsxs)("div",{children:[(0,r.jsx)("strong",{children:"Topic:"})," ",e.title]}),(0,r.jsxs)("div",{children:[(0,r.jsx)("strong",{children:"DateTime:"})," ",p()(e.start).format("DD MMM, hh:mm A")]})]},t)))}),(0,r.jsxs)("p",{className:"mt-2",children:["A ",(0,r.jsx)("strong",{children:'"Join"'})," button will appear 5 minutes before the session starts. You can use it to join the Zoom meeting directly from here."]})]})}),de&&(0,r.jsx)(l,{onClose:()=>ce(null),children:(0,r.jsxs)("div",{className:"alert alert-info mt-3",children:[(0,r.jsx)("h5",{children:"\ud83d\udcc5 Zoom Meeting Details"}),(0,r.jsx)("p",{children:"The following Zoom meeting is scheduled. Please find the details below:"}),(0,r.jsxs)("ul",{children:[(0,r.jsxs)("li",{children:[(0,r.jsx)("strong",{children:"Topic:"})," ",de.topic," "]}),(0,r.jsxs)("li",{children:[(0,r.jsx)("strong",{children:"Date & Time:"})," ",p()(de.start).format("DD MMM, hh:mm A")]})]}),(0,r.jsxs)("p",{className:"mt-2",children:["A ",(0,r.jsx)("strong",{children:"Join"})," button will appear 5 minutes before the session starts. You can use it to join the Zoom meeting directly from here."]}),p()().isSameOrAfter(p()(de.start).subtract(5,"minutes"))&&p()().isBefore(p()(de.start).add(45,"hour"))&&(0,r.jsx)("button",{onClick:()=>(async e=>{let t={id:e,ip_address:F};try{const e=await w.A.post(ie+"openZoomLink",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});"2"===e.data.status?L(e.data.message):(De(e.data),Ye(!0),setTimeout((()=>{Ye(!1)}),1e3))}catch(s){}})(de.id),type:"button",rel:"noopener noreferrer",className:"btn btn-primary mt-3",children:"Join Zoom Meeting"})]})}),_&&(0,r.jsx)(l,{onClose:()=>D(null),children:(0,r.jsxs)("div",{className:"alert alert-info mt-3",children:[(0,r.jsxs)("h5",{children:["\ud83d\udcc5 ",(0,r.jsx)("b",{children:"Broadcast Session Details"})]}),(0,r.jsx)("p",{children:"A broadcast session is scheduled. Please find the details below:"}),(0,r.jsxs)("ul",{children:[(0,r.jsxs)("li",{children:[(0,r.jsx)("strong",{children:"Session Period:"})," ",_.morevng.charAt(0).toUpperCase()+_.morevng.slice(1)]}),(0,r.jsxs)("li",{children:[(0,r.jsx)("strong",{children:"Topic:"})," ",_.topic]}),(0,r.jsxs)("li",{children:[(0,r.jsx)("strong",{children:"Date & Time:"})," ",p()(_.start).format("DD MMM, hh:mm A")]})]}),(0,r.jsxs)("p",{className:"mt-2",children:["A ",(0,r.jsx)("strong",{children:"Join"})," button will appear 5 minutes before the session starts. You can use it to join the broadcast session directly from here."]}),p()().isSameOrAfter(p()(_.start).subtract(5,"minutes"))&&p()().isBefore(p()(_.start).add(45,"minutes"))&&(0,r.jsx)(x.N_,{target:"_blank",to:_.zoom_link,rel:"noopener noreferrer",className:"btn btn-primary mt-3",children:"Join Live Broadcast Session"})]})}),(0,r.jsx)(m.CB,{children:V.name}),(0,r.jsxs)("div",{className:"row gy-3",children:[(0,r.jsx)("div",{className:"col-md-4",children:(0,r.jsxs)(m.uM,{children:[(0,r.jsxs)("div",{className:"d-flex flex-column gap-3",children:[(0,r.jsx)("div",{className:"klogo",children:(0,r.jsx)("div",{className:"inlogo fulw",children:(0,r.jsx)("img",{src:"/logos/logoblack.png",alt:"logo"})})}),(0,r.jsx)("h3",{children:"Keiretsu Forum Conoda"}),(0,r.jsx)("h4",{children:"Deal Screening - 30 minutes"})]}),(0,r.jsxs)("h6",{children:[(0,r.jsx)(m.vE,{children:(0,r.jsx)(g,{})}),"30 min"]}),(0,r.jsxs)("h6",{children:[(0,r.jsx)(m.vE,{children:(0,r.jsx)(b.A,{})}),"Web conferencing details provided upon confirmation."]}),(0,r.jsx)("div",{dangerouslySetInnerHTML:{__html:V.description}})]})}),(0,r.jsx)("div",{className:"col-md-8",children:(0,r.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,r.jsx)("label",{children:"Select a date and time"}),(0,r.jsxs)(m.Jq,{children:[(0,r.jsx)(j.Vv,{localizer:R,events:xe,startAccessor:"start",endAccessor:"end",style:{height:600},popup:!0,selectable:!0,defaultView:"month",views:["month"],onSelectEvent:e=>{if(""!==G){if("Broadcaste"===e.meet_type)D(e);else{const s=new Date;if(e.time){var t=e.end;const a=p()(t).format("YYYY-MM-DD"),i=e.time,o=p()(i,"HH:mm").add(30,"minutes").format("HH:mm");if(!(new Date(`${a}T${o}:00`)>s))return void ne(e)}if(ge.some((t=>t.id===e.id)))return void ce(e);A(e)}z(e)}else P(!0)},eventPropGetter:e=>{const t=ge.some((t=>t.id===e.id)),s=pe.some((t=>t.id===e.id));let a="event-default";return t?a="event-registered":s&&(a="event-selected"),{className:a}}}),(0,r.jsx)("strong",{children:"Time Zone"}),(0,r.jsx)("select",{value:N,onChange:e=>S(e.target.value),children:Se.map((e=>(0,r.jsx)("option",{value:e.value,children:e.label},e.value)))})]}),(0,r.jsx)("button",{style:{opacity:Me?.5:1,pointerEvents:Me?"none":"auto"},className:"registerzoom",onClick:()=>(he({name:"",email:""}),void(pe.length>0&&!re?$(!0):$(!1))),type:"button",children:"Register For Zoom"})]})}),(0,r.jsx)("div",{className:"col-12",children:(0,r.jsxs)(m.Jq,{children:[(0,r.jsx)(y.A,{}),(0,r.jsx)("p",{children:V.textt})]})})]})]})})})})]})})})]}),(0,r.jsx)(m.hJ,{show:E,children:(0,r.jsxs)(m.Cd,{children:[(0,r.jsx)(m.nj,{onClick:()=>$(!1),children:"\xd7"}),(0,r.jsxs)("div",{className:"card p-3 mt-3",children:[(0,r.jsx)("h5",{className:"mb-2",children:"Register Your Email"}),(0,r.jsx)("input",{placeholder:"Name",value:ue.name,onChange:e=>he({...ue,name:e.target.value}),className:"form-control mb-2"}),(0,r.jsx)("input",{placeholder:"Email",value:ue.email,onChange:e=>he({...ue,email:e.target.value}),className:"form-control mb-2"}),(0,r.jsx)("button",{type:"button",className:"btn btn-primary",onClick:async()=>{if(!ue.name||!ue.email)return L("Please enter your name and email."),void setTimeout((()=>{L("")}),1200);let e={email:ue.email,name:ue.name,user_id:te.id,timezone:N,selectedMeetings:pe.map((e=>e.id)),ip:F};try{const t=await w.A.post(ie+"register_zoom",e);console.log(t.data),"success"===t.data.status?(le(t.data.selectedMeetings),me([]),ye(),Ne()):L(t.data.message),setTimeout((()=>{$(!1),U(""),L("")}),1200)}catch(t){console.error("Error creating zoom meet",t)}},children:"Confirm Registration"})]})]})})]}),(0,r.jsx)(u.A,{moduledata:V,paytmmodule:se,show:I,onClose:()=>P(!1),onSubmit:async e=>{e.preventDefault();var t=e.target;let s={name:t.name.value,email:t.email.value,cardnumber:t.cardnumber.value,expiry:t.expiry.value,cvv:t.cvv.value,user_id:te.id,plan_id:X};try{(await w.A.post(ie+"usersubscription",s,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results}catch(a){a.response||(a.request?console.error("Request data:",a.request):console.error("Error message:",a.message))}$(!1)}})]})}},95264:(e,t,s)=>{s.d(t,{A:()=>a});const a=(0,s(77784).A)("building",[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["path",{d:"M9 22v-4h6v4",key:"r93iot"}],["path",{d:"M8 6h.01",key:"1dz90k"}],["path",{d:"M16 6h.01",key:"1x0f13"}],["path",{d:"M12 6h.01",key:"1vi96p"}],["path",{d:"M12 10h.01",key:"1nrarc"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M16 14h.01",key:"1gbofw"}],["path",{d:"M8 10h.01",key:"19clt8"}],["path",{d:"M8 14h.01",key:"6423bh"}]])}}]);
//# sourceMappingURL=9670.62a4098c.chunk.js.map