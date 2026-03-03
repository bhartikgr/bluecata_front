/*! For license information please see 7116.39a4a80b.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[7116],{65727:(e,t,a)=>{a.d(t,{A:()=>s});const s=(0,a(77784).A)("lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]])},73779:(e,t,a)=>{a.r(t),a.d(t,{default:()=>me});var s=a(65043),n=a(94060),i=a(44710),o=a(45394),r=(a(38421),a(57943)),l=(a(9191),a(53579)),c=a(27836),d=a(86178),p=a.n(d),u=a(12758),m=(a(83656),a(86213)),h=a(4563),x=a(26022),g=a(63393),y=a(69677),f=a(70579);const j=(0,y.c)("pk_test_51RUJzWAx6rm2q3pys9SgKUPRxNxPZ4P1X6EazNQvnPuHKOOfzGsbylaTLUktId9ANHULkwBk67jnp5aqZ9Dlm6PR00jKdDwvSq"),b=e=>{let{onClose:t}=e;var a="https://capavate.com/api/user/aifile/";const n=localStorage.getItem("CompanyLoginData"),i=JSON.parse(n),[r,l]=(0,s.useState)("");(0,s.useEffect)((()=>{c()}),[]);const c=async()=>{let e={user_id:""};try{var t=(await m.A.post("https://capavate.com/api/admin/module/getDataroompayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;l(t[0])}catch(a){a.response||(a.request?console.error("Request data:",a.request):console.error("Error message:",a.message))}},d=e=>{let{payment:t}=e;const[n,o]=(0,s.useState)(t),r=(0,g.useStripe)(),[l,c]=(0,s.useState)(""),[d,p]=(0,s.useState)(""),u=(0,g.useElements)(),[h,y]=(0,s.useState)(""),[j,b]=(0,s.useState)(!1),[v,w]=(0,s.useState)(""),[k,S]=(0,s.useState)(!1);setTimeout((()=>{w("")}),5e3);const A=async e=>{try{await m.A.post(`${a}CreateuserSubscriptionLockFile`,e,{headers:{Accept:"application/json","Content-Type":"application/json"}}),w("Payment successful! \ud83c\udf89"),S(!1),setTimeout((()=>{window.location.reload()}),2e3)}catch(t){console.error("Success handler error:",t),w("Payment was captured, but post-process failed."),S(!0)}finally{b(!1)}};return(0,f.jsxs)("form",{onSubmit:async e=>{if(console.log(r),e.preventDefault(),console.log(r),!r||!u)return;const t=u.getElement(g.CardElement);if(!t)return w("Payment form is not ready. Please reload the page."),void S(!0);b(!0);try{const{data:e}=await m.A.post(`${a}CreateuserSubscriptionPaymentLockFile`,{user_id:i.id,amount:n}),s=await r.confirmCardPayment(e.clientSecret,{payment_method:{card:t}});if(s.error)w(s.error.message),S(!0),b(!1);else if("succeeded"===s.paymentIntent.status){const t={user_id:i.id,amount:n,clientSecret:e.clientSecret,payment_status:s.paymentIntent.status};await A(t)}else w("Payment failed. Try again."),S(!0),b(!1)}catch(s){w("Unexpected error occurred."),S(!0),b(!1)}},action:"javascript:void(0)",method:"post",children:[(0,f.jsx)("div",{className:"form-control rounded-3",style:{padding:"0.75rem",border:"1px solid #000",borderColor:"#ced4da"},children:(0,f.jsx)(g.CardElement,{options:{style:{base:{fontSize:"16px",color:"#32325d",fontFamily:'"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',"::placeholder":{color:"#a0aec0"},padding:"0.75rem"},invalid:{color:"#e5424d"}},classes:{base:"stripe-card-element",focus:"border-primary",invalid:"border-danger"}}})}),(0,f.jsx)("div",{className:"d-grid gap-2 d-md-flex justify-content-md-end mt-4",children:(0,f.jsxs)(x.$n,{disabled:!r||j,type:"submit",className:"submit d-flex align-items-center gap-2",style:{background:"#003b21"},children:[!j&&(0,f.jsxs)("span",{children:["Pay \u20ac",n]}),j&&(0,f.jsx)("div",{className:"spinner-border text-white spinneronetimepay m-0",role:"status",children:(0,f.jsx)("span",{className:"visually-hidden"})})]})}),v&&(0,f.jsx)("p",{className:k?" mt-3 error_pop":"success_pop mt-3",children:v})]})};return(0,f.jsx)(f.Fragment,{children:(0,f.jsx)("div",{className:"payment_modal-overlay",onClick:t,children:(0,f.jsxs)("div",{className:"modal-container scroll_bar",onClick:e=>e.stopPropagation(),children:[(0,f.jsxs)("div",{className:"modal-header",children:[(0,f.jsxs)("div",{className:"modal-title-section",children:[(0,f.jsx)("h5",{className:"modal-title",children:"Payment"}),(0,f.jsxs)("div",{className:"price-tag",children:["Credit: \u20ac",r.perInstance_Fee]})]}),(0,f.jsx)("button",{type:"button",className:"close_btn_global",onClick:t,"aria-label":"Close",children:(0,f.jsx)(o.LwM,{size:24})})]}),(0,f.jsxs)("div",{className:"payment-info",children:[(0,f.jsxs)("div",{className:"benefits-list",children:[(0,f.jsxs)("div",{className:"benefit-item",children:[(0,f.jsx)("div",{className:"benefit-icon",children:(0,f.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,f.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,f.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,f.jsx)("div",{className:"benefit-text",children:"To generate a diligence report, all documents in the data room must be locked."})]}),(0,f.jsxs)("div",{className:"benefit-item",children:[(0,f.jsx)("div",{className:"benefit-icon",children:(0,f.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,f.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,f.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,f.jsx)("div",{className:"benefit-text",children:"Documents in the data room are editable until the first diligence report is generated."})]}),(0,f.jsxs)("div",{className:"benefit-item",children:[(0,f.jsx)("div",{className:"benefit-icon",children:(0,f.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,f.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,f.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,f.jsx)("div",{className:"benefit-text",children:"After generating a diligence report, you can still manage documents, but they must be locked, and credits are required to create a new version."})]}),(0,f.jsxs)("div",{className:"benefit-item",children:[(0,f.jsx)("div",{className:"benefit-icon",children:(0,f.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,f.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,f.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,f.jsxs)("div",{className:"benefit-text",children:["Additional document generation:"," ",(0,f.jsxs)("strong",{children:["\u20ac",r.perInstance_Fee]})," per instance."]})]})]}),(0,f.jsxs)("div",{className:"payment-methods",children:[(0,f.jsxs)("div",{className:"accepted-cards pt-2",children:[(0,f.jsx)("span",{className:"accepted-text",children:"We accept:"}),(0,f.jsx)("div",{className:"card-icons",children:(0,f.jsx)("div",{className:"text-center mb-4",children:(0,f.jsx)("img",{src:"/assets/user/images/cardimage.jpg",alt:"cards",className:"img-fluid rounded",style:{maxWidth:"200px"}})})})]}),(0,f.jsx)("div",{className:"stripe-form-container",children:(0,f.jsx)(g.Elements,{stripe:j,children:(0,f.jsx)(d,{payment:r.perInstance_Fee})})})]})]})]})})})};var v=a(56052),w=a(83885),k=a(17321),S=a(37022),A=a(48173),C=a(23156),_=a(60184),N=a(65727),E=a(77784);const L=(0,E.A)("lock-open",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 9.9-1",key:"1mm8w8"}]]);var T=a(5379),I=a(7104);const D=(0,E.A)("brain",[["path",{d:"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",key:"l5xja"}],["path",{d:"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",key:"ep3f8r"}],["path",{d:"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",key:"1p4c4q"}],["path",{d:"M17.599 6.5a3 3 0 0 0 .399-1.375",key:"tmeiqw"}],["path",{d:"M6.003 5.125A3 3 0 0 0 6.401 6.5",key:"105sqy"}],["path",{d:"M3.477 10.896a4 4 0 0 1 .585-.396",key:"ql3yin"}],["path",{d:"M19.938 10.5a4 4 0 0 1 .585.396",key:"1qfode"}],["path",{d:"M6 18a4 4 0 0 1-1.967-.516",key:"2e4loj"}],["path",{d:"M19.967 17.484A4 4 0 0 1 18 18",key:"159ez6"}]]),z=(0,E.A)("pencil",[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]),P=(0,E.A)("trash-2",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]]);var Y=a(73216),M=a(35475),$=a(94298),F=a(40614),q=a(86376),R=a(5464),U=a(25581),O=a(7585);const W=R.default.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 9999;
  animation: fadeIn 0.2s ease-out;
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`,J=R.default.div`
  position: relative;
  width: 100%;
  max-width: 500px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
  animation: slideUp 0.3s ease-out;
  max-height: 650px;
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`,V=R.default.div`
  position: relative;
  padding: 24px 24px 16px;
  border-bottom: 1px solid #f3f4f6;
`,B=R.default.button`
  position: absolute;
  top: 24px;
  right: 24px;
  padding: 4px;
  background: transparent;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 50%;
  transition: all 0.2s;

  &:hover {
    color: #4b5563;
    background: #f3f4f6;
  }
`,H=R.default.h2`
  font-size: 24px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 4px 0;
`,G=R.default.p`
  font-size: 14px;
  color: #6b7280;
  margin: 0;
`,K=R.default.div`
  padding: 0 24px 24px 24px;
`,Z=R.default.div`
  display: flex;
  justify-content: center;
  padding: 16px;
  background: linear-gradient(to bottom right, #f9fafb, #f3f4f6);
  border-radius: 12px;
`,Q=R.default.div`
  display: flex;
  align-items: center;
  gap: 12px;
`,X=R.default.div`
  width: 48px;
  height: 32px;
  background: ${e=>e.gradient};
  border-radius: 6px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 10px;
  font-weight: 700;
`,ee=R.default.div`
  padding: 16px;
  background: linear-gradient(to bottom right, #eff6ff, #e0e7ff);
  border-radius: 12px;
  border: 1px solid #dbeafe;
  margin-bottom: 24px;
`,te=R.default.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`,ae=R.default.span`
  font-size: 14px;
  font-weight: 500;
  color: #4b5563;
`,se=R.default.div`
  text-align: right;
`,ne=(R.default.div`
  font-size: 14px;
  color: #9ca3af;
  text-decoration: line-through;
`,R.default.div`
  font-size: 28px;
  font-weight: 700;
  color: #111827;
`),ie=(R.default.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #059669;
`,R.default.div`
  margin-bottom: 24px;
`,R.default.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 12px;
`),oe=(R.default.div`
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
`,R.default.input`
  flex: 1;
  padding: 10px 16px;
  font-size: 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  outline: none;
  text-transform: uppercase;
  transition: all 0.2s;

  &:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  &:disabled {
    background: #f9fafb;
    color: #6b7280;
    cursor: not-allowed;
  }
`,R.default.button`
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  color: white;
  background: linear-gradient(to right, #2563eb, #1d4ed8);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  &:hover:not(:disabled) {
    background: linear-gradient(to right, #1d4ed8, #1e40af);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`,R.default.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 14px;
  color: #dc2626;
`,R.default.div`
  margin-bottom: 24px;
`),re=R.default.div`
  padding: 16px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  min-height: 120px;
  background: white;
  transition: border-color 0.2s;

  &:focus-within {
    border-color: #3b82f6;
  }
`,le=(R.default.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
  font-size: 14px;
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
`,R.default.button`
  width: 100%;
  padding: 14px 24px;
  font-size: 16px;
  font-weight: 600;
  color: white;
  background: ${e=>e.disabled?"#d1d5db":"linear-gradient(to right, #059669, #047857)"};
  border: none;
  border-radius: 8px;
  cursor: ${e=>e.disabled?"not-allowed":"pointer"};
  transition: all 0.2s;
  box-shadow: ${e=>e.disabled?"none":"0 4px 6px rgba(0, 0, 0, 0.1)"};
  margin-bottom: 16px;

  &:hover:not(:disabled) {
    background: linear-gradient(to right, #047857, #065f46);
    box-shadow: 0 6px 8px rgba(0, 0, 0, 0.15);
  }
`),ce=R.default.span`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
`,de=R.default.div`
  width: 20px;
  height: 20px;
  border: 2px solid white;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`,pe=R.default.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: #6b7280;
`,ue=e=>{let{show:t,onClose:a,payment:n,usersubscriptiondataroomone_time_id:i}=e;const[o,r]=(0,s.useState)(!1),[l,c]=(0,s.useState)(0),[d,p]=(0,s.useState)(n),[u,h]=(0,s.useState)(""),[x,g]=(0,s.useState)(!1),[y,j]=(0,s.useState)(null),[b,v]=(0,s.useState)(!1),[w,k]=(0,s.useState)(!1),[S,A]=(0,s.useState)(!1),[C,_]=(0,s.useState)(null),N=localStorage.getItem("SignatoryLoginData"),E=JSON.parse(N),L=(U.J,U.J+"api/user/payment/"),[T,I]=(0,s.useState)(""),[D,z]=(0,s.useState)(!1),P=(0,s.useRef)(null),Y=(0,s.useRef)(null),[M,$]=(0,s.useState)(""),[R,ue]=(0,s.useState)("");(0,s.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),t=await e.json();ue(t.ip)}catch(e){console.error("Failed to fetch IP",e)}})()}),[]),(0,s.useEffect)((()=>{if(!t)return;let e=!0;return(async()=>{try{if(console.log("\ud83d\udd04 Initializing Airwallex SDK..."),await O.Ay.loadAirwallex({env:"demo"}),!e)return;console.log("\u2705 Airwallex SDK loaded");const{data:t}=await m.A.post(`${L}access_token`);if(!e)return;const a=t.accessToken;if(!a)throw new Error("Access token missing");$(a);const{data:s}=await m.A.post(`${L}create_payment_intent`,{amount:n,currency:"EUR",accessToken:a,originalAmount:n});if(!e)return;const{paymentIntentId:i,clientSecret:o}=s;if(!i||!o)throw new Error("Payment intent creation failed");_({id:i,client_secret:o});const l=O.Ay.createElement("card",{intent:{id:i,client_secret:o}});Y.current=l,j(l),l.mount("airwallex-card"),window.addEventListener("onReady",(e=>{r(!0)})),window.addEventListener("onChange",(e=>{var t;g((null===(t=e.detail)||void 0===t?void 0:t.complete)||!1)})),window.addEventListener("onError",(e=>{var t;h((null===(t=e.detail)||void 0===t?void 0:t.message)||"Card validation error")}))}catch(p){var t,a,s,i,o,l,c,d;const e=(null===(t=p.response)||void 0===t||null===(a=t.data)||void 0===a||null===(s=a.error)||void 0===s?void 0:s.message)||(null===(i=p.response)||void 0===i||null===(o=i.data)||void 0===o?void 0:o.message)||p.message;"configuration_error"===(null===(l=p.response)||void 0===l||null===(c=l.data)||void 0===c||null===(d=c.error)||void 0===d?void 0:d.code)?alert("\u26a0\ufe0f Payment gateway not configured. Please contact support."):alert("Payment initialization failed: "+e)}})(),()=>{var t;if(e=!1,window.removeEventListener("onReady",(()=>{})),window.removeEventListener("onChange",(()=>{})),window.removeEventListener("onError",(()=>{})),null!==(t=Y.current)&&void 0!==t&&t.unmount)try{Y.current.unmount()}catch(a){console.warn("Unmount failed:",a)}}}),[t,n]);return t?(0,f.jsx)(W,{children:(0,f.jsxs)(J,{children:[(0,f.jsxs)(V,{children:[(0,f.jsx)(B,{onClick:a,children:(0,f.jsx)(F.A,{size:24})}),(0,f.jsx)(H,{children:"Complete Payment"}),(0,f.jsx)(G,{children:"Secure payment powered by Airwallex"})]}),(0,f.jsxs)(K,{children:[T&&(0,f.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(D?"error_pop":"success_pop"),children:[(0,f.jsx)("div",{className:"d-flex align-items-start gap-2",children:(0,f.jsx)("span",{className:"d-block",children:T})}),(0,f.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>I(""),children:"\xd7"})]}),(0,f.jsx)(Z,{children:(0,f.jsxs)(Q,{children:[(0,f.jsx)(X,{gradient:"linear-gradient(to bottom right, #2563eb, #1d4ed8)",children:"VISA"}),(0,f.jsx)(X,{gradient:"linear-gradient(to bottom right, #dc2626, #ea580c)",children:"MC"}),(0,f.jsx)(X,{gradient:"linear-gradient(to bottom right, #3b82f6, #2563eb)",children:"AMEX"})]})}),(0,f.jsx)(ee,{children:(0,f.jsxs)(te,{children:[(0,f.jsx)(ae,{children:"Total Amount"}),(0,f.jsx)(se,{children:(0,f.jsxs)(ne,{children:["\u20ac",d.toFixed(2)]})})]})}),(0,f.jsxs)(oe,{children:[(0,f.jsxs)(ie,{children:[(0,f.jsx)(q.A,{size:16}),(0,f.jsx)("span",{children:"Card Details"})]}),(0,f.jsx)(re,{id:"airwallex-card",ref:P})]}),(0,f.jsx)(le,{onClick:async()=>{if(d<=0)return await m.A.post(`${L}CompanySubscriptionOneTimeDataRoomPlus`,{company_id:E.companies[0].id,created_by_id:E.id,amount:0,clientSecret:null,PayidOnetime:null,payment_status:"succeeded",ip_address:R}),I("Subscription applied successfully! \ud83c\udf89"),z(!1),void setTimeout((()=>window.location.reload()),2e3);if(!y||!C)return I("Payment form not loaded"),void z(!0);if(!x)return I("Please fill card details correctly"),void z(!0);k(!0),h("");try{const{data:e}=await m.A.post(`${L}create_payment_intent`,{amount:Math.round(100*d),currency:"EUR",accessToken:M,originalAmount:n,discount:l}),t=e.paymentIntentId,a=e.clientSecret,s=await O.Ay.confirmPaymentIntent({element:y,id:t,client_secret:a});"SUCCEEDED"===s.status?(await m.A.post(`${L}CreateuserSubscriptionDataRoomPerinstance`,{company_id:E.companies[0].id,created_by_id:E.id,amount:d,clientSecret:a,PayidOnetime:t,payment_status:"succeeded",usersubscriptiondataroomone_time_id:i,ip_address:R}),I("Payment successful! \ud83c\udf89"),z(!1),setTimeout((()=>window.location.reload()),2e3)):(I(`Payment ${s.status}. Please try again.`),z(!0))}catch(e){I(e.message||"Payment failed. Please try again."),z(!0)}finally{k(!1)}},disabled:!o||w,children:w?(0,f.jsxs)(ce,{children:[(0,f.jsx)(de,{}),(0,f.jsx)("span",{children:"Processing..."})]}):`Pay \u20ac${d.toFixed(2)}`}),(0,f.jsxs)(pe,{children:[(0,f.jsx)("svg",{width:"16",height:"16",fill:"currentColor",viewBox:"0 0 20 20",style:{color:"#059669"},children:(0,f.jsx)("path",{fillRule:"evenodd",d:"M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z",clipRule:"evenodd"})}),(0,f.jsx)("span",{children:"Secured by 256-bit SSL encryption"})]})]})]})}):null};function me(){const[e,t]=(0,s.useState)([]),[a,d]=(0,s.useState)(""),[x,g]=(0,s.useState)(""),[y,j]=(0,s.useState)(!1),[E,F]=(0,s.useState)(""),[q,R]=((0,u.ye)(p()),(0,s.useState)(!1)),[O,W]=(0,s.useState)(!1),[J,V]=(0,s.useState)(!1),[B,H]=(0,s.useState)([]),G=localStorage.getItem("SignatoryLoginData"),[K,Z]=(0,s.useState)(!1),[Q,X]=(0,s.useState)(!0),ee=JSON.parse(G);var te=U.J+"api/user/",ae=U.J+"api/user/aifile/";document.title="Dataroom Management & Executive Summary";const[se,ne]=(0,s.useState)(!1),[ie,oe]=(0,s.useState)("Onetime"),[re,le]=(0,s.useState)(""),[ce,de]=(0,s.useState)(!1),[pe,me]=(0,s.useState)(!1),[he,xe]=(0,s.useState)(""),[ge,ye]=(0,s.useState)(""),[fe,je]=(0,s.useState)(null),be=U.J+"api/user/";(0,s.useEffect)((()=>{ve()}),[]);const ve=async()=>{let e={company_id:ee.companies[0].id,user_id:ee.id};try{const t=(await m.A.post(be+"getAuthorizedSignature",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results;t.length>0&&je(t[0])}catch(se){}};(0,s.useEffect)((()=>{we()}),[]),(0,s.useEffect)((()=>{_e()}),[]),(0,s.useEffect)((()=>{ke()}),[]),(0,s.useEffect)((()=>{}),[]);const we=async()=>{let e={company_id:ee.companies[0].id};try{const a=await m.A.post(ae+"checkApprovaldoc",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if("1"===a.data.status&&null!=a.data.unique_code){var t=a.data.unique_code;Ce("/approvalpage/"+t)}}catch(se){}},ke=async()=>{let e={company_id:ee.companies[0].id};try{const t=await m.A.post(ae+"getcompanyData",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});t.data.results.length>0&&(ye(t.data.results[0].downloadUrl),xe(t.data.results[0]))}catch(se){}};(0,s.useEffect)((()=>{Se()}),[]);const Se=async()=>{let e={company_id:ee.companies[0].id};try{const t=await m.A.post(ae+"getcheckDataRoomPlusInvestorSubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(console.log(t.data.results[0].active_until),t.data.results.length>0){const e=new Date(t.data.results[0].active_until),a=new Date;e.setHours(0,0,0,0),a.setHours(0,0,0,0),me(a<=e)}}catch(se){}};(0,s.useEffect)((()=>{Ae()}),[]);const Ae=async()=>{let e={company_id:ee.companies[0].id};try{(await m.A.post(ae+"getDocumentcheck",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length>0?de(!0):de(!1)}catch(se){}},Ce=(0,Y.Zp)(),_e=async()=>{let e={company_id:ee.companies[0].id};try{const t=await m.A.post(te+"getcategories",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});H(t.data.results)}catch(se){}},Ne=U.J+"api/admin/module/",[Ee,Le]=(0,s.useState)(""),[Te,Ie]=(0,s.useState)(""),[De,ze]=(0,s.useState)(""),[Pe,Ye]=(0,s.useState)(""),[Me,$e]=(0,s.useState)(!1);(0,s.useEffect)((()=>{Fe(),Ue()}),[]);const Fe=async()=>{let e={user_id:""};try{var t=(await m.A.post(Ne+"getDataroompayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;Ye(t[0])}catch(se){se.response||(se.request?console.error("Request data:",se.request):console.error("Error message:",se.message))}},[qe,Re]=(0,s.useState)(!1),Ue=async()=>{let e={user_id:ee.id};try{const t=(await m.A.post(Ne+"getCheckOnetimePayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;if(t.length>0){const e=new Date(t[0].end_date),a=new Date;e.setHours(0,0,0,0),a.setHours(0,0,0,0),a<=e?(Re(!1),$e(!0)):(Re(!0),$e(!1))}else Re(!1),$e(!1)}catch(se){se.response||(se.request?console.error("Request data:",se.request):console.error("Error message:",se.message))}},[Oe,We]=(0,s.useState)(!1),[Je,Ve]=(0,s.useState)(!1),[Be,He]=(0,s.useState)(!0),[Ge,Ke]=(0,s.useState)(""),[Ze,Qe]=(0,s.useState)(""),[Xe,et]=(0,s.useState)(""),tt=async function(e,t){let a=arguments.length>2&&void 0!==arguments[2]?arguments[2]:"";Se();let s={cat_id:e};""===a&&(ct(null),st(null));try{const a=(await m.A.post(ae+"getcategoryname",s,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;Ke(e),Qe(t),!1===Me&&!1===pe?We(!0):R(!0),a.length>0?et(a[0].name):et("Others")}catch(se){}},[at,st]=(0,s.useState)(null),[nt,it]=(0,s.useState)(""),[ot,rt]=s.useState({}),[lt,ct]=(0,s.useState)(null),[dt,pt]=(0,s.useState)(null),[ut,mt]=(0,s.useState)(""),[ht,xt]=(0,s.useState)(""),gt=(e,t)=>{const a=`${e}-${t}`;ct((e=>e===a?null:a))},yt=()=>{_e(),R(!1),Ae()},[ft,jt]=(0,s.useState)(!1),[bt,vt]=(0,s.useState)([]),[wt,kt]=(0,s.useState)(!1),[St,At]=(0,s.useState)(""),[Ct,_t]=(0,s.useState)(""),Nt=()=>{jt(!1),kt(!1),_e()},[Et,Lt]=(0,s.useState)(!1),Tt=async()=>{ee.id;!1===ce||Ie("\u26a0\ufe0f Before proceeding, confirm that all required documents have been uploaded. Clicking forward will impact your credit balance, and this action cannot be undone.")},[It,Dt]=(0,s.useState)(0),[zt,Pt]=(0,s.useState)(!1),[Yt,Mt]=(0,s.useState)("Generate Executive Summary"),[$t,Ft]=(0,s.useState)(""),[qt,Rt]=(0,s.useState)(null);(0,s.useEffect)((()=>{}),[]);const[Ut,Ot]=(0,s.useState)(!1);return(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)(l.mO,{children:(0,f.jsxs)("div",{className:"fullpage d-block",children:[$t&&(0,f.jsx)("p",{className:se?" mt-3 error_pop":"success_pop mt-3",children:$t}),Ee&&(0,f.jsx)(S.A,{message:Ee,onConfirm:async()=>{let e={id:nt,company_id:ee.companies[0].id};try{const t=await m.A.post(ae+"UserDocDeleteFile",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});_e(),st(null),Le("");const a=t.data.message;Ft(a),ne(!0),setTimeout((()=>{ne(!1),Ft("")}),1e3)}catch(se){}},onCancel:()=>{Le("")}}),Te&&(0,f.jsx)(S.A,{message:Te,onConfirm:async()=>{let e={company_id:ee.companies[0].id};Ie("");try{const s=await m.A.post(ae+"checkuserSubscriptionThreeMonth",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(s.data.results.length>0){var t=s.data.results;let e={company_id:ee.companies[0].id,created_by_role:ee.role,created_by_id:ee.id,payid:t[0].id};le(t[0].id);try{if((await m.A.post(ae+"perInstancePayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.allowGeneration){Mt("Please don't refresh the page"),Dt(0),Pt(!0);const t=setInterval((()=>{Dt((e=>e>=95?e:Math.min(e+10*Math.random(),95)))}),500);Ie(""),Z(!0),X(!0);try{var a=(await m.A.post(ae+"generateProcessAI",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;"2"===a.status?(Z(!1),Pt(!1),j(!0),F(a.message),Mt("Generate Executive Summary"),setTimeout((()=>{j(!1),F("")}),1200)):(clearInterval(t),Dt(100),Z(!1),setTimeout((()=>{Pt(!1),Ce("/approvalpage/"+a.code)}),500))}catch(se){console.error("Error generating summary",se)}}else oe("Perinstance"),X(!1),Lt(!0)}catch(se){}}else We(!0),Re(!0)}catch(se){}},onCancel:()=>{Ie("")}}),a&&(0,f.jsx)(S.A,{message:a,onConfirm:async()=>{let t={company_id:ee.companies[0].id,lockId:e};try{await m.A.post(ae+"filelock",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});F("Documents locked successfully"),setTimeout((()=>{_e(),d(""),F(""),Ae()}),1200)}catch(se){}},onCancel:()=>{d("")}}),x&&(0,f.jsx)(S.A,{message:x,onConfirm:async()=>{let e={user_id:ee.id};try{const t=await m.A.post(ae+"allfileslock",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});F(t.data.message),"1"===t.data.status?j(!1):j(!0),setTimeout((()=>{j(!1),g(""),_e(),F("")}),1200)}catch(se){}},onCancel:()=>{g("")}}),De&&(0,f.jsx)(A.A,{message:De,onClose:()=>{ze("")}}),E&&(0,f.jsx)("p",{className:y?" mt-3 error_pop":"success_pop mt-3",children:E}),(0,f.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,f.jsx)(i.A,{isCollapsed:Ut,setIsCollapsed:Ot}),(0,f.jsxs)("div",{className:"global_view "+(Ut?"global_view_col":""),children:[(0,f.jsx)(n.A,{}),(0,f.jsx)(l.$K,{className:"d-block p-md-4 p-3",children:(0,f.jsx)("div",{className:"container-fluid",children:(0,f.jsxs)(c.zP,{className:"d-flex flex-column gap-4",children:[(0,f.jsx)("div",{className:"pb-3 bar_design",children:(0,f.jsx)("h4",{className:"h5 mb-0",children:"Dataroom Management & Executive Summary"})}),(0,f.jsxs)("div",{className:"titleroom d-flex m-0 flex-wrap gap-3 justify-content-between align-items-center text-center",children:[(0,f.jsxs)("button",{type:"button",disabled:K||"Yes"!==(null===fe||void 0===fe?void 0:fe.approve),style:{opacity:K||"Yes"!==(null===fe||void 0===fe?void 0:fe.approve)?.6:1},onClick:Tt,className:"generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2",children:[(0,f.jsx)("span",{style:{opacity:ce&&"Yes"===(null===fe||void 0===fe?void 0:fe.approve)?1:.6},children:Yt}),K&&(0,f.jsx)("div",{className:"spinner-color spinner-border spinneronetimepay m-0",role:"status",children:(0,f.jsx)("span",{className:"visually-hidden"})})]}),"owner"!==ee.role&&(0,f.jsx)(M.N_,{to:"/authorized-signature",className:"generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2",children:(0,f.jsx)("span",{children:"Yes"===(null===fe||void 0===fe?void 0:fe.approve)?"Approved Signature":"Signature to Approval"})})]}),(0,f.jsxs)("div",{className:"table-responsive d-flex flex-column gap-3",children:[B.map((e=>{e.category_id,e.category_id,e.category_id;return(0,f.jsx)("div",{className:"overflow-auto",children:(0,f.jsxs)("table",{className:"table document_table",children:[(0,f.jsx)("thead",{children:(0,f.jsxs)("tr",{children:[(0,f.jsxs)(c.A0,{children:[e.name," ",e.category_tips&&(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)("span",{className:"tooltip-icon","data-tooltip-id":`tt-cat-${e.id}`,"data-tooltip-html":e.category_tips,children:(0,f.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,f.jsx)(r.m_,{id:`tt-cat-${e.id}`,place:"top",float:!0,interactive:!0,className:"custom-tooltip",positionStrategy:"fixed"})]})]}),(0,f.jsx)(c.A0,{children:"Upload Documents"}),(0,f.jsxs)(c.A0,{children:["Manage Documents",e.do_not_exits&&(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)("span",{className:"tooltip-icon","data-tooltip-id":`tt-doc-${e.id}`,"data-tooltip-html":e.do_not_exits,children:(0,f.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,f.jsx)(r.m_,{id:`tt-doc-${e.id}`,place:"top",float:!0,interactive:!0,className:"custom-tooltip",positionStrategy:"fixed"})]})]}),(0,f.jsxs)(c.A0,{children:["Exists but NOT Available",e.exits_tips&&(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)("span",{className:"tooltip-icon","data-tooltip-id":`tt-exit-${e.id}`,"data-tooltip-html":e.exits_tips,children:(0,f.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,f.jsx)(r.m_,{id:`tt-exit-${e.id}`,place:"top",float:!0,interactive:!0,className:"custom-tooltip",positionStrategy:"fixed"})]})]}),(0,f.jsx)(c.A0,{children:"Provided"})]})}),e.subcategories&&e.subcategories.length>0?(0,f.jsx)("tbody",{children:e.subcategories.map(((t,a)=>{e.id,t.id,e.id,t.id;return(0,f.jsxs)("tr",{children:[(0,f.jsx)(c.l$,{children:(0,f.jsxs)("h6",{children:[t.name,t.tips&&(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)("span",{"data-tooltip-id":`tooltipSub-${e.id}-${t.id}`,"data-tooltip-html":t.tips,className:"tooltip-icon",children:(0,f.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,f.jsx)(r.m_,{id:`tooltipSub-${e.id}-${t.id}`,place:"top",float:!0,interactive:!0,className:"custom-tooltip",positionStrategy:"fixed"})]})]})}),(0,f.jsx)(c.l$,{children:(0,f.jsx)(c.s5,{type:"button",onClick:()=>{"Yes"!==t.Ai_generate?tt(e.id,t.id):"Yes"===t.lockStatus&&(async()=>{let e={user_id:ee.id};try{!0===(await m.A.post(ae+"lockFileCheckSubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.allowEdit&&W(!0)}catch(se){}})(e.id,t.id)},children:t.documents.length>0?(0,f.jsx)("span",{children:"Yes"===t.Ai_generate?(0,f.jsx)(f.Fragment,{children:(t.lockStatus,(0,f.jsxs)(f.Fragment,{children:["Lock"," ",(0,f.jsx)(N.A,{size:16,className:"text-white",title:"Locked"})]}))}):(0,f.jsxs)(f.Fragment,{children:["Add ",(0,f.jsx)(C.OiG,{})]})}):(0,f.jsx)("span",{style:{whiteSpace:"nowrap"},className:"d-block",children:"Click to upload"})})}),(0,f.jsx)(c.l$,{children:t.documents&&t.documents.length>0?(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)(c.s5,{type:"button",onClick:()=>gt(e.id,t.id),children:lt===`${e.id}-${t.id}`?"Hide Documents":"View Documents"}),lt===`${e.id}-${t.id}`&&(0,f.jsx)("div",{className:"main_popup-overlay",children:(0,f.jsx)("div",{className:"popupDataRoom",children:(0,f.jsxs)("div",{className:"uploadFilescroll position-relative",children:[(0,f.jsxs)("div",{className:"d-flex mb-2 pop_bg justify-content-between align-items-center p-2",children:[(0,f.jsx)("h4",{className:"docName",children:t.name}),(0,f.jsx)("div",{className:"d-flex gap-2 align-items-center",children:(0,f.jsx)("button",{type:"button",className:"bg-transparent text-white p-1 border-0",onClick:()=>gt(e.id,t.id),children:(0,f.jsx)(o.LwM,{size:24})})})]}),(0,f.jsx)("ol",{className:"text-start text-capitalize px-3 pdflist",children:t.documents.map(((a,s)=>(0,f.jsx)("li",{children:(0,f.jsxs)("span",{className:"d-flex justify-content-between align-items-center",children:[(0,f.jsxs)("span",{className:"d-flex align-items-center gap-2",children:[s+1,".",(0,f.jsx)(f.Fragment,{children:"Yes"===a.locked?(0,f.jsx)(N.A,{size:14,style:{color:"var(--primary)"},title:"Locked"}):(0,f.jsx)(L,{size:14,className:"text-success",title:"Unlocked"})}),a.name]}),(0,f.jsxs)("div",{className:"d-inline ",children:[(0,f.jsx)("button",{title:"More actions",className:"btn btn-link p-0 text-dark",type:"button",onClick:()=>{return e=a.id,it(e),void st((t=>t===e?null:e));var e},children:(0,f.jsx)(T.A,{width:16,height:16})}),at===a.id&&(0,f.jsxs)("div",{style:{position:"absolute",width:"100px",backgroundColor:"#fff",boxShadow:"0 2px 5px rgba(0,0,0,0.2)",padding:"2px",zIndex:997,right:0},children:[(0,f.jsxs)("button",{type:"button",title:"Download",className:"editdelete-links",onClick:()=>(async(e,t,a,s)=>{try{const t=await m.A.post(ae+"filedownload",{company_id:e,folderName:s,filename:a},{responseType:"blob"}),n=new Blob([t.data]),i=window.URL.createObjectURL(n),o=document.createElement("a");o.href=i,o.download=a,document.body.appendChild(o),o.click(),o.remove(),window.URL.revokeObjectURL(i)}catch(se){alert("Download failed"),console.error(se)}})(a.company_id,a.id,a.name,a.folder_name),children:[(0,f.jsx)(I.A,{className:"me-1",width:12,height:10}),"Download"]}),(0,f.jsxs)("button",{type:"button",title:"Yes"===a.Ai_generate?"Yes":"No",className:"editdelete-links",children:[(0,f.jsx)(D,{className:"me-1 text-white",width:12,height:10}),"Yes"===a.Ai_generate?"AI Yes":"AI No"]}),"No"===a.Ai_generate&&(0,f.jsxs)("button",{onClick:()=>(async(e,t)=>{let a={company_id:ee.companies[0].id,id:t};try{const e=await m.A.post(ae+"fileslockorUnlock",a,{headers:{Accept:"application/json","Content-Type":"application/json"}});F(e.data.message),setTimeout((()=>{_e(),F("")}),1200)}catch(se){}})(a.company_id,a.document_id,a.locked,a.Ai_generate),type:"button",title:"Yes"===a.locked?"Unlock":"Lock",className:"editdelete-links",children:["Yes"===a.locked?(0,f.jsx)(L,{className:"me-1 text-white",width:12,height:10}):(0,f.jsx)(N.A,{className:"me-1 text-white",width:12,height:10}),"Yes"===a.locked?"Unlock":"Lock"]}),(0,f.jsxs)("button",{type:"button",title:"Edit",className:"editdelete-links",style:{opacity:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?.6:1,pointerEvents:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?"none":"auto"},onClick:()=>(async(e,t,a,s,n,i)=>{if(console.log(a,i),mt(t),xt(e),"Yes"===i&&"Yes"===a&&"Yes"===n){let e={user_id:ee.id};try{if(!0===(await m.A.post(ae+"lockFileCheckSubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.allowEdit)W(!0);else{let e={cat_id:s};try{const t=(await m.A.post(ae+"getcategoryname",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;Ke(s),V(!0),t.length>0?et(t[0].name):et("Others")}catch(se){}}}catch(se){}}else{let e={cat_id:s};try{const t=(await m.A.post(ae+"getcategoryname",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;Ke(s),V(!0),t.length>0?et(t[0].name):et("Others")}catch(se){}}})(a.id,a.name,a.lockStatus,e.id,a.locked,a.Ai_generate),children:[(0,f.jsx)(z,{className:"me-1 text-white",width:10,height:10}),"Yes"===a.Ai_generate?"Replace":"Edit"]}),"Yes"===a.Ai_generate&&(0,f.jsxs)("button",{type:"button",title:"Add",className:"editdelete-links",onClick:()=>tt(e.id,t.id,"1"),style:{opacity:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?.6:1,pointerEvents:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?"none":"auto"},children:[(0,f.jsx)(C.OiG,{className:"me-1",width:10,height:10}),"Add"]}),(0,f.jsxs)("button",{type:"button",title:"Delete",className:"editdelete-links",style:{opacity:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?.6:1,pointerEvents:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?"none":"auto"},onClick:()=>(async(e,t,a,s)=>{if("Yes"===t&&"Yes"===a&&"Yes"===s){let t={company_id:ee.companies[0].id,docId:e};try{const e=await m.A.post(ae+"lockFileCheckSubscription",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(e.data)}catch(se){}}else Le("Are you sure? You want to delete this file")})(a.id,a.locked,a.Ai_generate,a.lockStatus),children:[(0,f.jsx)(P,{className:"me-1",width:10,height:10}),"Delete"]})]})]})]})},a.id)))}),(0,f.jsx)("button",{className:"btn btn-outline-dark",type:"button",onClick:()=>gt(e.id,t.id),children:(0,f.jsx)(_.QCr,{})})]})})})]}):(0,f.jsx)("span",{children:"N/A"})}),(0,f.jsx)(c.l$,{children:(0,f.jsx)("h5",{children:"--"})}),(0,f.jsx)(c.l$,{children:t.documents.length>0?(0,f.jsx)("p",{children:"Yes"}):(0,f.jsx)("span",{children:"--"})})]},t.id)}))}):(0,f.jsx)("tbody",{children:(0,f.jsx)("tr",{children:(0,f.jsx)(c.l$,{colSpan:5,children:(0,f.jsx)("p",{children:"No subcategories"})})})})]},e.id)})})),(0,f.jsx)("div",{className:"titleroom d-flex justify-content-between align-items-center text-center",children:(0,f.jsxs)("button",{type:"button",disabled:K||"Yes"!==(null===fe||void 0===fe?void 0:fe.approve),style:{opacity:K||"Yes"!==(null===fe||void 0===fe?void 0:fe.approve)?.6:1},onClick:Tt,className:"generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2",children:[(0,f.jsx)("span",{style:{opacity:ce&&"Yes"===(null===fe||void 0===fe?void 0:fe.approve)?1:.6},children:Yt}),K&&(0,f.jsx)("div",{className:"spinner-color spinner-border spinneronetimepay m-0",role:"status",children:(0,f.jsx)("span",{className:"visually-hidden"})})]})})]})]})})})]})]})]})}),q&&(0,f.jsx)(h.A,{onClose:()=>R(!1),catgeoryId:Ge,subcatgeoryId:Ze,CategorynameFile:Xe,refreshpage:yt,lockunlockId:()=>{if(Ze){t(Ze);d("To generate a diligence report, all documents in the data room must be locked.\nThis document is editable until the first diligence report is generated.\n\nI want to lock this document.")}}}),O&&(0,f.jsx)(b,{onClose:()=>W(!1)}),J&&(0,f.jsx)(v.A,{onClose:()=>V(!1),catgeoryId:Ge,subcatgeoryId:Ze,CategorynameFile:Xe,refreshpage:yt,Docname:ut,DeleteIdDocs:nt,docId:ht}),ft&&(0,f.jsx)(k.A,{onClose:()=>jt(!1),catgeoryId:Ge,subcatgeoryId:Ze,CategorynameFile:Xe,refreshpageAi:Nt,Docname:ut,DeleteIdDocs:nt,AIquestions:bt}),wt&&(0,f.jsx)(w.A,{onClose:()=>kt(!1),AiUpdatesummaryID:St,refreshpageAi:Nt,AISummary:Ct}),Oe&&(0,f.jsx)($.A,{show:Oe,onClose:()=>We(!1),payment:Pe.onetime_Fee,referstatus:Q}),Et&&(0,f.jsx)(ue,{show:Et,onClose:()=>Lt(!1),payment:Pe.perInstance_Fee,usersubscriptiondataroomone_time_id:re})]})}}}]);
//# sourceMappingURL=7116.39a4a80b.chunk.js.map