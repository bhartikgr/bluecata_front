/*! For license information please see 2298.7da6f121.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[2298],{7118:(e,s,a)=>{a.d(s,{A:()=>t});const t=(0,a(77784).A)("users",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["path",{d:"M16 3.13a4 4 0 0 1 0 7.75",key:"1da9ce"}]])},12073:(e,s,a)=>{a.d(s,{A:()=>T});var t=a(65043),i=(a(38421),a(88155),a(73216)),o=a(35475),n=a(53639),l=a(42489),r=a(42983),d=a(9463),c=a(28006),p=a(94651),m=a(35087),x=a(7118),h=a(77784);const u=(0,h.A)("user-plus",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["line",{x1:"19",x2:"19",y1:"8",y2:"14",key:"1bvyxn"}],["line",{x1:"22",x2:"16",y1:"11",y2:"11",key:"1shjgl"}]]);var f=a(13190);const g=(0,h.A)("heart",[["path",{d:"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",key:"c3ymky"}]]);var v=a(85347),b=a(73062),y=a(55731),j=a(44919),N=a(13892),k=a(80899),w=a(70579);function C(e){var s,a;let{label:t,name:i,type:o="text",placeholder:n,formik:l,required:r=!1,className:d=""}=e;const c=(null===l||void 0===l||null===(s=l.touched)||void 0===s?void 0:s[i])&&(null===l||void 0===l||null===(a=l.errors)||void 0===a?void 0:a[i]);return(0,w.jsxs)("div",{className:"d-flex flex-column gap-2 input-deisgn",children:[(0,w.jsxs)("label",{children:[t," ",r&&(0,w.jsx)("span",{className:"text-danger",children:"*"})]}),(0,w.jsx)("input",{type:o,name:i,placeholder:n,className:`form-control rounded-3 ${c?"is-invalid":""} ${d}`,...null!==l&&void 0!==l&&l.getFieldProps?l.getFieldProps(i):{}}),c&&(0,w.jsx)("div",{className:"invalid-feedback",children:l.errors[i]})]})}var _=a(78703);function S(e){let{label:s,name:a,options:t=[],formik:i,required:o=!1,isMulti:n=!1}=e;const l=i.touched[a]&&i.errors[a],r={control:(e,s)=>({...e,backgroundColor:"#fff",borderColor:l||s.isFocused?"#d40209":"#dee2e6",boxShadow:s.isFocused?"0 0 0 0.2rem rgba(212,2,9,.15)":"none","&:hover":{borderColor:"#dee2e6"},minHeight:"45px",borderRadius:"8px",fontSize:"0.85rem",color:"#000000db"}),menu:e=>({...e,borderRadius:"8px",overflow:"hidden"}),option:(e,s)=>({...e,backgroundColor:s.isSelected?"#d40209":s.isFocused?"rgba(212,2,9,.08)":"#fff",color:s.isSelected?"#fff":"#000000db",fontSize:"0.85rem",cursor:"pointer"}),singleValue:e=>({...e,color:"#000000db"}),multiValue:e=>({...e,backgroundColor:"#d40209"}),multiValueLabel:e=>({...e,color:"#fff"}),multiValueRemove:e=>({...e,color:"#fff",":hover":{backgroundColor:"#a50005",color:"#fff"}})};return(0,w.jsxs)("div",{className:"d-flex flex-column gap-2 input-deisgn",children:[(0,w.jsxs)("label",{children:[s," ",o&&(0,w.jsx)("span",{className:"text-danger",children:"*"})]}),(0,w.jsx)(_.Ay,{name:a,options:t,value:n?t.filter((e=>{var s;return null===(s=i.values[a])||void 0===s?void 0:s.includes(e.value)})):t.find((e=>e.value===i.values[a]))||null,onChange:e=>{n?i.setFieldValue(a,e?e.map((e=>e.value)):[]):i.setFieldValue(a,e?e.value:"")},onBlur:()=>i.setFieldTouched(a,!0),isMulti:n,styles:r,classNamePrefix:"react-select"}),l&&(0,w.jsx)("div",{className:"invalid-feedback d-block",children:i.errors[a]})]})}var z=a(76245);const A=(0,h.A)("external-link",[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]);var M=a(25581),E=a(86213);const q=k.Ik({firstName:k.Yj().required("First name is required"),lastName:k.Yj().required("Last name is required"),email:k.Yj().email("Invalid email").required("Email is required"),phone:k.Yj().required("Phone number is required"),city:k.Yj().required("City is required"),country:k.Yj().required("Country is required")});function I(e){let{setShowModal:s,investorData:a}=e;const i=M.J+"api/user/capitalround/",o=M.J+"api/user/investor/",[n,l]=(0,t.useState)([]),[r,d]=(0,t.useState)([]),[c,p]=(0,t.useState)(!1),[m,x]=(0,t.useState)(!1);(0,t.useEffect)((()=>{h(),null!==a&&void 0!==a&&a.id&&u()}),[a]);const h=async()=>{try{const e=await E.A.post(i+"getallcountrySymbolList",{id:""},{headers:{Accept:"application/json","Content-Type":"application/json"}});l(e.data.results||[])}catch(e){console.error("Error fetching countries:",e)}},u=async()=>{try{const e=await E.A.post(o+"getPortfolioCompanies",{investor_id:a.id});d(e.data.results||[])}catch(e){console.error("Error fetching portfolio:",e)}},g=n.map((e=>({label:e.name,value:e.name}))),v=(0,N.Wx)({initialValues:{firstName:(null===a||void 0===a?void 0:a.first_name)||"",lastName:(null===a||void 0===a?void 0:a.last_name)||"",email:(null===a||void 0===a?void 0:a.email)||"",phone:(null===a||void 0===a?void 0:a.phone)||"",city:(null===a||void 0===a?void 0:a.city)||"",country:(null===a||void 0===a?void 0:a.country)||""},validationSchema:q,onSubmit:async e=>{p(!0);try{"1"===(await E.A.post(M.J+"api/user/investor/joinAngelNetwork",{...e,investor_id:null===a||void 0===a?void 0:a.id,portfolio_companies:r})).data.status&&(x(!0),setTimeout((()=>s(!1)),3e3))}catch(t){console.error("Error submitting:",t)}finally{p(!1)}}});return(0,w.jsxs)(w.Fragment,{children:[(0,w.jsx)("div",{className:"modal fade show form-pop",style:{display:"block"},children:(0,w.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-lg",children:(0,w.jsx)("div",{className:"modal-content rounded-4 shadow-lg border-0",children:(0,w.jsxs)("div",{className:"p-4",children:[(0,w.jsxs)("div",{className:"d-flex align-items-start gap-3 mb-4",children:[(0,w.jsx)("div",{className:"rounded-3 d-flex align-items-center justify-content-center flex-shrink-0 bg-danger-subtle text-danger",style:{width:"45px",height:"45px"},children:(0,w.jsxs)("svg",{width:"28",height:"28",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"1.5",children:[(0,w.jsx)("path",{d:"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2",strokeLinecap:"round"}),(0,w.jsx)("circle",{cx:"12",cy:"7",r:"4"})]})}),(0,w.jsx)("div",{className:"flex-grow-1",children:(0,w.jsxs)("div",{className:"d-flex form-pop-head justify-content-between gap-2 align-items-start",children:[(0,w.jsxs)("div",{className:"d-flex flex-column gap-1",children:[(0,w.jsx)("h4",{children:"Join the Capavate Angel Network"}),(0,w.jsx)("p",{children:"Connect with top-tier startups and investment opportunities"})]}),(0,w.jsx)("button",{type:"button",className:"close_btn_pop",onClick:()=>s(!1),children:(0,w.jsx)(z.A,{})})]})})]}),m?(0,w.jsxs)("div",{className:"text-center py-5",children:[(0,w.jsx)("div",{className:"text-success mb-3",children:(0,w.jsx)("svg",{width:"64",height:"64",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,w.jsx)("path",{d:"M20 6L9 17l-5-5",strokeLinecap:"round",strokeLinejoin:"round"})})}),(0,w.jsx)("h5",{className:"mb-2",children:"Successfully Joined!"}),(0,w.jsx)("p",{className:"text-muted",children:"You are now on the Capavate Angel Network waitlist."})]}):(0,w.jsxs)(w.Fragment,{children:[r.length>0&&(0,w.jsxs)("div",{className:"rounded-3 p-3 mb-4 bg-light border-start border-4 border-info",children:[(0,w.jsxs)("div",{className:"d-flex align-items-center gap-2 mb-2",children:[(0,w.jsx)(f.A,{size:18,className:"text-info"}),(0,w.jsx)("h6",{className:"fw-bold mb-0",children:"Your Portfolio Companies"})]}),(0,w.jsx)("div",{className:"d-flex flex-wrap gap-2 mt-2",children:r.map(((e,s)=>(0,w.jsxs)("div",{className:"d-flex align-items-center gap-2 bg-white p-2 rounded-3 shadow-sm",style:{border:"1px solid #dee2e6"},children:[(0,w.jsx)("span",{children:e.name}),e.profile_link&&(0,w.jsx)("a",{href:e.profile_link,target:"_blank",rel:"noopener noreferrer",className:"text-info",children:(0,w.jsx)(A,{size:14})})]},s)))}),(0,w.jsx)("p",{className:"text-muted small mt-2 mb-0",children:"These companies will be notified when you join the network."})]}),(0,w.jsx)("div",{className:"rounded-3 p-3 mb-4 bg_light border-start border-4 border-danger",children:(0,w.jsx)("p",{className:"mb-0 small",children:"Join the Capavate Angel Network to get access to exclusive deal flow, co-investment opportunities, and connect with fellow angel investors."})}),(0,w.jsxs)("form",{className:"d-flex flex-column gap-3",onSubmit:v.handleSubmit,children:[(0,w.jsxs)("div",{className:"row g-3",children:[(0,w.jsx)("div",{className:"col-md-6",children:(0,w.jsx)(C,{label:"First Name",name:"firstName",placeholder:"John",formik:v,required:!0})}),(0,w.jsx)("div",{className:"col-md-6",children:(0,w.jsx)(C,{label:"Last Name",name:"lastName",placeholder:"Doe",formik:v,required:!0})})]}),(0,w.jsxs)("div",{className:"row g-3",children:[(0,w.jsx)("div",{className:"col-md-6",children:(0,w.jsx)(C,{label:"Email Address",name:"email",type:"email",placeholder:"john@example.com",formik:v,required:!0})}),(0,w.jsx)("div",{className:"col-md-6",children:(0,w.jsx)(C,{label:"Phone Number",name:"phone",type:"tel",placeholder:"+1 (555) 123-4567",formik:v,required:!0})})]}),(0,w.jsxs)("div",{className:"row g-3",children:[(0,w.jsx)("div",{className:"col-md-6",children:(0,w.jsx)(C,{label:"City",name:"city",placeholder:"San Francisco",formik:v,required:!0})}),(0,w.jsx)("div",{className:"col-md-6",children:(0,w.jsx)(S,{label:"Country",name:"country",formik:v,required:!0,options:g.length>0?g:[{label:"Loading...",value:""}]})})]}),(0,w.jsxs)("div",{className:"d-flex gap-3 mt-3",children:[(0,w.jsx)("button",{type:"button",className:"button_deisgn bg_light text-black flex-grow-1",onClick:()=>s(!1),children:"Cancel"}),(0,w.jsx)("button",{type:"submit",className:"button_deisgn bg-success flex-grow-1 text-white",disabled:c||v.isSubmitting,children:c?"Joining...":"Join Angel Network"})]})]})]})]})})})}),(0,w.jsx)("div",{className:"modal-backdrop fade show",onClick:()=>s(!1)})]})}var F=a(47196);F.IWF,n.A,l.A;function T(){const[e,s]=(0,t.useState)(!1),[h,N]=(0,t.useState)(null),[k,C]=(0,t.useState)(!1),[_,S]=(0,t.useState)(!1),z=(0,i.zy)(),A=localStorage.getItem("InvestorData"),q=JSON.parse(A),T=(M.J,M.J+"api/user/investor/"),[O,R]=(0,t.useState)(null),[D,Y]=(0,t.useState)(!1);(0,t.useEffect)((()=>{const e=()=>{s(window.innerWidth<786)};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[]),(0,t.useEffect)((()=>{L()}),[]);const L=async()=>{try{var e;const s=await E.A.post(T+"getinvestorData",{id:q.id});if((null===(e=s.data.results)||void 0===e?void 0:e.length)>0){const e=s.data.results[0];console.log(e.capavate_interests),R(e)}else R({})}catch(s){console.error(s),R({})}},P={"/record-round-list":["/createrecord","/record-round-cap-table"]},J=e=>{var s;if(!e||"#"===e)return!1;const a=z.pathname;return a===e||(!!a.startsWith(e+"/")||!(null===(s=P[e])||void 0===s||!s.some((e=>a===e||a.startsWith(e+"/")))))},W={firstName:"John",lastName:"Doe",investorType:"Angel Investor",location:"San Francisco, CA",followers:1250,following:342,portfolioCompanies:["TechStart Inc.","GrowthLabs","FutureFund"],interests:null!==O&&void 0!==O&&O.capavate_interests?null===O||void 0===O?void 0:O.capavate_interests.split(",").map((e=>e.trim())):[],industryExpertise:["Technology","Healthcare","Education"],typicalChequeSize:null!==O&&void 0!==O&&O.cheque_size?null===O||void 0===O?void 0:O.cheque_size.split(",").map((e=>e.trim())):[],geographyFocus:null===O||void 0===O?void 0:O.geo_focus,preferredStage:["Seed","Series A"],handsOn:"Hands-on (Monthly advisory calls)"},[H,V]=(0,t.useState)({investor:{contact_listed:"No",portfolio_company:"No",contact_from:"No",capavate_member:"No",everyone:"No"},company:{contact_listed:"No",portfolio_company:"No",contact_from:"No",capavate_member:"No",everyone:"No"}}),[B,G]=(0,t.useState)(!1),[$,Z]=(0,t.useState)(!1),[K,U]=(0,t.useState)(null);(0,t.useEffect)((()=>{D&&Q()}),[D]);const Q=async()=>{if(null!==q&&void 0!==q&&q.id)try{var e,s;const a=await E.A.post(T+"getCapTableRules",{investor_id:q.id,type:"Investor"}),t=await E.A.post(T+"getCapTableRules",{investor_id:q.id,type:"Company"});V({investor:(null===(e=a.data.results)||void 0===e?void 0:e[0])||{contact_listed:"No",portfolio_company:"No",contact_from:"No",capavate_member:"No",everyone:"No"},company:(null===(s=t.data.results)||void 0===s?void 0:s[0])||{contact_listed:"No",portfolio_company:"No",contact_from:"No",capavate_member:"No",everyone:"No"}})}catch(a){console.error("Error fetching rules:",a)}},X=async e=>{G(!0),U(e);try{const s="Investor"===e?H.investor:H.company,a={investor_id:q.id,type:e,contact_listed:s.contact_listed,portfolio_company:s.portfolio_company||"No",contact_from:s.contact_from||"No",capavate_member:s.capavate_member,everyone:s.everyone};await E.A.post(T+"saveCapTableRules",a),Z(!0),setTimeout((()=>Z(!1)),3e3)}catch(s){console.error("Error saving rules:",s)}finally{G(!1),U(null)}},ee=(e,s)=>{V((a=>({...a,[e]:{...a[e],[s]:"Yes"===a[e][s]?"No":"Yes"}})))};return(0,w.jsxs)(w.Fragment,{children:[(0,w.jsxs)("div",{className:"main_sidenav_social scroll_nonw d-flex flex-column gap-4 p-3 justify-content-start align-items-md-start align-items-center "+(e?"collapsed p-md-3":"p-md-4"),children:[(0,w.jsxs)("div",{className:"d-flex justify-content-between align-items-center w-100",children:[!e&&(0,w.jsx)(o.N_,{to:"/investor/dashboard",className:"com_logo",children:(0,w.jsx)("img",{src:"../../../assets/images/capavate.png",className:"img-fluid rounded",style:{maxHeight:"50px"},alt:"profile",onError:e=>{e.target.onerror=null,e.target.src=a(77572)}})}),(0,w.jsx)("button",{className:"menu_btn",onClick:()=>s(!e),children:e?(0,w.jsx)(r.A,{size:22}):(0,w.jsx)(d.A,{size:22})})]}),!e&&(0,w.jsxs)("div",{className:"company_box bg-white border rounded-3 shadow-sm p-3 w-100",children:[(0,w.jsxs)("div",{className:"d-flex align-items-center gap-2 mb-2",children:[(0,w.jsx)("div",{className:"d-flex align-items-center gap-2 mb-2",children:(0,w.jsx)("div",{className:"avatar-circle bg-primary text-white d-flex align-items-center justify-content-center overflow-hidden",style:{width:"40px",height:"40px",borderRadius:"50%",position:"relative"},children:null!==O&&void 0!==O&&O.profile_picture?(0,w.jsx)("img",{src:M.J+"api/upload/investor/inv_"+(null===O||void 0===O?void 0:O.id)+"/"+(null===O||void 0===O?void 0:O.profile_picture),className:"img-fluid w-100 h-100",style:{objectFit:"cover",width:"100%",height:"100%"},alt:"profile"}):(0,w.jsx)("span",{className:"fw-bold",children:(0,w.jsx)("img",{src:M.J+"api/upload/investor/inv_"+(null===O||void 0===O?void 0:O.id)+"/"+(null===O||void 0===O?void 0:O.profile_picture),className:"img-fluid w-100 h-100",style:{objectFit:"cover",width:"100%",height:"100%"},alt:"profile"})})})}),(0,w.jsx)("div",{children:(0,w.jsx)("h6",{className:"mb-0",children:null!==O&&void 0!==O&&O.screen_name?O.screen_name:`${(null===O||void 0===O?void 0:O.first_name)||""} ${(null===O||void 0===O?void 0:O.last_name)||""}`.trim()})})]}),(0,w.jsx)("div",{className:"details small text-muted d-flex flex-column gap-1",children:(0,w.jsxs)("p",{className:"mb-1 d-flex align-items-center gap-1",children:["Investor Type:",(0,w.jsx)("span",{children:null===O||void 0===O?void 0:O.type_of_investor})]})}),(0,w.jsx)("div",{className:"details small text-muted d-flex flex-column gap-1",children:(0,w.jsxs)("p",{className:"mb-1 d-flex align-items-center gap-1",children:[(0,w.jsx)(c.A,{size:14}),(0,w.jsxs)("span",{children:[null===O||void 0===O?void 0:O.full_address," ",null===O||void 0===O?void 0:O.company_country]})]})})]}),(0,w.jsxs)("ul",{className:"nav flex-column gap-1 w-100",children:[(0,w.jsx)("li",{children:(0,w.jsxs)(o.N_,{to:"/investor/profile",className:"sidebar_item d-flex gap-2 align-items-center "+(J("/investor/profile")?"active":""),children:[(0,w.jsx)(F.IWF,{size:18}),!e&&"Edit Profile"]})}),(0,w.jsx)("li",{children:(0,w.jsxs)(o.N_,{to:"/investor/company-list",className:"sidebar_item d-flex gap-2 align-items-center "+(J("/investor/company-list")||z.pathname.startsWith("/investor/company/capital-round-list")||z.pathname.startsWith("/investor/company/capital-round-list/view")?"active":""),children:[(0,w.jsx)(n.A,{size:18}),!e&&"Company List"]})}),(0,w.jsx)("li",{children:(0,w.jsxs)("span",{className:"sidebar_item d-flex gap-2 align-items-center",onClick:()=>Y(!0),style:{cursor:"pointer"},children:[(0,w.jsx)(l.A,{size:18}),!e&&"Cap Table Rules"]})}),(0,w.jsxs)("li",{className:"mt-3 px-2",children:[(0,w.jsxs)("div",{className:"d-flex justify-content-between align-items-center cursor-pointer mb-2",onClick:()=>{S(!_)},style:{cursor:"pointer"},children:[(0,w.jsx)("span",{className:"fw-bold text-primary",children:"\ud83d\udc7c Angel Profile"}),_?(0,w.jsx)(p.A,{size:16}):(0,w.jsx)(m.A,{size:16})]}),_&&(0,w.jsxs)("div",{className:"small text-muted angel-profile-section",children:[(0,w.jsxs)("div",{className:"row g-2 mb-3",children:[(0,w.jsx)("div",{className:"col-6",children:(0,w.jsxs)("div",{className:"stat-card p-2 bg-light rounded",children:[(0,w.jsx)(x.A,{size:14,className:"me-1"}),(0,w.jsx)("span",{className:"fw-bold",children:W.followers}),(0,w.jsx)("small",{children:" followers"})]})}),(0,w.jsx)("div",{className:"col-6",children:(0,w.jsxs)("div",{className:"stat-card p-2 bg-light rounded",children:[(0,w.jsx)(u,{size:14,className:"me-1"}),(0,w.jsx)("span",{className:"fw-bold",children:W.following}),(0,w.jsx)("small",{children:" following"})]})})]}),(0,w.jsxs)("div",{className:"mb-3",children:[(0,w.jsxs)("div",{className:"d-flex align-items-center gap-1 mb-2",children:[(0,w.jsx)(f.A,{size:14}),(0,w.jsx)("strong",{children:"Portfolio Companies:"})]}),(0,w.jsx)("ul",{className:"ps-3 mb-0",children:null!==W&&void 0!==W&&W.portfolioCompanies&&W.portfolioCompanies.length>0?W.portfolioCompanies.map(((e,s)=>(0,w.jsx)("li",{className:"mb-1",children:e},s))):(0,w.jsx)("li",{className:"text-muted",children:"No portfolio companies listed"})})]}),(0,w.jsx)("div",{className:"mb-3",children:(0,w.jsx)("button",{className:"btn btn-danger w-100 fw-bold py-2",onClick:()=>C(!0),style:{background:"linear-gradient(135deg, #dc3545 0%, #bb2d3b 100%)",border:"none",borderRadius:"8px"},children:"Join Capavate Angel Network"})}),(0,w.jsxs)("div",{className:"profile-details",children:[(0,w.jsx)("p",{className:"mb-2 fw-bold",children:"Profile:"}),(0,w.jsxs)("div",{className:"mb-2",children:[(0,w.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,w.jsx)(g,{size:14,className:"text-danger"}),(0,w.jsx)("span",{children:"Interests:"})]}),(0,w.jsx)("div",{className:"ps-3",children:null!==W&&void 0!==W&&W.interests&&W.interests.length>0?W.interests.map(((e,s)=>(0,w.jsx)("span",{className:"badge bg-light text-dark me-1 mb-1 p-2",children:e},s))):(0,w.jsx)("span",{className:"text-muted",children:"No interests added yet"})})]}),(0,w.jsxs)("div",{className:"mb-2",children:[(0,w.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,w.jsx)(v.A,{size:14,className:"text-warning"}),(0,w.jsx)("span",{children:"Industry Expertise:"})]}),(0,w.jsx)("div",{className:"ps-3",children:null!==W&&void 0!==W&&W.industryExpertise&&W.industryExpertise.length>0?W.industryExpertise.map(((e,s)=>(0,w.jsx)("span",{className:"badge bg-light text-dark me-1 mb-1 p-2",children:e},s))):(0,w.jsx)("span",{className:"text-muted",children:"No industry expertise added yet"})})]}),(0,w.jsxs)("div",{className:"mb-2",children:[(0,w.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,w.jsx)(b.A,{size:14,className:"text-success"}),(0,w.jsx)("span",{children:"Typical cheque size:"})]}),(0,w.jsx)("p",{className:"ps-3 mb-0",children:Array.isArray(W.typicalChequeSize)?W.typicalChequeSize.join(", "):W.typicalChequeSize})]}),(0,w.jsxs)("div",{className:"mb-2",children:[(0,w.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,w.jsx)(y.A,{size:14,className:"text-info"}),(0,w.jsx)("span",{children:"Geography focus:"})]}),(0,w.jsx)("p",{className:"ps-3 mb-0",children:W.geographyFocus})]}),(0,w.jsxs)("div",{className:"mb-2",children:[(0,w.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,w.jsx)(j.A,{size:14,className:"text-primary"}),(0,w.jsx)("span",{children:"Preferred stage:"})]}),(0,w.jsx)("div",{className:"ps-3",children:null!==W&&void 0!==W&&W.preferredStage&&W.preferredStage.length>0?W.preferredStage.map(((e,s)=>(0,w.jsx)("span",{className:"badge bg-light text-dark me-1 mb-1 p-2",children:e},s))):(0,w.jsx)("span",{className:"text-muted",children:"No preferred stages selected"})})]}),(0,w.jsxs)("div",{className:"mb-0",children:[(0,w.jsxs)("div",{className:"d-flex align-items-center gap-1",children:[(0,w.jsx)(l.A,{size:14,className:"text-secondary"}),(0,w.jsx)("span",{children:"Hands-on vs hands-off:"})]}),(0,w.jsx)("p",{className:"ps-3 mb-0",children:W.handsOn})]})]})]})]})]})]}),D&&(0,w.jsx)("div",{style:{position:"fixed",inset:0,zIndex:99999,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"},onClick:()=>Y(!1),children:(0,w.jsxs)("div",{style:{background:"#fff",borderRadius:"16px",maxWidth:"900px",width:"100%",maxHeight:"85vh",overflowY:"auto",padding:"32px",position:"relative"},onClick:e=>e.stopPropagation(),children:[(0,w.jsxs)("div",{className:"d-flex justify-content-between align-items-center mb-4",children:[(0,w.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"\ud83d\udccb Cap Table Visibility & Rules"}),(0,w.jsx)("button",{onClick:()=>Y(!1),style:{background:"none",border:"none",fontSize:"24px",cursor:"pointer",color:"#64748b"},children:"\xd7"})]}),(0,w.jsxs)("div",{className:"row g-4",children:[(0,w.jsx)("div",{className:"col-md-6",children:(0,w.jsxs)("div",{style:{border:"2px solid #CC0000",borderRadius:"12px",padding:"20px",height:"100%"},children:[(0,w.jsx)("h6",{className:"fw-bold mb-3 pb-2 border-bottom",style:{color:"#CC0000",textDecoration:"underline"},children:"Cap Table INVESTOR view the below:"}),(0,w.jsx)("p",{className:"fw-semibold mb-2 small",children:"Who can see this post:"}),(0,w.jsxs)("div",{className:"small mb-3",children:[(0,w.jsxs)("div",{className:"d-flex align-items-start gap-2 mb-1",children:[(0,w.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===H.investor.contact_listed,onChange:()=>ee("investor","contact_listed"),style:{cursor:"pointer"}}),(0,w.jsxs)("div",{children:["Contacts listed on my cap table",(0,w.jsxs)("div",{className:"ms-3 mt-1",children:[(0,w.jsxs)("div",{className:"d-flex align-items-start gap-2 mb-1",children:[(0,w.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===H.investor.portfolio_company,onChange:()=>ee("investor","portfolio_company"),style:{cursor:"pointer"}}),(0,w.jsxs)("span",{style:{color:"#CC0000",fontStyle:"italic"},children:["ONLY contacts from ",(0,w.jsx)("strong",{children:"[SELECT PORTFOLIO COMPANY FROM DROPDOWN]"})," portfolio company"]})]}),(0,w.jsxs)("div",{className:"d-flex align-items-start gap-2",children:[(0,w.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===H.investor.contact_from,onChange:()=>ee("investor","contact_from"),style:{cursor:"pointer"}}),(0,w.jsx)("span",{children:"Contacts from all of my portfolio company cap tables"})]})]})]})]}),(0,w.jsxs)("div",{className:"d-flex align-items-start gap-2 mb-1",children:[(0,w.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===H.investor.capavate_member,onChange:()=>ee("investor","capavate_member"),style:{cursor:"pointer"}}),(0,w.jsx)("span",{children:"Only Capavate Angel Network members (if you are an active member)"})]}),(0,w.jsxs)("div",{className:"d-flex align-items-start gap-2",children:[(0,w.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===H.investor.everyone,onChange:()=>ee("investor","everyone"),style:{cursor:"pointer"}}),(0,w.jsx)("span",{children:"Everyone"})]})]}),(0,w.jsx)("p",{className:"fw-bold mb-2 small",children:"RULES OF ENGAGEMENT ON POSTS:"}),["No solicitation: no sales pitches, no fundraising asks, no capital calls.","Focus on business-related content.","Do not offer, advertise, or sell securities to the general public through Capavate.",'No cold "DM me for a deal" or lead-gen style posts; keep deal discussion in appropriate, permitted channels.',"Be professional, courteous, and constructive in all posts and comments.","Challenge ideas, not people; no personal attacks, insults, or harassment.","No hate speech, discrimination, or threats of any kind.","Keep language clear, concise, and suitable for a professional investor audience.","Do not share private disputes or grievances; resolve those offline.","No spam: no mass tagging, repetitive posts, or irrelevant links."].map(((e,s)=>(0,w.jsxs)("div",{className:"d-flex gap-2 mb-1 small",children:[(0,w.jsxs)("span",{className:"fw-bold flex-shrink-0",style:{color:"#CC0000"},children:[s+1,"."]}),(0,w.jsx)("span",{children:e})]},s)))]})}),(0,w.jsx)("div",{className:"col-md-6",children:(0,w.jsxs)("div",{style:{border:"2px solid #1e40af",borderRadius:"12px",padding:"20px",height:"100%"},children:[(0,w.jsx)("h6",{className:"fw-bold mb-3 pb-2 border-bottom",style:{color:"#1e40af",textDecoration:"underline"},children:"Cap Table COMPANY view the below:"}),(0,w.jsx)("p",{className:"fw-semibold mb-2 small",children:"Who can see this post:"}),(0,w.jsxs)("div",{className:"small mb-3",children:[(0,w.jsxs)("div",{className:"d-flex align-items-start gap-2 mb-1",children:[(0,w.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===H.company.contact_listed,onChange:()=>ee("company","contact_listed"),style:{cursor:"pointer"}}),(0,w.jsxs)("span",{children:["Only contacts on"," ",(0,w.jsx)("span",{style:{color:"#CC0000",fontStyle:"italic"},children:(0,w.jsx)("strong",{children:"[COMPANY NAME]"})})," ","cap table"]})]}),(0,w.jsxs)("div",{className:"d-flex align-items-start gap-2 mb-1",children:[(0,w.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===H.company.capavate_member,onChange:()=>ee("company","capavate_member"),style:{cursor:"pointer"}}),(0,w.jsx)("span",{children:"Only Capavate Angel Network members (if you are an active member or have previously presented to the network)"})]}),(0,w.jsxs)("div",{className:"d-flex align-items-start gap-2",children:[(0,w.jsx)("input",{type:"checkbox",className:"mt-1 flex-shrink-0",checked:"Yes"===H.company.everyone,onChange:()=>ee("company","everyone"),style:{cursor:"pointer"}}),(0,w.jsx)("span",{children:"Everyone"})]})]}),(0,w.jsx)("p",{className:"fw-bold mb-2 small",children:"RULES OF ENGAGEMENT ON POSTS:"}),["No solicitation: no sales pitches, no fundraising asks, no capital calls.","Focus on business-related content.","Do not offer, advertise, or sell securities to the general public through Capavate.",'No cold "DM me for a deal" or lead-gen style posts; keep deal discussion in appropriate, permitted channels.',"Be professional, courteous, and constructive in all posts and comments.","Challenge ideas, not people; no personal attacks, insults, or harassment.","No hate speech, discrimination, or threats of any kind.","Keep language clear, concise, and suitable for a professional investor audience.","Do not share private disputes or grievances; resolve those offline.","No spam: no mass tagging, repetitive posts, or irrelevant links."].map(((e,s)=>(0,w.jsxs)("div",{className:"d-flex gap-2 mb-1 small",children:[(0,w.jsxs)("span",{className:"fw-bold flex-shrink-0",style:{color:"#1e40af"},children:[s+1,"."]}),(0,w.jsx)("span",{children:e})]},s)))]})})]}),(0,w.jsxs)("div",{className:"d-flex justify-content-end gap-3 mt-4 pt-3 border-top",children:[$&&(0,w.jsx)("span",{className:"text-success me-3 align-self-center small fw-bold",children:"\u2713 Saved successfully"}),(0,w.jsx)("button",{onClick:()=>X("Investor"),disabled:B,style:{background:"#CC0000",color:"#fff",border:"none",borderRadius:"8px",padding:"10px 20px",fontWeight:600,fontSize:"14px",cursor:"pointer",opacity:B?.6:1},children:B&&"Investor"===K?(0,w.jsxs)(w.Fragment,{children:[(0,w.jsx)("span",{className:"spinner-border spinner-border-sm me-2",role:"status"}),"Saving..."]}):"Save Investor Rules"}),(0,w.jsx)("button",{onClick:()=>X("Company"),disabled:B,style:{background:"#1e40af",color:"#fff",border:"none",borderRadius:"8px",padding:"10px 20px",fontWeight:600,fontSize:"14px",cursor:"pointer",opacity:B?.6:1},children:B&&"Company"===K?(0,w.jsxs)(w.Fragment,{children:[(0,w.jsx)("span",{className:"spinner-border spinner-border-sm me-2",role:"status"}),"Saving..."]}):"Save Company Rules"})]})]})}),k&&(0,w.jsx)(I,{setShowModal:C})]})}},13190:(e,s,a)=>{a.d(s,{A:()=>t});const t=(0,a(77784).A)("briefcase",[["path",{d:"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",key:"jecpp"}],["rect",{width:"20",height:"14",x:"2",y:"6",rx:"2",key:"i6l2r4"}]])},42489:(e,s,a)=>{a.d(s,{A:()=>t});const t=(0,a(77784).A)("shield",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}]])},44919:(e,s,a)=>{a.d(s,{A:()=>t});const t=(0,a(77784).A)("trending-up",[["polyline",{points:"22 7 13.5 15.5 8.5 10.5 2 17",key:"126l90"}],["polyline",{points:"16 7 22 7 22 13",key:"kwv8wd"}]])},53639:(e,s,a)=>{a.d(s,{A:()=>t});const t=(0,a(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},55731:(e,s,a)=>{a.d(s,{A:()=>t});const t=(0,a(77784).A)("globe",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]])},62837:(e,s,a)=>{a.d(s,{$K:()=>n,CB:()=>r,Cd:()=>v,I0:()=>c,Jq:()=>x,R3:()=>j,Zw:()=>m,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>i,mg:()=>l,nj:()=>b,pd:()=>y,uM:()=>h,vE:()=>o,z6:()=>p});var t=a(5464);const i=t.default.div`
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
`,o=t.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,n=(t.default.div`
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
`,t.default.div`
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
`,t.default.div`
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
`,t.default.div`
  display: block;
  height: 100%;
`),l=t.default.div`
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
`,r=t.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=t.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=t.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=t.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,m=t.default.div`
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
`,x=(t.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,t.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,t.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,t.default.div`
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
`),h=(t.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,t.default.div`
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
`),u=(t.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,t.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,t.default.div`
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
`,t.default.button`
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
`,t.default.div`
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
`,t.default.video`
  background-color: black;
  border: none;
`,t.default.div`
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
`,t.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,t.default.button`
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
`),f=((0,t.default)(u)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,t.default)(u)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,t.default.sup`
  color: var(--primary);
`),g=t.default.div`
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
`,v=t.default.div`
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
`,b=t.default.button`
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
`,y=t.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,j=t.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},73062:(e,s,a)=>{a.d(s,{A:()=>t});const t=(0,a(77784).A)("dollar-sign",[["line",{x1:"12",x2:"12",y1:"2",y2:"22",key:"7eqyqh"}],["path",{d:"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",key:"1b0p4s"}]])},81906:(e,s,a)=>{a.d(s,{A:()=>c});var t=a(65043),i=a(9493),o=a(45394),n=a(86213),l=a(73216),r=a(35475),d=a(70579);const c=function(){const[e,s]=(0,t.useState)(!1),a=(0,l.Zp)(),[c,p]=(0,t.useState)(!1),[m,x]=(0,t.useState)(!1);(0,t.useEffect)((()=>{const e=localStorage.getItem("InvestorData");if(e)try{const s=JSON.parse(e);if(!s||"object"!==typeof s)return localStorage.removeItem("InvestorData"),void a("/investor/login",{replace:!0});const t=(new Date).getTime();if(!s.expiry||t>s.expiry)return localStorage.removeItem("InvestorData"),void a("/investor/login",{replace:!0})}catch(s){console.error("Error parsing user data:",s),localStorage.removeItem("InvestorData"),a("/investor/login",{replace:!0})}else a("/investor/login",{replace:!0})}),[a]);const h=()=>{s(!1),x(!1),y(!1)},[u,f]=(0,t.useState)(""),[g,v]=(0,t.useState)(null),[b,y]=(0,t.useState)(!1),j=async()=>{const e=localStorage.getItem("InvestorData"),s=JSON.parse(e);let a={company_id:s.companies[0].id,role_id:s.id};if("owner"===s.role);else try{const e=await n.A.post("https://capavate.com/api/user/aifile/companyRole",a,{headers:{Accept:"application/json","Content-Type":"application/json"}});y(!0),e.data.results.length>0&&v(e.data.results[0].signature_role)}catch(t){}};return(0,d.jsxs)("div",{className:"top_bar px-md-3",children:[(0,d.jsx)("div",{className:"container-fluid",children:(0,d.jsx)("div",{className:" position-relative",children:(0,d.jsxs)("div",{className:"d-flex align-items-center justify-content-between gap-3 flex-wrap",children:[(0,d.jsx)("div",{className:"d-flex align-items-center gap-3",children:(0,d.jsx)(r.N_,{to:"/investor/dashboard",className:"py-2 su-creditb",children:"Dashboard HOME"})}),(0,d.jsx)("div",{className:"d-flex align-items-center justify-content-md-end gap-3 flex-wrap",children:(0,d.jsx)("button",{type:"button",onClick:()=>{localStorage.removeItem("InvestorData"),window.location.href="/investor/login"},title:"Logout",className:"logout_btn_global flex-shrink-0",children:(0,d.jsx)(i.A,{size:20,strokeWidth:1})})})]})})}),e&&u&&(0,d.jsx)("div",{className:"main_popup-overlay",children:(0,d.jsxs)("div",{className:"popup-container",style:{maxWidth:"400px"},children:[(0,d.jsxs)("div",{className:"d-flex align-items-center gap-3 mb-3 justify-content-between",children:[(0,d.jsx)("h2",{className:"popup-title",children:"Subscription Status"}),(0,d.jsx)("button",{type:"button",className:"close_btn_global",onClick:h,"aria-label":"Close",children:(0,d.jsx)(o.LwM,{size:24})})]}),2===u.type?(0,d.jsxs)("div",{onClick:()=>a("/package-subscription"),style:{backgroundColor:"#dc3545",color:"white",padding:"20px",borderRadius:"8px",textAlign:"center",fontWeight:"bold",fontSize:"18px",marginBottom:"15px",cursor:"pointer",transition:"all 0.3s ease",boxShadow:"0 2px 8px rgba(220, 53, 69, 0.3)"},onMouseOver:e=>{e.currentTarget.style.backgroundColor="#bd2130",e.currentTarget.style.transform="scale(1.02)"},onMouseOut:e=>{e.currentTarget.style.backgroundColor="#dc3545",e.currentTarget.style.transform="scale(1)"},children:[(0,d.jsx)("div",{children:"Please Activate Account"}),(0,d.jsx)("small",{style:{fontSize:"14px",opacity:"0.9",marginTop:"8px",display:"block"},children:"Click here to subscribe"})]}):(0,d.jsxs)(d.Fragment,{children:[(0,d.jsx)("div",{style:{backgroundColor:"#28a745",color:"white",padding:"20px",borderRadius:"8px",textAlign:"center",fontWeight:"bold",fontSize:"18px",marginBottom:"15px"},children:"Active Subscription"}),(0,d.jsxs)("ul",{className:"popup-list",children:[(0,d.jsxs)("li",{children:["Access to Dataroom + Investor reporting for 1 year (till"," ",(0,d.jsx)("strong",{children:(N=u.valid_until,new Date(N).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"}))}),")"]}),(0,d.jsxs)("li",{children:["Due diligence documents generated:"," ",(0,d.jsx)("strong",{children:u.total_generated})," / 2 allowed"]}),(0,d.jsxs)("li",{children:["Credit Balance Left:"," ",(0,d.jsx)("strong",{children:u.credit_balance})]}),u.extra_generations>0&&(0,d.jsx)("li",{className:"warn",children:(0,d.jsxs)("strong",{children:[u.extra_generations," additional generation(s) will incur \u20ac100 each"]})})]})]})]})}),m&&(0,d.jsx)("div",{className:"main_popup-overlay",children:(0,d.jsxs)("div",{className:"popup-container",children:[(0,d.jsxs)("div",{className:"d-flex align-items-center gap-3  justify-content-between",children:[(0,d.jsx)("h2",{className:"popup-title",children:"Your Role/Permission"}),(0,d.jsx)("button",{type:"button",className:"close_btn_global",onClick:h,"aria-label":"Close",children:(0,d.jsx)(o.LwM,{size:24})})]}),(0,d.jsx)("ul",{className:"popup-list",children:(0,d.jsx)("li",{children:(0,d.jsx)(r.N_,{onClick:j,to:"javascript:void(0)",children:g})})})]})}),b&&(0,d.jsx)("div",{className:"main_popup-overlay",children:(0,d.jsxs)("div",{className:"popup-container",children:[(0,d.jsxs)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:[(0,d.jsx)("h2",{className:"popup-title",children:"Your Role"}),(0,d.jsx)("button",{type:"button",className:"close_btn_global",onClick:h,"aria-label":"Close",children:(0,d.jsx)(o.LwM,{size:24})})]}),(0,d.jsx)("ul",{className:"popup-list",children:(0,d.jsx)("li",{onClick:j,children:g})})]})})]});var N}},85347:(e,s,a)=>{a.d(s,{A:()=>t});const t=(0,a(77784).A)("award",[["path",{d:"m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526",key:"1yiouv"}],["circle",{cx:"12",cy:"8",r:"6",key:"1vp47v"}]])},94651:(e,s,a)=>{a.d(s,{A:()=>t});const t=(0,a(77784).A)("eye-off",[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]])}}]);
//# sourceMappingURL=2298.7da6f121.chunk.js.map