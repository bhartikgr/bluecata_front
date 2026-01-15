"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[9001],{11508:(e,t,s)=>{s.d(t,{A:()=>l});var r=s(65043),n=s(86213),a=s(26022),i=s(45394),o=s(63393),c=s(45286),d=s(70579);const l=e=>{let{paytmmodule:t,show:s,onClose:l}=e;var p="http://localhost:5000/api/user/aifile/";const u=localStorage.getItem("SignatoryLoginData"),m=JSON.parse(u),h=()=>{(0,r.useEffect)((()=>{s(t)}),[t]);const[e,s]=(0,r.useState)(t),[i,c]=(0,r.useState)(""),l=(0,o.useStripe)(),u=(0,o.useElements)(),[h,x]=(0,r.useState)(""),[f,v]=(0,r.useState)(!1),[j,g]=(0,r.useState)(""),[y,w]=(0,r.useState)(!1),[b,S]=(0,r.useState)(""),[N,C]=(0,r.useState)(""),[k,E]=(0,r.useState)("");(0,r.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),t=await e.json();C(t.ip)}catch(e){console.error("Failed to fetch IP",e)}})()}),[]);const _=async e=>{try{await n.A.post(`${p}CreateuserSubscription_Academy`,e,{headers:{Accept:"application/json","Content-Type":"application/json"}}),g("Payment successful! \ud83c\udf89"),w(!1),setTimeout((()=>{window.location.reload()}),2e3)}catch(y){console.error("Success handler error:",y),g("Payment was captured, but post-process failed."),w(!0)}finally{v(!1)}};return(0,d.jsxs)("form",{onSubmit:async t=>{if(t.preventDefault(),!l||!u)return;const s=u.getElement(o.CardElement);if(!s)return g("Payment form is not ready. Please reload the page."),void w(!0);const{error:r}=await l.createPaymentMethod({type:"card",card:s});if(r)return g(r.message||"Invalid card details."),void w(!0);v(!0);try{console.log();const{data:t}=await n.A.post(`${p}CreateuserSubscription_AcademyCheck`,{amount:e}),r=await l.confirmCardPayment(t.clientSecret,{payment_method:{card:s}});if(r.error)g(r.error.message),w(!0),v(!1);else if("succeeded"===r.paymentIntent.status){const s={code:"",company_id:m.companies[0].id,amount:e,created_by_id:m.id,clientSecret:t.clientSecret,payment_status:r.paymentIntent.status,discount:"",ip_address:N};console.log(r.paymentIntent,t.clientSecret),await _(s)}else g("Payment failed. Try again."),w(!0),v(!1)}catch(a){console.log(a),g("Unexpected error occurred."),w(!0),v(!1)}},method:"post",children:[(0,d.jsx)("div",{className:"form-control rounded-3",style:{padding:"0.75rem",border:"1px solid #000",borderColor:"#ced4da"},children:(0,d.jsx)(o.CardElement,{options:{style:{base:{fontSize:"16px",color:"#32325d",fontFamily:'"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',"::placeholder":{color:"#a0aec0"},padding:"0.75rem"},invalid:{color:"#e5424d"}},classes:{base:"stripe-card-element",focus:"border-primary",invalid:"border-danger"}}})}),i&&(0,d.jsxs)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:[(0,d.jsx)("b",{children:"Discount:"})," ",i,"%"]}),(0,d.jsx)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:(0,d.jsxs)(a.$n,{disabled:!l||f,type:"submit",className:"submit d-flex align-items-center gap-2",style:{background:"#003b21"},children:[!f&&(0,d.jsxs)("span",{children:["Pay \u20ac",e]}),f&&(0,d.jsx)("div",{className:"spinner-border text-white spinneronetimepay m-0",role:"status",children:(0,d.jsx)("span",{className:"visually-hidden"})})]})}),j&&(0,d.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(y?"error_pop":"success_pop"),children:[(0,d.jsx)("div",{className:"d-flex align-items-start gap-2",children:(0,d.jsx)("span",{className:"d-block",children:j})}),(0,d.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>g(""),children:"\xd7"})]})]})},[x,f]=(0,r.useState)(!1);return s?(0,d.jsx)(d.Fragment,{children:(0,d.jsx)("div",{className:"payment_modal-overlay",onClick:l,children:(0,d.jsxs)("div",{className:"modal-container scroll_bar",onClick:e=>e.stopPropagation(),children:[(0,d.jsxs)("div",{className:"modal-header",children:[(0,d.jsxs)("div",{className:"modal-title-section",children:[(0,d.jsx)("h5",{className:"modal-title",children:"Payment"}),(0,d.jsxs)("div",{className:"price-tag",children:["Fee: \u20ac",t]})]}),(0,d.jsx)("button",{type:"button",className:"close_btn_global",onClick:l,"aria-label":"Close",children:(0,d.jsx)(i.LwM,{size:24})})]}),(0,d.jsx)("div",{className:"payment-info",children:(0,d.jsx)("div",{className:"benefits-list",children:(0,d.jsxs)("div",{className:"benefit-item",children:[(0,d.jsx)("div",{className:"benefit-icon",children:(0,d.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,d.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,d.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,d.jsx)("div",{className:"benefit-text",children:"Launch your startup the smart way: join live investor meetings, master your pitch, and raise capital. Get access for 3 team members and set up your company for success from day one."})]})})}),(0,d.jsxs)("div",{className:"payment-methods",children:[(0,d.jsxs)("div",{className:"accepted-cards",children:[(0,d.jsx)("span",{className:"accepted-text",children:"We accept:"}),(0,d.jsx)("div",{className:"card-icons",children:(0,d.jsx)("div",{className:"text-center mb-4",children:(0,d.jsx)("img",{src:"/assets/user/images/cardimage.jpg",alt:"cards",className:"img-fluid rounded",style:{maxWidth:"200px"}})})})]}),(0,d.jsx)("div",{className:"stripe-form-container",children:(0,d.jsx)(o.Elements,{stripe:c.A,children:(0,d.jsx)(h,{})})})]})]})})}):null}},31541:(e,t,s)=>{s.d(t,{$K:()=>n,$m:()=>l,CB:()=>i,Jn:()=>p,Q1:()=>c,mH:()=>d,mS:()=>o,mg:()=>a});var r=s(5464);const n=r.default.div`
  display: block;
  padding: 3rem 0;
  background-color: #fff;
