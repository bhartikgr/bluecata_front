/*! For license information please see 6914.18a8d419.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[6914],{2701:(e,t,a)=>{a.r(t),a.d(t,{default:()=>ge});var s=a(65043),i=a(74723),n=a(45394),o=(a(38421),a(57943)),r=(a(9191),a(53579)),l=a(27836),d=a(86178),c=a.n(d),p=a(12758),u=(a(83656),a(86213)),m=a(4563),h=a(26022),x=a(63393),g=a(69677),y=a(70579);const f=(0,g.c)("pk_test_51RUJzWAx6rm2q3pys9SgKUPRxNxPZ4P1X6EazNQvnPuHKOOfzGsbylaTLUktId9ANHULkwBk67jnp5aqZ9Dlm6PR00jKdDwvSq"),j=e=>{let{onClose:t}=e;var a="https://capavate.com/api/user/aifile/";const i=localStorage.getItem("CompanyLoginData"),o=JSON.parse(i),[r,l]=(0,s.useState)("");(0,s.useEffect)((()=>{d()}),[]);const d=async()=>{let e={user_id:""};try{var t=(await u.A.post("https://capavate.com/api/admin/module/getDataroompayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;l(t[0])}catch(a){a.response||(a.request?console.error("Request data:",a.request):console.error("Error message:",a.message))}},c=e=>{let{payment:t}=e;const[i,n]=(0,s.useState)(t),r=(0,x.useStripe)(),[l,d]=(0,s.useState)(""),[c,p]=(0,s.useState)(""),m=(0,x.useElements)(),[g,f]=(0,s.useState)(""),[j,b]=(0,s.useState)(!1),[v,w]=(0,s.useState)(""),[k,A]=(0,s.useState)(!1);setTimeout((()=>{w("")}),5e3);const C=async e=>{try{await u.A.post(`${a}CreateuserSubscriptionLockFile`,e,{headers:{Accept:"application/json","Content-Type":"application/json"}}),w("Payment successful! \ud83c\udf89"),A(!1),setTimeout((()=>{window.location.reload()}),2e3)}catch(t){console.error("Success handler error:",t),w("Payment was captured, but post-process failed."),A(!0)}finally{b(!1)}};return(0,y.jsxs)("form",{onSubmit:async e=>{if(console.log(r),e.preventDefault(),console.log(r),!r||!m)return;const t=m.getElement(x.CardElement);if(!t)return w("Payment form is not ready. Please reload the page."),void A(!0);b(!0);try{const{data:e}=await u.A.post(`${a}CreateuserSubscriptionPaymentLockFile`,{user_id:o.id,amount:i}),s=await r.confirmCardPayment(e.clientSecret,{payment_method:{card:t}});if(s.error)w(s.error.message),A(!0),b(!1);else if("succeeded"===s.paymentIntent.status){const t={user_id:o.id,amount:i,clientSecret:e.clientSecret,payment_status:s.paymentIntent.status};await C(t)}else w("Payment failed. Try again."),A(!0),b(!1)}catch(s){w("Unexpected error occurred."),A(!0),b(!1)}},action:"javascript:void(0)",method:"post",children:[(0,y.jsx)("div",{className:"form-control rounded-3",style:{padding:"0.75rem",border:"1px solid #000",borderColor:"#ced4da"},children:(0,y.jsx)(x.CardElement,{options:{style:{base:{fontSize:"16px",color:"#32325d",fontFamily:'"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',"::placeholder":{color:"#a0aec0"},padding:"0.75rem"},invalid:{color:"#e5424d"}},classes:{base:"stripe-card-element",focus:"border-primary",invalid:"border-danger"}}})}),(0,y.jsx)("div",{className:"d-grid gap-2 d-md-flex justify-content-md-end mt-4",children:(0,y.jsxs)(h.$n,{disabled:!r||j,type:"submit",className:"submit d-flex align-items-center gap-2",style:{background:"#003b21"},children:[!j&&(0,y.jsxs)("span",{children:["Pay \u20ac",i]}),j&&(0,y.jsx)("div",{className:"spinner-border text-white spinneronetimepay m-0",role:"status",children:(0,y.jsx)("span",{className:"visually-hidden"})})]})}),v&&(0,y.jsx)("p",{className:k?" mt-3 error_pop":"success_pop mt-3",children:v})]})};return(0,y.jsx)(y.Fragment,{children:(0,y.jsx)("div",{className:"payment_modal-overlay",onClick:t,children:(0,y.jsxs)("div",{className:"modal-container scroll_bar",onClick:e=>e.stopPropagation(),children:[(0,y.jsxs)("div",{className:"modal-header",children:[(0,y.jsxs)("div",{className:"modal-title-section",children:[(0,y.jsx)("h5",{className:"modal-title",children:"Payment"}),(0,y.jsxs)("div",{className:"price-tag",children:["Credit: \u20ac",r.perInstance_Fee]})]}),(0,y.jsx)("button",{type:"button",className:"close_btn_global",onClick:t,"aria-label":"Close",children:(0,y.jsx)(n.LwM,{size:24})})]}),(0,y.jsxs)("div",{className:"payment-info",children:[(0,y.jsxs)("div",{className:"benefits-list",children:[(0,y.jsxs)("div",{className:"benefit-item",children:[(0,y.jsx)("div",{className:"benefit-icon",children:(0,y.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,y.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,y.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,y.jsx)("div",{className:"benefit-text",children:"To generate a diligence report, all documents in the data room must be locked."})]}),(0,y.jsxs)("div",{className:"benefit-item",children:[(0,y.jsx)("div",{className:"benefit-icon",children:(0,y.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,y.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,y.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,y.jsx)("div",{className:"benefit-text",children:"Documents in the data room are editable until the first diligence report is generated."})]}),(0,y.jsxs)("div",{className:"benefit-item",children:[(0,y.jsx)("div",{className:"benefit-icon",children:(0,y.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,y.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,y.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,y.jsx)("div",{className:"benefit-text",children:"After generating a diligence report, you can still manage documents, but they must be locked, and credits are required to create a new version."})]}),(0,y.jsxs)("div",{className:"benefit-item",children:[(0,y.jsx)("div",{className:"benefit-icon",children:(0,y.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,y.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,y.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,y.jsxs)("div",{className:"benefit-text",children:["Additional document generation:"," ",(0,y.jsxs)("strong",{children:["\u20ac",r.perInstance_Fee]})," per instance."]})]})]}),(0,y.jsxs)("div",{className:"payment-methods",children:[(0,y.jsxs)("div",{className:"accepted-cards pt-2",children:[(0,y.jsx)("span",{className:"accepted-text",children:"We accept:"}),(0,y.jsx)("div",{className:"card-icons",children:(0,y.jsx)("div",{className:"text-center mb-4",children:(0,y.jsx)("img",{src:"/assets/user/images/cardimage.jpg",alt:"cards",className:"img-fluid rounded",style:{maxWidth:"200px"}})})})]}),(0,y.jsx)("div",{className:"stripe-form-container",children:(0,y.jsx)(x.Elements,{stripe:f,children:(0,y.jsx)(c,{payment:r.perInstance_Fee})})})]})]})]})})})};var b=a(56052),v=a(83885),w=a(17321),k=a(37022),A=a(48173),C=a(23156),S=a(60184),N=a(65727),_=a(77784);const z=(0,_.A)("lock-open",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 9.9-1",key:"1mm8w8"}]]);var I=a(5379),L=a(7104);const $=(0,_.A)("brain",[["path",{d:"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",key:"l5xja"}],["path",{d:"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",key:"ep3f8r"}],["path",{d:"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",key:"1p4c4q"}],["path",{d:"M17.599 6.5a3 3 0 0 0 .399-1.375",key:"tmeiqw"}],["path",{d:"M6.003 5.125A3 3 0 0 0 6.401 6.5",key:"105sqy"}],["path",{d:"M3.477 10.896a4 4 0 0 1 .585-.396",key:"ql3yin"}],["path",{d:"M19.938 10.5a4 4 0 0 1 .585.396",key:"1qfode"}],["path",{d:"M6 18a4 4 0 0 1-1.967-.516",key:"2e4loj"}],["path",{d:"M19.967 17.484A4 4 0 0 1 18 18",key:"159ez6"}]]),E=(0,_.A)("pencil",[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]);var T=a(9855),D=a(73216),P=a(35475),B=a(94298),Y=a(40614),M=a(86376),R=a(5464),F=a(25581),q=a(7585);const U=R.default.div`
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
`,H=R.default.div`
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
`,O=R.default.div`
  position: relative;
  padding: 24px 24px 16px;
  border-bottom: 1px solid #f3f4f6;
`,W=R.default.button`
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
`,J=R.default.h2`
  font-size: 24px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 4px 0;
`,V=R.default.p`
  font-size: 14px;
  color: #6b7280;
  margin: 0;
`,G=R.default.div`
  padding: 0 24px 24px 24px;
`,K=R.default.div`
  display: flex;
  justify-content: center;
  padding: 16px;
  background: linear-gradient(to bottom right, #f9fafb, #f3f4f6);
  border-radius: 12px;
`,Z=R.default.div`
  display: flex;
  align-items: center;
  gap: 12px;
`,Q=R.default.div`
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
`,X=R.default.div`
  padding: 16px;
  background: linear-gradient(to bottom right, #eff6ff, #e0e7ff);
  border-radius: 12px;
  border: 1px solid #dbeafe;
  margin-bottom: 24px;
`,ee=R.default.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`,te=R.default.span`
  font-size: 14px;
  font-weight: 500;
  color: #4b5563;
`,ae=R.default.div`
  text-align: right;
`,se=(R.default.div`
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
`),ne=(R.default.div`
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
`),oe=R.default.div`
  padding: 16px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  min-height: 120px;
  background: white;
  transition: border-color 0.2s;

  &:focus-within {
    border-color: #3b82f6;
  }
`,re=(R.default.div`
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
`),le=R.default.span`
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
`,ce=R.default.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: #6b7280;
`,pe=e=>{let{show:t,onClose:a,payment:i,usersubscriptiondataroomone_time_id:n}=e;const[o,r]=(0,s.useState)(!1),[l,d]=(0,s.useState)(0),[c,p]=(0,s.useState)(i),[m,h]=(0,s.useState)(""),[x,g]=(0,s.useState)(!1),[f,j]=(0,s.useState)(null),[b,v]=(0,s.useState)(!1),[w,k]=(0,s.useState)(!1),[A,C]=(0,s.useState)(!1),[S,N]=(0,s.useState)(null),_=localStorage.getItem("SignatoryLoginData"),z=JSON.parse(_),I=(F.J,F.J+"api/user/payment/"),[L,$]=(0,s.useState)(""),[E,T]=(0,s.useState)(!1),D=(0,s.useRef)(null),P=(0,s.useRef)(null),[B,R]=(0,s.useState)(""),[pe,ue]=(0,s.useState)("");(0,s.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),t=await e.json();ue(t.ip)}catch(e){console.error("Failed to fetch IP",e)}})()}),[]),(0,s.useEffect)((()=>{if(!t)return;let e=!0;return(async()=>{try{if(console.log("\ud83d\udd04 Initializing Airwallex SDK..."),await q.Ay.loadAirwallex({env:"demo"}),!e)return;console.log("\u2705 Airwallex SDK loaded");const{data:t}=await u.A.post(`${I}access_token`);if(!e)return;const a=t.accessToken;if(!a)throw new Error("Access token missing");R(a);const{data:s}=await u.A.post(`${I}create_payment_intent`,{amount:i,currency:"EUR",accessToken:a,originalAmount:i});if(!e)return;const{paymentIntentId:n,clientSecret:o}=s;if(!n||!o)throw new Error("Payment intent creation failed");N({id:n,client_secret:o});const l=q.Ay.createElement("card",{intent:{id:n,client_secret:o}});P.current=l,j(l),l.mount("airwallex-card"),window.addEventListener("onReady",(e=>{r(!0)})),window.addEventListener("onChange",(e=>{var t;g((null===(t=e.detail)||void 0===t?void 0:t.complete)||!1)})),window.addEventListener("onError",(e=>{var t;h((null===(t=e.detail)||void 0===t?void 0:t.message)||"Card validation error")}))}catch(p){var t,a,s,n,o,l,d,c;const e=(null===(t=p.response)||void 0===t||null===(a=t.data)||void 0===a||null===(s=a.error)||void 0===s?void 0:s.message)||(null===(n=p.response)||void 0===n||null===(o=n.data)||void 0===o?void 0:o.message)||p.message;"configuration_error"===(null===(l=p.response)||void 0===l||null===(d=l.data)||void 0===d||null===(c=d.error)||void 0===c?void 0:c.code)?alert("\u26a0\ufe0f Payment gateway not configured. Please contact support."):alert("Payment initialization failed: "+e)}})(),()=>{var t;if(e=!1,window.removeEventListener("onReady",(()=>{})),window.removeEventListener("onChange",(()=>{})),window.removeEventListener("onError",(()=>{})),null!==(t=P.current)&&void 0!==t&&t.unmount)try{P.current.unmount()}catch(a){console.warn("Unmount failed:",a)}}}),[t,i]);return t?(0,y.jsx)(U,{children:(0,y.jsxs)(H,{children:[(0,y.jsxs)(O,{children:[(0,y.jsx)(W,{onClick:a,children:(0,y.jsx)(Y.A,{size:24})}),(0,y.jsx)(J,{children:"Complete Payment"}),(0,y.jsx)(V,{children:"Secure payment powered by Airwallex"})]}),(0,y.jsxs)(G,{children:[L&&(0,y.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(E?"error_pop":"success_pop"),children:[(0,y.jsx)("div",{className:"d-flex align-items-start gap-2",children:(0,y.jsx)("span",{className:"d-block",children:L})}),(0,y.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>$(""),children:"\xd7"})]}),(0,y.jsx)(K,{children:(0,y.jsxs)(Z,{children:[(0,y.jsx)(Q,{gradient:"linear-gradient(to bottom right, #2563eb, #1d4ed8)",children:"VISA"}),(0,y.jsx)(Q,{gradient:"linear-gradient(to bottom right, #dc2626, #ea580c)",children:"MC"}),(0,y.jsx)(Q,{gradient:"linear-gradient(to bottom right, #3b82f6, #2563eb)",children:"AMEX"})]})}),(0,y.jsx)(X,{children:(0,y.jsxs)(ee,{children:[(0,y.jsx)(te,{children:"Total Amount"}),(0,y.jsx)(ae,{children:(0,y.jsxs)(se,{children:["\u20ac",c.toFixed(2)]})})]})}),(0,y.jsxs)(ne,{children:[(0,y.jsxs)(ie,{children:[(0,y.jsx)(M.A,{size:16}),(0,y.jsx)("span",{children:"Card Details"})]}),(0,y.jsx)(oe,{id:"airwallex-card",ref:D})]}),(0,y.jsx)(re,{onClick:async()=>{if(c<=0)return await u.A.post(`${I}CompanySubscriptionOneTimeDataRoomPlus`,{company_id:z.companies[0].id,created_by_id:z.id,amount:0,clientSecret:null,PayidOnetime:null,payment_status:"succeeded",ip_address:pe}),$("Subscription applied successfully! \ud83c\udf89"),T(!1),void setTimeout((()=>window.location.reload()),2e3);if(!f||!S)return $("Payment form not loaded"),void T(!0);if(!x)return $("Please fill card details correctly"),void T(!0);k(!0),h("");try{const{data:e}=await u.A.post(`${I}create_payment_intent`,{amount:Math.round(100*c),currency:"EUR",accessToken:B,originalAmount:i,discount:l}),t=e.paymentIntentId,a=e.clientSecret,s=await q.Ay.confirmPaymentIntent({element:f,id:t,client_secret:a});"SUCCEEDED"===s.status?(await u.A.post(`${I}CreateuserSubscriptionDataRoomPerinstance`,{company_id:z.companies[0].id,created_by_id:z.id,amount:c,clientSecret:a,PayidOnetime:t,payment_status:"succeeded",usersubscriptiondataroomone_time_id:n,ip_address:pe}),$("Payment successful! \ud83c\udf89"),T(!1),setTimeout((()=>window.location.reload()),2e3)):($(`Payment ${s.status}. Please try again.`),T(!0))}catch(e){$(e.message||"Payment failed. Please try again."),T(!0)}finally{k(!1)}},disabled:!o||w,children:w?(0,y.jsxs)(le,{children:[(0,y.jsx)(de,{}),(0,y.jsx)("span",{children:"Processing..."})]}):`Pay \u20ac${c.toFixed(2)}`}),(0,y.jsxs)(ce,{children:[(0,y.jsx)("svg",{width:"16",height:"16",fill:"currentColor",viewBox:"0 0 20 20",style:{color:"#059669"},children:(0,y.jsx)("path",{fillRule:"evenodd",d:"M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z",clipRule:"evenodd"})}),(0,y.jsx)("span",{children:"Secured by 256-bit SSL encryption"})]})]})]})}):null};var ue=a(11433),me=a(76245),he=a(77819);function xe(e){let{show:t,onClose:a,onConfirm:i,companyName:n="Your Company",isSubmitting:o=!1}=e;const[r,l]=(0,s.useState)(!1),[d,c]=(0,s.useState)("");(0,s.useEffect)((()=>{t&&(l(!1),c(""))}),[t]);return t?(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)("div",{className:"modal fade show",style:{display:"block",backgroundColor:"rgba(0, 0, 0, 0.6)",backdropFilter:"blur(4px)",zIndex:1050},children:(0,y.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-lg",children:(0,y.jsxs)("div",{className:"modal-content",style:{borderRadius:"20px",border:"none",boxShadow:"0 25px 50px -12px rgba(0, 0, 0, 0.25)",overflow:"hidden"},children:[(0,y.jsx)("div",{style:{background:"linear-gradient(135deg, rgb(26, 28, 46) 0%, rgb(219 74, 67) 100%)",padding:"24px 32px",borderBottom:"1px solid rgb(26, 28, 46)"},children:(0,y.jsxs)("div",{className:"d-flex justify-content-between align-items-center",children:[(0,y.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[(0,y.jsx)("div",{style:{width:"48px",height:"48px",background:"rgba(204, 0, 0, 0.15)",borderRadius:"12px",display:"flex",alignItems:"center",justifyContent:"center"},children:(0,y.jsx)(N.A,{size:28,color:"#CC0000"})}),(0,y.jsxs)("div",{children:[(0,y.jsx)("div",{style:{fontSize:"11px",fontWeight:"700",letterSpacing:"0.1em",textTransform:"uppercase",color:"#CC0000",marginBottom:"4px"},children:"Acknowledgement"}),(0,y.jsx)("h4",{style:{margin:0,fontSize:"1.5rem",fontWeight:"700",color:"#fff",letterSpacing:"-0.5px"},children:"Data Room Lock & AI Executive Summary"}),(0,y.jsx)("p",{style:{color:"rgba(255,255,255,0.7)",margin:"4px 0 0 0",fontSize:"0.85rem"},children:"Signatory Action"})]})]}),(0,y.jsx)("button",{onClick:a,disabled:o,style:{background:"rgba(255,255,255,0.1)",border:"none",cursor:o?"not-allowed":"pointer",width:"40px",height:"40px",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s",opacity:o?.5:1},children:(0,y.jsx)(me.A,{size:20,color:"#fff"})})]})}),(0,y.jsxs)("div",{style:{padding:"32px"},children:[(0,y.jsxs)("div",{style:{border:"1px solid #e9ecef",borderRadius:"16px",overflow:"hidden",marginBottom:"24px"},children:[(0,y.jsx)("div",{style:{background:"#f8f9fa",padding:"16px 24px",borderBottom:"1px solid #e9ecef",borderLeft:"4px solid #CC0000"},children:(0,y.jsx)("h5",{style:{margin:0,fontWeight:"700",fontSize:"1rem",color:"#212529"},children:(0,y.jsx)("span",{style:{marginLeft:"12px",padding:"2px 8px",borderRadius:"12px",fontSize:"11px",fontWeight:"600",backgroundColor:"#CC0000",color:"#fff"},children:"Signatory Action"})})}),(0,y.jsxs)("div",{style:{padding:"24px"},children:[(0,y.jsxs)("div",{style:{fontSize:"1rem",color:"#212529",marginBottom:"20px",lineHeight:"1.6"},children:["You are about to lock the data room for ",(0,y.jsx)("strong",{children:n})," and generate an AI-assisted executive summary from its contents."]}),(0,y.jsx)("p",{style:{fontWeight:"600",marginBottom:"12px",color:"#212529",fontSize:"0.95rem"},children:"By proceeding, you confirm that:"}),(0,y.jsxs)("ul",{style:{paddingLeft:"20px",marginBottom:"24px"},children:[(0,y.jsx)("li",{style:{marginBottom:"12px",color:"#495057",lineHeight:"1.6",fontSize:"0.9rem"},children:"You are authorised to lock this data room and to grant the Capavate platform access to its contents for the purpose of generating the executive summary."}),(0,y.jsxs)("li",{style:{marginBottom:"12px",color:"#495057",lineHeight:"1.6",fontSize:"0.9rem"},children:["All documents and materials contained in the data room are owned by or lawfully licensed to ",(0,y.jsx)("strong",{children:n}),", and their use for AI processing does not violate any third-party rights, confidentiality obligations, or applicable law."]}),(0,y.jsx)("li",{style:{marginBottom:"12px",color:"#495057",lineHeight:"1.6",fontSize:"0.9rem"},children:"The AI-generated executive summary is produced automatically and may not be accurate, complete, or up to date. It does not constitute financial, legal, or investment advice. You remain solely responsible for reviewing, verifying, and approving the summary before it is shared with any investor."}),(0,y.jsx)("li",{style:{marginBottom:"12px",color:"#495057",lineHeight:"1.6",fontSize:"0.9rem"},children:"Capavate and BluePrint Catalyst Limited bear no liability for the accuracy, completeness, or consequences of the AI-generated output, including any investor decisions made in reliance thereon."})]}),(0,y.jsxs)("div",{style:{background:"#f8f9fa",borderRadius:"12px",padding:"20px",border:d?"1px solid #CC0000":"1px solid #e9ecef",boxShadow:d?"0 0 0 3px rgba(204, 0, 0, 0.1)":"none"},children:[(0,y.jsxs)("div",{className:"form-check",style:{paddingLeft:"32px"},children:[(0,y.jsx)("input",{type:"checkbox",className:"form-check-input",id:"dataRoomLockConfirm",checked:r,onChange:e=>{l(e.target.checked),e.target.checked&&c("")},style:{width:"20px",height:"20px",marginLeft:"-32px",cursor:"pointer",accentColor:"#CC0000"}}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"dataRoomLockConfirm",style:{cursor:"pointer",fontSize:"0.9rem",color:"#212529",lineHeight:"1.5"},children:(0,y.jsx)("strong",{children:"I confirm I am authorised to lock this data room and understand the AI summary must be reviewed before distribution. I accept all responsibility for its contents."})})]}),d&&(0,y.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:"8px",marginTop:"12px",color:"#CC0000",fontSize:"0.85rem"},children:[(0,y.jsx)(he.A,{size:14}),(0,y.jsx)("span",{children:d})]})]})]})]}),(0,y.jsxs)("div",{style:{display:"flex",gap:"16px",justifyContent:"flex-end"},children:[(0,y.jsx)("button",{type:"button",onClick:a,disabled:o,style:{padding:"10px 24px",borderRadius:"8px",border:"1px solid #dee2e6",background:"#fff",color:"#495057",fontSize:"0.9rem",fontWeight:"500",cursor:o?"not-allowed":"pointer",opacity:o?.5:1},children:"Cancel"}),(0,y.jsx)("button",{type:"button",onClick:()=>{r?(c(""),i()):c("Please confirm the acknowledgment to proceed")},disabled:!r||o,style:{padding:"10px 28px",borderRadius:"8px",border:"none",background:r&&!o?"linear-gradient(135deg, #CC0000 0%, #A00000 100%)":"#ccc",color:"#fff",fontSize:"0.9rem",fontWeight:"600",cursor:r&&!o?"pointer":"not-allowed",opacity:r&&!o?1:.6,transition:"all 0.2s",display:"flex",alignItems:"center",gap:"8px"},children:o?"Processing...":(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)(N.A,{size:16}),(0,y.jsx)($,{size:16}),"Lock Data Room & Generate AI Summary"]})})]})]})]})})}),(0,y.jsx)("div",{className:"modal-backdrop fade show",onClick:a,style:{position:"fixed",top:0,left:0,width:"100%",height:"100%",backgroundColor:"rgba(0, 0, 0, 0.6)",zIndex:1040}})]}):null}function ge(){const[e,t]=(0,s.useState)([]),[a,d]=(0,s.useState)(""),[h,x]=(0,s.useState)(""),[g,f]=(0,s.useState)(!1),[_,Y]=(0,s.useState)(""),[M,R]=((0,p.ye)(c()),(0,s.useState)(!1)),[q,U]=(0,s.useState)(!1),[H,O]=(0,s.useState)(!1),[W,J]=(0,s.useState)([]),V=localStorage.getItem("SignatoryLoginData"),[G,K]=(0,s.useState)(!1),[Z,Q]=(0,s.useState)(!0),X=JSON.parse(V),ee=null===X||void 0===X?void 0:X.access_token;var te=F.J+"api/user/",ae=F.J+"api/user/aifile/";document.title="Dataroom Management & Executive Summary";const[se,ie]=(0,s.useState)(!1),[ne,oe]=(0,s.useState)("Onetime"),[re,le]=(0,s.useState)(""),[de,ce]=(0,s.useState)(!1),[me,he]=(0,s.useState)(!1),[ge,ye]=(0,s.useState)(""),[fe,je]=(0,s.useState)(""),[be,ve]=(0,s.useState)(null),we=F.J+"api/user/";(0,s.useEffect)((()=>{ke()}),[]);const ke=async()=>{let e={company_id:X.companies[0].id,user_id:X.id};try{const t=(await u.A.post(we+"getAuthorizedSignature",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}})).data.results;t.length>0&&ve(t[0])}catch(se){}};(0,s.useEffect)((()=>{Ae()}),[]),(0,s.useEffect)((()=>{ze()}),[]),(0,s.useEffect)((()=>{Ce()}),[]),(0,s.useEffect)((()=>{}),[]);const Ae=async()=>{let e={company_id:X.companies[0].id};try{const a=await u.A.post(ae+"checkApprovaldoc",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}});if("1"===a.data.status&&null!=a.data.unique_code){var t=a.data.unique_code;_e("/approvalpage/"+t)}}catch(se){}},Ce=async()=>{let e={company_id:X.companies[0].id};try{const t=await u.A.post(ae+"getcompanyData",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}});t.data.results.length>0&&(je(t.data.results[0].downloadUrl),ye(t.data.results[0]))}catch(se){}};(0,s.useEffect)((()=>{Se()}),[]);const Se=async()=>{let e={company_id:X.companies[0].id};try{const t=await u.A.post(ae+"getcheckDataRoomPlusInvestorSubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}});if(console.log(t.data.results[0].active_until),t.data.results.length>0){const e=new Date(t.data.results[0].active_until),a=new Date;e.setHours(0,0,0,0),a.setHours(0,0,0,0),he(a<=e)}}catch(se){}};(0,s.useEffect)((()=>{Ne()}),[]);const Ne=async()=>{let e={company_id:X.companies[0].id};try{(await u.A.post(ae+"getDocumentcheck",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}})).data.results.length>0?ce(!0):ce(!1)}catch(se){}},_e=(0,D.Zp)(),ze=async()=>{let e={company_id:X.companies[0].id};try{const t=await u.A.post(te+"getcategories",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}});J(t.data.results)}catch(se){}},Ie=F.J+"api/admin/module/",[Le,$e]=(0,s.useState)(""),[Ee,Te]=(0,s.useState)(""),[De,Pe]=(0,s.useState)(""),[Be,Ye]=(0,s.useState)(""),[Me,Re]=(0,s.useState)(!1);(0,s.useEffect)((()=>{Fe(),He()}),[]);const Fe=async()=>{let e={user_id:""};try{var t=(await u.A.post(Ie+"getDataroompayment",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}})).data.row;Ye(t[0])}catch(se){se.response||(se.request?console.error("Request data:",se.request):console.error("Error message:",se.message))}},[qe,Ue]=(0,s.useState)(!1),He=async()=>{let e={user_id:X.id};try{const t=(await u.A.post(Ie+"getCheckOnetimePayment",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}})).data.row;if(t.length>0){const e=new Date(t[0].end_date),a=new Date;e.setHours(0,0,0,0),a.setHours(0,0,0,0),a<=e?(Ue(!1),Re(!0)):(Ue(!0),Re(!1))}else Ue(!1),Re(!1)}catch(se){se.response||(se.request?console.error("Request data:",se.request):console.error("Error message:",se.message))}},[Oe,We]=(0,s.useState)(!1),[Je,Ve]=(0,s.useState)(!1),[Ge,Ke]=(0,s.useState)(!0),[Ze,Qe]=(0,s.useState)(""),[Xe,et]=(0,s.useState)(""),[tt,at]=(0,s.useState)(""),st=async function(e,t){let a=arguments.length>2&&void 0!==arguments[2]?arguments[2]:"";Se();let s={cat_id:e};""===a&&(pt(null),nt(null));try{const a=(await u.A.post(ae+"getcategoryname",s,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}})).data.row;Qe(e),et(t),R(!0),a.length>0?at(a[0].name):at("Others")}catch(se){}},[it,nt]=(0,s.useState)(null),[ot,rt]=(0,s.useState)(""),[lt,dt]=s.useState({}),[ct,pt]=(0,s.useState)(null),[ut,mt]=(0,s.useState)(null),[ht,xt]=(0,s.useState)(""),[gt,yt]=(0,s.useState)(""),ft=(e,t)=>{const a=`${e}-${t}`;pt((e=>e===a?null:a))},jt=()=>{ze(),R(!1),Ne()},[bt,vt]=(0,s.useState)(!1),[wt,kt]=(0,s.useState)([]),[At,Ct]=(0,s.useState)(!1),[St,Nt]=(0,s.useState)(""),[_t,zt]=(0,s.useState)(""),[It,Lt]=(0,s.useState)(!1),[$t,Et]=(0,s.useState)(!1),Tt=()=>{vt(!1),Ct(!1),ze()},[Dt,Pt]=(0,s.useState)(!1),Bt=async()=>{X.id;!1===de||Te("\u26a0\ufe0f Before proceeding, confirm that all required documents have been uploaded. Clicking forward will impact your credit balance, and this action cannot be undone.")},[Yt,Mt]=(0,s.useState)(0),[Rt,Ft]=(0,s.useState)(!1),[qt,Ut]=(0,s.useState)("Generate Executive Summary"),[Ht,Ot]=(0,s.useState)(""),[Wt,Jt]=(0,s.useState)(null);(0,s.useEffect)((()=>{}),[]);const[Vt,Gt]=(0,s.useState)(!1);return(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)("main",{children:(0,y.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,y.jsx)(ue.A,{}),(0,y.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,y.jsx)(i.A,{}),(0,y.jsxs)("section",{className:"px-md-3 py-4",children:[Ht&&(0,y.jsx)("p",{className:se?" mt-3 error_pop":"success_pop mt-3",children:Ht}),Le&&(0,y.jsx)(k.A,{message:Le,onConfirm:async()=>{let e={id:ot,company_id:X.companies[0].id};try{const t=await u.A.post(ae+"UserDocDeleteFile",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}});ze(),nt(null),$e("");const a=t.data.message;Ot(a),ie(!0),setTimeout((()=>{ie(!1),Ot("")}),1e3)}catch(se){}},onCancel:()=>{$e("")}}),Ee&&(0,y.jsx)(k.A,{message:Ee,onConfirm:async()=>{Te(""),Lt(!0)},onCancel:()=>{Te("")}}),a&&(0,y.jsx)(k.A,{message:a,onConfirm:async()=>{let t={company_id:X.companies[0].id,lockId:e};try{await u.A.post(ae+"filelock",t,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}});Y("Documents locked successfully"),setTimeout((()=>{ze(),d(""),Y(""),Ne()}),1200)}catch(se){}},onCancel:()=>{d("")}}),h&&(0,y.jsx)(k.A,{message:h,onConfirm:async()=>{let e={user_id:X.id};try{const t=await u.A.post(ae+"allfileslock",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}});Y(t.data.message),"1"===t.data.status?f(!1):f(!0),setTimeout((()=>{f(!1),x(""),ze(),Y("")}),1200)}catch(se){}},onCancel:()=>{x("")}}),De&&(0,y.jsx)(A.A,{message:De,onClose:()=>{Pe("")}}),_&&(0,y.jsx)("p",{className:g?" mt-3 error_pop":"success_pop mt-3",children:_}),(0,y.jsx)("div",{className:"container-fluid",children:(0,y.jsx)("div",{className:"row gy-4",children:(0,y.jsx)("div",{className:"col-md-12 order-1 order-md-0",children:(0,y.jsx)(r.$K,{className:"d-block p-md-4 p-3",children:(0,y.jsx)("div",{className:"container-fluid",children:(0,y.jsxs)(l.zP,{className:"d-flex flex-column gap-4",children:[(0,y.jsx)("div",{className:"pb-3 bar_design",children:(0,y.jsx)("h4",{className:"h5 mb-0",children:"Dataroom Management & Executive Summary"})}),(0,y.jsxs)("div",{className:"titleroom d-flex m-0 flex-wrap gap-3 justify-content-between align-items-center text-center",children:[(0,y.jsxs)("button",{type:"button",disabled:G,style:{opacity:G?.6:1},onClick:Bt,className:"generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2",children:[(0,y.jsx)("span",{style:{opacity:de?1:.6},children:qt}),G&&(0,y.jsx)("div",{className:"spinner-color spinner-border spinneronetimepay m-0",role:"status",children:(0,y.jsx)("span",{className:"visually-hidden"})})]}),"owner"!==X.role&&(0,y.jsx)(P.N_,{to:"/authorized-signature",className:"generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2",children:(0,y.jsx)("span",{children:"Yes"===(null===be||void 0===be?void 0:be.approve)?"Approved Signature":"Signature to Approval"})})]}),(0,y.jsxs)("div",{className:"table-responsive d-flex flex-column gap-3",children:[W.map((e=>{e.category_id,e.category_id,e.category_id;return(0,y.jsx)("div",{className:"overflow-auto",children:(0,y.jsxs)("table",{className:"table document_table",children:[(0,y.jsx)("thead",{children:(0,y.jsxs)("tr",{children:[(0,y.jsxs)(l.A0,{children:[e.name," ",e.category_tips&&(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)("span",{className:"tooltip-icon","data-tooltip-id":`tt-cat-${e.id}`,"data-tooltip-html":e.category_tips,children:(0,y.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,y.jsx)(o.m_,{id:`tt-cat-${e.id}`,place:"top",float:!0,interactive:!0,className:"custom-tooltip",positionStrategy:"fixed",delayShow:300,delayHide:100})]})]}),(0,y.jsx)(l.A0,{children:"Upload Documents"}),(0,y.jsxs)(l.A0,{children:["Manage Documents",e.do_not_exits&&(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)("span",{className:"tooltip-icon","data-tooltip-id":`tt-doc-${e.id}`,"data-tooltip-html":e.do_not_exits,children:(0,y.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,y.jsx)(o.m_,{id:`tt-doc-${e.id}`,place:"top",float:!0,interactive:!0,className:"custom-tooltip",positionStrategy:"fixed",delayShow:300,delayHide:100})]})]}),(0,y.jsxs)(l.A0,{children:["Exists but NOT Available",e.exits_tips&&(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)("span",{className:"tooltip-icon","data-tooltip-id":`tt-exit-${e.id}`,"data-tooltip-html":e.exits_tips,children:(0,y.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,y.jsx)(o.m_,{id:`tt-exit-${e.id}`,place:"top",float:!0,interactive:!0,className:"custom-tooltip",positionStrategy:"fixed",delayShow:300,delayHide:100})]})]}),(0,y.jsx)(l.A0,{children:"Provided"})]})}),e.subcategories&&e.subcategories.length>0?(0,y.jsx)("tbody",{children:e.subcategories.map(((t,a)=>{const s=`tooltipSub-${e.id}-${t.id}`;return(0,y.jsxs)("tr",{children:[(0,y.jsx)(l.l$,{children:(0,y.jsxs)("h6",{children:[t.name,t.tips&&(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)("span",{"data-tooltip-id":s,className:"tooltip-icon",children:(0,y.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,y.jsx)(o.m_,{id:s,place:"top",interactive:!0,className:"custom-tooltip",positionStrategy:"fixed",delayShow:300,delayHide:100,clickable:!0,children:(0,y.jsx)("div",{dangerouslySetInnerHTML:{__html:t.tips},className:"scroll_bar",style:{maxHeight:"90vh",overflowY:"auto"}})})]})]})}),(0,y.jsx)(l.l$,{children:(0,y.jsx)(l.s5,{type:"button",onClick:()=>{"Yes"!==t.Ai_generate?st(e.id,t.id):"Yes"===t.lockStatus&&(async()=>{let e={user_id:X.id};try{!0===(await u.A.post(ae+"lockFileCheckSubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}})).data.allowEdit&&U(!0)}catch(se){}})(e.id,t.id)},children:t.documents.length>0?(0,y.jsx)("span",{children:"Yes"===t.Ai_generate?(0,y.jsxs)(y.Fragment,{children:["Lock"," ",(0,y.jsx)(N.A,{size:16,className:"text-white",title:"Locked"})]}):(0,y.jsxs)(y.Fragment,{children:["Add ",(0,y.jsx)(C.OiG,{})]})}):(0,y.jsx)("span",{style:{whiteSpace:"nowrap"},className:"d-block",children:"Click to upload"})})}),(0,y.jsx)(l.l$,{children:t.documents&&t.documents.length>0?(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)(l.s5,{type:"button",onClick:()=>ft(e.id,t.id),children:ct===`${e.id}-${t.id}`?"Hide Documents":"View Documents"}),ct===`${e.id}-${t.id}`&&(0,y.jsx)("div",{className:"main_popup-overlay",children:(0,y.jsx)("div",{className:"popupDataRoom",children:(0,y.jsxs)("div",{className:"uploadFilescroll position-relative",children:[(0,y.jsxs)("div",{className:"d-flex mb-2 pop_bg justify-content-between align-items-center p-2",children:[(0,y.jsx)("h4",{className:"docName",children:t.name}),(0,y.jsx)("div",{className:"d-flex gap-2 align-items-center",children:(0,y.jsx)("button",{type:"button",className:"bg-transparent text-white p-1 border-0",onClick:()=>ft(e.id,t.id),children:(0,y.jsx)(n.LwM,{size:24})})})]}),(0,y.jsx)("ol",{className:"text-start text-capitalize px-3 pdflist",children:t.documents.map(((a,s)=>(0,y.jsx)("li",{children:(0,y.jsxs)("span",{className:"d-flex justify-content-between align-items-center",children:[(0,y.jsxs)("span",{className:"d-flex align-items-center gap-2",children:[s+1,".",(0,y.jsx)(y.Fragment,{children:"Yes"===a.locked?(0,y.jsx)(N.A,{size:14,style:{color:"var(--primary)"},title:"Locked"}):(0,y.jsx)(z,{size:14,className:"text-success",title:"Unlocked"})}),a.name]}),(0,y.jsxs)("div",{className:"d-inline position-relative",children:[(0,y.jsx)("button",{title:"More actions",className:"btn btn-link p-0 text-dark",type:"button",onClick:()=>{return e=a.id,rt(e),void nt((t=>t===e?null:e));var e},children:(0,y.jsx)(I.A,{width:16,height:16})}),it===a.id&&(0,y.jsxs)("div",{style:{position:"absolute",width:"100px",backgroundColor:"#fff",boxShadow:"0 2px 5px rgba(0,0,0,0.2)",padding:"2px",zIndex:997,right:0,top:"100%"},children:[(0,y.jsxs)("button",{type:"button",title:"Download",className:"editdelete-links",onClick:()=>(async(e,t,a,s)=>{try{const t=await u.A.post(ae+"filedownload",{company_id:e,folderName:s,filename:a},{responseType:"blob",headers:{Authorization:`Bearer ${ee}`,"Content-Type":"application/json"}}),i=new Blob([t.data]),n=window.URL.createObjectURL(i),o=document.createElement("a");o.href=n,o.download=a,document.body.appendChild(o),o.click(),o.remove(),window.URL.revokeObjectURL(n)}catch(se){alert("Download failed"),console.error(se)}})(a.company_id,a.id,a.name,a.folder_name),children:[(0,y.jsx)(L.A,{className:"me-1",width:12,height:10}),"Download"]}),(0,y.jsxs)("button",{type:"button",title:"Yes"===a.Ai_generate?"Yes":"No",className:"editdelete-links",children:[(0,y.jsx)($,{className:"me-1 text-white",width:12,height:10}),"Yes"===a.Ai_generate?"AI Yes":"AI No"]}),"No"===a.Ai_generate&&(0,y.jsxs)("button",{onClick:()=>(async(e,t)=>{let a={company_id:X.companies[0].id,id:t};try{const e=await u.A.post(ae+"fileslockorUnlock",a,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}});Y(e.data.message),setTimeout((()=>{ze(),Y("")}),1200)}catch(se){}})(a.company_id,a.document_id,a.locked,a.Ai_generate),type:"button",title:"Yes"===a.locked?"Unlock":"Lock",className:"editdelete-links",children:["Yes"===a.locked?(0,y.jsx)(z,{className:"me-1 text-white",width:12,height:10}):(0,y.jsx)(N.A,{className:"me-1 text-white",width:12,height:10}),"Yes"===a.locked?"Unlock":"Lock"]}),(0,y.jsxs)("button",{type:"button",title:"Edit",className:"editdelete-links",style:{opacity:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?.6:1,pointerEvents:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?"none":"auto"},onClick:()=>(async(e,t,a,s,i,n)=>{if(console.log(a,n),xt(t),yt(e),"Yes"===n&&"Yes"===a&&"Yes"===i){let e={user_id:X.id};try{if(!0===(await u.A.post(ae+"lockFileCheckSubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}})).data.allowEdit)U(!0);else{let e={cat_id:s};try{const t=(await u.A.post(ae+"getcategoryname",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}})).data.row;Qe(s),O(!0),t.length>0?at(t[0].name):at("Others")}catch(se){}}}catch(se){}}else{let e={cat_id:s};try{const t=(await u.A.post(ae+"getcategoryname",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}})).data.row;Qe(s),O(!0),t.length>0?at(t[0].name):at("Others")}catch(se){}}})(a.id,a.name,a.lockStatus,e.id,a.locked,a.Ai_generate),children:[(0,y.jsx)(E,{className:"me-1 text-white",width:10,height:10}),"Yes"===a.Ai_generate?"Replace":"Edit"]}),"Yes"===a.Ai_generate&&(0,y.jsxs)("button",{type:"button",title:"Add",className:"editdelete-links",onClick:()=>st(e.id,t.id,"1"),style:{opacity:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?.6:1,pointerEvents:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?"none":"auto"},children:[(0,y.jsx)(C.OiG,{className:"me-1",width:10,height:10}),"Add"]}),(0,y.jsxs)("button",{type:"button",title:"Delete",className:"editdelete-links",style:{opacity:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?.6:1,pointerEvents:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?"none":"auto"},onClick:()=>(async(e,t,a,s)=>{if("Yes"===t&&"Yes"===a&&"Yes"===s){let t={company_id:X.companies[0].id,docId:e};try{const e=await u.A.post(ae+"lockFileCheckSubscription",t,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}});console.log(e.data)}catch(se){}}else $e("Are you sure? You want to delete this file")})(a.id,a.locked,a.Ai_generate,a.lockStatus),children:[(0,y.jsx)(T.A,{className:"me-1",width:10,height:10}),"Delete"]})]})]})]})},a.id)))}),(0,y.jsx)("button",{className:"btn btn-outline-dark",type:"button",onClick:()=>ft(e.id,t.id),children:(0,y.jsx)(S.QCr,{})})]})})})]}):(0,y.jsx)("span",{children:"N/A"})}),(0,y.jsx)(l.l$,{children:(0,y.jsx)("h5",{children:"--"})}),(0,y.jsx)(l.l$,{children:t.documents.length>0?(0,y.jsx)("p",{children:"Yes"}):(0,y.jsx)("span",{children:"--"})})]},t.id)}))}):(0,y.jsx)("tbody",{children:(0,y.jsx)("tr",{children:(0,y.jsx)(l.l$,{colSpan:5,children:(0,y.jsx)("p",{children:"No subcategories"})})})})]},e.id)})})),(0,y.jsx)("div",{className:"titleroom d-flex justify-content-between align-items-center text-center",children:(0,y.jsxs)("button",{type:"button",disabled:G,style:{opacity:G?.6:1},onClick:Bt,className:"generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2",children:[(0,y.jsx)("span",{style:{opacity:de?1:.6},children:qt}),G&&(0,y.jsx)("div",{className:"spinner-color spinner-border spinneronetimepay m-0",role:"status",children:(0,y.jsx)("span",{className:"visually-hidden"})})]})})]})]})})})})})})]})]})]})}),M&&(0,y.jsx)(m.A,{onClose:()=>R(!1),catgeoryId:Ze,subcatgeoryId:Xe,CategorynameFile:tt,refreshpage:jt,lockunlockId:()=>{if(Xe){t(Xe);d("To generate a diligence report, all documents in the data room must be locked.\nThis document is editable until the first diligence report is generated.\n\nI want to lock this document.")}}}),q&&(0,y.jsx)(j,{onClose:()=>U(!1)}),H&&(0,y.jsx)(b.A,{onClose:()=>O(!1),catgeoryId:Ze,subcatgeoryId:Xe,CategorynameFile:tt,refreshpage:jt,Docname:ht,DeleteIdDocs:ot,docId:gt}),bt&&(0,y.jsx)(w.A,{onClose:()=>vt(!1),catgeoryId:Ze,subcatgeoryId:Xe,CategorynameFile:tt,refreshpageAi:Tt,Docname:ht,DeleteIdDocs:ot,AIquestions:wt}),At&&(0,y.jsx)(v.A,{onClose:()=>Ct(!1),AiUpdatesummaryID:St,refreshpageAi:Tt,AISummary:_t}),Oe&&(0,y.jsx)(B.A,{show:Oe,onClose:()=>We(!1),payment:Be.onetime_Fee,referstatus:Z}),Dt&&(0,y.jsx)(pe,{show:Dt,onClose:()=>Pt(!1),payment:Be.perInstance_Fee,usersubscriptiondataroomone_time_id:re}),(0,y.jsx)(xe,{show:It,onClose:()=>Lt(!1),onConfirm:async()=>{Lt(!1);let e={company_id:X.companies[0].id};Te("");try{await u.A.post(ae+"checkuserSubscriptionThreeMonth",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}});let a={company_id:X.companies[0].id,created_by_role:X.role,created_by_id:X.id,payid:"1"};le("1"),Ut("Please don't refresh the page"),Mt(0),Ft(!0);const s=setInterval((()=>{Mt((e=>e>=95?e:Math.min(e+10*Math.random(),95)))}),500);Te(""),K(!0),Q(!0);try{var t=(await u.A.post(ae+"generateProcessAI",a,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ee}`}})).data;"2"===t.status?(K(!1),Ft(!1),f(!0),Y(t.message),Ut("Generate Executive Summary"),setTimeout((()=>{f(!1),Y("")}),1200)):(clearInterval(s),Mt(100),K(!1),setTimeout((()=>{Ft(!1),_e("/approvalpage/"+t.code)}),500))}catch(se){console.error("Error generating summary",se)}}catch(se){}},companyName:X.companies[0].id,isSubmitting:$t})]})}},9855:(e,t,a)=>{a.d(t,{A:()=>s});const s=(0,a(77784).A)("trash-2",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]])},65727:(e,t,a)=>{a.d(t,{A:()=>s});const s=(0,a(77784).A)("lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]])}}]);
//# sourceMappingURL=6914.18a8d419.chunk.js.map