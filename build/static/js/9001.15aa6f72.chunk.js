"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[9001],{11508:(e,t,s)=>{s.d(t,{A:()=>p});var a=s(65043),r=s(86213),n=s(26022),i=s(45394),o=s(69677),l=s(63393),d=s(70579);const c=(0,o.c)("pk_test_51RUJzWAx6rm2q3pys9SgKUPRxNxPZ4P1X6EazNQvnPuHKOOfzGsbylaTLUktId9ANHULkwBk67jnp5aqZ9Dlm6PR00jKdDwvSq"),p=e=>{let{moduledata:t,paytmmodule:s,show:o,onClose:p,onSubmit:u}=e;var m="https://blueprintcatalyst.com/api/user/aifile/";document.title="Dataroom Management & Diligence";const x=localStorage.getItem("UserLoginData"),h=JSON.parse(x),g=()=>{(0,a.useEffect)((()=>{t(s)}),[s]);const[e,t]=(0,a.useState)(s),[i,o]=(0,a.useState)(""),c=(0,l.useStripe)(),p=(0,l.useElements)(),[u,x]=(0,a.useState)(""),[g,f]=(0,a.useState)(!1),[j,y]=(0,a.useState)(""),[v,b]=(0,a.useState)(!1),[w,C]=(0,a.useState)("Onetime"),[N,k]=(0,a.useState)(""),[S,E]=(0,a.useState)(""),_=async e=>{try{await r.A.post(`${m}CreateuserSubscription_Academy`,e,{headers:{Accept:"application/json","Content-Type":"application/json"}}),y("Payment successful! \ud83c\udf89"),b(!1),setTimeout((()=>{window.location.reload()}),2e3)}catch(v){console.error("Success handler error:",v),y("Payment was captured, but post-process failed."),b(!0)}finally{f(!1)}};return(0,d.jsxs)("form",{onSubmit:async t=>{if(t.preventDefault(),!c||!p)return;const s=p.getElement(l.CardElement);if(!s)return y("Payment form is not ready. Please reload the page."),void b(!0);f(!0);try{const{data:t}=await r.A.post(`${m}CreateuserSubscription_AcademyCheck`,{user_id:h.id,amount:e}),a=await c.confirmCardPayment(t.clientSecret,{payment_method:{card:s}});if(a.error)y(a.error.message),b(!0),f(!1);else if("succeeded"===a.paymentIntent.status){const s={code:u,user_id:h.id,amount:e,clientSecret:t.clientSecret,PayidOnetime:N,payment_status:a.paymentIntent.status,discount:i};await _(s)}else y("Payment failed. Try again."),b(!0),f(!1)}catch(a){y("Unexpected error occurred."),b(!0),f(!1)}},children:[(0,d.jsx)("div",{className:"form-control rounded-3",style:{padding:"0.75rem",border:"1px solid #000",borderColor:"#ced4da"},children:(0,d.jsx)(l.CardElement,{options:{style:{base:{fontSize:"16px",color:"#32325d",fontFamily:'"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',"::placeholder":{color:"#a0aec0"},padding:"0.75rem"},invalid:{color:"#e5424d"}},classes:{base:"stripe-card-element",focus:"border-primary",invalid:"border-danger"}}})}),(0,d.jsxs)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:[(0,d.jsxs)("div",{className:"d-flex flex-column",children:[(0,d.jsx)("input",{type:"text",name:"refferal_code",defaultValue:u,onChange:async e=>{const t=e.target.value.toUpperCase();x(t)},className:"form-control w-auto",placeholder:"Apply Referral Code",autoComplete:"off",style:{textTransform:"uppercase"}}),S&&(0,d.jsx)("span",{className:"text-danger mt-1",style:{fontSize:"0.875rem"},children:S})]}),(0,d.jsx)(n.$n,{type:"button",onClick:async()=>{if(""===u)E("Enter the code");else{let a={code:u,type:"Academy",email:h.email};console.log(a);try{const n=await r.A.post(`${m}checkreferCode`,a,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(n.data.results.length>0){var e=n.data.results[0];if(e.usage_limit>e.used_count){o(e.percentage);const a=s*e.percentage/100;t(s-a),E("")}else o(""),t(s),E("This code already used")}else o(""),t(s),E("Invalid code!")}catch(v){}}},className:"submit d-flex align-items-center gap-2",style:{background:"#5C636B",height:"fit-content"},children:"Apply Code"})]}),i&&(0,d.jsxs)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:[(0,d.jsx)("b",{children:"Discount:"})," ",i,"%"]}),(0,d.jsx)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:(0,d.jsxs)(n.$n,{disabled:!c||g,type:"submit",className:"submit d-flex align-items-center gap-2",style:{background:"#003b21"},children:[!g&&(0,d.jsxs)("span",{children:["Pay \u20ac",e]}),g&&(0,d.jsx)("div",{className:"spinner-border text-white spinneronetimepay m-0",role:"status",children:(0,d.jsx)("span",{className:"visually-hidden"})})]})}),j&&(0,d.jsx)("p",{className:v?" mt-3 error_pop":"success_pop mt-3",children:j})]})},[f,j]=(0,a.useState)(!1);return o?(0,d.jsx)(d.Fragment,{children:(0,d.jsx)("div",{className:"payment_modal-overlay",onClick:p,children:(0,d.jsxs)("div",{className:"modal-container scroll_bar",onClick:e=>e.stopPropagation(),children:[(0,d.jsxs)("div",{className:"modal-header",children:[(0,d.jsxs)("div",{className:"modal-title-section",children:[(0,d.jsx)("h5",{className:"modal-title",children:"Payment"}),(0,d.jsxs)("div",{className:"price-tag",children:["Fee: \u20ac",s]})]}),(0,d.jsx)("button",{type:"button",className:"close_btn_global",onClick:p,"aria-label":"Close",children:(0,d.jsx)(i.LwM,{size:24})})]}),(0,d.jsx)("div",{className:"payment-info",children:(0,d.jsx)("div",{className:"benefits-list",children:(0,d.jsxs)("div",{className:"benefit-item",children:[(0,d.jsx)("div",{className:"benefit-icon",children:(0,d.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,d.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,d.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,d.jsx)("div",{className:"benefit-text",children:"1,200 Euros. ONE-TIME. This will include participation in all modules for each company."})]})})}),(0,d.jsxs)("div",{className:"payment-methods",children:[(0,d.jsxs)("div",{className:"accepted-cards",children:[(0,d.jsx)("span",{className:"accepted-text",children:"We accept:"}),(0,d.jsx)("div",{className:"card-icons",children:(0,d.jsx)("div",{className:"text-center mb-4",children:(0,d.jsx)("img",{src:"/assets/user/images/cardimage.jpg",alt:"cards",className:"img-fluid rounded",style:{maxWidth:"200px"}})})})]}),(0,d.jsx)("div",{className:"stripe-form-container",children:(0,d.jsx)(l.Elements,{stripe:c,children:(0,d.jsx)(g,{})})})]})]})})}):null}},31541:(e,t,s)=>{s.d(t,{$K:()=>r,$m:()=>c,CB:()=>i,Jn:()=>p,Q1:()=>l,mH:()=>d,mS:()=>o,mg:()=>n});var a=s(5464);const r=a.default.div`
  display: block;
  padding: 3rem 0;
  background-color: #fff;