`,a=r.default.div`
  background: #fff;
  border-radius: 10px;
  padding: 40px 20px;
  box-shadow: 0px 0px 10px #dddddd;
  @media (max-width: 576px) {
    padding: 40px 15px;
  }
`,i=r.default.div`
  color: #c00000;
  font-size: 30px;
  text-align: center;
  text-transform: uppercase;
  font-weight: 600;
  text-decoration: underline;
  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,o=r.default.div`
  display: grid;
  gap: 1rem;
  padding: 0;
  grid-template-columns: repeat(4, 1fr);
  @media (max-width: 1200px) {
    grid-template-columns: repeat(3, 1fr);
  }
  @media (max-width: 992px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (max-width: 576px) {
    grid-template-columns: 1fr;
  }
`,c=r.default.div`
  cursor: pointer;

  video {
    width: 100%;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
`,d=r.default.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.8);
  display: ${e=>{let{open:t}=e;return t?"flex":"none"}};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`,l=r.default.div`
  position: relative;
  width: 80%;
  max-width: 800px;

  video {
    width: 100%;
    border-radius: 8px;
  }
`,p=r.default.button`
  position: absolute;
  top: -10px;
  right: -10px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: #fff;
  border: none;
  color: #000;
  font-size: 30px;
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
  aspect-ratio: 1;
  line-height: 0;
  padding-bottom: 5px;
