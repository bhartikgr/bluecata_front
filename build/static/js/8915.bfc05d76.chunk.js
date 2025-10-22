/*! For license information please see 8915.bfc05d76.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[8915],{11508:(e,n,t)=>{t.d(n,{A:()=>c});var a=t(65043),i=t(86213),r=t(26022),s=t(45394),o=t(63393),l=t(45286),d=t(70579);const c=e=>{let{paytmmodule:n,show:t,onClose:c}=e;var p="https://blueprintcatalyst.com/api/user/aifile/";const m=localStorage.getItem("SignatoryLoginData"),x=JSON.parse(m),u=()=>{(0,a.useEffect)((()=>{t(n)}),[n]);const[e,t]=(0,a.useState)(n),[s,l]=(0,a.useState)(""),c=(0,o.useStripe)(),m=(0,o.useElements)(),[u,h]=(0,a.useState)(""),[f,g]=(0,a.useState)(!1),[b,y]=(0,a.useState)(""),[v,j]=(0,a.useState)(!1),[w,k]=(0,a.useState)(""),[N,z]=(0,a.useState)(""),[_,S]=(0,a.useState)("");(0,a.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),n=await e.json();z(n.ip)}catch(e){console.error("Failed to fetch IP",e)}})()}),[]);const C=async e=>{try{await i.A.post(`${p}CreateuserSubscription_Academy`,e,{headers:{Accept:"application/json","Content-Type":"application/json"}}),y("Payment successful! \ud83c\udf89"),j(!1),setTimeout((()=>{window.location.reload()}),2e3)}catch(v){console.error("Success handler error:",v),y("Payment was captured, but post-process failed."),j(!0)}finally{g(!1)}};return(0,d.jsxs)("form",{onSubmit:async n=>{if(n.preventDefault(),!c||!m)return;const t=m.getElement(o.CardElement);if(!t)return y("Payment form is not ready. Please reload the page."),void j(!0);const{error:a}=await c.createPaymentMethod({type:"card",card:t});if(a)return y(a.message||"Invalid card details."),void j(!0);g(!0);try{console.log();const{data:n}=await i.A.post(`${p}CreateuserSubscription_AcademyCheck`,{amount:e}),a=await c.confirmCardPayment(n.clientSecret,{payment_method:{card:t}});if(a.error)y(a.error.message),j(!0),g(!1);else if("succeeded"===a.paymentIntent.status){const t={code:"",company_id:x.companies[0].id,amount:e,created_by_id:x.id,clientSecret:n.clientSecret,payment_status:a.paymentIntent.status,discount:"",ip_address:N};console.log(a.paymentIntent,n.clientSecret),await C(t)}else y("Payment failed. Try again."),j(!0),g(!1)}catch(r){console.log(r),y("Unexpected error occurred."),j(!0),g(!1)}},method:"post",children:[(0,d.jsx)("div",{className:"form-control rounded-3",style:{padding:"0.75rem",border:"1px solid #000",borderColor:"#ced4da"},children:(0,d.jsx)(o.CardElement,{options:{style:{base:{fontSize:"16px",color:"#32325d",fontFamily:'"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',"::placeholder":{color:"#a0aec0"},padding:"0.75rem"},invalid:{color:"#e5424d"}},classes:{base:"stripe-card-element",focus:"border-primary",invalid:"border-danger"}}})}),s&&(0,d.jsxs)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:[(0,d.jsx)("b",{children:"Discount:"})," ",s,"%"]}),(0,d.jsx)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:(0,d.jsxs)(r.$n,{disabled:!c||f,type:"submit",className:"submit d-flex align-items-center gap-2",style:{background:"#003b21"},children:[!f&&(0,d.jsxs)("span",{children:["Pay \u20ac",e]}),f&&(0,d.jsx)("div",{className:"spinner-border text-white spinneronetimepay m-0",role:"status",children:(0,d.jsx)("span",{className:"visually-hidden"})})]})}),b&&(0,d.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(v?"error_pop":"success_pop"),children:[(0,d.jsx)("div",{className:"d-flex align-items-start gap-2",children:(0,d.jsx)("span",{className:"d-block",children:b})}),(0,d.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>y(""),children:"\xd7"})]})]})},[h,f]=(0,a.useState)(!1);return t?(0,d.jsx)(d.Fragment,{children:(0,d.jsx)("div",{className:"payment_modal-overlay",onClick:c,children:(0,d.jsxs)("div",{className:"modal-container scroll_bar",onClick:e=>e.stopPropagation(),children:[(0,d.jsxs)("div",{className:"modal-header",children:[(0,d.jsxs)("div",{className:"modal-title-section",children:[(0,d.jsx)("h5",{className:"modal-title",children:"Payment"}),(0,d.jsxs)("div",{className:"price-tag",children:["Fee: \u20ac",n]})]}),(0,d.jsx)("button",{type:"button",className:"close_btn_global",onClick:c,"aria-label":"Close",children:(0,d.jsx)(s.LwM,{size:24})})]}),(0,d.jsx)("div",{className:"payment-info",children:(0,d.jsx)("div",{className:"benefits-list",children:(0,d.jsxs)("div",{className:"benefit-item",children:[(0,d.jsx)("div",{className:"benefit-icon",children:(0,d.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,d.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,d.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,d.jsx)("div",{className:"benefit-text",children:"Launch your startup the smart way: join live investor meetings, master your pitch, and raise capital. Get access for 3 team members and set up your company for success from day one."})]})})}),(0,d.jsxs)("div",{className:"payment-methods",children:[(0,d.jsxs)("div",{className:"accepted-cards",children:[(0,d.jsx)("span",{className:"accepted-text",children:"We accept:"}),(0,d.jsx)("div",{className:"card-icons",children:(0,d.jsx)("div",{className:"text-center mb-4",children:(0,d.jsx)("img",{src:"/assets/user/images/cardimage.jpg",alt:"cards",className:"img-fluid rounded",style:{maxWidth:"200px"}})})})]}),(0,d.jsx)("div",{className:"stripe-form-container",children:(0,d.jsx)(o.Elements,{stripe:l.A,children:(0,d.jsx)(u,{})})})]})]})})}):null}},25015:()=>{},28915:(e,n,t)=>{t.r(n),t.d(n,{default:()=>m});var a=t(65043),i=(t(25015),t(94060)),r=(t(38421),t(36210)),s=t(62837),o=(t(83656),t(44710)),l=t(86213),d=(t(45286),t(63393),t(26022),t(11508)),c=t(94298),p=t(70579);function m(){document.title="Pricing Plan";const[e,n]=(0,a.useState)(!1),t="https://blueprintcatalyst.com/api/user/aifile/",m=localStorage.getItem("SignatoryLoginData"),x=JSON.parse(m),[u,h]=(0,a.useState)(!1),[f,g]=(0,a.useState)(!1),[b,y]=(0,a.useState)(!1),[v,j]=(0,a.useState)(""),[w,k]=(0,a.useState)("Onetime"),[N,z]=(0,a.useState)(""),[_,S]=(0,a.useState)(!1),[C,A]=(0,a.useState)(!0);(0,a.useEffect)((()=>{E()}),[u]);const E=async()=>{try{const e=await l.A.post(t+"checkuserSubscriptionThreeMonth",{company_id:x.companies[0].id});e.data.results.length>0?h(!0):h(!1)}catch(e){console.error("Error fetching subscription plans:",e)}};(0,a.useEffect)((()=>{P()}),[]);const P=async()=>{let e={company_id:x.companies[0].id};try{const n=await l.A.post("https://blueprintcatalyst.com/api/user/checkmodulesubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(n.data.results),n.data.results.length>0?g(!0):g(!1)}catch(n){}};(0,a.useEffect)((()=>{I()}),[]);const I=async()=>{let e={user_id:""};try{var n=(await l.A.post("https://blueprintcatalyst.com/api/admin/module/getDataroompayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;z(n[0])}catch(t){t.response||(t.request?console.error("Request data:",t.request):console.error("Error message:",t.message))}};return(0,p.jsxs)(p.Fragment,{children:[(0,p.jsx)(s.mO,{children:(0,p.jsx)("div",{className:"fullpage d-block",children:(0,p.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,p.jsx)(o.A,{isCollapsed:e,setIsCollapsed:n}),(0,p.jsxs)("div",{className:"global_view "+(e?"global_view_col":""),children:[(0,p.jsx)(i.A,{}),(0,p.jsx)(s.$K,{className:"d-block p-md-4 p-3",children:(0,p.jsxs)("div",{className:"container-fluid",children:[(0,p.jsx)("div",{className:"subscription-header",children:(0,p.jsxs)("div",{className:"subscription-title",children:[(0,p.jsx)("h1",{children:"Your Package Subscriptions"}),(0,p.jsx)("p",{children:"Manage your active plans and services"})]})}),(0,p.jsxs)("div",{className:"row gy-5 py-3",children:[(0,p.jsx)("div",{className:"col-md-4",children:(0,p.jsxs)("div",{className:"package_card",children:[(0,p.jsxs)("div",{className:"d-flex flex-column gap-0",children:[(0,p.jsxs)("div",{className:"d-flex flex-column gap-2 card_top",children:[(0,p.jsx)("h3",{children:"Investor Ops"}),(0,p.jsxs)("ul",{className:"d-flex flex-column gap-1",children:[(0,p.jsxs)("li",{children:["\u20ac",null===N||void 0===N?void 0:N.onetime_Fee," Euro annual."]}),(0,p.jsx)("li",{children:"Unlimited stakeholders"}),(0,p.jsx)("li",{children:"Start unlimited investment rounds"}),(0,p.jsx)("li",{children:"Unlimited investor reports"}),(0,p.jsx)("li",{children:"Facilitate the close of rounds"})]})]}),(0,p.jsxs)("div",{className:"inner_card d-flex flex-column gap-2",children:[(0,p.jsx)("span",{className:"mainp text-white",children:"Includes :"}),(0,p.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,p.jsx)("h4",{children:"Dataroom Management"}),(0,p.jsxs)("div",{className:"d-flex flex-column gap-1",children:[(0,p.jsxs)("div",{className:"d-flex align-items-start gap-1",children:[(0,p.jsx)(r.A,{width:18,className:"text-white flex-shrink-0"}),(0,p.jsx)("p",{children:"Centralize key investor documents and streamline your due diligence prep."})]}),(0,p.jsxs)("div",{className:"d-flex align-items-start gap-1",children:[(0,p.jsx)(r.A,{width:18,className:"text-white flex-shrink-0"}),(0,p.jsxs)("p",{children:["Receive one free executive summary to share with investors; additional copies cost \u20ac",null===N||void 0===N?void 0:N.perInstance_Fee,"each."]})]})]})]}),(0,p.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,p.jsx)("h4",{children:"Cap Table Management :"}),(0,p.jsx)("div",{className:"d-flex flex-column gap-1",children:(0,p.jsxs)("div",{className:"d-flex align-items-start gap-1",children:[(0,p.jsx)(r.A,{width:18,className:"text-white flex-shrink-0"}),(0,p.jsx)("p",{children:"Know who owns what in your company."})]})})]}),(0,p.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,p.jsx)("h4",{children:"Investor Reporting Module :"}),(0,p.jsx)("div",{className:"d-flex flex-column gap-1",children:(0,p.jsxs)("div",{className:"d-flex align-items-start gap-1",children:[(0,p.jsx)(r.A,{width:18,className:"text-white flex-shrink-0"}),(0,p.jsx)("p",{children:"Ensure that you connect with your investors with updates. No more \u2018out of sight, out of mind\u2019!."})]})})]}),(0,p.jsx)("div",{className:"mt-3",children:u?(0,p.jsx)("button",{className:"activate_btn border-0 active_sb",type:"button",children:"Active"}):(0,p.jsx)("button",{className:"activate_btn border-0",type:"button",onClick:()=>{S(!0)},children:"Pay Now"})})]})]}),(0,p.jsx)("div",{className:"card_reco",children:(0,p.jsx)("p",{children:"Recommended"})})]})}),(0,p.jsx)("div",{className:"col-md-4",children:(0,p.jsxs)("div",{className:"package_card h-100",children:[(0,p.jsxs)("div",{className:"d-flex flex-column gap-0 h-100",children:[(0,p.jsxs)("div",{className:"d-flex flex-column gap-2 card_top",children:[(0,p.jsx)("h3",{children:"Learn To Raise"}),(0,p.jsxs)("ul",{className:"d-flex flex-column gap-1",children:[(0,p.jsxs)("li",{children:["\u20ac",null===N||void 0===N?void 0:N.academy_Fee," Euro (one-time)."]}),(0,p.jsx)("li",{children:"Join live investor meetings"}),(0,p.jsx)("li",{children:"Learn to pitch and raise capital"}),(0,p.jsx)("li",{children:"Access for 3 team members"}),(0,p.jsx)("li",{children:"Set up your company the right way"})]})]}),(0,p.jsxs)("div",{className:"inner_card d-flex flex-column gap-2 h-100",children:[(0,p.jsx)("span",{className:"mainp text-white",children:"Includes :"}),(0,p.jsxs)("div",{className:"d-flex flex-column justify-content-between h-100",children:[(0,p.jsx)("div",{className:"d-flex flex-column gap-2",children:(0,p.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,p.jsx)("div",{className:"d-flex align-items-start gap-1",children:(0,p.jsx)("p",{children:"Launch your startup the smart way: join live investor meetings, master your pitch, and raise capital. Get access for 3 team members and set up your company for success from day one."})}),(0,p.jsx)("div",{className:"d-flex align-items-start gap-1",children:(0,p.jsx)("p",{children:"Launch your startup the smart way: join live investor meetings, master your pitch, and raise capital. Get access for 3 team members and set up your company for success from day one."})})]})}),(0,p.jsx)("div",{className:"mt-3",children:f?(0,p.jsx)("button",{className:"activate_btn border-0 active_sb",type:"button",children:"Active"}):(0,p.jsx)("button",{className:"activate_btn border-0",type:"button",children:"Pay Now"})})]})]})]}),(0,p.jsx)("div",{className:"card_reco",children:(0,p.jsx)("p",{children:"Optional"})})]})})]})]})})]})]})})}),_&&(0,p.jsx)(c.A,{show:_,onClose:()=>S(!1),payment:N.onetime_Fee,referstatus:!0}),(0,p.jsx)(d.A,{paytmmodule:N.academy_Fee,show:b,onClose:()=>y(!1)}),(0,p.jsx)("style",{jsx:!0,children:"\n        .subscription-header {\n          display: flex;\n          justify-content: space-between;\n          align-items: flex-end;\n          margin-bottom: 2rem;\n          padding-bottom: 1rem;\n          border-bottom: 1px solid #e5e7eb;\n        }\n\n        .subscription-title h1 {\n          font-size: 2rem;\n          font-weight: 700;\n          color: #0a0a0a;\n          margin: 0 0 0.5rem 0;\n        }\n\n        .subscription-title p {\n          color: #6b7280;\n          margin: 0;\n          font-size: 1.1rem;\n        }\n\n        .subscription-count {\n          background: #f8fafc;\n          padding: 0.5rem 1rem;\n          border-radius: 20px;\n          font-size: 0.9rem;\n          color: #6b7280;\n        }\n\n        .empty-state {\n          text-align: center;\n          padding: 4rem 2rem;\n          background: #f8fafc;\n          border-radius: 12px;\n          margin: 2rem 0;\n        }\n\n        .empty-icon {\n          color: #9ca3af;\n          margin-bottom: 1.5rem;\n        }\n\n        .empty-state h3 {\n          font-size: 1.5rem;\n          color: #374151;\n          margin: 0 0 1rem 0;\n        }\n\n        .empty-state p {\n          color: #6b7280;\n          margin: 0;\n        }\n\n        .subscription-grid {\n          display: grid;\n          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));\n          gap: 1.5rem;\n          margin-top: 2rem;\n        }\n\n        .subscription-card {\n          background: #fff;\n          border-radius: 16px;\n          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);\n          overflow: hidden;\n          transition: all 0.3s ease;\n          border: 1px solid #f1f5f9;\n        }\n\n        .subscription-card:hover {\n          transform: translateY(-4px);\n          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);\n        }\n\n        .card-header {\n          display: flex;\n          justify-content: space-between;\n          align-items: flex-start;\n          padding: 1.5rem;\n          background: linear-gradient(135deg, #efefef 0%, #efefef 100%);\n          border-bottom: 1px solid #e5e7eb;\n        }\n\n        .card-title-section {\n          display: flex;\n          align-items: center;\n          gap: 0.75rem;\n        }\n\n        .card-icon {\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          width: 48px;\n          height: 48px;\n          border-radius: 12px;\n          background: linear-gradient(\n            135deg,\n            var(--primary) 0%,\n            var(--primary-icon) 100%\n          );\n          color: white;\n          flex-shrink: 0;\n        }\n\n        .card-header h3 {\n          font-size: 1.25rem;\n          font-weight: 600;\n          color: #0a0a0a;\n          margin: 0;\n        }\n\n        .status-badge {\n          padding: 0.25rem 0.75rem;\n          border-radius: 20px;\n          font-size: 0.75rem;\n          font-weight: 600;\n        }\n\n        .status-active {\n          background: #ecfdf5;\n          color: #065f46;\n        }\n\n        .status-inactive {\n          background: #fef2f2;\n          color: #991b1b;\n        }\n\n        .card-body {\n          padding: 1.5rem;\n        }\n\n        .price-section {\n          display: flex;\n          align-items: baseline;\n          gap: 0.25rem;\n          margin-bottom: 1.5rem;\n        }\n\n        .price {\n          font-size: 1.75rem;\n          font-weight: 700;\n          color: #0a0a0a;\n        }\n\n        .period {\n          color: #6b7280;\n          font-size: 0.9rem;\n        }\n\n        .details-grid {\n          display: flex;\n          flex-direction: column;\n          gap: 0.75rem;\n          margin-bottom: 1.5rem;\n        }\n\n        .detail-item {\n          display: flex;\n          align-items: center;\n          gap: 0.5rem;\n          color: #6b7280;\n          font-size: 0.9rem;\n        }\n\n        .detail-item svg {\n          flex-shrink: 0;\n        }\n\n        .features-section h4 {\n          font-size: 1rem;\n          font-weight: 600;\n          color: #374151;\n          margin: 0 0 1rem 0;\n        }\n\n        .features-list {\n          list-style: none;\n          padding: 0;\n          margin: 0;\n          display: flex;\n          flex-direction: column;\n          gap: 0.5rem;\n        }\n\n        .features-list li {\n          display: flex;\n          align-items: center;\n          gap: 0.5rem;\n          font-size: 0.9rem;\n          color: #4b5563;\n        }\n\n        .features-list li svg {\n          color: #10b981;\n          flex-shrink: 0;\n        }\n\n        @media (max-width: 768px) {\n          .subscription-header {\n            flex-direction: column;\n            align-items: flex-start;\n            gap: 1rem;\n          }\n\n          .subscription-title h1 {\n            font-size: 1.75rem;\n          }\n\n          .subscription-grid {\n            grid-template-columns: 1fr;\n          }\n\n          .card-header {\n            flex-direction: column;\n            align-items: flex-start;\n            gap: 1rem;\n          }\n        }\n      "})]})}},36210:(e,n,t)=>{t.d(n,{A:()=>a});const a=(0,t(77784).A)("check",[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]])},62837:(e,n,t)=>{t.d(n,{$K:()=>s,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>x,R3:()=>j,Zw:()=>m,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>i,mg:()=>o,nj:()=>y,pd:()=>v,uM:()=>u,vE:()=>r,z6:()=>p});var a=t(5464);const i=a.default.div`
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
`,r=a.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,s=(a.default.div`
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
  background: var(--primary);
  border-bottom: 10px solid var(--secondary-color);
  .logo {
    display: inline-block;
    width: 140px;
    img {
      width: 100%;
    }
  }
`,a.default.div`
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
`,a.default.div`
  display: block;
  height: 100%;
`),o=a.default.div`
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
`,l=a.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=a.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=a.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=a.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,m=a.default.div`
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
`,x=(a.default.div`
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
    left: 12px;
    width: 16px; /* smaller width */
    height: 16px; /* smaller height */
    stroke: var(--primary-icon);
    stroke-width: 1.2;
  }
`),u=(a.default.div`
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
`),h=(a.default.div`
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
`),f=((0,a.default)(h)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(h)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,a.default.sup`
  color: var(--primary);
`),g=a.default.div`
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
  border-radius: 10px;
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
  font-size: 0.9rem;
`,j=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},83656:()=>{}}]);
//# sourceMappingURL=8915.bfc05d76.chunk.js.map