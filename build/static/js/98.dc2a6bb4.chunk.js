/*! For license information please see 98.dc2a6bb4.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[98],{9333:(e,t,s)=>{s.d(t,{A:()=>a});const a=(0,s(77784).A)("video",[["path",{d:"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5",key:"ftymec"}],["rect",{x:"2",y:"6",width:"14",height:"12",rx:"2",key:"158x01"}]])},11508:(e,t,s)=>{s.d(t,{A:()=>c});var a=s(65043),o=s(86213),i=s(26022),r=s(45394),n=s(63393),l=s(45286),d=s(70579);const c=e=>{let{paytmmodule:t,show:s,onClose:c}=e;var m="https://blueprintcatalyst.com/api/user/aifile/";const p=localStorage.getItem("SignatoryLoginData"),u=JSON.parse(p),x=()=>{(0,a.useEffect)((()=>{s(t)}),[t]);const[e,s]=(0,a.useState)(t),[r,l]=(0,a.useState)(""),c=(0,n.useStripe)(),p=(0,n.useElements)(),[x,h]=(0,a.useState)(""),[f,g]=(0,a.useState)(!1),[b,y]=(0,a.useState)(""),[v,j]=(0,a.useState)(!1),[w,k]=(0,a.useState)(""),[N,C]=(0,a.useState)(""),S=async e=>{try{await o.A.post(`${m}CreateuserSubscription_Academy`,e,{headers:{Accept:"application/json","Content-Type":"application/json"}}),y("Payment successful! \ud83c\udf89"),j(!1),setTimeout((()=>{window.location.reload()}),2e3)}catch(v){console.error("Success handler error:",v),y("Payment was captured, but post-process failed."),j(!0)}finally{g(!1)}};return(0,d.jsxs)("form",{onSubmit:async t=>{if(t.preventDefault(),!c||!p)return;const s=p.getElement(n.CardElement);if(!s)return y("Payment form is not ready. Please reload the page."),void j(!0);const{error:a}=await c.createPaymentMethod({type:"card",card:s});if(a)return y(a.message||"Invalid card details."),void j(!0);g(!0);try{console.log();const{data:t}=await o.A.post(`${m}CreateuserSubscription_AcademyCheck`,{amount:e}),a=await c.confirmCardPayment(t.clientSecret,{payment_method:{card:s}});if(a.error)y(a.error.message),j(!0),g(!1);else if("succeeded"===a.paymentIntent.status){const s={code:"",company_id:u.companies[0].id,amount:e,clientSecret:t.clientSecret,payment_status:a.paymentIntent.status,discount:""};console.log(a.paymentIntent,t.clientSecret),await S(s)}else y("Payment failed. Try again."),j(!0),g(!1)}catch(i){console.log(i),y("Unexpected error occurred."),j(!0),g(!1)}},method:"post",children:[(0,d.jsx)("div",{className:"form-control rounded-3",style:{padding:"0.75rem",border:"1px solid #000",borderColor:"#ced4da"},children:(0,d.jsx)(n.CardElement,{options:{style:{base:{fontSize:"16px",color:"#32325d",fontFamily:'"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',"::placeholder":{color:"#a0aec0"},padding:"0.75rem"},invalid:{color:"#e5424d"}},classes:{base:"stripe-card-element",focus:"border-primary",invalid:"border-danger"}}})}),r&&(0,d.jsxs)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:[(0,d.jsx)("b",{children:"Discount:"})," ",r,"%"]}),(0,d.jsx)("div",{className:"d-flex gap-2 d-md-flex justify-content-md-end mt-4",children:(0,d.jsxs)(i.$n,{disabled:!c||f,type:"submit",className:"submit d-flex align-items-center gap-2",style:{background:"#003b21"},children:[!f&&(0,d.jsxs)("span",{children:["Pay \u20ac",e]}),f&&(0,d.jsx)("div",{className:"spinner-border text-white spinneronetimepay m-0",role:"status",children:(0,d.jsx)("span",{className:"visually-hidden"})})]})}),b&&(0,d.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(v?"error_pop":"success_pop"),children:[(0,d.jsx)("div",{className:"d-flex align-items-start gap-2",children:(0,d.jsx)("span",{className:"d-block",children:b})}),(0,d.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>y(""),children:"\xd7"})]})]})},[h,f]=(0,a.useState)(!1);return s?(0,d.jsx)(d.Fragment,{children:(0,d.jsx)("div",{className:"payment_modal-overlay",onClick:c,children:(0,d.jsxs)("div",{className:"modal-container scroll_bar",onClick:e=>e.stopPropagation(),children:[(0,d.jsxs)("div",{className:"modal-header",children:[(0,d.jsxs)("div",{className:"modal-title-section",children:[(0,d.jsx)("h5",{className:"modal-title",children:"Payment"}),(0,d.jsxs)("div",{className:"price-tag",children:["Fee: \u20ac",t]})]}),(0,d.jsx)("button",{type:"button",className:"close_btn_global",onClick:c,"aria-label":"Close",children:(0,d.jsx)(r.LwM,{size:24})})]}),(0,d.jsx)("div",{className:"payment-info",children:(0,d.jsx)("div",{className:"benefits-list",children:(0,d.jsxs)("div",{className:"benefit-item",children:[(0,d.jsx)("div",{className:"benefit-icon",children:(0,d.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,d.jsx)("path",{d:"M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,d.jsx)("path",{d:"M22 4L12 14.01L9 11.01",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,d.jsx)("div",{className:"benefit-text",children:"Launch your startup the smart way: join live investor meetings, master your pitch, and raise capital. Get access for 3 team members and set up your company for success from day one."})]})})}),(0,d.jsxs)("div",{className:"payment-methods",children:[(0,d.jsxs)("div",{className:"accepted-cards",children:[(0,d.jsx)("span",{className:"accepted-text",children:"We accept:"}),(0,d.jsx)("div",{className:"card-icons",children:(0,d.jsx)("div",{className:"text-center mb-4",children:(0,d.jsx)("img",{src:"/assets/user/images/cardimage.jpg",alt:"cards",className:"img-fluid rounded",style:{maxWidth:"200px"}})})})]}),(0,d.jsx)("div",{className:"stripe-form-container",children:(0,d.jsx)(n.Elements,{stripe:l.A,children:(0,d.jsx)(x,{})})})]})]})})}):null}},18622:(e,t,s)=>{s.d(t,{A:()=>i});var a=s(65043),o=s(70579);const i=function(e){let{message:t,onClose:s}=e;const[i,r]=(0,a.useState)("show");return(0,a.useEffect)((()=>{const e=setTimeout((()=>{r("")}),2500),t=setTimeout((()=>{s()}),3e3);return()=>{clearTimeout(e),clearTimeout(t)}}),[s]),(0,o.jsxs)("div",{className:`alert alert-success alert-dismissible fade ${i}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:9999,minWidth:"300px",maxWidth:"90%"},children:[(0,o.jsx)("strong",{children:"Success!"})," ",t,(0,o.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:s})]})}},25015:()=>{},34939:(e,t,s)=>{s.d(t,{A:()=>i});var a=s(65043),o=s(70579);const i=function(e){let{message:t,onClose:s}=e;const[i,r]=(0,a.useState)("show");return(0,a.useEffect)((()=>{const e=setTimeout((()=>{r("")}),3500),t=setTimeout((()=>{s()}),3e3);return()=>{clearTimeout(e),clearTimeout(t)}}),[s]),(0,o.jsxs)("div",{className:`alert alert-danger alert-dismissible fade ${i}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:999999,minWidth:"300px",maxWidth:"90%"},children:[(0,o.jsx)("strong",{children:"Error!"})," ",t,(0,o.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:s})]})}},37022:(e,t,s)=>{s.d(t,{A:()=>i});var a=s(65043),o=s(70579);const i=function(e){let{message:t,onConfirm:s,onCancel:i}=e;const r=(0,a.useRef)(null),n=(0,a.useRef)(null);return(0,a.useEffect)((()=>{const e=e=>{"Escape"===e.key&&i(),"Enter"===e.key&&s()};return document.addEventListener("keydown",e),n.current.focus(),document.body.style.overflow="hidden",()=>{document.removeEventListener("keydown",e),document.body.style.overflow="unset"}}),[s,i]),(0,o.jsxs)("div",{className:"modal-backdrop",style:{position:"fixed",top:0,left:0,width:"100%",height:"100%",backgroundColor:"rgba(0, 0, 0, 0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,opacity:0,animation:"fadeIn 0.3s ease-out forwards",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)"},onClick:i,children:[(0,o.jsxs)("div",{ref:r,className:"modal-content",style:{backgroundColor:"white",padding:"2rem",borderRadius:"12px",boxShadow:"0 10px 30px rgba(0, 0, 0, 0.15), 0 0 10px rgba(220, 53, 69, 0.2)",maxWidth:"450px",width:"90%",transform:"scale(0.9) translateY(-20px)",animation:"scaleIn 0.3s ease-out forwards",border:"1px solid rgba(220, 53, 69, 0.2)"},onClick:e=>e.stopPropagation(),children:[(0,o.jsx)("div",{className:"modal-icon",style:{textAlign:"center",marginBottom:"1.5rem"},children:(0,o.jsx)("svg",{width:"56",height:"56",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",style:{color:"#dc3545"},children:(0,o.jsx)("path",{d:"M12 9V14M12 17V17.01M5.07183 19H18.9282C20.4678 19 21.4301 17.3333 20.6603 16L13.7321 4C12.9623 2.66667 11.0378 2.66667 10.268 4L3.33978 16C2.56998 17.3333 3.53223 19 5.07183 19Z",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})})}),(0,o.jsx)("h3",{className:"modal-title",style:{textAlign:"center",margin:"0 0 1rem 0",color:"#dc3545",fontSize:"1.5rem",fontWeight:"600"},children:"Confirm Action"}),(0,o.jsx)("p",{className:"modal-message",style:{textAlign:"center",margin:"0 0 2rem 0",color:"#495057",fontSize:"1rem",lineHeight:"1.5"},children:t}),(0,o.jsxs)("div",{className:"modal-actions",style:{display:"flex",justifyContent:"center",gap:"1rem"},children:[(0,o.jsx)("button",{type:"button",className:"btn-cancel",onClick:i,style:{padding:"0.75rem 1.5rem",backgroundColor:"#f8f9fa",color:"#495057",border:"1px solid #dee2e6",borderRadius:"6px",fontWeight:"500",fontSize:"1rem",cursor:"pointer",transition:"all 0.2s ease",minWidth:"100px"},onMouseOver:e=>{e.target.style.backgroundColor="#e9ecef",e.target.style.transform="translateY(-2px)"},onMouseOut:e=>{e.target.style.backgroundColor="#f8f9fa",e.target.style.transform="translateY(0)"},children:"Cancel"}),(0,o.jsx)("button",{type:"button",className:"btn-confirm",ref:n,onClick:s,style:{padding:"0.75rem 1.5rem",backgroundColor:"#dc3545",color:"white",border:"none",borderRadius:"6px",fontWeight:"500",fontSize:"1rem",cursor:"pointer",transition:"all 0.2s ease",minWidth:"100px",boxShadow:"0 4px 6px rgba(220, 53, 69, 0.3)"},onMouseOver:e=>{e.target.style.backgroundColor="#bd2130",e.target.style.transform="translateY(-2px)",e.target.style.boxShadow="0 6px 8px rgba(220, 53, 69, 0.4)"},onMouseOut:e=>{e.target.style.backgroundColor="#dc3545",e.target.style.transform="translateY(0)",e.target.style.boxShadow="0 4px 6px rgba(220, 53, 69, 0.3)"},children:"Confirm"})]})]}),(0,o.jsx)("style",{children:"\n          @keyframes fadeIn {\n            from { opacity: 0; }\n            to { opacity: 1; }\n          }\n          \n          @keyframes scaleIn {\n            from { \n              transform: scale(0.9) translateY(-20px);\n              opacity: 0;\n            }\n            to { \n              transform: scale(1) translateY(0);\n              opacity: 1;\n            }\n          }\n          \n          .btn-cancel:focus, .btn-confirm:focus {\n            outline: 2px solid #3d8bfd;\n            outline-offset: 2px;\n          }\n        "})]})}},47890:(e,t,s)=>{s.r(t),s.d(t,{default:()=>w});var a=s(65043),o=(s(25015),s(43328)),i=s(34939),r=s(18622),n=s(70579);const l=function(e){let{children:t,onClose:s}=e;const[o,i]=(0,a.useState)("show");return(0,n.jsxs)("div",{className:`alert alert-success alert-dismissible fade ${o}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:9999,minWidth:"300px",maxWidth:"90%"},children:[t,(0,n.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:s})]})};s(38421);var d=s(34348),c=s.n(d),m=s(62837),p=s(11508),u=s(73216),x=s(35475),h=s(37022);const f=(0,s(77784).A)("clock",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polyline",{points:"12 6 12 12 16 14",key:"68esgv"}]]);var g=s(9333),b=s(95264),y=s(6551),v=(s(83656),s(44710)),j=s(86213);function w(){const e=(0,u.Zp)(),[t,s]=(0,a.useState)([]),[d,w]=(0,a.useState)([]),[k,N]=(0,a.useState)(Intl.DateTimeFormat().resolvedOptions().timeZone),[C,S]=(0,a.useState)(null),[z,M]=(0,a.useState)(null),[A,_]=(0,a.useState)(null),[D,Y]=(0,a.useState)(!1),[T,I]=(0,a.useState)(!1),[E,R]=(0,a.useState)(!1),[L,$]=(0,a.useState)({name:"",email:""}),W=(0,y.ye)(c()),[O,P]=(0,a.useState)(""),[F,Z]=(0,a.useState)([]),[B,H]=(0,a.useState)(""),[J,V]=(0,a.useState)(""),[q,K]=(0,a.useState)(""),[G,U]=(0,a.useState)(""),{id:Q}=(0,u.g)(),X=localStorage.getItem("CompanyLoginData"),ee=JSON.parse(X),[te,se]=(0,a.useState)(""),ae="https://blueprintcatalyst.com/api/user/",[oe,ie]=(0,a.useState)(null),[re,ne]=(0,a.useState)(null),[le,de]=(0,a.useState)(null),[ce,me]=(0,a.useState)([]),[pe,ue]=(0,a.useState)({name:"",email:""}),[xe,he]=(0,a.useState)([]);document.title="Module Page",(0,a.useEffect)((()=>{if(Intl.supportedValuesOf){const e=Intl.supportedValuesOf("timeZone");s(e)}}),[]);const[fe,ge]=(0,a.useState)([]);(0,a.useEffect)((()=>{be()}),[Q]),(0,a.useEffect)((()=>{ye()}),[Q]);const be=async()=>{try{const[e,t]=await Promise.all([j.A.post(ae+"get_combined_zoom_meetings",{module_id:Q,user_id:ee.id}),j.A.post(ae+"get_SessionMeeting",{module_id:Q,user_id:ee.id})]),s=e.data.meetings||[],a=t.data.meetings||[],o=Intl.DateTimeFormat().resolvedOptions().timeZone,i=s.map((e=>ve(e.originalMeeting,e.isRegistered,o,e.meet_type,e.zoom_link,e.morevng))),r=a.map((e=>e.originalMeeting?ve(e.originalMeeting,!1,o,e.meet_type,e.zoom_link,e.morevng):{...e,start:c().tz(`${e.meeting_date} ${e.time}`,"YYYY-MM-DD HH:mm:ss",e.timezone).tz(o).toDate(),end:c().tz(`${e.meeting_date} ${e.time}`,"YYYY-MM-DD HH:mm:ss",e.timezone).tz(o).add(30,"minutes").toDate(),isRegistered:!1})),n=[...i,...r];n.sort(((e,t)=>e.start-t.start));const l=n.filter((e=>e.isRegistered));he(n),ge(l)}catch(e){console.error("Failed to fetch meetings",e)}},ye=async()=>{try{await j.A.post(ae+"get_SessionMeeting",{module_id:Q,user_id:ee.id})}catch(e){console.error("Failed to fetch combined meetings",e)}},ve=(e,t,s,a,o,i)=>{const r=`${c()(e.meeting_date).format("YYYY-MM-DD")} ${e.time}:00`,n=c().tz(r,"YYYY-MM-DD HH:mm:ss",e.timezone).clone().tz(s);return{id:e.id,topic:e.topic,time:e.time,datee:e.meeting_date_time,moduleId:e.module_id,zoom_link:o,isRegistered:t,allDay:!1,start:n.toDate(),end:n.clone().add(30,"minutes").toDate(),title:`${n.format("hh:mm A")} ${e.topic}`,meet_type:a,morevng:i}};(0,a.useEffect)((()=>{je()}),[]);const je=async()=>{let e={user_id:""};try{var t=(await j.A.post("https://blueprintcatalyst.com/api/admin/module/getDataroompayment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.row;se(t[0].academy_Fee)}catch(s){s.response||(s.request?console.error("Request data:",s.request):console.error("Error message:",s.message))}};(0,a.useEffect)((()=>{"undefined"!==Q&&we()}),[Q]);const we=async()=>{let e={id:Q,user_id:ee.id};try{(await j.A.post(ae+"checkmodulesubscription",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length>0&&U("1")}catch(t){}};(0,a.useEffect)((()=>{Q&&ke()}),[Q]);const ke=async()=>{let t={id:Q};try{const s=await j.A.post(ae+"selectModule",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});s.data.results.length>0?(we(),K(s.data.results[0]),Z(s.data.zoomMeetings)):e("/dataroom-Duediligence")}catch(s){}};(0,a.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),t=await e.json();P(t.ip)}catch(e){console.error("Failed to fetch IP",e)}})()}),[]),(0,a.useEffect)((()=>{if(Intl.supportedValuesOf){const e=Intl.supportedValuesOf("timeZone");s(e)}}),[]),(0,a.useEffect)((()=>{if(Intl.supportedValuesOf){const e=Intl.supportedValuesOf("timeZone"),t=c()(),s=e.map((e=>({value:e,label:`${e} (${t.clone().tz(e).format("hh:mm A")})`})));w(s)}}),[]);(new Date).setHours(0,0,0,0);c()().format("YYYY-MM-DD");const[Ne,Ce]=(0,a.useState)([]),Se=(0,a.useRef)(null);(0,a.useEffect)((()=>{if(null!==F&&void 0!==F&&F.length&&null!==t&&void 0!==t&&t.length){const e=c()().format("YYYY-MM-DD"),s=F.find((t=>c()(t.start).format("YYYY-MM-DD")===e));if(s){const e=`${Q}_${s.id}_${c()(s.start).format()}`;if(Se.current===e)return;Se.current=e;const a=c()(s.start),o=t.map((e=>({value:e,label:`${e} (${a.clone().tz(e).format("hh:mm A")})`})));Ce(o)}}else Ce(d)}),[F,t,Q,d]);const ze=()=>{ne(null),setTimeout((()=>{I(!1)}),5)},[Me,Ae]=(0,a.useState)(!0);(0,a.useEffect)((()=>{ce.length>0&&!re?Ae(!1):(ue({name:"",email:""}),Ae(!0))}),[ce,re]);const[_e,De]=(0,a.useState)(null),[Ye,Te]=(0,a.useState)(!1),[Ie,Ee]=(0,a.useState)(!1);return(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)(m.mO,{children:(0,n.jsxs)("div",{className:"fullpage d-block",children:[Ye&&_e&&(0,n.jsx)("div",{dangerouslySetInnerHTML:{__html:_e},style:{width:"100%",height:"80vh"}}),(0,n.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,n.jsx)(v.A,{isCollapsed:Ie,setIsCollapsed:Ee}),(0,n.jsxs)("div",{className:"global_view "+(Ie?"global_view_col":""),children:[(0,n.jsx)(o.A,{}),(0,n.jsx)(m.$K,{className:"d-block p-md-4 p-3",children:(0,n.jsx)("div",{className:"container-fluid",children:(0,n.jsx)("form",{action:"",children:(0,n.jsx)(m.mg,{id:"step5",children:(0,n.jsxs)("div",{className:"d-flex flex-column gap-4",children:[z&&(0,n.jsx)(h.A,{message:(0,n.jsxs)("div",{className:"alert alert-warning mt-3",children:[(0,n.jsx)("h5",{children:"\ud83d\udcdd Confirm Meeting Registration"}),(0,n.jsx)("p",{children:"You're about to register for the following Zoom meeting. Please review the details carefully before proceeding:"}),(0,n.jsxs)("ul",{children:[(0,n.jsxs)("li",{children:[(0,n.jsx)("strong",{children:"Topic:"})," ",z.topic]}),(0,n.jsxs)("li",{children:[(0,n.jsx)("strong",{children:"Date & Time:"})," ",c()(z.start).format("DD MMM, hh:mm A")]})]}),(0,n.jsxs)("p",{className:"mt-3",children:["\ud83d\udc49 Once you confirm, the"," ",(0,n.jsx)("strong",{children:'"Register For Zoom"'})," button will be enabled."]}),(0,n.jsx)("p",{className:"mt-2",children:"Do you want to continue with the registration?"})]}),onConfirm:()=>{const e=C;if(ce.find((t=>t.id===e.id)))me(ce.filter((t=>t.id!==e.id)));else{if(ce.length>=3)return H("Only 3 meetings allowed."),void setTimeout((()=>H("")),2e3);me([...ce,e])}M(null)},onCancel:()=>M(null)}),B&&(0,n.jsx)(i.A,{message:B,onClose:()=>H("")}),J&&(0,n.jsx)(r.A,{message:J,onClose:()=>V("")}),oe&&(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)("div",{className:"modal-backdrop fade show",style:{backgroundColor:"rgba(0, 0, 0, 0.5)",zIndex:1050}}),(0,n.jsx)("div",{className:"modal fade show d-block",tabIndex:"-1",role:"dialog",style:{zIndex:1100},children:(0,n.jsx)("div",{className:"modal-dialog modal-dialog-centered",children:(0,n.jsxs)("div",{className:"modal-content",style:{borderRadius:"12px",overflow:"hidden",boxShadow:"0 10px 30px rgba(0, 0, 0, 0.2)",border:"none"},children:[(0,n.jsxs)("div",{className:"modal-header",style:{backgroundColor:"#dc3545",color:"white",borderBottom:"none",padding:"1.25rem 1.5rem"},children:[(0,n.jsx)("h5",{className:"modal-title fw-semibold m-0",children:"Meeting Scheduling Failed"}),(0,n.jsx)("button",{type:"button",className:"btn-close btn-close-white",onClick:()=>ie(null)})]}),(0,n.jsxs)("div",{className:"modal-body p-4",children:[(0,n.jsx)("p",{className:"text-dark mb-3 fw-medium",children:"There was an issue with your meeting schedule. Please review the details below:"}),(0,n.jsx)("div",{className:"card border-0 bg-light mb-3",style:{borderRadius:"8px"},children:(0,n.jsxs)("div",{className:"card-body p-3",children:[(0,n.jsx)("h6",{className:"fw-semibold mb-2 text-dark",children:"Meeting Details"}),(0,n.jsxs)("div",{className:"d-flex mb-2",children:[(0,n.jsx)("span",{className:"text-muted me-2",children:"Topic:"}),(0,n.jsx)("span",{className:"fw-medium text-dark",children:oe.topic})]}),(0,n.jsxs)("div",{className:"d-flex",children:[(0,n.jsx)("span",{className:"text-muted me-2",children:"Time:"}),(0,n.jsxs)("span",{className:"fw-medium text-dark",children:[c()(oe.start).format("DD MMM, YYYY")," ","at"," ",c()(oe.start).format("hh:mm A")]})]})]})}),(0,n.jsx)("div",{className:"alert alert-warning border-0",style:{backgroundColor:"rgba(255,193,7,0.1)",borderRadius:"8px",borderLeft:"4px solid #ffc107"},children:(0,n.jsx)("p",{className:"mb-0 fw-medium text-dark",children:"The selected meeting time may have already passed or is invalid. Please choose a future date and time, and try again."})})]}),(0,n.jsx)("div",{className:"modal-footer",style:{borderTop:"1px solid #e9ecef",padding:"1rem 1.5rem"},children:(0,n.jsx)("button",{type:"button",className:"btn btn-primary",onClick:()=>ie(null),style:{borderRadius:"8px",padding:"0.625rem 1.5rem",fontWeight:"500"},children:"OK, I Understand"})})]})})})]}),re&&(0,n.jsx)("div",{className:"modal-backdrop fade show",style:{display:"block",backgroundColor:"rgba(0, 0, 0, 0.5)"},children:(0,n.jsx)("div",{className:"modal fade show d-block",tabIndex:"-1",children:(0,n.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-lg",children:(0,n.jsxs)("div",{className:"modal-content",style:{borderRadius:"12px",overflow:"hidden",boxShadow:"0 10px 30px rgba(0, 0, 0, 0.2)",border:"none"},children:[(0,n.jsxs)("div",{className:"modal-header",style:{backgroundColor:"#198754",color:"white",borderBottom:"none",padding:"1.25rem 1.5rem"},children:[(0,n.jsxs)("div",{className:"d-flex align-items-center",children:[(0,n.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",fill:"currentColor",className:"me-2",viewBox:"0 0 16 16",children:(0,n.jsx)("path",{d:"M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"})}),(0,n.jsx)("h5",{className:"modal-title mb-0 fw-semibold",children:"Registered Successfully!"})]}),(0,n.jsx)("button",{type:"button",className:"btn-close btn-close-white",onClick:()=>ze(),style:{filter:"brightness(0) invert(1)"}})]}),(0,n.jsxs)("div",{className:"modal-body p-4",children:[(0,n.jsxs)("div",{className:"mb-4",children:[(0,n.jsxs)("p",{className:"text-dark mb-4",style:{fontSize:"1rem",lineHeight:"1.5"},children:["Your scheduled Zoom meetings are listed below. A ",(0,n.jsx)("strong",{children:'"Join"'})," button will appear 5 minutes before each session starts."]}),(0,n.jsx)("div",{className:"card border-0",style:{backgroundColor:"#f8f9fa",borderRadius:"8px"},children:(0,n.jsxs)("div",{className:"card-body p-3",children:[(0,n.jsx)("h6",{className:"fw-semibold mb-3 text-dark",style:{fontSize:"1rem"},children:"Meeting Details:"}),(0,n.jsx)("div",{className:"row g-3",children:re.map(((e,t)=>(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"d-flex align-items-start p-3 rounded",style:{backgroundColor:"white"},children:[(0,n.jsx)("div",{className:"bg-success bg-opacity-10 p-2 rounded-circle me-3 flex-shrink-0",children:(0,n.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"16",height:"16",fill:"currentColor",className:"text-success",viewBox:"0 0 16 16",children:(0,n.jsx)("path",{d:"M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"})})}),(0,n.jsx)("div",{className:"flex-grow-1",children:(0,n.jsxs)("div",{className:"d-flex justify-content-between align-items-start flex-wrap",children:[(0,n.jsxs)("div",{className:"me-3 mb-1",children:[(0,n.jsx)("span",{className:"text-muted d-block small",children:"Topic:"}),(0,n.jsx)("span",{className:"fw-medium text-dark",children:e.title})]}),(0,n.jsxs)("div",{className:"text-end",children:[(0,n.jsx)("span",{className:"text-muted d-block small",children:"Date & Time:"}),(0,n.jsx)("span",{className:"fw-medium text-dark",children:c()(e.start).format("DD MMM, hh:mm A")})]})]})})]})},t)))})]})})]}),(0,n.jsxs)("div",{className:"alert alert-info border-0 d-flex align-items-center",style:{backgroundColor:"rgba(13, 110, 253, 0.1)",borderRadius:"8px",borderLeft:"4px solid #0d6efd"},children:[(0,n.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"20",height:"20",fill:"currentColor",className:"text-info me-3 flex-shrink-0",viewBox:"0 0 16 16",children:(0,n.jsx)("path",{d:"M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"})}),(0,n.jsx)("div",{children:(0,n.jsxs)("p",{className:"mb-0 fw-medium text-dark",children:["A ",(0,n.jsx)("strong",{children:'"Join"'})," button will appear 5 minutes before each session starts. You can use it to join the Zoom meeting directly from here."]})})]})]}),(0,n.jsx)("div",{className:"modal-footer",style:{borderTop:"1px solid #e9ecef",padding:"1rem 1.5rem"},children:(0,n.jsx)("button",{type:"button",className:"btn btn-success",onClick:()=>ze(),style:{borderRadius:"8px",padding:"0.625rem 1.5rem",fontWeight:"500"},children:"Got It, Thanks!"})})]})})})}),le&&(0,n.jsx)(l,{onClose:()=>de(null),children:(0,n.jsxs)("div",{className:"alert alert-info mt-3",children:[(0,n.jsx)("h5",{children:"\ud83d\udcc5 Zoom Meeting Details"}),(0,n.jsx)("p",{children:"The following Zoom meeting is scheduled. Please find the details below:"}),(0,n.jsxs)("ul",{children:[(0,n.jsxs)("li",{children:[(0,n.jsx)("strong",{children:"Topic:"})," ",le.topic," "]}),(0,n.jsxs)("li",{children:[(0,n.jsx)("strong",{children:"Date & Time:"})," ",c()(le.start).format("DD MMM, hh:mm A")]})]}),(0,n.jsxs)("p",{className:"mt-2",children:["A ",(0,n.jsx)("strong",{children:"Join"})," button will appear 5 minutes before the session starts. You can use it to join the Zoom meeting directly from here."]}),c()().isSameOrAfter(c()(le.start).subtract(5,"minutes"))&&c()().isBefore(c()(le.start).add(45,"hour"))&&(0,n.jsx)("button",{onClick:()=>(async e=>{let t={id:e,ip_address:O};try{const e=await j.A.post(ae+"openZoomLink",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});"2"===e.data.status?H(e.data.message):(De(e.data),Te(!0),setTimeout((()=>{Te(!1)}),1e3))}catch(s){}})(le.id),type:"button",rel:"noopener noreferrer",className:"btn btn-primary mt-3",children:"Join Zoom Meeting"})]})}),A&&(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)("div",{className:"modal-backdrop fade show",style:{backgroundColor:"rgba(0, 0, 0, 0.5)",zIndex:1050}}),(0,n.jsx)("div",{className:"modal fade show d-block",tabIndex:"-1",role:"dialog",style:{zIndex:1100},children:(0,n.jsx)("div",{className:"modal-dialog modal-dialog-centered",children:(0,n.jsxs)("div",{className:"modal-content",style:{borderRadius:"12px",overflow:"hidden",boxShadow:"0 10px 30px rgba(0, 0, 0, 0.2)",border:"none"},children:[(0,n.jsxs)("div",{className:"modal-header",style:{backgroundColor:"#335795",color:"white",borderBottom:"none",padding:"1.25rem 1.5rem"},children:[(0,n.jsx)("h5",{className:"modal-title fw-semibold m-0",children:"Broadcast Session Details"}),(0,n.jsx)("button",{type:"button",className:"btn-close btn-close-white",onClick:()=>_(null)})]}),(0,n.jsxs)("div",{className:"modal-body p-4",children:[(0,n.jsx)("p",{className:"text-dark mb-3 fw-medium",children:"A broadcast session is scheduled. Please find the details below:"}),(0,n.jsx)("div",{className:"card border-0 bg-light mb-3",style:{borderRadius:"8px"},children:(0,n.jsxs)("div",{className:"card-body p-3",children:[(0,n.jsx)("h6",{className:"fw-semibold mb-2 text-dark",children:"Session Details"}),(0,n.jsxs)("div",{className:"d-flex mb-2",children:[(0,n.jsx)("span",{className:"text-muted me-2",children:"Session Period:"}),(0,n.jsx)("span",{className:"fw-medium text-dark",children:A.morevng})]}),(0,n.jsxs)("div",{className:"d-flex mb-2",children:[(0,n.jsx)("span",{className:"text-muted me-2",children:"Topic:"}),(0,n.jsx)("span",{className:"fw-medium text-dark",children:A.topic})]}),(0,n.jsxs)("div",{className:"d-flex",children:[(0,n.jsx)("span",{className:"text-muted me-2",children:"Date & Time:"}),(0,n.jsxs)("span",{className:"fw-medium text-dark",children:[c()(A.start).format("DD MMM, YYYY")," ","at"," ",c()(A.start).format("hh:mm A")]})]})]})}),(0,n.jsx)("div",{className:"alert alert-info border-0",style:{backgroundColor:"rgba(51,87,149,0.1)",borderRadius:"8px",borderLeft:"4px solid #335795",color:"#212529"},children:(0,n.jsxs)("p",{className:"mb-0 fw-medium",children:["A ",(0,n.jsx)("strong",{children:'"Join"'})," button will appear 5 minutes before the session starts."]})}),c()().isSameOrAfter(c()(A.start).subtract(5,"minutes"))&&c()().isBefore(c()(A.start).add(45,"minutes"))&&(0,n.jsx)("div",{className:"text-center",children:(0,n.jsx)(x.N_,{target:"_blank",to:A.zoom_link,rel:"noopener noreferrer",className:"btn px-4 py-2 fw-semibold",style:{borderRadius:"8px",backgroundColor:"#335795",border:"none",color:"white"},children:"Join Live Broadcast Session"})})]}),(0,n.jsx)("div",{className:"modal-footer",style:{borderTop:"1px solid #e9ecef",padding:"1rem 1.5rem"},children:(0,n.jsx)("button",{type:"button",className:"btn btn-outline-secondary",onClick:()=>_(null),style:{borderRadius:"8px",padding:"0.625rem 1.5rem",fontWeight:"500"},children:"Close"})})]})})})]}),(0,n.jsx)(m.CB,{children:q.name}),(0,n.jsxs)("div",{className:"row gy-3",children:[(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)(m.uM,{children:[(0,n.jsxs)("div",{className:"d-flex flex-column gap-3",children:[(0,n.jsx)("div",{className:"klogo",children:(0,n.jsx)("div",{className:"inlogo fulw",children:(0,n.jsx)("img",{src:"/logos/capavate.png",alt:"logo"})})}),(0,n.jsx)("h3",{children:"Keiretsu Forum Conoda"}),(0,n.jsx)("h4",{children:"Deal Screening - 30 minutes"})]}),(0,n.jsxs)("div",{className:"d-flex flex-column gap-2 pt-2",children:[(0,n.jsxs)("h6",{children:[(0,n.jsx)(m.vE,{children:(0,n.jsx)(f,{})}),"30 min"]}),(0,n.jsxs)("h6",{children:[(0,n.jsx)(m.vE,{children:(0,n.jsx)(g.A,{})}),"Web conferencing details provided upon confirmation."]}),(0,n.jsx)("div",{dangerouslySetInnerHTML:{__html:q.description}})]})]})}),(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"d-flex flex-column gap-3",children:[(0,n.jsx)("label",{children:"Select a date and time"}),(0,n.jsxs)(m.Jq,{children:[(0,n.jsx)(y.Vv,{localizer:W,events:xe,startAccessor:"start",endAccessor:"end",style:{height:600},popup:!0,selectable:!0,defaultView:"month",views:["month"],onSelectEvent:e=>{if(""!==G){if("Broadcaste"===e.meet_type)_(e);else{const s=new Date;if(e.time){var t=e.end;const a=c()(t).format("YYYY-MM-DD"),o=e.time,i=c()(o,"HH:mm").add(30,"minutes").format("HH:mm");if(!(new Date(`${a}T${i}:00`)>s))return void ie(e)}if(fe.some((t=>t.id===e.id)))return void de(e);M(e)}S(e)}else R(!0)},eventPropGetter:e=>{const t=fe.some((t=>t.id===e.id)),s=ce.some((t=>t.id===e.id));let a="event-default";return t?a="event-registered":s&&(a="event-selected"),{className:a}}}),(0,n.jsx)("strong",{children:"Time Zone"}),(0,n.jsx)("select",{value:k,onChange:e=>N(e.target.value),children:Ne.map((e=>(0,n.jsx)("option",{value:e.value,children:e.label},e.value)))})]}),(0,n.jsx)("button",{style:{opacity:Me?.5:1,pointerEvents:Me?"none":"auto"},className:"registerzoom",onClick:()=>(ue({name:"",email:""}),void(ce.length>0&&!re?I(!0):I(!1))),type:"button",children:"Register For Zoom"})]})}),(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)(m.Jq,{children:[(0,n.jsx)(b.A,{}),(0,n.jsx)("p",{children:q.textt})]})})]})]})})})})})]})]})]})}),(0,n.jsx)(p.A,{moduledata:q,paytmmodule:te,show:E,onClose:()=>R(!1),onSubmit:async e=>{e.preventDefault();var t=e.target;let s={name:t.name.value,email:t.email.value,cardnumber:t.cardnumber.value,expiry:t.expiry.value,cvv:t.cvv.value,user_id:ee.id,plan_id:Q};try{(await j.A.post(ae+"usersubscription",s,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results}catch(a){a.response||(a.request?console.error("Request data:",a.request):console.error("Error message:",a.message))}I(!1)}})]})}},62837:(e,t,s)=>{s.d(t,{$K:()=>r,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>u,R3:()=>j,Zw:()=>p,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>o,mg:()=>n,nj:()=>y,pd:()=>v,uM:()=>x,vE:()=>i,z6:()=>m});var a=s(5464);const o=a.default.div`
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
`,r=(a.default.div`
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
`),n=a.default.div`
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
`,m=a.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,p=a.default.div`
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
    left: 12px;
    width: 16px; /* smaller width */
    height: 16px; /* smaller height */
    stroke: var(--primary-icon);
    stroke-width: 1.2;
  }
`),x=(a.default.div`
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
`},95264:(e,t,s)=>{s.d(t,{A:()=>a});const a=(0,s(77784).A)("building",[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["path",{d:"M9 22v-4h6v4",key:"r93iot"}],["path",{d:"M8 6h.01",key:"1dz90k"}],["path",{d:"M16 6h.01",key:"1x0f13"}],["path",{d:"M12 6h.01",key:"1vi96p"}],["path",{d:"M12 10h.01",key:"1nrarc"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M16 14h.01",key:"1gbofw"}],["path",{d:"M8 10h.01",key:"19clt8"}],["path",{d:"M8 14h.01",key:"6423bh"}]])}}]);
//# sourceMappingURL=98.dc2a6bb4.chunk.js.map