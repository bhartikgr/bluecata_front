/*! For license information please see 2298.eb076d69.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[2298],{7118:(e,s,a)=>{a.d(s,{A:()=>i});const i=(0,a(77784).A)("users",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["path",{d:"M16 3.13a4 4 0 0 1 0 7.75",key:"1da9ce"}]])},12073:(e,s,a)=>{a.d(s,{A:()=>R});var i=a(65043),t=(a(38421),a(88155),a(73216)),l=a(35475),n=a(42489),o=a(42983),r=a(9463),d=a(28006),c=a(94651),p=a(35087),m=a(7118),x=a(77784);const h=(0,x.A)("user-plus",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["line",{x1:"19",x2:"19",y1:"8",y2:"14",key:"1bvyxn"}],["line",{x1:"22",x2:"16",y1:"11",y2:"11",key:"1shjgl"}]]);var u=a(13190);const f=(0,x.A)("heart",[["path",{d:"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",key:"c3ymky"}]]);var g=a(85347),b=a(73062),v=a(55731),j=a(44919),y=a(13892),N=a(80899),k=a(70579);function w(e){var s,a;let{label:i,name:t,type:l="text",placeholder:n,formik:o,required:r=!1,className:d=""}=e;const c=(null===o||void 0===o||null===(s=o.touched)||void 0===s?void 0:s[t])&&(null===o||void 0===o||null===(a=o.errors)||void 0===a?void 0:a[t]);return(0,k.jsxs)("div",{className:"d-flex flex-column gap-2 input-deisgn",children:[(0,k.jsxs)("label",{children:[i," ",r&&(0,k.jsx)("span",{className:"text-danger",children:"*"})]}),(0,k.jsx)("input",{type:l,name:t,placeholder:n,className:`form-control rounded-3 ${c?"is-invalid":""} ${d}`,...null!==o&&void 0!==o&&o.getFieldProps?o.getFieldProps(t):{}}),c&&(0,k.jsx)("div",{className:"invalid-feedback",children:o.errors[t]})]})}var _=a(78703);function C(e){let{label:s,name:a,options:i=[],formik:t,required:l=!1,isMulti:n=!1}=e;const o=t.touched[a]&&t.errors[a],r={control:(e,s)=>({...e,backgroundColor:"#fff",borderColor:o||s.isFocused?"#d40209":"#dee2e6",boxShadow:s.isFocused?"0 0 0 0.2rem rgba(212,2,9,.15)":"none","&:hover":{borderColor:"#dee2e6"},minHeight:"45px",borderRadius:"8px",fontSize:"0.85rem",color:"#000000db"}),menu:e=>({...e,borderRadius:"8px",overflow:"hidden"}),option:(e,s)=>({...e,backgroundColor:s.isSelected?"#d40209":s.isFocused?"rgba(212,2,9,.08)":"#fff",color:s.isSelected?"#fff":"#000000db",fontSize:"0.85rem",cursor:"pointer"}),singleValue:e=>({...e,color:"#000000db"}),multiValue:e=>({...e,backgroundColor:"#d40209"}),multiValueLabel:e=>({...e,color:"#fff"}),multiValueRemove:e=>({...e,color:"#fff",":hover":{backgroundColor:"#a50005",color:"#fff"}})};return(0,k.jsxs)("div",{className:"d-flex flex-column gap-2 input-deisgn",children:[(0,k.jsxs)("label",{children:[s," ",l&&(0,k.jsx)("span",{className:"text-danger",children:"*"})]}),(0,k.jsx)(_.Ay,{name:a,options:i,value:n?i.filter((e=>{var s;return null===(s=t.values[a])||void 0===s?void 0:s.includes(e.value)})):i.find((e=>e.value===t.values[a]))||null,onChange:e=>{n?t.setFieldValue(a,e?e.map((e=>e.value)):[]):t.setFieldValue(a,e?e.value:"")},onBlur:()=>t.setFieldTouched(a,!0),isMulti:n,styles:r,classNamePrefix:"react-select"}),o&&(0,k.jsx)("div",{className:"invalid-feedback d-block",children:t.errors[a]})]})}var S=a(76245);const z=(0,x.A)("external-link",[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]);var A=a(25581),E=a(86213);const I=N.Ik({firstName:N.Yj().required("First name is required"),lastName:N.Yj().required("Last name is required"),email:N.Yj().email("Invalid email").required("Email is required"),phone:N.Yj().required("Phone number is required"),city:N.Yj().required("City is required"),country:N.Yj().required("Country is required")});function M(e){let{setShowModal:s,investorData:a}=e;const t=A.J+"api/user/capitalround/",l=A.J+"api/user/investor/",[n,o]=(0,i.useState)([]),[r,d]=(0,i.useState)([]),[c,p]=(0,i.useState)(!1),[m,x]=(0,i.useState)(!1);(0,i.useEffect)((()=>{h(),null!==a&&void 0!==a&&a.id&&f()}),[a]);const h=async()=>{try{const e=await E.A.post(t+"getallcountrySymbolList",{id:""},{headers:{Accept:"application/json","Content-Type":"application/json"}});o(e.data.results||[])}catch(e){console.error("Error fetching countries:",e)}},f=async()=>{try{const e=await E.A.post(l+"getPortfolioCompanies",{investor_id:a.id});d(e.data.results||[])}catch(e){console.error("Error fetching portfolio:",e)}},g=n.map((e=>({label:e.name,value:e.name}))),b=(0,y.Wx)({initialValues:{firstName:(null===a||void 0===a?void 0:a.first_name)||"",lastName:(null===a||void 0===a?void 0:a.last_name)||"",email:(null===a||void 0===a?void 0:a.email)||"",phone:(null===a||void 0===a?void 0:a.phone)||"",city:(null===a||void 0===a?void 0:a.city)||"",country:(null===a||void 0===a?void 0:a.country)||""},validationSchema:I,onSubmit:async e=>{p(!0);try{"1"===(await E.A.post(A.J+"api/user/investor/joinAngelNetwork",{...e,investor_id:null===a||void 0===a?void 0:a.id,portfolio_companies:r})).data.status&&(x(!0),setTimeout((()=>s(!1)),3e3))}catch(i){console.error("Error submitting:",i)}finally{p(!1)}}});return(0,k.jsxs)(k.Fragment,{children:[(0,k.jsx)("div",{className:"modal fade show form-pop",style:{display:"block"},children:(0,k.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-lg",children:(0,k.jsx)("div",{className:"modal-content rounded-4 shadow-lg border-0",children:(0,k.jsxs)("div",{className:"p-4",children:[(0,k.jsxs)("div",{className:"d-flex align-items-start gap-3 mb-4",children:[(0,k.jsx)("div",{className:"rounded-3 d-flex align-items-center justify-content-center flex-shrink-0 bg-danger-subtle text-danger",style:{width:"45px",height:"45px"},children:(0,k.jsxs)("svg",{width:"28",height:"28",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:[(0,k.jsx)("path",{d:"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2",strokeLinecap:"round"}),(0,k.jsx)("circle",{cx:"12",cy:"7",r:"4"})]})}),(0,k.jsx)("div",{className:"flex-grow-1",children:(0,k.jsxs)("div",{className:"d-flex form-pop-head justify-content-between gap-2 align-items-start",children:[(0,k.jsxs)("div",{className:"d-flex flex-column gap-1",children:[(0,k.jsx)("h4",{children:"Join the Capavate Angel Network"}),(0,k.jsx)("p",{children:"Connect with top-tier startups and investment opportunities"})]}),(0,k.jsx)("button",{type:"button",className:"close_btn_pop",onClick:()=>s(!1),children:(0,k.jsx)(S.A,{})})]})})]}),m?(0,k.jsxs)("div",{className:"text-center py-5",children:[(0,k.jsx)("div",{className:"text-success mb-3",children:(0,k.jsx)("svg",{width:"64",height:"64",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,k.jsx)("path",{d:"M20 6L9 17l-5-5",strokeLinecap:"round",strokeLinejoin:"round"})})}),(0,k.jsx)("h5",{className:"mb-2",children:"Successfully Joined!"}),(0,k.jsx)("p",{className:"text-muted",children:"You are now on the Capavate Angel Network waitlist."})]}):(0,k.jsxs)(k.Fragment,{children:[r.length>0&&(0,k.jsxs)("div",{className:"rounded-3 p-3 mb-4 bg-light border-start border-4 border-info",children:[(0,k.jsxs)("div",{className:"d-flex align-items-center gap-2 mb-2",children:[(0,k.jsx)(u.A,{size:18,className:"text-info"}),(0,k.jsx)("h6",{className:"fw-bold mb-0",children:"Your Portfolio Companies"})]}),(0,k.jsx)("div",{className:"d-flex flex-wrap gap-2 mt-2",children:r.map(((e,s)=>(0,k.jsxs)("div",{className:"d-flex align-items-center gap-2 bg-white p-2 rounded-3 shadow-sm",style:{border:"1px solid #dee2e6"},children:[(0,k.jsx)("span",{children:e.name}),e.profile_link&&(0,k.jsx)("a",{href:e.profile_link,target:"_blank",rel:"noopener noreferrer",className:"text-info",children:(0,k.jsx)(z,{size:14})})]},s)))}),(0,k.jsx)("p",{className:"text-muted small mt-2 mb-0",children:"These companies will be notified when you join the network."})]}),(0,k.jsx)("div",{className:"rounded-3 p-3 mb-4 bg_light border-start border-4 border-danger",children:(0,k.jsx)("p",{className:"mb-0 small",children:"Join the Capavate Angel Network to get access to exclusive deal flow, co-investment opportunities, and connect with fellow angel investors."})}),(0,k.jsxs)("form",{className:"d-flex flex-column gap-3",onSubmit:b.handleSubmit,children:[(0,k.jsxs)("div",{className:"row g-3",children:[(0,k.jsx)("div",{className:"col-md-6",children:(0,k.jsx)(w,{label:"First Name",name:"firstName",placeholder:"John",formik:b,required:!0})}),(0,k.jsx)("div",{className:"col-md-6",children:(0,k.jsx)(w,{label:"Last Name",name:"lastName",placeholder:"Doe",formik:b,required:!0})})]}),(0,k.jsxs)("div",{className:"row g-3",children:[(0,k.jsx)("div",{className:"col-md-6",children:(0,k.jsx)(w,{label:"Email Address",name:"email",type:"email",placeholder:"john@example.com",formik:b,required:!0})}),(0,k.jsx)("div",{className:"col-md-6",children:(0,k.jsx)(w,{label:"Phone Number",name:"phone",type:"tel",placeholder:"+1 (555) 123-4567",formik:b,required:!0})})]}),(0,k.jsxs)("div",{className:"row g-3",children:[(0,k.jsx)("div",{className:"col-md-6",children:(0,k.jsx)(w,{label:"City",name:"city",placeholder:"San Francisco",formik:b,required:!0})}),(0,k.jsx)("div",{className:"col-md-6",children:(0,k.jsx)(C,{label:"Country",name:"country",formik:b,required:!0,options:g.length>0?g:[{label:"Loading...",value:""}]})})]}),(0,k.jsxs)("div",{className:"d-flex gap-3 mt-3",children:[(0,k.jsx)("button",{type:"button",className:"button_deisgn bg_light text-black flex-grow-1",onClick:()=>s(!1),children:"Cancel"}),(0,k.jsx)("button",{type:"submit",className:"button_deisgn bg-success flex-grow-1 text-white",disabled:c||b.isSubmitting,children:c?"Joining...":"Join Angel Network"})]})]})]})]})})})}),(0,k.jsx)("div",{className:"modal-backdrop fade show",onClick:()=>s(!1)})]})}var q=a(47196),F=a(50423);const T=[{label:"Edit Profile",href:"/investor/profile",icon:(0,k.jsx)(q.IWF,{size:18})},{label:"Cap Table Rules",icon:(0,k.jsx)(n.A,{size:18}),modal:"capTableRules"}];function R(){const[e,s]=(0,i.useState)(!1),[x,y]=(0,i.useState)(null),[N,w]=(0,i.useState)(!1),[_,C]=(0,i.useState)(!1),S=(0,t.zy)(),z=localStorage.getItem("InvestorData"),I=JSON.parse(z),q=(A.J,A.J+"api/user/investor/"),[R,O]=(0,i.useState)(null),[D,Y]=(0,i.useState)(!1);(0,i.useEffect)((()=>{const e=()=>{s(window.innerWidth<786)};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[]),(0,i.useEffect)((()=>{L()}),[]);const L=async()=>{try{var e;const s=await E.A.post(q+"getinvestorData",{id:I.id});if((null===(e=s.data.results)||void 0===e?void 0:e.length)>0){const e=s.data.results[0];console.log(e.capavate_interests),O(e)}else O({})}catch(s){console.error(s),O({})}},P={"/record-round-list":["/createrecord","/record-round-cap-table"]},J=e=>{var s;if(!e||"#"===e)return!1;const a=S.pathname;return a===e||(!!a.startsWith(e+"/")||!(null===(s=P[e])||void 0===s||!s.some((e=>a===e||a.startsWith(e+"/")))))},W=e=>e.status?(0,k.jsx)("span",{className:"menu_value "+("confirmed"===e.status?"bg-success":"pending"===e.status?"bg-danger":"bg-secondary"),children:e.status}):e.value?(0,k.jsx)("span",{className:"menu_value bg-success",children:e.value}):null,H=e=>null===e||void 0===e?void 0:e.some((e=>e.subItems?e.subItems.some((e=>{var s;const a=S.pathname;return!!a.startsWith(e.href)||!(null===(s=P[e.href])||void 0===s||!s.some((e=>a===e||a.startsWith(e+"/"))))})):S.pathname.startsWith(e.href))),V={firstName:"John",lastName:"Doe",investorType:"Angel Investor",location:"San Francisco, CA",followers:1250,following:342,portfolioCompanies:["TechStart Inc.","GrowthLabs","FutureFund"],interests:null!==R&&void 0!==R&&R.capavate_interests?null===R||void 0===R?void 0:R.capavate_interests.split(",").map((e=>e.trim())):[],industryExpertise:["Technology","Healthcare","Education"],typicalChequeSize:null!==R&&void 0!==R&&R.cheque_size?null===R||void 0===R?void 0:R.cheque_size.split(",").map((e=>e.trim())):[],geographyFocus:null===R||void 0===R?void 0:R.geo_focus,preferredStage:["Seed","Series A"],handsOn:"Hands-on (Monthly advisory calls)"},[B,G]=(0,i.useState)({investor:{contact_listed:"No",portfolio_company:"No",contact_from:"No",capavate_member:"No",everyone:"No"},company:{contact_listed:"No",portfolio_company:"No",contact_from:"No",capavate_member:"No",everyone:"No"}}),[$,K]=(0,i.useState)(!1),[Z,U]=(0,i.useState)(!1),[Q,X]=(0,i.useState)(null);(0,i.useEffect)((()=>{D&&ee()}),[D]);const ee=async()=>{if(null!==I&&void 0!==I&&I.id)try{var e,s;const a=await E.A.post(q+"getCapTableRules",{investor_id:I.id,type:"Investor"}),i=await E.A.post(q+"getCapTableRules",{investor_id:I.id,type:"Company"});G({investor:(null===(e=a.data.results)||void 0===e?void 0:e[0])||{contact_listed:"No",portfolio_company:"No",contact_from:"No",capavate_member:"No",everyone:"No"},company:(null===(s=i.data.results)||void 0===s?void 0:s[0])||{contact_listed:"No",portfolio_company:"No",contact_from:"No",capavate_member:"No",everyone:"No"}})}catch(a){console.error("Error fetching rules:",a)}},se=async e=>{K(!0),X(e);try{const s="Investor"===e?B.investor:B.company,a={investor_id:I.id,type:e,contact_listed:s.contact_listed,portfolio_company:s.portfolio_company||"No",contact_from:s.contact_from||"No",capavate_member:s.capavate_member,everyone:s.everyone};await E.A.post(q+"saveCapTableRules",a),U(!0),setTimeout((()=>U(!1)),3e3)}catch(s){console.error("Error saving rules:",s)}finally{K(!1),X(null)}},ae=(e,s)=>{G((a=>({...a,[e]:{...a[e],[s]:"Yes"===a[e][s]?"No":"Yes"}})))};return(0,k.jsxs)(k.Fragment,{children:[(0,k.jsxs)("div",{className:"main_sidenav_social scroll_nonw d-flex flex-column gap-4 p-3 justify-content-start align-items-md-start align-items-center "+(e?"collapsed p-md-3":"p-md-4"),children:[(0,k.jsxs)("div",{className:"d-flex justify-content-between align-items-center w-100",children:[!e&&(0,k.jsx)(l.N_,{to:"/investor/dashboard",className:"com_logo",children:(0,k.jsx)("img",{src:"../../../assets/images/capavate.png",className:"img-fluid rounded",style:{maxHeight:"50px"},alt:"profile",onError:e=>{e.target.onerror=null,e.target.src=a(77572)}})}),(0,k.jsx)("button",{className:"menu_btn",onClick:()=>s(!e),children:e?(0,k.jsx)(o.A,{size:22}):(0,k.jsx)(r.A,{size:22})})]}),!e&&(0,k.jsxs)("div",{className:"company_box bg-white border rounded-3 shadow-sm p-3 w-100",children:[(0,k.jsxs)("div",{className:"d-flex align-items-center gap-2 mb-2",children:[(0,k.jsx)("div",{className:"d-flex align-items-center gap-2 mb-2",children:(0,k.jsx)("div",{className:"avatar-circle bg-primary text-white d-flex align-items-center justify-content-center overflow-hidden",style:{width:"40px",height:"40px",borderRadius:"50%",position:"relative"},children:null!==R&&void 0!==R&&R.profile_picture?(0,k.jsx)("img",{src:A.J+"api/upload/investor/inv_"+(null===R||void 0===R?void 0:R.id)+"/"+(null===R||void 0===R?void 0:R.profile_picture),className:"img-fluid w-100 h-100",style:{objectFit:"cover",width:"100%",height:"100%"},alt:"profile"}):(0,k.jsx)("span",{className:"fw-bold",children:(0,k.jsx)("img",{src:A.J+"api/upload/investor/inv_"+(null===R||void 0===R?void 0:R.id)+"/"+(null===R||void 0===R?void 0:R.profile_picture),className:"img-fluid w-100 h-100",style:{objectFit:"cover",width:"100%",height:"100%"},alt:"profile"})})})}),(0,k.jsx)("div",{children:(0,k.jsx)("h6",{className:"mb-0",children:null!==R&&void 0!==R&&R.screen_name?R.screen_name:`${(null===R||void 0===R?void 0:R.first_name)||""} ${(null===R||void 0===R?void 0:R.last_name)||""}`.trim()})})]}),(0,k.jsx)("div",{className:"details small text-muted d-flex flex-column gap-1",children:(0,k.jsxs)("p",{className:"mb-1 d-flex align-items-center gap-1",children:["Investor Type:",(0,k.jsx)("span",{children:null===R||void 0===R?void 0:R.type_of_investor})]})}),(0,k.jsx)("div",{className:"details small text-muted d-flex flex-column gap-1",children:(0,k.jsxs)("p",{className:"mb-1 d-flex align-items-center gap-1",children:[(0,k.jsx)(d.A,{size:14}),(0,k.jsxs)("span",{children:[null===R||void 0===R?void 0:R.full_address," ",null===R||void 0===R?void 0:R.company_country]})]})})]}),(0,k.jsxs)("ul",{className:"nav flex-column gap-1 w-100",children:[T.map(((a,i)=>(0,k.jsx)("li",{children:a.dropdown?(0,k.jsxs)(k.Fragment,{children:[(0,k.jsxs)("div",{className:"sidebar_item d-flex justify-content-between align-items-center "+(H(a.dropdown)?"active":""),onClick:()=>(a=>{e&&s(!1),y(x===a?null:a)})(i),style:{cursor:"pointer"},children:[(0,k.jsxs)("div",{className:"d-flex gap-2 align-items-center",children:[a.icon,!e&&a.label]}),!e&&(0,k.jsx)(F.pte,{})]}),(x===i||H(a.dropdown))&&!e&&(0,k.jsx)("ul",{className:"submenu",children:a.dropdown.map(((e,s)=>(0,k.jsx)("li",{children:e.subItems?(0,k.jsxs)(k.Fragment,{children:[(0,k.jsxs)("div",{className:"sidebar_item d-flex gap-2 align-items-center fw-medium",children:[e.icon,(0,k.jsx)("span",{children:e.label})]}),(0,k.jsx)("ul",{className:"ps-4 mt-1 mb-2",children:null!==e&&void 0!==e&&e.subItems&&e.subItems.length>0?e.subItems.map(((e,s)=>(0,k.jsx)("li",{children:e.modal?(0,k.jsx)("span",{className:"sidebar_item small cursor-pointer",onClick:()=>w(!0),children:e.label}):e.href&&"#"!==e.href?(0,k.jsx)(l.N_,{to:e.href,className:"sidebar_item small "+(J(e.href)?"active":""),children:(0,k.jsxs)("div",{className:"d-flex justify-content-between w-100",children:[(0,k.jsx)("span",{children:e.label}),W(e)]})}):(0,k.jsx)("span",{className:"sidebar_item small",children:e.label})},s))):null})]}):e.href&&"#"!==e.href?(0,k.jsx)(l.N_,{to:e.href,className:"sidebar_item "+(J(e.href)?"active":""),children:(0,k.jsxs)("div",{className:"d-flex justify-content-between w-100",children:[(0,k.jsxs)("div",{className:"d-flex gap-2 align-items-center",children:[e.icon,(0,k.jsx)("span",{children:e.label})]}),W(e)]})}):(0,k.jsx)("span",{className:"sidebar_item",children:e.label})},s)))})]}):a.modal?(0,k.jsxs)("span",{className:"sidebar_item d-flex gap-2 align-items-center",onClick:()=>{"capTableRules"===a.modal&&Y(!0)},style:{cursor:"pointer"},children:[a.icon,!e&&a.label]}):(0,k.jsxs)(l.N_,{to:a.href,className:"sidebar_item d-flex gap-2 align-items-center "+(J(a.href)?"active":""),children:[a.icon,!e&&a.label]})},i))),(0,k.jsxs)("li",{className:"mt-3 px-2",children:[(0,k.jsxs)("div",{className:"d-flex justify-content-between align-items-center cursor-pointer mb-2",onClick:()=>{C(!_)},style:{cursor:"pointer"},children:[(0,k.jsx)("span",{className:"fw-bold text-primary",children:"\ud83d\udc7c Angel Profile"}),_?(0,k.jsx)(c.A,{size:16}):(0,k.jsx)(p.A,{size:16})]}),_&&(0,k.jsxs)("div",{className:"small text-muted angel-profile-section",children:[(0,k.jsxs)("div",{className:"row g-2 mb-3",children:[(0,k.jsx)("div",{className:"col-6",children:(0,k.jsxs)("div",{className:"stat-card p-2 bg-light rounded",children:[(0,k.jsx)(m.A,{size:14,className:"me-1"}),(0,k.jsx)("span",{className:"fw-bold",children:V.followers}),(0,k.jsx)("small",{children:" followers"})]})}),(0,k.jsx)("div",{className:"col-6",children:(0,k.jsxs)("div",{className:"stat-card p-2 bg-light rounded",children:[(0,k.jsx)(h,{size:14,className:"me-1"}),(0,k.jsx)("span",{className:"fw-bold",children:V.following}),(0,k.jsx)("small",{children:" following"})]})})]}),(0,k.jsxs)("div",{className:"mb-3",children:[(0,k.jsxs)("div",{className:"d-flex align-items-center gap-1 mb-2",children:[(0,k.jsx)(u.A,{size:14}),(0,k.jsx)("strong",{children:"Portfolio Companies:"})]}),(0,k.jsx)("ul",{className:"ps-3 mb-0",children:null!==V&&void 0!==V&&V.portfolioCompanies&&V.portfolioCompanies.length>0?V.portfolioCompanies.map(((e,s)=>(0,k.jsx)("li",{className:"mb-1",children:e},s))):(0,k.jsx)("li",{className:"text-muted",children:"No portfolio companies listed"})})]}),(0,k.jsx)("div",{className:"mb-3",children:(0,k.jsx)("button",{className:"btn btn-danger w-100 fw-bold py-2",onClick:()=>w(!0),style:{background:"linear-gradient(135deg, #dc3545 0%, #bb2d3b 100%)",border:"none",borderRadius:"8px"},children:"Join Capavate Angel Network"})}),(0,k.jsxs)("div",{className:"profile-details",children:[(0,k.jsx)("p",{className:"mb-2 fw-bold",children:"Profile:"}),(0,k.jsxs)("div",{className:"mb-2",children:[(0,k.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,k.jsx)(f,{size:14,className:"text-danger"}),(0,k.jsx)("span",{children:"Interests:"})]}),(0,k.jsx)("div",{className:"ps-3",children:null!==V&&void 0!==V&&V.interests&&V.interests.length>0?V.interests.map(((e,s)=>(0,k.jsx)("span",{className:"badge bg-light text-dark me-1 mb-1 p-2",children:e},s))):(0,k.jsx)("span",{className:"text-muted",children:"No interests added yet"})})]}),(0,k.jsxs)("div",{className:"mb-2",children:[(0,k.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,k.jsx)(g.A,{size:14,className:"text-warning"}),(0,k.jsx)("span",{children:"Industry Expertise:"})]}),(0,k.jsx)("div",{className:"ps-3",children:null!==V&&void 0!==V&&V.industryExpertise&&V.industryExpertise.length>0?V.industryExpertise.map(((e,s)=>(0,k.jsx)("span",{className:"badge bg-light text-dark me-1 mb-1 p-2",children:e},s))):(0,k.jsx)("span",{className:"text-muted",children:"No industry expertise added yet"})})]}),(0,k.jsxs)("div",{className:"mb-2",children:[(0,k.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,k.jsx)(b.A,{size:14,className:"text-success"}),(0,k.jsx)("span",{children:"Typical cheque size:"})]}),(0,k.jsx)("p",{className:"ps-3 mb-0",children:Array.isArray(V.typicalChequeSize)?V.typicalChequeSize.join(", "):V.typicalChequeSize})]}),(0,k.jsxs)("div",{className:"mb-2",children:[(0,k.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,k.jsx)(v.A,{size:14,className:"text-info"}),(0,k.jsx)("span",{children:"Geography focus:"})]}),(0,k.jsx)("p",{className:"ps-3 mb-0",children:V.geographyFocus})]}),(0,k.jsxs)("div",{className:"mb-2",children:[(0,k.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,k.jsx)(j.A,{size:14,className:"text-primary"}),(0,k.jsx)("span",{children:"Preferred stage:"})]}),(0,k.jsx)("div",{className:"ps-3",children:null!==V&&void 0!==V&&V.preferredStage&&V.preferredStage.length>0?V.preferredStage.map(((e,s)=>(0,k.jsx)("span",{className:"badge bg-light text-dark me-1 mb-1 p-2",children:e},s))):(0,k.jsx)("span",{className:"text-muted",children:"No preferred stages selected"})})]}),(0,k.jsxs)("div",{className:"mb-0",children:[(0,k.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,k.jsx)(n.A,{size:14,className:"text-secondary"}),(0,k.jsx)("span",{children:"Hands-on vs hands-off:"})]}),(0,k.jsx)("p",{className:"ps-3 mb-0",children:V.handsOn})]})]})]})]})]})]}),D&&(0,k.jsx)("div",{style:{position:"fixed",inset:0,zIndex:99999,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"},onClick:()=>Y(!1),children:(0,k.jsxs)("div",{style:{background:"#fff",borderRadius:"16px",maxWidth:"900px",width:"100%",maxHeight:"85vh",overflowY:"auto",padding:"32px",position:"relative"},onClick:e=>e.stopPropagation(),children:[(0,k.jsxs)("div",{className:"d-flex justify-content-between align-items-center mb-4",children:[(0,k.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"\ud83d\udccb Cap Table Visibility & Rules"}),(0,k.jsx)("button",{onClick:()=>Y(!1),style:{background:"none",border:"none",fontSize:"24px",cursor:"pointer",color:"#64748b"},children:"\xd7"})]}),(0,k.jsxs)("div",{className:"row g-4",children:[(0,k.jsx)("div",{className:"col-md-6",children:(0,k.jsxs)("div",{style:{border:"2px solid #CC0000",borderRadius:"12px",padding:"20px",height:"100%"},children:[(0,k.jsx)("h6",{className:"fw-bold mb-3 pb-2 border-bottom",style:{color:"#CC0000",textDecoration:"underline"},children:"Cap Table INVESTOR view the below:"}),(0,k.jsx)("p",{className:"fw-semibold mb-2 small",children:"Who can see this post:"}),(0,k.jsxs)("div",{className:"small mb-3",children:[(0,k.jsxs)("div",{className:"d-flex align-items-start gap-2 mb-1",children:[(0,k.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===B.investor.contact_listed,onChange:()=>ae("investor","contact_listed"),style:{cursor:"pointer"}}),(0,k.jsxs)("div",{children:["Contacts listed on my cap table",(0,k.jsxs)("div",{className:"ms-3 mt-1",children:[(0,k.jsxs)("div",{className:"d-flex align-items-start gap-2 mb-1",children:[(0,k.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===B.investor.portfolio_company,onChange:()=>ae("investor","portfolio_company"),style:{cursor:"pointer"}}),(0,k.jsxs)("span",{style:{color:"#CC0000",fontStyle:"italic"},children:["ONLY contacts from ",(0,k.jsx)("strong",{children:"[SELECT PORTFOLIO COMPANY FROM DROPDOWN]"})," portfolio company"]})]}),(0,k.jsxs)("div",{className:"d-flex align-items-start gap-2",children:[(0,k.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===B.investor.contact_from,onChange:()=>ae("investor","contact_from"),style:{cursor:"pointer"}}),(0,k.jsx)("span",{children:"Contacts from all of my portfolio company cap tables"})]})]})]})]}),(0,k.jsxs)("div",{className:"d-flex align-items-start gap-2 mb-1",children:[(0,k.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===B.investor.capavate_member,onChange:()=>ae("investor","capavate_member"),style:{cursor:"pointer"}}),(0,k.jsx)("span",{children:"Only Capavate Angel Network members (if you are an active member)"})]}),(0,k.jsxs)("div",{className:"d-flex align-items-start gap-2",children:[(0,k.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===B.investor.everyone,onChange:()=>ae("investor","everyone"),style:{cursor:"pointer"}}),(0,k.jsx)("span",{children:"Everyone"})]})]}),(0,k.jsx)("p",{className:"fw-bold mb-2 small",children:"RULES OF ENGAGEMENT ON POSTS:"}),["No solicitation: no sales pitches, no fundraising asks, no capital calls.","Focus on business-related content.","Do not offer, advertise, or sell securities to the general public through Capavate.",'No cold "DM me for a deal" or lead-gen style posts; keep deal discussion in appropriate, permitted channels.',"Be professional, courteous, and constructive in all posts and comments.","Challenge ideas, not people; no personal attacks, insults, or harassment.","No hate speech, discrimination, or threats of any kind.","Keep language clear, concise, and suitable for a professional investor audience.","Do not share private disputes or grievances; resolve those offline.","No spam: no mass tagging, repetitive posts, or irrelevant links."].map(((e,s)=>(0,k.jsxs)("div",{className:"d-flex gap-2 mb-1 small",children:[(0,k.jsxs)("span",{className:"fw-bold flex-shrink-0",style:{color:"#CC0000"},children:[s+1,"."]}),(0,k.jsx)("span",{children:e})]},s)))]})}),(0,k.jsx)("div",{className:"col-md-6",children:(0,k.jsxs)("div",{style:{border:"2px solid #1e40af",borderRadius:"12px",padding:"20px",height:"100%"},children:[(0,k.jsx)("h6",{className:"fw-bold mb-3 pb-2 border-bottom",style:{color:"#1e40af",textDecoration:"underline"},children:"Cap Table COMPANY view the below:"}),(0,k.jsx)("p",{className:"fw-semibold mb-2 small",children:"Who can see this post:"}),(0,k.jsxs)("div",{className:"small mb-3",children:[(0,k.jsxs)("div",{className:"d-flex align-items-start gap-2 mb-1",children:[(0,k.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===B.company.contact_listed,onChange:()=>ae("company","contact_listed"),style:{cursor:"pointer"}}),(0,k.jsxs)("span",{children:["Only contacts on"," ",(0,k.jsx)("span",{style:{color:"#CC0000",fontStyle:"italic"},children:(0,k.jsx)("strong",{children:"[COMPANY NAME]"})})," ","cap table"]})]}),(0,k.jsxs)("div",{className:"d-flex align-items-start gap-2 mb-1",children:[(0,k.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===B.company.capavate_member,onChange:()=>ae("company","capavate_member"),style:{cursor:"pointer"}}),(0,k.jsx)("span",{children:"Only Capavate Angel Network members (if you are an active member or have previously presented to the network)"})]}),(0,k.jsxs)("div",{className:"d-flex align-items-start gap-2",children:[(0,k.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===B.company.everyone,onChange:()=>ae("company","everyone"),style:{cursor:"pointer"}}),(0,k.jsx)("span",{children:"Everyone"})]})]}),(0,k.jsx)("p",{className:"fw-bold mb-2 small",children:"RULES OF ENGAGEMENT ON POSTS:"}),["No solicitation: no sales pitches, no fundraising asks, no capital calls.","Focus on business-related content.","Do not offer, advertise, or sell securities to the general public through Capavate.",'No cold "DM me for a deal" or lead-gen style posts; keep deal discussion in appropriate, permitted channels.',"Be professional, courteous, and constructive in all posts and comments.","Challenge ideas, not people; no personal attacks, insults, or harassment.","No hate speech, discrimination, or threats of any kind.","Keep language clear, concise, and suitable for a professional investor audience.","Do not share private disputes or grievances; resolve those offline.","No spam: no mass tagging, repetitive posts, or irrelevant links."].map(((e,s)=>(0,k.jsxs)("div",{className:"d-flex gap-2 mb-1 small",children:[(0,k.jsxs)("span",{className:"fw-bold flex-shrink-0",style:{color:"#1e40af"},children:[s+1,"."]}),(0,k.jsx)("span",{children:e})]},s)))]})})]}),(0,k.jsxs)("div",{className:"d-flex justify-content-end gap-3 mt-4 pt-3 border-top",children:[Z&&(0,k.jsx)("span",{className:"text-success me-3 align-self-center small fw-bold",children:"\u2713 Saved successfully"}),(0,k.jsx)("button",{onClick:()=>se("Investor"),disabled:$,style:{background:"#CC0000",color:"#fff",border:"none",borderRadius:"8px",padding:"10px 20px",fontWeight:600,fontSize:"14px",cursor:"pointer",opacity:$?.6:1},children:$&&"Investor"===Q?(0,k.jsxs)(k.Fragment,{children:[(0,k.jsx)("span",{className:"spinner-border spinner-border-sm me-2",role:"status"}),"Saving..."]}):"Save Investor Rules"}),(0,k.jsx)("button",{onClick:()=>se("Company"),disabled:$,style:{background:"#1e40af",color:"#fff",border:"none",borderRadius:"8px",padding:"10px 20px",fontWeight:600,fontSize:"14px",cursor:"pointer",opacity:$?.6:1},children:$&&"Company"===Q?(0,k.jsxs)(k.Fragment,{children:[(0,k.jsx)("span",{className:"spinner-border spinner-border-sm me-2",role:"status"}),"Saving..."]}):"Save Company Rules"})]})]})}),N&&(0,k.jsx)(M,{setShowModal:w})]})}},13190:(e,s,a)=>{a.d(s,{A:()=>i});const i=(0,a(77784).A)("briefcase",[["path",{d:"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",key:"jecpp"}],["rect",{width:"20",height:"14",x:"2",y:"6",rx:"2",key:"i6l2r4"}]])},42489:(e,s,a)=>{a.d(s,{A:()=>i});const i=(0,a(77784).A)("shield",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}]])},44919:(e,s,a)=>{a.d(s,{A:()=>i});const i=(0,a(77784).A)("trending-up",[["polyline",{points:"22 7 13.5 15.5 8.5 10.5 2 17",key:"126l90"}],["polyline",{points:"16 7 22 7 22 13",key:"kwv8wd"}]])},55731:(e,s,a)=>{a.d(s,{A:()=>i});const i=(0,a(77784).A)("globe",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]])},62837:(e,s,a)=>{a.d(s,{$K:()=>n,CB:()=>r,Cd:()=>b,I0:()=>c,Jq:()=>x,R3:()=>y,Zw:()=>m,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>t,mg:()=>o,nj:()=>v,pd:()=>j,uM:()=>h,vE:()=>l,z6:()=>p});var i=a(5464);const t=i.default.div`
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
`,l=i.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,n=(i.default.div`
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
`,i.default.div`
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
`,i.default.div`
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
`,i.default.div`
  display: block;
  height: 100%;
`),o=i.default.div`
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
`,r=i.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=i.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=i.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=i.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,m=i.default.div`
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
`,x=(i.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,i.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,i.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,i.default.div`
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
`),h=(i.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,i.default.div`
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
`),u=(i.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,i.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,i.default.div`
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
`,i.default.button`
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
`,i.default.div`
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
`,i.default.video`
  background-color: black;
  border: none;
`,i.default.div`
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
`,i.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,i.default.button`
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
`),f=((0,i.default)(u)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,i.default)(u)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,i.default.sup`
  color: var(--primary);
`),g=i.default.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: ${e=>{let{show:s}=e;return s?"flex":"none"}};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`,b=i.default.div`
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
`,v=i.default.button`
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
`,j=i.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,y=i.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},73062:(e,s,a)=>{a.d(s,{A:()=>i});const i=(0,a(77784).A)("dollar-sign",[["line",{x1:"12",x2:"12",y1:"2",y2:"22",key:"7eqyqh"}],["path",{d:"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",key:"1b0p4s"}]])},81906:(e,s,a)=>{a.d(s,{A:()=>c});var i=a(65043),t=a(9493),l=a(45394),n=a(86213),o=a(73216),r=a(35475),d=a(70579);const c=function(){const[e,s]=(0,i.useState)(!1),a=(0,o.Zp)(),[c,p]=(0,i.useState)(!1),[m,x]=(0,i.useState)(!1);(0,i.useEffect)((()=>{const e=localStorage.getItem("InvestorData");if(e)try{const s=JSON.parse(e);if(!s||"object"!==typeof s)return localStorage.removeItem("InvestorData"),void a("/investor/login",{replace:!0});const i=(new Date).getTime();if(!s.expiry||i>s.expiry)return localStorage.removeItem("InvestorData"),void a("/investor/login",{replace:!0})}catch(s){console.error("Error parsing user data:",s),localStorage.removeItem("InvestorData"),a("/investor/login",{replace:!0})}else a("/investor/login",{replace:!0})}),[a]);const h=()=>{s(!1),x(!1),j(!1)},[u,f]=(0,i.useState)(""),[g,b]=(0,i.useState)(null),[v,j]=(0,i.useState)(!1),y=async()=>{const e=localStorage.getItem("InvestorData"),s=JSON.parse(e);let a={company_id:s.companies[0].id,role_id:s.id};if("owner"===s.role);else try{const e=await n.A.post("https://capavate.com/api/user/aifile/companyRole",a,{headers:{Accept:"application/json","Content-Type":"application/json"}});j(!0),e.data.results.length>0&&b(e.data.results[0].signature_role)}catch(i){}};return(0,d.jsxs)("div",{className:"top_bar px-md-3",children:[(0,d.jsx)("div",{className:"container-fluid",children:(0,d.jsx)("div",{className:" position-relative",children:(0,d.jsxs)("div",{className:"d-flex align-items-center justify-content-between gap-3 flex-wrap",children:[(0,d.jsx)("div",{className:"d-flex align-items-center gap-3",children:(0,d.jsx)(r.N_,{to:"/investor/dashboard",className:"py-2 su-creditb",children:"Dashboard HOME"})}),(0,d.jsx)("div",{className:"d-flex align-items-center justify-content-md-end gap-3 flex-wrap",children:(0,d.jsx)("button",{type:"button",onClick:()=>{localStorage.removeItem("InvestorData"),window.location.href="/investor/login"},title:"Logout",className:"logout_btn_global flex-shrink-0",children:(0,d.jsx)(t.A,{size:20,strokeWidth:1})})})]})})}),e&&u&&(0,d.jsx)("div",{className:"main_popup-overlay",children:(0,d.jsxs)("div",{className:"popup-container",style:{maxWidth:"400px"},children:[(0,d.jsxs)("div",{className:"d-flex align-items-center gap-3 mb-3 justify-content-between",children:[(0,d.jsx)("h2",{className:"popup-title",children:"Subscription Status"}),(0,d.jsx)("button",{type:"button",className:"close_btn_global",onClick:h,"aria-label":"Close",children:(0,d.jsx)(l.LwM,{size:24})})]}),2===u.type?(0,d.jsxs)("div",{onClick:()=>a("/package-subscription"),style:{backgroundColor:"#dc3545",color:"white",padding:"20px",borderRadius:"8px",textAlign:"center",fontWeight:"bold",fontSize:"18px",marginBottom:"15px",cursor:"pointer",transition:"all 0.3s ease",boxShadow:"0 2px 8px rgba(220, 53, 69, 0.3)"},onMouseOver:e=>{e.currentTarget.style.backgroundColor="#bd2130",e.currentTarget.style.transform="scale(1.02)"},onMouseOut:e=>{e.currentTarget.style.backgroundColor="#dc3545",e.currentTarget.style.transform="scale(1)"},children:[(0,d.jsx)("div",{children:"Please Activate Account"}),(0,d.jsx)("small",{style:{fontSize:"14px",opacity:"0.9",marginTop:"8px",display:"block"},children:"Click here to subscribe"})]}):(0,d.jsxs)(d.Fragment,{children:[(0,d.jsx)("div",{style:{backgroundColor:"#28a745",color:"white",padding:"20px",borderRadius:"8px",textAlign:"center",fontWeight:"bold",fontSize:"18px",marginBottom:"15px"},children:"Active Subscription"}),(0,d.jsxs)("ul",{className:"popup-list",children:[(0,d.jsxs)("li",{children:["Access to Dataroom + Investor reporting for 1 year (till"," ",(0,d.jsx)("strong",{children:(N=u.valid_until,new Date(N).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"}))}),")"]}),(0,d.jsxs)("li",{children:["Due diligence documents generated:"," ",(0,d.jsx)("strong",{children:u.total_generated})," / 2 allowed"]}),(0,d.jsxs)("li",{children:["Credit Balance Left:"," ",(0,d.jsx)("strong",{children:u.credit_balance})]}),u.extra_generations>0&&(0,d.jsx)("li",{className:"warn",children:(0,d.jsxs)("strong",{children:[u.extra_generations," additional generation(s) will incur \u20ac100 each"]})})]})]})]})}),m&&(0,d.jsx)("div",{className:"main_popup-overlay",children:(0,d.jsxs)("div",{className:"popup-container",children:[(0,d.jsxs)("div",{className:"d-flex align-items-center gap-3  justify-content-between",children:[(0,d.jsx)("h2",{className:"popup-title",children:"Your Role/Permission"}),(0,d.jsx)("button",{type:"button",className:"close_btn_global",onClick:h,"aria-label":"Close",children:(0,d.jsx)(l.LwM,{size:24})})]}),(0,d.jsx)("ul",{className:"popup-list",children:(0,d.jsx)("li",{children:(0,d.jsx)(r.N_,{onClick:y,to:"javascript:void(0)",children:g})})})]})}),v&&(0,d.jsx)("div",{className:"main_popup-overlay",children:(0,d.jsxs)("div",{className:"popup-container",children:[(0,d.jsxs)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:[(0,d.jsx)("h2",{className:"popup-title",children:"Your Role"}),(0,d.jsx)("button",{type:"button",className:"close_btn_global",onClick:h,"aria-label":"Close",children:(0,d.jsx)(l.LwM,{size:24})})]}),(0,d.jsx)("ul",{className:"popup-list",children:(0,d.jsx)("li",{onClick:y,children:g})})]})})]});var N}},85347:(e,s,a)=>{a.d(s,{A:()=>i});const i=(0,a(77784).A)("award",[["path",{d:"m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526",key:"1yiouv"}],["circle",{cx:"12",cy:"8",r:"6",key:"1vp47v"}]])},94651:(e,s,a)=>{a.d(s,{A:()=>i});const i=(0,a(77784).A)("eye-off",[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]])}}]);
//# sourceMappingURL=2298.eb076d69.chunk.js.map