`},39001:(e,t,s)=>{s.r(t),s.d(t,{default:()=>u});var r=s(65043),n=(s(65136),s(94060)),a=s(31541),i=s(26022),o=s(11508),c=s(44710),d=s(86213),l=s(25581),p=s(70579);function u(){const[e,t]=(0,r.useState)(!1),[s,u]=(0,r.useState)(!1),[m,h]=(0,r.useState)([]),[x,f]=(0,r.useState)(""),[v,j]=(0,r.useState)(null),g=(0,r.useRef)(),y=l.J+"api/upload/video",w=l.J+"api/user/",b=l.J+"api/admin/module/",S=localStorage.getItem("CompanyLoginData"),N=JSON.parse(S),[C,k]=(0,r.useState)(""),[E,_]=(0,r.useState)(!1),[L,P]=(0,r.useState)(""),[A,q]=(0,r.useState)("");(0,r.useEffect)((()=>{document.title="Investor Presentation Structure - Expert Advice Video"}),[]),(0,r.useEffect)((()=>{const e=e=>e.preventDefault();document.addEventListener("contextmenu",e);const t=e=>{("F12"===e.key||e.ctrlKey&&e.shiftKey&&"I"===e.key||e.ctrlKey&&"u"===e.key)&&e.preventDefault()};document.addEventListener("keydown",t);const s=setInterval((()=>{const e=window.outerWidth-window.innerWidth>160,t=window.outerHeight-window.innerHeight>160;(e||t)&&(u(!1),j(null))}),1e3);return()=>{document.removeEventListener("contextmenu",e),document.removeEventListener("keydown",t),clearInterval(s)}}),[]),(0,r.useEffect)((()=>{D()}),[]);const D=async()=>{let e={id:"",user_id:N.id};try{(await d.A.post(w+"checkmodulesubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length>0&&q("1")}catch(t){}};(0,r.useEffect)((()=>{I()}),[]);const I=async()=>{let e={user_id:""};try{var t=(await d.A.post(b+"getDataroompayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;P(t[0].academy_Fee)}catch(s){s.response||(s.request?console.error("Request data:",s.request):console.error("Error message:",s.message))}},$=async e=>{let s={user_id:N.id,video_id:e.id,limit:e.max_limit};try{var r=(await d.A.post(w+"videolimitsave",s,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;"2"===r.status?(j(null),t(!0),f(r.message),setTimeout((()=>{g.current&&(g.current.pause(),g.current.currentTime=0),f("")}),1800)):(f(""),u(!0),setTimeout((()=>{var e;null===(e=g.current)||void 0===e||e.play()}),100))}catch(n){n.response||(n.request?console.error("Request data:",n.request):console.error("Error message:",n.message))}},J=l.J+"api/admin/video/";(0,r.useEffect)((()=>{T()}),[]);const T=async()=>{let e={user_id:""};try{var t=(await d.A.post(J+"getvideolist",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results;h(t)}catch(s){s.response||(s.request?console.error("Request data:",s.request):console.error("Error message:",s.message))}},[M,F]=(0,r.useState)(!1),[z,U]=(0,r.useState)(!1);return(0,p.jsxs)(p.Fragment,{children:[(0,p.jsx)(i.mO,{children:(0,p.jsx)("div",{className:"fullpage d-block",children:(0,p.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,p.jsx)(c.A,{isCollapsed:z,setIsCollapsed:U}),(0,p.jsxs)("div",{className:"global_view "+(z?"global_view_col":""),children:[(0,p.jsx)(n.A,{}),(0,p.jsx)(a.$K,{className:"d-block p-md-4 p-3",children:(0,p.jsxs)("div",{className:"container-fluid",children:[x&&(0,p.jsx)("p",{className:e?" mt-3 error_pop":"success_pop mt-3",children:x}),(0,p.jsx)(a.mg,{children:(0,p.jsxs)("div",{className:"d-flex flex-column gap-5",children:[(0,p.jsx)(a.CB,{children:"investor presentation structure - expert advice videos"}),(0,p.jsx)(a.mS,{children:m.map(((e,t)=>{const s=e.video.replace(/\\/g,"/");return(0,p.jsx)(a.Q1,{onClick:()=>(e=>{if(""===A)return void _(!0);j(null),e.id;const t=e.video;j(`${y}/${t}`),$(e)})(e),children:(0,p.jsxs)("video",{muted:!0,onContextMenu:e=>e.preventDefault(),onError:e=>console.error("Error loading video:",e),children:[(0,p.jsx)("source",{src:`${y}/${s}`,type:"video/mp4"}),(0,p.jsx)("p",{children:"Your browser does not support the video tag or the video format."})]})},t)}))})]})})]})})]})]})})}),(0,p.jsx)(a.mH,{open:s,children:(0,p.jsxs)(a.$m,{children:[v&&(0,p.jsxs)("video",{ref:g,className:"advicevideo",controls:!0,autoPlay:!0,controlsList:"nodownload nofullscreen noremoteplayback",onContextMenu:e=>e.preventDefault(),style:{width:"100%"},children:[(0,p.jsx)("source",{src:v,type:"video/mp4"}),"Your browser does not support the video tag."]}),(0,p.jsx)(a.Jn,{onClick:()=>{u(!1),g.current&&(g.current.pause(),g.current.currentTime=0),j(null)},children:"\xd7"})]})}),(0,p.jsx)(i.mO,{children:M&&(0,p.jsx)(i.hJ,{children:(0,p.jsxs)(i.zD,{children:[(0,p.jsx)(i.nj,{onClick:()=>F(!1),children:"\xd7"}),(0,p.jsx)(i.rL,{className:"pb-2",children:"Payment Details"}),(0,p.jsx)(i.V7,{children:(0,p.jsx)(i.MH,{src:"/assets/user/images/cardimage.jpg",alt:"cards"})}),(0,p.jsxs)(i.lV,{onSubmit:e=>{e.preventDefault(),console.log(e.target),F(!1)},children:[(0,p.jsxs)(i.gE,{children:[(0,p.jsx)(i.JU,{children:"Name"}),(0,p.jsx)(i.pd,{type:"text",name:"name",required:!0,placeholder:"name"})]}),(0,p.jsxs)(i.gE,{children:[(0,p.jsx)(i.JU,{children:"Email"}),(0,p.jsx)(i.pd,{type:"email",name:"email",required:!0,placeholder:"email"})]}),(0,p.jsxs)(i.gE,{children:[(0,p.jsx)(i.JU,{children:"Card Number"}),(0,p.jsx)(i.pd,{type:"text",name:"cardNumber",required:!0,placeholder:"card number",inputMode:"numeric",maxLength:19,onInput:e=>{let t=e.target.value.replace(/\D/g,"");t=t.substring(0,16),t=t.replace(/(.{4})/g,"$1 ").trim(),e.target.value=t}})]}),(0,p.jsxs)(i.fI,{children:[(0,p.jsxs)(i.gE,{children:[(0,p.jsx)(i.JU,{children:"Expiry Date"}),(0,p.jsx)(i.pd,{type:"text",name:"expiry",required:!0,placeholder:"MM/YYYY",inputMode:"numeric",maxLength:7,pattern:"(0[1-9]|1[0-2])\\/\\d{4}",onInput:e=>{let t=e.target.value.replace(/\D/g,"");t.length>6&&(t=t.slice(0,6)),t.length>=3&&(t=t.slice(0,2)+"/"+t.slice(2)),e.target.value=t}})]}),(0,p.jsxs)(i.gE,{children:[(0,p.jsx)(i.JU,{children:"CVV"}),(0,p.jsx)(i.pd,{type:"text",name:"cvv",required:!0,placeholder:"123"})]})]}),(0,p.jsxs)(i.e2,{children:[(0,p.jsx)(i.$n,{type:"button",className:"cancel",onClick:()=>F(!1),children:"Cancel"}),(0,p.jsx)(i.$n,{type:"submit",className:"submit",children:"Pay Now"})]})]})]})})}),(0,p.jsx)(o.A,{moduledata:C,paytmmodule:L,show:E,onClose:()=>_(!1),onSubmit:()=>{}})]})}},45286:(e,t,s)=>{s.d(t,{A:()=>r});const r=(0,s(69677).c)("pk_test_51RUJzWAx6rm2q3pys9SgKUPRxNxPZ4P1X6EazNQvnPuHKOOfzGsbylaTLUktId9ANHULkwBk67jnp5aqZ9Dlm6PR00jKdDwvSq")},69677:(e,t,s)=>{s.d(t,{c:()=>v});var r,n="basil",a="https://js.stripe.com",i="".concat(a,"/").concat(n,"/stripe.js"),o=/^https:\/\/js\.stripe\.com\/v3\/?(\?.*)?$/,c=/^https:\/\/js\.stripe\.com\/(v3|[a-z]+)\/stripe\.js(\?.*)?$/,d="loadStripe.setLoadParameters was called but an existing Stripe.js script already exists in the document; existing script parameters will be used",l=function(e){var t=e&&!e.advancedFraudSignals?"?advancedFraudSignals=false":"",s=document.createElement("script");s.src="".concat(i).concat(t);var r=document.head||document.body;if(!r)throw new Error("Expected document.body not to be null. Stripe.js requires a <body> element.");return r.appendChild(s),s},p=null,u=null,m=null,h=function(e){return null!==p?p:(p=new Promise((function(t,s){if("undefined"!==typeof window&&"undefined"!==typeof document)if(window.Stripe&&e&&console.warn(d),window.Stripe)t(window.Stripe);else try{var r=function(){for(var e,t=document.querySelectorAll('script[src^="'.concat(a,'"]')),s=0;s<t.length;s++){var r=t[s];if(e=r.src,o.test(e)||c.test(e))return r}return null}();if(r&&e)console.warn(d);else if(r){if(r&&null!==m&&null!==u){var n;r.removeEventListener("load",m),r.removeEventListener("error",u),null===(n=r.parentNode)||void 0===n||n.removeChild(r),r=l(e)}}else r=l(e);m=function(e,t){return function(){window.Stripe?e(window.Stripe):t(new Error("Stripe.js not available"))}}(t,s),u=function(e){return function(t){e(new Error("Failed to load Stripe.js",{cause:t}))}}(s),r.addEventListener("load",m),r.addEventListener("error",u)}catch(i){return void s(i)}else t(null)}))).catch((function(e){return p=null,Promise.reject(e)}))},x=!1,f=function(){return r||(r=h(null).catch((function(e){return r=null,Promise.reject(e)})))};Promise.resolve().then((function(){return f()})).catch((function(e){x||console.warn(e)}));var v=function(){for(var e=arguments.length,t=new Array(e),s=0;s<e;s++)t[s]=arguments[s];x=!0;var r=Date.now();return f().then((function(e){return function(e,t,s){if(null===e)return null;var r=t[0].match(/^pk_test/),a=function(e){return 3===e?"v3":e}(e.version),i=n;r&&a!==i&&console.warn("Stripe.js@".concat(a," was loaded on the page, but @stripe/stripe-js@").concat("7.3.1"," expected Stripe.js@").concat(i,". This may result in unexpected behavior. For more information, see https://docs.stripe.com/sdks/stripejs-versioning"));var o=e.apply(void 0,t);return function(e,t){e&&e._registerWrapper&&e._registerWrapper({name:"stripe-js",version:"7.3.1",startTime:t})}(o,s),o}(e,t,r)}))}}}]);
//# sourceMappingURL=9001.cfb0b429.chunk.js.map