`,n=a.default.div`
  background: #fff;
  border-radius: 10px;
  padding: 40px 20px;
  box-shadow: 0px 0px 10px #dddddd;
  @media (max-width: 576px) {
    padding: 40px 15px;
  }
`,i=a.default.div`
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
`,o=a.default.div`
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
`,l=a.default.div`
  cursor: pointer;

  video {
    width: 100%;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
`,d=a.default.div`
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
`,c=a.default.div`
  position: relative;
  width: 80%;
  max-width: 800px;

  video {
    width: 100%;
    border-radius: 8px;
  }
`,p=a.default.button`
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
`},39001:(e,t,s)=>{s.r(t),s.d(t,{default:()=>p});var a=s(65043),r=(s(65136),s(43328)),n=s(31541),i=s(26022),o=s(11508),l=s(44710),d=s(86213),c=s(70579);function p(){const[e,t]=(0,a.useState)(!1),[s,p]=(0,a.useState)(!1),[u,m]=(0,a.useState)([]),[x,h]=(0,a.useState)(""),[g,f]=(0,a.useState)(null),j=(0,a.useRef)(),y="https://blueprintcatalyst.com/api/upload/video",v="https://blueprintcatalyst.com/api/user/",b=localStorage.getItem("UserLoginData"),w=JSON.parse(b),[C,N]=(0,a.useState)(""),[k,S]=(0,a.useState)(!1),[E,_]=(0,a.useState)(""),[A,D]=(0,a.useState)("");(0,a.useEffect)((()=>{document.title="Investor Presentation Structure - Expert Advice Video"}),[]),(0,a.useEffect)((()=>{const e=e=>e.preventDefault();document.addEventListener("contextmenu",e);const t=e=>{("F12"===e.key||e.ctrlKey&&e.shiftKey&&"I"===e.key||e.ctrlKey&&"u"===e.key)&&e.preventDefault()};document.addEventListener("keydown",t);const s=setInterval((()=>{const e=window.outerWidth-window.innerWidth>160,t=window.outerHeight-window.innerHeight>160;(e||t)&&(p(!1),f(null))}),1e3);return()=>{document.removeEventListener("contextmenu",e),document.removeEventListener("keydown",t),clearInterval(s)}}),[]),(0,a.useEffect)((()=>{L()}),[]);const L=async()=>{let e={id:"",user_id:w.id};try{(await d.A.post(v+"checkmodulesubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length>0&&D("1")}catch(t){}};(0,a.useEffect)((()=>{P()}),[]);const P=async()=>{let e={user_id:""};try{var t=(await d.A.post("https://blueprintcatalyst.com/api/admin/module/getDataroompayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;_(t[0].academy_Fee)}catch(s){s.response||(s.request?console.error("Request data:",s.request):console.error("Error message:",s.message))}},q=async e=>{let s={user_id:w.id,video_id:e.id,limit:e.max_limit};try{var a=(await d.A.post(v+"videolimitsave",s,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;"2"===a.status?(f(null),t(!0),h(a.message),setTimeout((()=>{j.current&&(j.current.pause(),j.current.currentTime=0),h("")}),1800)):(h(""),p(!0),setTimeout((()=>{var e;null===(e=j.current)||void 0===e||e.play()}),100))}catch(r){r.response||(r.request?console.error("Request data:",r.request):console.error("Error message:",r.message))}};(0,a.useEffect)((()=>{T()}),[]);const T=async()=>{let e={user_id:""};try{var t=(await d.A.post("https://blueprintcatalyst.com/api/admin/video/getvideolist",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results;m(t)}catch(s){s.response||(s.request?console.error("Request data:",s.request):console.error("Error message:",s.message))}},[$,I]=(0,a.useState)(!1),[M,U]=(0,a.useState)(!1);return(0,c.jsxs)(c.Fragment,{children:[(0,c.jsx)(i.mO,{children:(0,c.jsx)("div",{className:"fullpage d-block",children:(0,c.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,c.jsx)(l.A,{isCollapsed:M,setIsCollapsed:U}),(0,c.jsxs)("div",{className:"global_view "+(M?"global_view_col":""),children:[(0,c.jsx)(r.A,{}),(0,c.jsx)(n.$K,{className:"d-block p-4",children:(0,c.jsxs)("div",{className:"container-fluid",children:[x&&(0,c.jsx)("p",{className:e?" mt-3 error_pop":"success_pop mt-3",children:x}),(0,c.jsx)(n.mg,{children:(0,c.jsxs)("div",{className:"d-flex flex-column gap-5",children:[(0,c.jsx)(n.CB,{children:"investor presentation structure - expert advice videos"}),(0,c.jsx)(n.mS,{children:u.map(((e,t)=>{const s=e.video.replace(/\\/g,"/");return(0,c.jsx)(n.Q1,{onClick:()=>(e=>{if(""===A)return void S(!0);f(null),e.id;const t=e.video;f(`${y}/${t}`),q(e)})(e),children:(0,c.jsxs)("video",{muted:!0,onContextMenu:e=>e.preventDefault(),onError:e=>console.error("Error loading video:",e),children:[(0,c.jsx)("source",{src:`${y}/${s}`,type:"video/mp4"}),(0,c.jsx)("p",{children:"Your browser does not support the video tag or the video format."})]})},t)}))})]})})]})})]})]})})}),(0,c.jsx)(n.mH,{open:s,children:(0,c.jsxs)(n.$m,{children:[g&&(0,c.jsxs)("video",{ref:j,className:"advicevideo",controls:!0,autoPlay:!0,controlsList:"nodownload nofullscreen noremoteplayback",onContextMenu:e=>e.preventDefault(),style:{width:"100%"},children:[(0,c.jsx)("source",{src:g,type:"video/mp4"}),"Your browser does not support the video tag."]}),(0,c.jsx)(n.Jn,{onClick:()=>{p(!1),j.current&&(j.current.pause(),j.current.currentTime=0),f(null)},children:"\xd7"})]})}),(0,c.jsx)(i.mO,{children:$&&(0,c.jsx)(i.hJ,{children:(0,c.jsxs)(i.zD,{children:[(0,c.jsx)(i.nj,{onClick:()=>I(!1),children:"\xd7"}),(0,c.jsx)(i.rL,{className:"pb-2",children:"Payment Details"}),(0,c.jsx)(i.V7,{children:(0,c.jsx)(i.MH,{src:"/assets/user/images/cardimage.jpg",alt:"cards"})}),(0,c.jsxs)(i.lV,{onSubmit:e=>{e.preventDefault(),console.log(e.target),I(!1)},children:[(0,c.jsxs)(i.gE,{children:[(0,c.jsx)(i.JU,{children:"Name"}),(0,c.jsx)(i.pd,{type:"text",name:"name",required:!0,placeholder:"name"})]}),(0,c.jsxs)(i.gE,{children:[(0,c.jsx)(i.JU,{children:"Email"}),(0,c.jsx)(i.pd,{type:"email",name:"email",required:!0,placeholder:"email"})]}),(0,c.jsxs)(i.gE,{children:[(0,c.jsx)(i.JU,{children:"Card Number"}),(0,c.jsx)(i.pd,{type:"text",name:"cardNumber",required:!0,placeholder:"card number",inputMode:"numeric",maxLength:19,onInput:e=>{let t=e.target.value.replace(/\D/g,"");t=t.substring(0,16),t=t.replace(/(.{4})/g,"$1 ").trim(),e.target.value=t}})]}),(0,c.jsxs)(i.fI,{children:[(0,c.jsxs)(i.gE,{children:[(0,c.jsx)(i.JU,{children:"Expiry Date"}),(0,c.jsx)(i.pd,{type:"text",name:"expiry",required:!0,placeholder:"MM/YYYY",inputMode:"numeric",maxLength:7,pattern:"(0[1-9]|1[0-2])\\/\\d{4}",onInput:e=>{let t=e.target.value.replace(/\D/g,"");t.length>6&&(t=t.slice(0,6)),t.length>=3&&(t=t.slice(0,2)+"/"+t.slice(2)),e.target.value=t}})]}),(0,c.jsxs)(i.gE,{children:[(0,c.jsx)(i.JU,{children:"CVV"}),(0,c.jsx)(i.pd,{type:"text",name:"cvv",required:!0,placeholder:"123"})]})]}),(0,c.jsxs)(i.e2,{children:[(0,c.jsx)(i.$n,{type:"button",className:"cancel",onClick:()=>I(!1),children:"Cancel"}),(0,c.jsx)(i.$n,{type:"submit",className:"submit",children:"Pay Now"})]})]})]})})}),(0,c.jsx)(o.A,{moduledata:C,paytmmodule:E,show:k,onClose:()=>S(!1),onSubmit:()=>{}})]})}}}]);
//# sourceMappingURL=9001.15aa6f72.chunk.js.map