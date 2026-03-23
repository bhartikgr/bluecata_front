/*! For license information please see 6914.f1c022aa.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[6914],{2701:(e,t,a)=>{a.r(t),a.d(t,{default:()=>ge});var s=a(65043),n=a(74723),i=a(45394),o=(a(38421),a(57943)),r=(a(9191),a(53579)),l=a(27836),c=a(86178),d=a.n(c),p=a(12758),m=(a(83656),a(86213)),u=a(4563),h=a(26022),x=a(63393),g=a(69677),f=a(70579);const y=(0,g.c)("pk_test_51RUJzWAx6rm2q3pys9SgKUPRxNxPZ4P1X6EazNQvnPuHKOOfzGsbylaTLUktId9ANHULkwBk67jnp5aqZ9Dlm6PR00jKdDwvSq"),j=e=>{let{onClose:t}=e;var a="https://capavate.com/api/user/aifile/";const n=localStorage.getItem("CompanyLoginData"),o=JSON.parse(n),[r,l]=(0,s.useState)("");(0,s.useEffect)((()=>{c()}),[]);const c=async()=>{let e={user_id:""};try{var t=(await m.A.post("https://capavate.com/api/admin/module/getDataroompayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;l(t[0])}catch(a){a.response||(a.request?console.error("Request data:",a.request):console.error("Error message:",a.message))}},d=e=>{let{payment:t}=e;const[n,i]=(0,s.useState)(t),r=(0,x.useStripe)(),[l,c]=(0,s.useState)(""),[d,p]=(0,s.useState)(""),u=(0,x.useElements)(),[g,y]=(0,s.useState)(""),[j,b]=(0,s.useState)(!1),[v,w]=(0,s.useState)(""),[k,C]=(0,s.useState)(!1);setTimeout((()=>{w("")}),5e3);const S=async e=>{try{await m.A.post(`${a}CreateuserSubscriptionLockFile`,e,{headers:{Accept:"application/json","Content-Type":"application/json"}}),w("Payment successful! \ud83c\udf89"),C(!1),setTimeout((()=>{window.location.reload()}),2e3)}catch(t){console.error("Success handler error:",t),w("Payment was captured, but post-process failed."),C(!0)}finally{b(!1)}};return(0,f.jsxs)("form",{onSubmit:async e=>{if(console.log(r),e.preventDefault(),console.log(r),!r||!u)return;const t=u.getElement(x.CardElement);if(!t)return w("Payment form is not ready. Please reload the page."),void C(!0);b(!0);try{const{data:e}=await m.A.post(`${a}CreateuserSubscriptionPaymentLockFile`,{user_id:o.id,amount:n}),s=await r.confirmCardPayment(e.clientSecret,{payment_method:{card:t}});if(s.error)w(s.error.message),C(!0),b(!1);else if("succeeded"===s.paymentIntent.status){const t={user_id:o.id,amount:n,clientSecret:e.clientSecret,payment_status:s.paymentIntent.status};await S(t)}else w("Payment failed. Try again."),C(!0),b(!1)}catch(s){w("Unexpected error occurred."),C(!0),b(!1)}},action:"javascript:void(0)",method:"post",children:[(0,f.jsx)("div",{className:"form-control rounded-3",style:{padding:"0.75rem",border:"1px solid #000",borderColor:"#ced4da"},children:(0,f.jsx)(x.CardElement,{options:{style:{base:{fontSize:"16px",color:"#32325d",fontFamily:'"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',"::placeholder":{color:"#a0aec0"},padding:"0.75rem"},invalid:{color:"#e5424d"}},classes:{base:"stripe-card-element",focus:"border-primary",invalid:"border-danger"}}})}),(0,f.jsx)("div",{className:"d-grid gap-2 d-md-flex justify-content-md-end mt-4",children:(0,f.jsxs)(h.$n,{disabled:!r||j,type:"submit",className:"submit d-flex align-items-center gap-2",style:{background:"#003b21"},children:[!j&&(0,f.jsxs)("span",{children:["Pay \u20ac",n]}),j&&(0,f.jsx)("div",{className:"spinner-border text-white spinneronetimepay m-0",role:"status",children:(0,f.jsx)("span",{className:"visually-hidden"})})]})}),v&&(0,f.jsx)("p",{className:k?" mt-3 error_pop":"success_pop mt-3",children:v})]})};return(0,f.jsx)(f.Fragment,{children:(0,f.jsx)("div",{className:"payment_modal-overlay",onClick:t,children:(0,f.jsxs)("div",{className:"modal-container scroll_bar",onClick:e=>e.stopPropagation(),children:[(0,f.jsxs)("div",{className:"modal-header",children:[(0,f.jsxs)("div",{className:"modal-title-section",children:[(0,f.jsx)("h5",{className:"modal-title",children:"Payment"}),(0,f.jsxs)("div",{className:"price-tag",children:["Credit: \u20ac",r.perInstance_Fee]})]}),(0,f.jsx)("button",{type:"button",className:"close_btn_global",onClick:t,"aria-label":"Close",children:(0,f.jsx)(i.LwM,{size:24})})]}),(0,f.jsxs)("div",{className:"payment-info",children:[(0,f.jsxs)("div",{className:"benefits-list",children:[(0,f.jsxs)("div",{className:"benefit-item",children:[(0,f.jsx)("div",{className:"benefit-icon",children:(0,f.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,f.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,f.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,f.jsx)("div",{className:"benefit-text",children:"To generate a diligence report, all documents in the data room must be locked."})]}),(0,f.jsxs)("div",{className:"benefit-item",children:[(0,f.jsx)("div",{className:"benefit-icon",children:(0,f.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,f.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,f.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,f.jsx)("div",{className:"benefit-text",children:"Documents in the data room are editable until the first diligence report is generated."})]}),(0,f.jsxs)("div",{className:"benefit-item",children:[(0,f.jsx)("div",{className:"benefit-icon",children:(0,f.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,f.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,f.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,f.jsx)("div",{className:"benefit-text",children:"After generating a diligence report, you can still manage documents, but they must be locked, and credits are required to create a new version."})]}),(0,f.jsxs)("div",{className:"benefit-item",children:[(0,f.jsx)("div",{className:"benefit-icon",children:(0,f.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,f.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,f.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,f.jsxs)("div",{className:"benefit-text",children:["Additional document generation:"," ",(0,f.jsxs)("strong",{children:["\u20ac",r.perInstance_Fee]})," per instance."]})]})]}),(0,f.jsxs)("div",{className:"payment-methods",children:[(0,f.jsxs)("div",{className:"accepted-cards pt-2",children:[(0,f.jsx)("span",{className:"accepted-text",children:"We accept:"}),(0,f.jsx)("div",{className:"card-icons",children:(0,f.jsx)("div",{className:"text-center mb-4",children:(0,f.jsx)("img",{src:"/assets/user/images/cardimage.jpg",alt:"cards",className:"img-fluid rounded",style:{maxWidth:"200px"}})})})]}),(0,f.jsx)("div",{className:"stripe-form-container",children:(0,f.jsx)(x.Elements,{stripe:y,children:(0,f.jsx)(d,{payment:r.perInstance_Fee})})})]})]})]})})})};var b=a(56052),v=a(83885),w=a(17321),k=a(37022),C=a(48173),S=a(23156),A=a(60184),N=a(65727),_=a(77784);const z=(0,_.A)("lock-open",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 9.9-1",key:"1mm8w8"}]]);var I=a(5379),L=a(7104);const E=(0,_.A)("brain",[["path",{d:"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",key:"l5xja"}],["path",{d:"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",key:"ep3f8r"}],["path",{d:"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",key:"1p4c4q"}],["path",{d:"M17.599 6.5a3 3 0 0 0 .399-1.375",key:"tmeiqw"}],["path",{d:"M6.003 5.125A3 3 0 0 0 6.401 6.5",key:"105sqy"}],["path",{d:"M3.477 10.896a4 4 0 0 1 .585-.396",key:"ql3yin"}],["path",{d:"M19.938 10.5a4 4 0 0 1 .585.396",key:"1qfode"}],["path",{d:"M6 18a4 4 0 0 1-1.967-.516",key:"2e4loj"}],["path",{d:"M19.967 17.484A4 4 0 0 1 18 18",key:"159ez6"}]]),T=(0,_.A)("pencil",[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]);var D=a(9855),P=a(73216),Y=a(35475),M=a(94298),$=a(40614),R=a(86376),F=a(5464),q=a(25581),U=a(7585);const B=F.default.div`
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
`,O=F.default.div`
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
`,W=F.default.div`
  position: relative;
  padding: 24px 24px 16px;
  border-bottom: 1px solid #f3f4f6;
`,H=F.default.button`
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
`,J=F.default.h2`
  font-size: 24px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 4px 0;
`,V=F.default.p`
  font-size: 14px;
  color: #6b7280;
  margin: 0;
`,G=F.default.div`
  padding: 0 24px 24px 24px;
`,K=F.default.div`
  display: flex;
  justify-content: center;
  padding: 16px;
  background: linear-gradient(to bottom right, #f9fafb, #f3f4f6);
  border-radius: 12px;
`,Z=F.default.div`
  display: flex;
  align-items: center;
  gap: 12px;
`,Q=F.default.div`
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
`,X=F.default.div`
  padding: 16px;
  background: linear-gradient(to bottom right, #eff6ff, #e0e7ff);
  border-radius: 12px;
  border: 1px solid #dbeafe;
  margin-bottom: 24px;
`,ee=F.default.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`,te=F.default.span`
  font-size: 14px;
  font-weight: 500;
  color: #4b5563;
`,ae=F.default.div`
  text-align: right;
`,se=(F.default.div`
  font-size: 14px;
  color: #9ca3af;
  text-decoration: line-through;
`,F.default.div`
  font-size: 28px;
  font-weight: 700;
  color: #111827;
`),ne=(F.default.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #059669;
`,F.default.div`
  margin-bottom: 24px;
`,F.default.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 12px;
`),ie=(F.default.div`
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
`,F.default.input`
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
`,F.default.button`
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
`,F.default.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 14px;
  color: #dc2626;
`,F.default.div`
  margin-bottom: 24px;
`),oe=F.default.div`
  padding: 16px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  min-height: 120px;
  background: white;
  transition: border-color 0.2s;

  &:focus-within {
    border-color: #3b82f6;
  }
`,re=(F.default.div`
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
`,F.default.button`
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
`),le=F.default.span`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
`,ce=F.default.div`
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
`,de=F.default.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: #6b7280;
`,pe=e=>{let{show:t,onClose:a,payment:n,usersubscriptiondataroomone_time_id:i}=e;const[o,r]=(0,s.useState)(!1),[l,c]=(0,s.useState)(0),[d,p]=(0,s.useState)(n),[u,h]=(0,s.useState)(""),[x,g]=(0,s.useState)(!1),[y,j]=(0,s.useState)(null),[b,v]=(0,s.useState)(!1),[w,k]=(0,s.useState)(!1),[C,S]=(0,s.useState)(!1),[A,N]=(0,s.useState)(null),_=localStorage.getItem("SignatoryLoginData"),z=JSON.parse(_),I=(q.J,q.J+"api/user/payment/"),[L,E]=(0,s.useState)(""),[T,D]=(0,s.useState)(!1),P=(0,s.useRef)(null),Y=(0,s.useRef)(null),[M,F]=(0,s.useState)(""),[pe,me]=(0,s.useState)("");(0,s.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),t=await e.json();me(t.ip)}catch(e){console.error("Failed to fetch IP",e)}})()}),[]),(0,s.useEffect)((()=>{if(!t)return;let e=!0;return(async()=>{try{if(console.log("\ud83d\udd04 Initializing Airwallex SDK..."),await U.Ay.loadAirwallex({env:"demo"}),!e)return;console.log("\u2705 Airwallex SDK loaded");const{data:t}=await m.A.post(`${I}access_token`);if(!e)return;const a=t.accessToken;if(!a)throw new Error("Access token missing");F(a);const{data:s}=await m.A.post(`${I}create_payment_intent`,{amount:n,currency:"EUR",accessToken:a,originalAmount:n});if(!e)return;const{paymentIntentId:i,clientSecret:o}=s;if(!i||!o)throw new Error("Payment intent creation failed");N({id:i,client_secret:o});const l=U.Ay.createElement("card",{intent:{id:i,client_secret:o}});Y.current=l,j(l),l.mount("airwallex-card"),window.addEventListener("onReady",(e=>{r(!0)})),window.addEventListener("onChange",(e=>{var t;g((null===(t=e.detail)||void 0===t?void 0:t.complete)||!1)})),window.addEventListener("onError",(e=>{var t;h((null===(t=e.detail)||void 0===t?void 0:t.message)||"Card validation error")}))}catch(p){var t,a,s,i,o,l,c,d;const e=(null===(t=p.response)||void 0===t||null===(a=t.data)||void 0===a||null===(s=a.error)||void 0===s?void 0:s.message)||(null===(i=p.response)||void 0===i||null===(o=i.data)||void 0===o?void 0:o.message)||p.message;"configuration_error"===(null===(l=p.response)||void 0===l||null===(c=l.data)||void 0===c||null===(d=c.error)||void 0===d?void 0:d.code)?alert("\u26a0\ufe0f Payment gateway not configured. Please contact support."):alert("Payment initialization failed: "+e)}})(),()=>{var t;if(e=!1,window.removeEventListener("onReady",(()=>{})),window.removeEventListener("onChange",(()=>{})),window.removeEventListener("onError",(()=>{})),null!==(t=Y.current)&&void 0!==t&&t.unmount)try{Y.current.unmount()}catch(a){console.warn("Unmount failed:",a)}}}),[t,n]);return t?(0,f.jsx)(B,{children:(0,f.jsxs)(O,{children:[(0,f.jsxs)(W,{children:[(0,f.jsx)(H,{onClick:a,children:(0,f.jsx)($.A,{size:24})}),(0,f.jsx)(J,{children:"Complete Payment"}),(0,f.jsx)(V,{children:"Secure payment powered by Airwallex"})]}),(0,f.jsxs)(G,{children:[L&&(0,f.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(T?"error_pop":"success_pop"),children:[(0,f.jsx)("div",{className:"d-flex align-items-start gap-2",children:(0,f.jsx)("span",{className:"d-block",children:L})}),(0,f.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>E(""),children:"\xd7"})]}),(0,f.jsx)(K,{children:(0,f.jsxs)(Z,{children:[(0,f.jsx)(Q,{gradient:"linear-gradient(to bottom right, #2563eb, #1d4ed8)",children:"VISA"}),(0,f.jsx)(Q,{gradient:"linear-gradient(to bottom right, #dc2626, #ea580c)",children:"MC"}),(0,f.jsx)(Q,{gradient:"linear-gradient(to bottom right, #3b82f6, #2563eb)",children:"AMEX"})]})}),(0,f.jsx)(X,{children:(0,f.jsxs)(ee,{children:[(0,f.jsx)(te,{children:"Total Amount"}),(0,f.jsx)(ae,{children:(0,f.jsxs)(se,{children:["\u20ac",d.toFixed(2)]})})]})}),(0,f.jsxs)(ie,{children:[(0,f.jsxs)(ne,{children:[(0,f.jsx)(R.A,{size:16}),(0,f.jsx)("span",{children:"Card Details"})]}),(0,f.jsx)(oe,{id:"airwallex-card",ref:P})]}),(0,f.jsx)(re,{onClick:async()=>{if(d<=0)return await m.A.post(`${I}CompanySubscriptionOneTimeDataRoomPlus`,{company_id:z.companies[0].id,created_by_id:z.id,amount:0,clientSecret:null,PayidOnetime:null,payment_status:"succeeded",ip_address:pe}),E("Subscription applied successfully! \ud83c\udf89"),D(!1),void setTimeout((()=>window.location.reload()),2e3);if(!y||!A)return E("Payment form not loaded"),void D(!0);if(!x)return E("Please fill card details correctly"),void D(!0);k(!0),h("");try{const{data:e}=await m.A.post(`${I}create_payment_intent`,{amount:Math.round(100*d),currency:"EUR",accessToken:M,originalAmount:n,discount:l}),t=e.paymentIntentId,a=e.clientSecret,s=await U.Ay.confirmPaymentIntent({element:y,id:t,client_secret:a});"SUCCEEDED"===s.status?(await m.A.post(`${I}CreateuserSubscriptionDataRoomPerinstance`,{company_id:z.companies[0].id,created_by_id:z.id,amount:d,clientSecret:a,PayidOnetime:t,payment_status:"succeeded",usersubscriptiondataroomone_time_id:i,ip_address:pe}),E("Payment successful! \ud83c\udf89"),D(!1),setTimeout((()=>window.location.reload()),2e3)):(E(`Payment ${s.status}. Please try again.`),D(!0))}catch(e){E(e.message||"Payment failed. Please try again."),D(!0)}finally{k(!1)}},disabled:!o||w,children:w?(0,f.jsxs)(le,{children:[(0,f.jsx)(ce,{}),(0,f.jsx)("span",{children:"Processing..."})]}):`Pay \u20ac${d.toFixed(2)}`}),(0,f.jsxs)(de,{children:[(0,f.jsx)("svg",{width:"16",height:"16",fill:"currentColor",viewBox:"0 0 20 20",style:{color:"#059669"},children:(0,f.jsx)("path",{fillRule:"evenodd",d:"M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z",clipRule:"evenodd"})}),(0,f.jsx)("span",{children:"Secured by 256-bit SSL encryption"})]})]})]})}):null};var me=a(66616),ue=a(76245),he=a(77819);function xe(e){let{show:t,onClose:a,onConfirm:n,companyName:i="Your Company",isSubmitting:o=!1}=e;const[r,l]=(0,s.useState)(!1),[c,d]=(0,s.useState)("");(0,s.useEffect)((()=>{t&&(l(!1),d(""))}),[t]);return t?(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)("div",{className:"modal fade show",style:{display:"block",backgroundColor:"rgba(0, 0, 0, 0.6)",backdropFilter:"blur(4px)",zIndex:1050},children:(0,f.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-lg",children:(0,f.jsxs)("div",{className:"modal-content",style:{borderRadius:"20px",border:"none",boxShadow:"0 25px 50px -12px rgba(0, 0, 0, 0.25)",overflow:"hidden"},children:[(0,f.jsx)("div",{style:{background:"linear-gradient(135deg, rgb(26, 28, 46) 0%, rgb(219 74, 67) 100%)",padding:"24px 32px",borderBottom:"1px solid rgb(26, 28, 46)"},children:(0,f.jsxs)("div",{className:"d-flex justify-content-between align-items-center",children:[(0,f.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[(0,f.jsx)("div",{style:{width:"48px",height:"48px",background:"rgba(204, 0, 0, 0.15)",borderRadius:"12px",display:"flex",alignItems:"center",justifyContent:"center"},children:(0,f.jsx)(N.A,{size:28,color:"#CC0000"})}),(0,f.jsxs)("div",{children:[(0,f.jsx)("div",{style:{fontSize:"11px",fontWeight:"700",letterSpacing:"0.1em",textTransform:"uppercase",color:"#CC0000",marginBottom:"4px"},children:"Acknowledgement"}),(0,f.jsx)("h4",{style:{margin:0,fontSize:"1.5rem",fontWeight:"700",color:"#fff",letterSpacing:"-0.5px"},children:"Data Room Lock & AI Executive Summary"}),(0,f.jsx)("p",{style:{color:"rgba(255,255,255,0.7)",margin:"4px 0 0 0",fontSize:"0.85rem"},children:"Signatory Action"})]})]}),(0,f.jsx)("button",{onClick:a,disabled:o,style:{background:"rgba(255,255,255,0.1)",border:"none",cursor:o?"not-allowed":"pointer",width:"40px",height:"40px",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s",opacity:o?.5:1},children:(0,f.jsx)(ue.A,{size:20,color:"#fff"})})]})}),(0,f.jsxs)("div",{style:{padding:"32px"},children:[(0,f.jsxs)("div",{style:{border:"1px solid #e9ecef",borderRadius:"16px",overflow:"hidden",marginBottom:"24px"},children:[(0,f.jsx)("div",{style:{background:"#f8f9fa",padding:"16px 24px",borderBottom:"1px solid #e9ecef",borderLeft:"4px solid #CC0000"},children:(0,f.jsxs)("h5",{style:{margin:0,fontWeight:"700",fontSize:"1rem",color:"#212529"},children:["Copy",(0,f.jsx)("span",{style:{marginLeft:"12px",padding:"2px 8px",borderRadius:"12px",fontSize:"11px",fontWeight:"600",backgroundColor:"#CC0000",color:"#fff"},children:"Signatory Action"})]})}),(0,f.jsxs)("div",{style:{padding:"24px"},children:[(0,f.jsxs)("div",{style:{fontSize:"1rem",color:"#212529",marginBottom:"20px",lineHeight:"1.6"},children:["You are about to lock the data room for ",(0,f.jsx)("strong",{children:i})," and generate an AI-assisted executive summary from its contents."]}),(0,f.jsx)("p",{style:{fontWeight:"600",marginBottom:"12px",color:"#212529",fontSize:"0.95rem"},children:"By proceeding, you confirm that:"}),(0,f.jsxs)("ul",{style:{paddingLeft:"20px",marginBottom:"24px"},children:[(0,f.jsx)("li",{style:{marginBottom:"12px",color:"#495057",lineHeight:"1.6",fontSize:"0.9rem"},children:"You are authorised to lock this data room and to grant the Capavate platform access to its contents for the purpose of generating the executive summary."}),(0,f.jsxs)("li",{style:{marginBottom:"12px",color:"#495057",lineHeight:"1.6",fontSize:"0.9rem"},children:["All documents and materials contained in the data room are owned by or lawfully licensed to ",(0,f.jsx)("strong",{children:i}),", and their use for AI processing does not violate any third-party rights, confidentiality obligations, or applicable law."]}),(0,f.jsx)("li",{style:{marginBottom:"12px",color:"#495057",lineHeight:"1.6",fontSize:"0.9rem"},children:"The AI-generated executive summary is produced automatically and may not be accurate, complete, or up to date. It does not constitute financial, legal, or investment advice. You remain solely responsible for reviewing, verifying, and approving the summary before it is shared with any investor."}),(0,f.jsx)("li",{style:{marginBottom:"12px",color:"#495057",lineHeight:"1.6",fontSize:"0.9rem"},children:"Capavate and BluePrint Catalyst Limited bear no liability for the accuracy, completeness, or consequences of the AI-generated output, including any investor decisions made in reliance thereon."})]}),(0,f.jsxs)("div",{style:{background:"#f8f9fa",borderRadius:"12px",padding:"20px",border:c?"1px solid #CC0000":"1px solid #e9ecef",boxShadow:c?"0 0 0 3px rgba(204, 0, 0, 0.1)":"none"},children:[(0,f.jsxs)("div",{className:"form-check",style:{paddingLeft:"32px"},children:[(0,f.jsx)("input",{type:"checkbox",className:"form-check-input",id:"dataRoomLockConfirm",checked:r,onChange:e=>{l(e.target.checked),e.target.checked&&d("")},style:{width:"20px",height:"20px",marginLeft:"-32px",cursor:"pointer",accentColor:"#CC0000"}}),(0,f.jsx)("label",{className:"form-check-label",htmlFor:"dataRoomLockConfirm",style:{cursor:"pointer",fontSize:"0.9rem",color:"#212529",lineHeight:"1.5"},children:(0,f.jsx)("strong",{children:"I confirm I am authorised to lock this data room and understand the AI summary must be reviewed before distribution. I accept all responsibility for its contents."})})]}),c&&(0,f.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:"8px",marginTop:"12px",color:"#CC0000",fontSize:"0.85rem"},children:[(0,f.jsx)(he.A,{size:14}),(0,f.jsx)("span",{children:c})]})]})]})]}),(0,f.jsxs)("div",{style:{display:"flex",gap:"16px",justifyContent:"flex-end"},children:[(0,f.jsx)("button",{type:"button",onClick:a,disabled:o,style:{padding:"10px 24px",borderRadius:"8px",border:"1px solid #dee2e6",background:"#fff",color:"#495057",fontSize:"0.9rem",fontWeight:"500",cursor:o?"not-allowed":"pointer",opacity:o?.5:1},children:"Cancel"}),(0,f.jsx)("button",{type:"button",onClick:()=>{r?(d(""),n()):d("Please confirm the acknowledgment to proceed")},disabled:!r||o,style:{padding:"10px 28px",borderRadius:"8px",border:"none",background:r&&!o?"linear-gradient(135deg, #CC0000 0%, #A00000 100%)":"#ccc",color:"#fff",fontSize:"0.9rem",fontWeight:"600",cursor:r&&!o?"pointer":"not-allowed",opacity:r&&!o?1:.6,transition:"all 0.2s",display:"flex",alignItems:"center",gap:"8px"},children:o?"Processing...":(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)(N.A,{size:16}),(0,f.jsx)(E,{size:16}),"Lock Data Room & Generate AI Summary"]})})]})]})]})})}),(0,f.jsx)("div",{className:"modal-backdrop fade show",onClick:a,style:{position:"fixed",top:0,left:0,width:"100%",height:"100%",backgroundColor:"rgba(0, 0, 0, 0.6)",zIndex:1040}})]}):null}function ge(){const[e,t]=(0,s.useState)([]),[a,c]=(0,s.useState)(""),[h,x]=(0,s.useState)(""),[g,y]=(0,s.useState)(!1),[_,$]=(0,s.useState)(""),[R,F]=((0,p.ye)(d()),(0,s.useState)(!1)),[U,B]=(0,s.useState)(!1),[O,W]=(0,s.useState)(!1),[H,J]=(0,s.useState)([]),V=localStorage.getItem("SignatoryLoginData"),[G,K]=(0,s.useState)(!1),[Z,Q]=(0,s.useState)(!0),X=JSON.parse(V);var ee=q.J+"api/user/",te=q.J+"api/user/aifile/";document.title="Dataroom Management & Executive Summary";const[ae,se]=(0,s.useState)(!1),[ne,ie]=(0,s.useState)("Onetime"),[oe,re]=(0,s.useState)(""),[le,ce]=(0,s.useState)(!1),[de,ue]=(0,s.useState)(!1),[he,ge]=(0,s.useState)(""),[fe,ye]=(0,s.useState)(""),[je,be]=(0,s.useState)(null),ve=q.J+"api/user/";(0,s.useEffect)((()=>{we()}),[]);const we=async()=>{let e={company_id:X.companies[0].id,user_id:X.id};try{const t=(await m.A.post(ve+"getAuthorizedSignature",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results;t.length>0&&be(t[0])}catch(ae){}};(0,s.useEffect)((()=>{ke()}),[]),(0,s.useEffect)((()=>{_e()}),[]),(0,s.useEffect)((()=>{Ce()}),[]),(0,s.useEffect)((()=>{}),[]);const ke=async()=>{let e={company_id:X.companies[0].id};try{const a=await m.A.post(te+"checkApprovaldoc",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if("1"===a.data.status&&null!=a.data.unique_code){var t=a.data.unique_code;Ne("/approvalpage/"+t)}}catch(ae){}},Ce=async()=>{let e={company_id:X.companies[0].id};try{const t=await m.A.post(te+"getcompanyData",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});t.data.results.length>0&&(ye(t.data.results[0].downloadUrl),ge(t.data.results[0]))}catch(ae){}};(0,s.useEffect)((()=>{Se()}),[]);const Se=async()=>{let e={company_id:X.companies[0].id};try{const t=await m.A.post(te+"getcheckDataRoomPlusInvestorSubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(console.log(t.data.results[0].active_until),t.data.results.length>0){const e=new Date(t.data.results[0].active_until),a=new Date;e.setHours(0,0,0,0),a.setHours(0,0,0,0),ue(a<=e)}}catch(ae){}};(0,s.useEffect)((()=>{Ae()}),[]);const Ae=async()=>{let e={company_id:X.companies[0].id};try{(await m.A.post(te+"getDocumentcheck",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length>0?ce(!0):ce(!1)}catch(ae){}},Ne=(0,P.Zp)(),_e=async()=>{let e={company_id:X.companies[0].id};try{const t=await m.A.post(ee+"getcategories",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});J(t.data.results)}catch(ae){}},ze=q.J+"api/admin/module/",[Ie,Le]=(0,s.useState)(""),[Ee,Te]=(0,s.useState)(""),[De,Pe]=(0,s.useState)(""),[Ye,Me]=(0,s.useState)(""),[$e,Re]=(0,s.useState)(!1);(0,s.useEffect)((()=>{Fe(),Be()}),[]);const Fe=async()=>{let e={user_id:""};try{var t=(await m.A.post(ze+"getDataroompayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;Me(t[0])}catch(ae){ae.response||(ae.request?console.error("Request data:",ae.request):console.error("Error message:",ae.message))}},[qe,Ue]=(0,s.useState)(!1),Be=async()=>{let e={user_id:X.id};try{const t=(await m.A.post(ze+"getCheckOnetimePayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;if(t.length>0){const e=new Date(t[0].end_date),a=new Date;e.setHours(0,0,0,0),a.setHours(0,0,0,0),a<=e?(Ue(!1),Re(!0)):(Ue(!0),Re(!1))}else Ue(!1),Re(!1)}catch(ae){ae.response||(ae.request?console.error("Request data:",ae.request):console.error("Error message:",ae.message))}},[Oe,We]=(0,s.useState)(!1),[He,Je]=(0,s.useState)(!1),[Ve,Ge]=(0,s.useState)(!0),[Ke,Ze]=(0,s.useState)(""),[Qe,Xe]=(0,s.useState)(""),[et,tt]=(0,s.useState)(""),at=async function(e,t){let a=arguments.length>2&&void 0!==arguments[2]?arguments[2]:"";Se();let s={cat_id:e};""===a&&(dt(null),nt(null));try{const a=(await m.A.post(te+"getcategoryname",s,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;Ze(e),Xe(t),!1===$e&&!1===de?We(!0):F(!0),a.length>0?tt(a[0].name):tt("Others")}catch(ae){}},[st,nt]=(0,s.useState)(null),[it,ot]=(0,s.useState)(""),[rt,lt]=s.useState({}),[ct,dt]=(0,s.useState)(null),[pt,mt]=(0,s.useState)(null),[ut,ht]=(0,s.useState)(""),[xt,gt]=(0,s.useState)(""),ft=(e,t)=>{const a=`${e}-${t}`;dt((e=>e===a?null:a))},yt=()=>{_e(),F(!1),Ae()},[jt,bt]=(0,s.useState)(!1),[vt,wt]=(0,s.useState)([]),[kt,Ct]=(0,s.useState)(!1),[St,At]=(0,s.useState)(""),[Nt,_t]=(0,s.useState)(""),[zt,It]=(0,s.useState)(!1),[Lt,Et]=(0,s.useState)(!1),Tt=()=>{bt(!1),Ct(!1),_e()},[Dt,Pt]=(0,s.useState)(!1),Yt=async()=>{X.id;!1===le||Te("\u26a0\ufe0f Before proceeding, confirm that all required documents have been uploaded. Clicking forward will impact your credit balance, and this action cannot be undone.")},[Mt,$t]=(0,s.useState)(0),[Rt,Ft]=(0,s.useState)(!1),[qt,Ut]=(0,s.useState)("Generate Executive Summary"),[Bt,Ot]=(0,s.useState)(""),[Wt,Ht]=(0,s.useState)(null);(0,s.useEffect)((()=>{}),[]);const[Jt,Vt]=(0,s.useState)(!1);return(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)("main",{children:(0,f.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,f.jsx)(me.A,{}),(0,f.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,f.jsx)(n.A,{}),(0,f.jsxs)("section",{className:"px-md-3 py-4",children:[Bt&&(0,f.jsx)("p",{className:ae?" mt-3 error_pop":"success_pop mt-3",children:Bt}),Ie&&(0,f.jsx)(k.A,{message:Ie,onConfirm:async()=>{let e={id:it,company_id:X.companies[0].id};try{const t=await m.A.post(te+"UserDocDeleteFile",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});_e(),nt(null),Le("");const a=t.data.message;Ot(a),se(!0),setTimeout((()=>{se(!1),Ot("")}),1e3)}catch(ae){}},onCancel:()=>{Le("")}}),Ee&&(0,f.jsx)(k.A,{message:Ee,onConfirm:async()=>{Te(""),It(!0)},onCancel:()=>{Te("")}}),a&&(0,f.jsx)(k.A,{message:a,onConfirm:async()=>{let t={company_id:X.companies[0].id,lockId:e};try{await m.A.post(te+"filelock",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});$("Documents locked successfully"),setTimeout((()=>{_e(),c(""),$(""),Ae()}),1200)}catch(ae){}},onCancel:()=>{c("")}}),h&&(0,f.jsx)(k.A,{message:h,onConfirm:async()=>{let e={user_id:X.id};try{const t=await m.A.post(te+"allfileslock",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});$(t.data.message),"1"===t.data.status?y(!1):y(!0),setTimeout((()=>{y(!1),x(""),_e(),$("")}),1200)}catch(ae){}},onCancel:()=>{x("")}}),De&&(0,f.jsx)(C.A,{message:De,onClose:()=>{Pe("")}}),_&&(0,f.jsx)("p",{className:g?" mt-3 error_pop":"success_pop mt-3",children:_}),(0,f.jsx)("div",{className:"container-fluid",children:(0,f.jsx)("div",{className:"row gy-4",children:(0,f.jsx)("div",{className:"col-md-12 order-1 order-md-0",children:(0,f.jsx)(r.$K,{className:"d-block p-md-4 p-3",children:(0,f.jsx)("div",{className:"container-fluid",children:(0,f.jsxs)(l.zP,{className:"d-flex flex-column gap-4",children:[(0,f.jsx)("div",{className:"pb-3 bar_design",children:(0,f.jsx)("h4",{className:"h5 mb-0",children:"Dataroom Management & Executive Summary"})}),(0,f.jsxs)("div",{className:"titleroom d-flex m-0 flex-wrap gap-3 justify-content-between align-items-center text-center",children:[(0,f.jsxs)("button",{type:"button",disabled:G,style:{opacity:G?.6:1},onClick:Yt,className:"generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2",children:[(0,f.jsx)("span",{style:{opacity:le?1:.6},children:qt}),G&&(0,f.jsx)("div",{className:"spinner-color spinner-border spinneronetimepay m-0",role:"status",children:(0,f.jsx)("span",{className:"visually-hidden"})})]}),"owner"!==X.role&&(0,f.jsx)(Y.N_,{to:"/authorized-signature",className:"generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2",children:(0,f.jsx)("span",{children:"Yes"===(null===je||void 0===je?void 0:je.approve)?"Approved Signature":"Signature to Approval"})})]}),(0,f.jsxs)("div",{className:"table-responsive d-flex flex-column gap-3",children:[H.map((e=>{e.category_id,e.category_id,e.category_id;return(0,f.jsx)("div",{className:"overflow-auto",children:(0,f.jsxs)("table",{className:"table document_table",children:[(0,f.jsx)("thead",{children:(0,f.jsxs)("tr",{children:[(0,f.jsxs)(l.A0,{children:[e.name," ",e.category_tips&&(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)("span",{className:"tooltip-icon","data-tooltip-id":`tt-cat-${e.id}`,"data-tooltip-html":e.category_tips,children:(0,f.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,f.jsx)(o.m_,{id:`tt-cat-${e.id}`,place:"top",float:!0,interactive:!0,className:"custom-tooltip",positionStrategy:"fixed"})]})]}),(0,f.jsx)(l.A0,{children:"Upload Documents"}),(0,f.jsxs)(l.A0,{children:["Manage Documents",e.do_not_exits&&(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)("span",{className:"tooltip-icon","data-tooltip-id":`tt-doc-${e.id}`,"data-tooltip-html":e.do_not_exits,children:(0,f.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,f.jsx)(o.m_,{id:`tt-doc-${e.id}`,place:"top",float:!0,interactive:!0,className:"custom-tooltip",positionStrategy:"fixed"})]})]}),(0,f.jsxs)(l.A0,{children:["Exists but NOT Available",e.exits_tips&&(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)("span",{className:"tooltip-icon","data-tooltip-id":`tt-exit-${e.id}`,"data-tooltip-html":e.exits_tips,children:(0,f.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,f.jsx)(o.m_,{id:`tt-exit-${e.id}`,place:"top",float:!0,interactive:!0,className:"custom-tooltip",positionStrategy:"fixed"})]})]}),(0,f.jsx)(l.A0,{children:"Provided"})]})}),e.subcategories&&e.subcategories.length>0?(0,f.jsx)("tbody",{children:e.subcategories.map(((t,a)=>{e.id,t.id,e.id,t.id;return(0,f.jsxs)("tr",{children:[(0,f.jsx)(l.l$,{children:(0,f.jsxs)("h6",{children:[t.name,t.tips&&(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)("span",{"data-tooltip-id":`tooltipSub-${e.id}-${t.id}`,"data-tooltip-html":t.tips,className:"tooltip-icon",children:(0,f.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip"})}),(0,f.jsx)(o.m_,{id:`tooltipSub-${e.id}-${t.id}`,place:"top",float:!0,interactive:!0,className:"custom-tooltip",positionStrategy:"fixed"})]})]})}),(0,f.jsx)(l.l$,{children:(0,f.jsx)(l.s5,{type:"button",onClick:()=>{"Yes"!==t.Ai_generate?at(e.id,t.id):"Yes"===t.lockStatus&&(async()=>{let e={user_id:X.id};try{!0===(await m.A.post(te+"lockFileCheckSubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.allowEdit&&B(!0)}catch(ae){}})(e.id,t.id)},children:t.documents.length>0?(0,f.jsx)("span",{children:"Yes"===t.Ai_generate?(0,f.jsx)(f.Fragment,{children:(t.lockStatus,(0,f.jsxs)(f.Fragment,{children:["Lock"," ",(0,f.jsx)(N.A,{size:16,className:"text-white",title:"Locked"})]}))}):(0,f.jsxs)(f.Fragment,{children:["Add ",(0,f.jsx)(S.OiG,{})]})}):(0,f.jsx)("span",{style:{whiteSpace:"nowrap"},className:"d-block",children:"Click to upload"})})}),(0,f.jsx)(l.l$,{children:t.documents&&t.documents.length>0?(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)(l.s5,{type:"button",onClick:()=>ft(e.id,t.id),children:ct===`${e.id}-${t.id}`?"Hide Documents":"View Documents"}),ct===`${e.id}-${t.id}`&&(0,f.jsx)("div",{className:"main_popup-overlay",children:(0,f.jsx)("div",{className:"popupDataRoom",children:(0,f.jsxs)("div",{className:"uploadFilescroll position-relative",children:[(0,f.jsxs)("div",{className:"d-flex mb-2 pop_bg justify-content-between align-items-center p-2",children:[(0,f.jsx)("h4",{className:"docName",children:t.name}),(0,f.jsx)("div",{className:"d-flex gap-2 align-items-center",children:(0,f.jsx)("button",{type:"button",className:"bg-transparent text-white p-1 border-0",onClick:()=>ft(e.id,t.id),children:(0,f.jsx)(i.LwM,{size:24})})})]}),(0,f.jsx)("ol",{className:"text-start text-capitalize px-3 pdflist",children:t.documents.map(((a,s)=>(0,f.jsx)("li",{children:(0,f.jsxs)("span",{className:"d-flex justify-content-between align-items-center",children:[(0,f.jsxs)("span",{className:"d-flex align-items-center gap-2",children:[s+1,".",(0,f.jsx)(f.Fragment,{children:"Yes"===a.locked?(0,f.jsx)(N.A,{size:14,style:{color:"var(--primary)"},title:"Locked"}):(0,f.jsx)(z,{size:14,className:"text-success",title:"Unlocked"})}),a.name]}),(0,f.jsxs)("div",{className:"d-inline ",children:[(0,f.jsx)("button",{title:"More actions",className:"btn btn-link p-0 text-dark",type:"button",onClick:()=>{return e=a.id,ot(e),void nt((t=>t===e?null:e));var e},children:(0,f.jsx)(I.A,{width:16,height:16})}),st===a.id&&(0,f.jsxs)("div",{style:{position:"absolute",width:"100px",backgroundColor:"#fff",boxShadow:"0 2px 5px rgba(0,0,0,0.2)",padding:"2px",zIndex:997,right:0},children:[(0,f.jsxs)("button",{type:"button",title:"Download",className:"editdelete-links",onClick:()=>(async(e,t,a,s)=>{try{const t=await m.A.post(te+"filedownload",{company_id:e,folderName:s,filename:a},{responseType:"blob"}),n=new Blob([t.data]),i=window.URL.createObjectURL(n),o=document.createElement("a");o.href=i,o.download=a,document.body.appendChild(o),o.click(),o.remove(),window.URL.revokeObjectURL(i)}catch(ae){alert("Download failed"),console.error(ae)}})(a.company_id,a.id,a.name,a.folder_name),children:[(0,f.jsx)(L.A,{className:"me-1",width:12,height:10}),"Download"]}),(0,f.jsxs)("button",{type:"button",title:"Yes"===a.Ai_generate?"Yes":"No",className:"editdelete-links",children:[(0,f.jsx)(E,{className:"me-1 text-white",width:12,height:10}),"Yes"===a.Ai_generate?"AI Yes":"AI No"]}),"No"===a.Ai_generate&&(0,f.jsxs)("button",{onClick:()=>(async(e,t)=>{let a={company_id:X.companies[0].id,id:t};try{const e=await m.A.post(te+"fileslockorUnlock",a,{headers:{Accept:"application/json","Content-Type":"application/json"}});$(e.data.message),setTimeout((()=>{_e(),$("")}),1200)}catch(ae){}})(a.company_id,a.document_id,a.locked,a.Ai_generate),type:"button",title:"Yes"===a.locked?"Unlock":"Lock",className:"editdelete-links",children:["Yes"===a.locked?(0,f.jsx)(z,{className:"me-1 text-white",width:12,height:10}):(0,f.jsx)(N.A,{className:"me-1 text-white",width:12,height:10}),"Yes"===a.locked?"Unlock":"Lock"]}),(0,f.jsxs)("button",{type:"button",title:"Edit",className:"editdelete-links",style:{opacity:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?.6:1,pointerEvents:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?"none":"auto"},onClick:()=>(async(e,t,a,s,n,i)=>{if(console.log(a,i),ht(t),gt(e),"Yes"===i&&"Yes"===a&&"Yes"===n){let e={user_id:X.id};try{if(!0===(await m.A.post(te+"lockFileCheckSubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.allowEdit)B(!0);else{let e={cat_id:s};try{const t=(await m.A.post(te+"getcategoryname",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;Ze(s),W(!0),t.length>0?tt(t[0].name):tt("Others")}catch(ae){}}}catch(ae){}}else{let e={cat_id:s};try{const t=(await m.A.post(te+"getcategoryname",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;Ze(s),W(!0),t.length>0?tt(t[0].name):tt("Others")}catch(ae){}}})(a.id,a.name,a.lockStatus,e.id,a.locked,a.Ai_generate),children:[(0,f.jsx)(T,{className:"me-1 text-white",width:10,height:10}),"Yes"===a.Ai_generate?"Replace":"Edit"]}),"Yes"===a.Ai_generate&&(0,f.jsxs)("button",{type:"button",title:"Add",className:"editdelete-links",onClick:()=>at(e.id,t.id,"1"),style:{opacity:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?.6:1,pointerEvents:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?"none":"auto"},children:[(0,f.jsx)(S.OiG,{className:"me-1",width:10,height:10}),"Add"]}),(0,f.jsxs)("button",{type:"button",title:"Delete",className:"editdelete-links",style:{opacity:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?.6:1,pointerEvents:"Yes"===a.Ai_generate&&"Yes"===t.lockStatus?"none":"auto"},onClick:()=>(async(e,t,a,s)=>{if("Yes"===t&&"Yes"===a&&"Yes"===s){let t={company_id:X.companies[0].id,docId:e};try{const e=await m.A.post(te+"lockFileCheckSubscription",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(e.data)}catch(ae){}}else Le("Are you sure? You want to delete this file")})(a.id,a.locked,a.Ai_generate,a.lockStatus),children:[(0,f.jsx)(D.A,{className:"me-1",width:10,height:10}),"Delete"]})]})]})]})},a.id)))}),(0,f.jsx)("button",{className:"btn btn-outline-dark",type:"button",onClick:()=>ft(e.id,t.id),children:(0,f.jsx)(A.QCr,{})})]})})})]}):(0,f.jsx)("span",{children:"N/A"})}),(0,f.jsx)(l.l$,{children:(0,f.jsx)("h5",{children:"--"})}),(0,f.jsx)(l.l$,{children:t.documents.length>0?(0,f.jsx)("p",{children:"Yes"}):(0,f.jsx)("span",{children:"--"})})]},t.id)}))}):(0,f.jsx)("tbody",{children:(0,f.jsx)("tr",{children:(0,f.jsx)(l.l$,{colSpan:5,children:(0,f.jsx)("p",{children:"No subcategories"})})})})]},e.id)})})),(0,f.jsx)("div",{className:"titleroom d-flex justify-content-between align-items-center text-center",children:(0,f.jsxs)("button",{type:"button",disabled:G,style:{opacity:G?.6:1},onClick:Yt,className:"generatebutton px-4 py-2 fn_size_sm btn btn-outline-dark active d-flex align-items-center gap-2",children:[(0,f.jsx)("span",{style:{opacity:le?1:.6},children:qt}),G&&(0,f.jsx)("div",{className:"spinner-color spinner-border spinneronetimepay m-0",role:"status",children:(0,f.jsx)("span",{className:"visually-hidden"})})]})})]})]})})})})})})]})]})]})}),R&&(0,f.jsx)(u.A,{onClose:()=>F(!1),catgeoryId:Ke,subcatgeoryId:Qe,CategorynameFile:et,refreshpage:yt,lockunlockId:()=>{if(Qe){t(Qe);c("To generate a diligence report, all documents in the data room must be locked.\nThis document is editable until the first diligence report is generated.\n\nI want to lock this document.")}}}),U&&(0,f.jsx)(j,{onClose:()=>B(!1)}),O&&(0,f.jsx)(b.A,{onClose:()=>W(!1),catgeoryId:Ke,subcatgeoryId:Qe,CategorynameFile:et,refreshpage:yt,Docname:ut,DeleteIdDocs:it,docId:xt}),jt&&(0,f.jsx)(w.A,{onClose:()=>bt(!1),catgeoryId:Ke,subcatgeoryId:Qe,CategorynameFile:et,refreshpageAi:Tt,Docname:ut,DeleteIdDocs:it,AIquestions:vt}),kt&&(0,f.jsx)(v.A,{onClose:()=>Ct(!1),AiUpdatesummaryID:St,refreshpageAi:Tt,AISummary:Nt}),Oe&&(0,f.jsx)(M.A,{show:Oe,onClose:()=>We(!1),payment:Ye.onetime_Fee,referstatus:Z}),Dt&&(0,f.jsx)(pe,{show:Dt,onClose:()=>Pt(!1),payment:Ye.perInstance_Fee,usersubscriptiondataroomone_time_id:oe}),(0,f.jsx)(xe,{show:zt,onClose:()=>It(!1),onConfirm:async()=>{let e={company_id:X.companies[0].id};Te("");try{const s=await m.A.post(te+"checkuserSubscriptionThreeMonth",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(s.data.results.length>0){var t=s.data.results;let e={company_id:X.companies[0].id,created_by_role:X.role,created_by_id:X.id,payid:t[0].id};re(t[0].id);try{if((await m.A.post(te+"perInstancePayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.allowGeneration){Ut("Please don't refresh the page"),$t(0),Ft(!0);const t=setInterval((()=>{$t((e=>e>=95?e:Math.min(e+10*Math.random(),95)))}),500);Te(""),K(!0),Q(!0);try{var a=(await m.A.post(te+"generateProcessAI",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;"2"===a.status?(K(!1),Ft(!1),y(!0),$(a.message),Ut("Generate Executive Summary"),setTimeout((()=>{y(!1),$("")}),1200)):(clearInterval(t),$t(100),K(!1),setTimeout((()=>{Ft(!1),Ne("/approvalpage/"+a.code)}),500))}catch(ae){console.error("Error generating summary",ae)}}else ie("Perinstance"),Q(!1),Pt(!0)}catch(ae){}}else We(!0),Ue(!0)}catch(ae){}},companyName:X.companies[0].id,isSubmitting:Lt})]})}},9855:(e,t,a)=>{a.d(t,{A:()=>s});const s=(0,a(77784).A)("trash-2",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]])},65727:(e,t,a)=>{a.d(t,{A:()=>s});const s=(0,a(77784).A)("lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]])}}]);
//# sourceMappingURL=6914.f1c022aa.chunk.js.map