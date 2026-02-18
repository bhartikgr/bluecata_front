"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[9033],{9191:()=>{},29033:(e,n,a)=>{a.r(n),a.d(n,{default:()=>x});var t=a(65043),i=a(77266),r=a(42552),s=(a(38421),a(53579)),o=(a(83656),a(86213)),l=a(73216),c=a(26632),d=(a(65016),a(62837)),p=a(24910),m=a(62585),h=(a(9191),a(25581)),u=a(70579);function x(){const e=localStorage.getItem("OwnerLoginData"),n=JSON.parse(e),a=h.J+"api/user/",x=h.J+"api/user/company/";var f=h.J+"api/user/capitalround/";document.title="Add Company";const[g,b]=(0,t.useState)(!1),[y,v]=(0,t.useState)(""),[j,_]=(0,t.useState)(""),w=(0,t.useRef)(null),[N,C]=(0,t.useState)(!1),[k,S]=(0,t.useState)(0),[O,z]=(0,t.useState)(0),[E,q]=(0,t.useState)(0),[A,I]=(0,t.useState)(!0),[D,M]=(0,t.useState)(!1),[F,W]=(0,t.useState)(!1),[L,P]=(0,t.useState)({phone:"",city_step2:"",company_street_address:"",company_industory:"",company_name:"",year_registration:"",company_website:"",employee_number:"",company_linkedin:"",descriptionStep4:"",problemStep4:"",solutionStep4:"",company_state:"",company_postal_code:"",company_country:"",company_email:""}),[T,R]=(0,t.useState)(""),[U,$]=(0,t.useState)(!1),B=(0,l.Zp)(),[H,V]=(0,t.useState)([]);(0,t.useEffect)((()=>{Y()}),[]);const Y=async()=>{let e={investor_id:""};try{const n=await o.A.post(f+"getIndustryExpertise",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});V(n.data.results)}catch(n){}};(0,t.useEffect)((()=>{Z()}),[]),(0,t.useEffect)((()=>{J()}),[]);const J=async()=>{const e={user_id:n.id};try{const n=await o.A.post(x+"getUserOwnerDetail",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});n.data.results.length>0&&R(n.data.results[0])}catch(a){console.error("Error generating summary",a)}},Z=async()=>{let e={user_id:n.id};try{const n=await o.A.post(a+"getcompanydetail",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});_(n.data.results[0])}catch(t){console.error("Error fetching company details:",t)}},K=e=>!!new RegExp("^(https?:\\/\\/)?((([a-zA-Z0-9\\-])+\\.)+[a-zA-Z]{2,})(\\:[0-9]{1,5})?(\\/.*)?$","i").test(e),[G,Q]=(0,t.useState)("");(0,t.useEffect)((()=>{X()}),[]);const X=async()=>{try{const e=await o.A.post(a+"getallcountry",L,{headers:{Accept:"application/json","Content-Type":"application/json"}});ve(e.data.results)}catch(e){}},[ee,ne]=(0,t.useState)([{first_name:"",last_name:"",email:"",confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:""}]),[ae,te]=(0,t.useState)(ee.map((()=>({emailMatch:""})))),ie=(e,n)=>{const{name:a,value:t}=n.target,i=[...ee];i[e][a]=t;const r=[...ae];if(r[e]||(r[e]={}),"signatory_email"===a||"signatory_confirm_email"===a){const n=i[e].signatory_email,a=i[e].signatory_confirm_email;r[e].emailMatch=n&&a&&n!==a?"Emails do not match!":""}if("signatory_email"===a&&!i[e].isCurrentUser){const n=i.map(((e,n)=>({email:e.signatory_email,index:n}))),a=n.filter(((e,a)=>e.email&&n.findIndex((n=>n.email===e.email))!==a));a.length>0?r[e].emailMatch="Email must be unique!":i[e].signatory_email===i[e].signatory_confirm_email&&(r[e].emailMatch="")}"signature_role"===a&&"Other"!==t&&(i[e].other_role=""),ne(i),te(r)},[re,se]=(0,t.useState)("");(0,t.useEffect)((()=>{if("Yes"===re){if(!ee.some((e=>e.isCurrentUser))){const e={first_name:T.first_name||"",last_name:T.last_name||"",signatory_email:T.email||"",signatory_confirm_email:T.email||"",linked_in:"",phone:T.phone_number||"",signature_role:"Founder and Chief Executive Officer (CEO) \u2013 Visionary and strategic leader",other_role:"",isCurrentUser:!0};ne([e]),te([{emailMatch:""}])}}else"No"===re&&(ne([{first_name:"",last_name:"",signatory_email:"",signatory_confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:"",isCurrentUser:!1}]),te([{emailMatch:""}]))}),[re,T]);const[oe,le]=(0,t.useState)({emailMatch:""}),[ce,de]=(0,t.useState)([]),[pe,me]=(0,t.useState)(null),[he,ue]=(0,t.useState)(""),[xe,fe]=(0,t.useState)(""),[ge,be]=(0,t.useState)(!0),[ye,ve]=(0,t.useState)([]),[je,_e]=(0,t.useState)(""),[we,Ne]=(0,t.useState)([]),Ce=ye.map((e=>({value:e.code,label:e.name}))),ke=e=>{const{name:n,value:a}=e.target;P((e=>({...e,[n]:a}))),"email"!==n&&"confirm_email"!==n||("email"===n&&a!==L.confirm_email||"confirm_email"===n&&a!==L.email?le((e=>({...e,emailMatch:"Emails do not match."}))):le((e=>({...e,emailMatch:""}))))},[Se,Oe]=(0,t.useState)(!1);return(0,u.jsxs)(u.Fragment,{children:[(0,u.jsx)(s.mO,{children:(0,u.jsx)("div",{className:"fullpage d-block",children:(0,u.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,u.jsx)(r.A,{isCollapsed:Se,setIsCollapsed:Oe}),(0,u.jsxs)("div",{className:"global_view "+(Se?"global_view_col":""),children:[(0,u.jsx)(i.A,{}),(0,u.jsx)(s.$K,{className:"d-block p-md-4 p-3",children:(0,u.jsxs)("div",{className:"container-fluid",children:[y&&(0,u.jsx)("div",{className:""+(g?" mt-3 error_pop":"success_pop mt-3"),children:y}),(0,u.jsxs)("div",{className:"profile-card",children:[A&&(0,u.jsx)("div",{className:"profile-header",children:(0,u.jsxs)("div",{className:"d-flex align-items-center justify-content-between gap-3 w-100",children:[(0,u.jsxs)("div",{className:"d-flex align-items-center justify-content-start gap-2",children:[(0,u.jsx)("div",{className:"profile-icon",children:(0,u.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,u.jsx)("path",{d:"M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"}),(0,u.jsx)("path",{d:"M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z"})]})}),(0,u.jsx)("div",{className:"profile-title",children:(0,u.jsx)("h2",{children:"Company Contact Info"})})]}),(0,u.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"1/3"})]})}),(0,u.jsx)("div",{className:"profile-content",children:(0,u.jsxs)("div",{className:"row g-3",children:[(0,u.jsx)("div",{className:"col-12 m-0 p-0",children:A&&(0,u.jsxs)("form",{onSubmit:()=>{if(""!==L.company_website){if(!K(L.company_website))return w.current.scrollIntoView({behavior:"smooth",block:"center"}),void C(!0);C(!1)}M(!0),I(!1)},method:"post",action:"javascript:void(0)",children:[(0,u.jsxs)("div",{className:"row g-3",children:[(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsxs)("label",{htmlFor:"company_name",className:"label_fontWeight",children:["Name of Company"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("input",{value:L.company_name,required:!0,type:"text",name:"company_name",id:"company_name",onChange:ke,className:"form-control",placeholder:"Enter company name"})]}),(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsxs)("label",{htmlFor:"company_name",className:"label_fontWeight",children:["Company Email"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("input",{value:L.company_email,required:!0,type:"text",name:"company_email",id:"company_email",onChange:ke,className:"form-control",placeholder:"Enter company email"})]}),(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsxs)("label",{htmlFor:"Industry",className:"label_fontWeight",children:["Industry ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsxs)("select",{id:"Industry",value:L.company_industory,className:"form-select",onChange:ke,name:"company_industory",required:!0,children:[(0,u.jsx)("option",{value:"",children:"Industry"}),H.map(((e,n)=>(0,u.jsx)("option",{value:e.value||e.name,children:e.name},n)))]})]}),(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsxs)("label",{htmlFor:"phone",className:"label_fontWeight",children:["Phone ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)(c.Ay,{required:!0,value:L.phone,name:"phone",defaultCountry:"CA",onChange:e=>{P({...L,phone:e}),e&&e.replace(/\D/g,"").length<10?Q("Phone number must be at least 10 digits"):Q("")},className:"phonregister form-control",placeholder:"Enter phone number"}),G&&(0,u.jsx)("small",{style:{color:"red"},children:G})]}),(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsxs)("label",{htmlFor:"company_website",className:"label_fontWeight",children:["Company Website / URL"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("input",{ref:w,type:"text",required:!0,value:L.company_website,onChange:ke,name:"company_website",id:"company_website",className:"form-control",placeholder:"Enter your company url"}),N&&(0,u.jsx)("div",{style:{fontSize:"13px"},className:"text-danger fw-semibold",children:"Please enter valid website url (eg:www.domain.com)"})]}),(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsxs)("label",{htmlFor:"employee_number",className:"label_fontWeight",children:["Number of Employees"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsxs)("select",{required:!0,onChange:ke,defaultValue:L.employee_number,name:"employee_number",id:"employee_number",className:"form-select",children:[(0,u.jsx)("option",{value:"",children:"Select employee count range"}),(0,u.jsx)("option",{value:"1-10",children:"1-10 employees"}),(0,u.jsx)("option",{value:"11-50",children:"11-50 employees"}),(0,u.jsx)("option",{value:"51-200",children:"51-200 employees"}),(0,u.jsx)("option",{value:"201-500",children:"201-500 employees"}),(0,u.jsx)("option",{value:"501-1000",children:"501-1000 employees"}),(0,u.jsx)("option",{value:"1000+",children:"1000+ employees"})]})]}),(0,u.jsxs)("div",{className:"col-12",children:[(0,u.jsxs)("label",{htmlFor:"year_registration",className:"label_fontWeight",children:["Date of Registration"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("input",{type:"date",required:!0,value:L.year_registration||"",name:"year_registration",id:"year_registration",className:"form-control",onChange:e=>{P((n=>({...n,year_registration:e.target.value})))}})]}),(0,u.jsxs)("div",{className:"col-12",children:[(0,u.jsxs)("label",{className:"label_fontWeight",children:["One-sentence headliner about the company"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("textarea",{required:!0,id:"description",name:"descriptionStep4",className:"form-control",maxLength:"800",value:L.descriptionStep4,onChange:e=>{const n=e.target.value,{name:a,value:t}=e.target;P((e=>({...e,[a]:t}))),S(n.length)},placeholder:"Max 800 characters..."}),(0,u.jsxs)("div",{className:"char-count",children:[k,"/800"]})]}),(0,u.jsxs)("div",{className:"col-12",children:[(0,u.jsxs)("label",{className:"label_fontWeight",children:["What problem are you solving?"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("textarea",{required:!0,id:"problem",name:"problemStep4",className:"form-control",maxLength:"400",value:L.problemStep4,onChange:e=>{const n=e.target.value,{name:a,value:t}=e.target;P((e=>({...e,[a]:t}))),z(n.length)},placeholder:"Max 400 characters..."}),(0,u.jsxs)("div",{className:"char-count",children:[O,"/400"]})]}),(0,u.jsxs)("div",{className:"col-12",children:[(0,u.jsxs)("label",{className:"label_fontWeight",children:["What is Your Solution to the Problem?"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("textarea",{required:!0,id:"solution",name:"solutionStep4",className:"form-control",maxLength:"400",value:L.solutionStep4,onChange:e=>{const n=e.target.value,{name:a,value:t}=e.target;P((e=>({...e,[a]:t}))),q(n.length)},placeholder:"Max 400 characters..."}),(0,u.jsxs)("div",{className:"char-count",children:[E,"/400"]})]})]}),(0,u.jsx)("div",{className:"col-12",children:(0,u.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,u.jsx)("div",{className:"flex-shrink-0"}),(0,u.jsx)("div",{className:"d-flex flex-row flex-shrink-0 gap-2",children:(0,u.jsx)("button",{type:"submit",className:"global_btn px-4 py-2 fn_size_sm active d-flex align-items-center gap-2",children:"Next"})})]})})]})}),(0,u.jsx)("div",{className:"col-12 m-0 p-0",children:D&&(0,u.jsx)(u.Fragment,{children:(0,u.jsxs)("form",{onSubmit:e=>{e.preventDefault();const n=[...ae];let a=!1;ee.forEach(((e,t)=>{n[t]||(n[t]={});const i=e.signatory_email,r=e.signatory_confirm_email;if(i&&r&&i!==r?(n[t].emailMatch="Emails do not match!",a=!0):n[t].emailMatch="",!e.isCurrentUser){const e=ee.map((e=>e.signatory_email)).filter((e=>e&&e===i));e.length>1&&(n[t].emailMatch="Email must be unique!",a=!0)}(e.phone||"").replace(/\D/g,"").length<10?(n[t].phone="Phone number must be at least 10 digits",a=!0):n[t].phone=""})),te(n),a||(M(!1),W(!0))},method:"post",action:"javascript:void(0)",children:[(0,u.jsx)("div",{className:"row g-3",children:(0,u.jsx)("div",{className:"d-flex flex-column gap-3 my-4",children:(0,u.jsxs)("div",{className:"d-flex justify-content-between gap-2 pt-3 align-items-start",children:[(0,u.jsxs)("div",{className:"flex-grow-1 d-flex flex-column gap-2",children:[(0,u.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"2/3"}),(0,u.jsx)("h4",{children:"Signatories for the Company"}),(0,u.jsx)("p",{className:"text-muted mb-0",style:{fontSize:"14px",lineHeight:"1.4"},children:"Signatories are the only users on the platform with the legal authority to bind the company to contracts and agreements. They have exclusive access to create, edit, delete, and confirm capital raise rounds, maintaining full control over the company's fundraising activities. These permissions are not available to any other users."})]}),(0,u.jsx)("button",{type:"button",onClick:()=>{if(ee.length>=3)return b(!0),v("You can only add up to three signatories total."),void setTimeout((()=>{v(""),b(!1)}),3e3);const e=ee.map((e=>e.signatory_email)).filter(Boolean),n=new Set(e);if(e.length!==n.size)return b(!0),v("Please make sure all existing emails are unique before adding a new signatory."),void setTimeout((()=>{v(""),b(!1)}),3e3);ne([...ee,{first_name:"",last_name:"",signatory_email:"",signatory_confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:"",isCurrentUser:!1}]),te([...ae,{emailMatch:""}])},className:"global_btn w-fit",style:{flexShrink:0},children:"+ Add A New Signatory"})]})})}),(0,u.jsxs)("div",{className:"col-md-6 mb-4 ",children:[(0,u.jsxs)("label",{htmlFor:"formally_legally",className:"label_fontWeight pb-2",children:["Can you formally/legally initiate a new round of investment on behalf of this company? ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsxs)(d.z6,{id:"companyStage",children:[(0,u.jsxs)(d.Zw,{children:[(0,u.jsx)("input",{type:"radio",name:"formally_legally",required:!0,value:"Yes",onChange:e=>se(e.target.value),id:"concept",checked:"Yes"===re}),(0,u.jsx)("label",{htmlFor:"concept",children:"Yes"})]}),(0,u.jsxs)(d.Zw,{children:[(0,u.jsx)("input",{type:"radio",name:"formally_legally",value:"No",onChange:e=>se(e.target.value),id:"planning5",required:!0,checked:"No"===re}),(0,u.jsx)("label",{htmlFor:"planning5",children:"No"})]})]}),"Yes"===re&&(0,u.jsx)("div",{className:"alert alert-info mt-2",children:(0,u.jsx)("small",{children:(0,u.jsx)("strong",{children:"\u2713 You have been automatically added as the primary signatory."})})})]}),ee.map(((e,n)=>{var a,t;return(0,u.jsxs)("div",{className:"d-flex flex-column gap-4 mb-4",children:[e.isCurrentUser&&(0,u.jsxs)("div",{className:"alert alert-success",children:[(0,u.jsx)("strong",{children:"Primary Signatory (You)"})," ","- Auto-populated from your profile"]}),(0,u.jsxs)("div",{className:"row gy-3",style:{border:"1px solid #e5e7eb",borderRadius:"8px",padding:"20px",backgroundColor:e.isCurrentUser?"#f8f9fa":"#fff"},children:[(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsxs)("label",{className:"label_fontWeight",children:["First Name"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("input",{type:"text",name:"first_name",value:e.first_name,onChange:e=>ie(n,e),placeholder:"Enter first name",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsxs)("label",{className:"label_fontWeight",children:["Last Name"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("input",{type:"text",name:"last_name",value:e.last_name,onChange:e=>ie(n,e),placeholder:"Enter last name",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsxs)("label",{className:"label_fontWeight",children:["Email"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("input",{type:"email",name:"signatory_email",value:e.signatory_email,onChange:e=>ie(n,e),placeholder:"Enter email",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsxs)("label",{className:"label_fontWeight",children:["Confirm Email"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("input",{type:"email",name:"signatory_confirm_email",value:e.signatory_confirm_email,onChange:e=>ie(n,e),placeholder:"Confirm email",className:"form-control",required:!0,disabled:e.isCurrentUser}),(null===(a=ae[n])||void 0===a?void 0:a.emailMatch)&&(0,u.jsx)("div",{className:"text-danger text-start fw-semibold",style:{fontSize:"13px"},children:ae[n].emailMatch})]}),(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsx)("label",{className:"label_fontWeight",children:"LinkedIn Profile"}),(0,u.jsx)("input",{type:"text",name:"linked_in",value:e.linked_in,onChange:e=>ie(n,e),placeholder:"Enter LinkedIn profile URL",className:"form-control"})]}),(0,u.jsxs)("div",{className:"col-md-6",children:[(0,u.jsxs)("label",{className:"label_fontWeight",children:["Phone Number"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)(c.Ay,{required:!0,name:"signatory_phone",defaultCountry:"CA",value:e.phone,onChange:e=>((e,n)=>{const a=[...ee];a[e].phone=n,ne(a);const t=[...ae];(n?n.replace(/\D/g,"").length:0)<10?t[e]={...t[e],phone:"Phone number must be at least 10 digits"}:t[e]&&delete t[e].phone,te(t)})(n,e),className:"phonregister form-control",placeholder:"Enter phone number"}),(null===(t=ae[n])||void 0===t?void 0:t.phone)&&(0,u.jsx)("div",{className:"text-danger text-start fw-semibold",style:{fontSize:"13px"},children:ae[n].phone})]}),(0,u.jsxs)("div",{className:"col-md-12",children:[(0,u.jsxs)("label",{className:"label_fontWeight",children:["Role"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsxs)("select",{name:"signature_role",value:e.signature_role,onChange:e=>ie(n,e),className:"form-select",required:!0,children:[(0,u.jsx)("option",{value:"",children:"Choose Role"}),(0,u.jsx)("option",{value:"Founder and Chief Executive Officer (CEO) \u2013 Visionary and strategic leader",children:"Founder and Chief Executive Officer (CEO) \u2013 Visionary and strategic leader"}),(0,u.jsx)("option",{value:"Chief Operating Officer (COO) \u2013 Oversees daily operations",children:"Chief Operating Officer (COO) \u2013 Oversees daily operations"}),(0,u.jsx)("option",{value:"Chief Financial Officer (CFO) \u2013 Manages finances and fundraising",children:"Chief Financial Officer (CFO) \u2013 Manages finances and fundraising"}),(0,u.jsx)("option",{value:"Chief Investment Officer (CIO) \u2013 Manages engagements with investors and shareholders",children:"Chief Investment Officer (CIO) \u2013 Manages engagements with investors and shareholders"}),(0,u.jsx)("option",{value:"Chief Technology Officer (CTO) \u2013 Leads product and tech development",children:"Chief Technology Officer (CTO) \u2013 Leads product and tech development"}),(0,u.jsx)("option",{value:"Chief Marketing Officer (CMO) \u2013 Drives brand and customer acquisition",children:"Chief Marketing Officer (CMO) \u2013 Drives brand and customer acquisition"}),(0,u.jsx)("option",{value:"Chief Product Officer (CPO) \u2013 Owns product strategy and roadmap",children:"Chief Product Officer (CPO) \u2013 Owns product strategy and roadmap"}),(0,u.jsx)("option",{value:"Chief Revenue Officer (CRO) \u2013 Focuses on sales and revenue growth",children:"Chief Revenue Officer (CRO) \u2013 Focuses on sales and revenue growth"}),(0,u.jsx)("option",{value:"Chief People Officer (CPO) \u2013 Builds company culture and HR strategy",children:"Chief People Officer (CPO) \u2013 Builds company culture and HR strategy"}),(0,u.jsx)("option",{value:"Legal Counsel \u2013 Advises on contracts, IP, and compliance",children:"Legal Counsel \u2013 Advises on contracts, IP, and compliance"}),(0,u.jsx)("option",{value:"Advisory Board Member \u2013 Expert advisor guiding strategy, growth, and investor relations",children:"Advisory Board Member \u2013 Expert advisor guiding strategy, growth, and investor relations"}),(0,u.jsx)("option",{value:"Other",children:"Other"})]})]}),"Other"===e.signature_role&&(0,u.jsxs)("div",{className:"col-md-12",children:[(0,u.jsxs)("label",{className:"label_fontWeight",children:["Please specify role"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("input",{type:"text",name:"other_role",value:e.other_role,onChange:e=>ie(n,e),placeholder:"Enter specific role",className:"form-control",required:!0})]}),(0,u.jsx)("div",{className:"col-md-12 d-flex justify-content-end",children:!e.isCurrentUser&&ee.length>1&&(0,u.jsx)("button",{type:"button",className:"btn btn-danger",onClick:()=>(e=>{const n=ee.filter(((n,a)=>a!==e));ne(n)})(n),children:"Remove Signatory"})})]})]},n)})),(0,u.jsx)("div",{className:"col-12",children:(0,u.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,u.jsx)("div",{className:"flex-shrink-0",children:(0,u.jsx)("button",{type:"button",className:"global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"3",onClick:()=>{M(!1),I(!0)},children:"Back"})}),(0,u.jsx)("div",{className:"flex-shrink-0",children:(0,u.jsx)("button",{type:"submit",className:"global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"4",children:"Next"})})]})})]})})}),(0,u.jsx)("div",{className:"col-12 m-0 p-0",children:F&&(0,u.jsx)(u.Fragment,{children:(0,u.jsxs)("form",{onSubmit:async e=>{if(e.preventDefault(),$(!0),""!==L.company_website){if(!K(L.company_website))return w.current.scrollIntoView({behavior:"smooth",block:"center"}),I(!0),M(!1),W(!1),void C(!0);C(!1)}let t=!1,i=-1;const r=ae.map(((e,n)=>{const a=ee[n].signatory_email.trim(),r=ee[n].signatory_confirm_email.trim();let s="";return a&&r&&a!==r&&(s="Emails do not match!"),s&&-1===i&&(i=n,t=!0),{...e,emailMatch:s}}));if(!t){const e=ee.map((e=>e.signatory_email.trim())).filter(Boolean),n=e.filter(((n,a)=>e.indexOf(n)!==a));n.length>0&&(i=ee.findIndex((e=>e.signatory_email.trim()&&n.includes(e.signatory_email.trim()))),t=!0,I(!1),M(!0),W(!1),ee.forEach(((e,a)=>{const t=e.signatory_email.trim();t&&n.includes(t)&&(r[a]={...r[a],emailMatch:"Email must be unique!"})})))}if(t){if(te(r),-1!==i){const e=`signatory_email_${i}`,n=document.getElementById(e);n&&(n.scrollIntoView({behavior:"smooth",block:"center"}),n.focus())}return I(!1),M(!0),W(!1),void $(!1)}let s={company_name:L.company_name,company_industory:L.company_industory,phone:L.phone,company_email:L.company_email,company_website:L.company_website,employee_number:L.employee_number,year_registration:L.year_registration,formally_legally:re,company_street_address:L.company_street_address,company_country:pe,company_state:L.company_state,country_code:he,city_code:"",state_code:xe,city_step2:L.city_step2,company_postal_code:L.company_postal_code,descriptionStep4:L.descriptionStep4,problemStep4:L.problemStep4,solutionStep4:L.solutionStep4,signatories:ee,user_id:n.id};console.log(s);try{const e=await o.A.post(`${a}companyaddWithSignatory`,s,{headers:{Accept:"application/json","Content-Type":"application/json"}});v(e.data.message),"2"===e.data.status?(b(!0),I(!0),M(!1),W(!1)):(b(!1),Z(),setTimeout((()=>{v(""),B("/user/companylist")}),3e3))}catch(l){v("Error updating profile. Please try again."),b(!0),setTimeout((()=>{v("")}),3e3)}finally{$(!1)}},method:"post",action:"javascript:void(0)",children:[(0,u.jsxs)("div",{className:"row g-3",children:[(0,u.jsx)("div",{className:"col-md-12 mt-5",children:(0,u.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,u.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"3/3"}),(0,u.jsx)("label",{htmlFor:"",children:(0,u.jsx)("h4",{children:"Company Mailing Address"})})]})}),(0,u.jsx)("div",{className:"col-md-6",children:(0,u.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,u.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Street"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("input",{value:L.company_street_address,onChange:ke,name:"company_street_address",required:!0,id:"",className:"form-control",placeholder:"Enter here",type:"text"})]})}),(0,u.jsx)("div",{className:"col-md-6",children:(0,u.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,u.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Country"," ",(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsxs)("select",{required:!0,value:L.company_country,name:"company_country",onChange:e=>{const n=e.target.value;Ne([]);const a=e.target.options[e.target.selectedIndex].text;be("Aruba"!==a&&"American Samoa"!==a),ue(n),me(a),P((n=>({...n,company_country:e.target.value})));const t=p.Ay.getStatesOfCountry(n);de(t)},placeholder:"Select or type a country",className:"form-select",children:[(0,u.jsx)("option",{value:"",children:"Select or type a country"}),Ce.map((e=>(0,u.jsx)("option",{value:e.value,children:e.label})))]})]})}),(0,u.jsx)("div",{className:"col-12",children:(0,u.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,u.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["State / Province / Territory / District"," ",ge&&(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsxs)("select",{className:"form-select",required:!!ge,name:"company_state",value:je,onChange:e=>{_e(e.target.value);const n=e.target.value,a=m.A.getCitiesOfState(L.company_country,n),t=ce.find((e=>e.isoCode===n));fe(n);const i=t?t.name:"";P((e=>({...e,company_state:i}))),0===a.length?be(!1):be(!0),Ne(a)},children:[(0,u.jsx)("option",{value:"",children:"-- Select State --"}),ce.map((e=>(0,u.jsx)("option",{value:e.isoCode,children:e.name},e.isoCode)))]})]})}),(0,u.jsx)("div",{className:"col-md-6",children:(0,u.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,u.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["City"," ",ge&&(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsxs)("select",{required:!!ge,name:"city_step2",onChange:async e=>{const n=e.target.value,a=(L.company_state,L.company_country,L.company_country),t=m.A.getCitiesOfState(a,n);console.log(t),P((e=>({...e,city_step2:n})))},placeholder:"Select or type a city",className:"form-select",children:[(0,u.jsx)("option",{value:"",children:"Select or type a city"}),we.map((e=>(0,u.jsx)("option",{value:e.name,children:e.name},e.name)))]})]})}),(0,u.jsx)("div",{className:"col-md-6",children:(0,u.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,u.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Postal code/Zip"," ",ge&&(0,u.jsx)("span",{className:"required",children:"*"})]}),(0,u.jsx)("input",{onChange:ke,type:"text",value:L.company_postal_code,className:"form-control",required:!!ge,name:"company_postal_code",placeholder:"Enter postal code/zip"})]})})]}),(0,u.jsx)("div",{className:"col-12 mt-4",children:(0,u.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,u.jsx)("div",{className:"flex-shrink-0",children:(0,u.jsx)("button",{type:"button",className:"global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"3",onClick:()=>{W(!1),M(!0)},children:"Back"})}),(0,u.jsx)("div",{className:"flex-shrink-0",children:(0,u.jsxs)("button",{disabled:U,style:{opacity:U?.6:1},type:"submit",className:"global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2",children:["Save",U&&(0,u.jsx)("div",{className:" spinner-white spinner-border spinneronetimepay m-0",role:"status",children:(0,u.jsx)("span",{className:"visually-hidden"})})]})})]})})]})})})]})})]})]})})]})]})})}),(0,u.jsx)("style",{jsx:!0,children:"\n        .profile-card {\n          background: #fff;\n          border-radius: 16px;\n          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);\n          overflow: hidden;\n        }\n\n        .profile-header {\n          display: flex;\n          align-items: center;\n          padding: 24px 32px;\n          border-bottom: 1px solid #f1f3f4;\n          background: #efefef;\n        }\n\n        .profile-icon {\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          width: 48px;\n          height: 48px;\n          border-radius: 12px;\n          background: linear-gradient(\n            135deg,\n            var(--primary) 0%,\n            var(--primary-icon) 100%\n          );\n          color: white;\n          margin-right: 16px;\n        }\n\n        .profile-title h2 {\n          font-size: 24px;\n          font-weight: 600;\n          color: #0a0a0a;\n          margin: 0 0 4px 0;\n        }\n\n        .profile-title p {\n          color: #6b7280;\n          margin: 0;\n          font-size: 14px;\n        }\n\n        .profile-content {\n          padding: 32px;\n        }\n\n        .form-grid {\n          display: grid;\n          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n          gap: 24px;\n          margin-bottom: 32px;\n        }\n\n        .form-group {\n          display: flex;\n          flex-direction: column;\n        }\n\n        .form-label {\n          font-weight: 500;\n          color: #374151;\n          margin-bottom: 8px;\n          font-size: 14px;\n        }\n\n        .required {\n          color: #f63b3b;\n        }\n\n        .form-input {\n          padding: 12px 16px;\n          border: 1px solid #e5e7eb;\n          border-radius: 8px;\n          font-size: 16px;\n          transition: all 0.2s ease;\n          background: #fff;\n        }\n\n        .form-input:focus {\n          outline: none;\n          border-color: #f63b3b;\n          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);\n        }\n\n        .form-input:disabled {\n          background-color: #f9fafb;\n          color: #6b7280;\n          cursor: not-allowed;\n        }\n\n        .input-note {\n          font-size: 12px;\n          color: #6b7280;\n          margin-top: 4px;\n        }\n\n        .phone-input {\n          padding: 12px 16px;\n          border: 1px solid #e5e7eb;\n          border-radius: 8px;\n          font-size: 16px;\n          width: 100%;\n        }\n\n        .phone-input:focus {\n          outline: none;\n          border-color: #f63b3b;\n          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);\n        }\n\n        .input-with-icon {\n          position: relative;\n          display: flex;\n          align-items: center;\n        }\n\n        .input-icon {\n          position: absolute;\n          left: 12px;\n          color: #6b7280;\n          z-index: 1;\n        }\n\n        .input-with-icon .form-input {\n          padding-left: 40px;\n        }\n\n        .form-actions {\n          display: flex;\n          justify-content: flex-end;\n          border-top: 1px solid #f1f3f4;\n          padding-top: 24px;\n        }\n\n        .btn-primary {\n          display: inline-flex;\n          align-items: center;\n          gap: 8px;\n          background: linear-gradient(135deg, #f63b3b 0%, #e03535 100%);\n          color: white;\n          border: none;\n          border-radius: 8px;\n          padding: 12px 24px;\n          font-size: 16px;\n          font-weight: 500;\n          cursor: pointer;\n          transition: all 0.2s ease;\n        }\n\n        .btn-primary:hover:not(:disabled) {\n          transform: translateY(-2px);\n          box-shadow: 0 4px 12px rgba(246, 59, 59, 0.25);\n        }\n\n        .btn-primary:disabled {\n          opacity: 0.7;\n          cursor: not-allowed;\n          transform: none;\n        }\n\n        .spinner {\n          width: 16px;\n          height: 16px;\n          border: 2px solid rgba(255, 255, 255, 0.3);\n          border-radius: 50%;\n          border-top-color: white;\n          animation: spin 1s ease-in-out infinite;\n        }\n\n        @keyframes spin {\n          to {\n            transform: rotate(360deg);\n          }\n        }\n\n        .alert {\n          padding: 12px 16px;\n          border-radius: 8px;\n          margin-bottom: 24px;\n          font-weight: 500;\n        }\n\n        .alert-success {\n          background-color: #ecfdf5;\n          color: #065f46;\n          border: 1px solid #a7f3d0;\n        }\n\n        .alert-error {\n          background-color: #fef2f2;\n          color: #991b1b;\n          border: 1px solid #fecaca;\n        }\n\n        @media (max-width: 768px) {\n          .profile-header {\n            padding: 20px;\n          }\n\n          .profile-content {\n            padding: 20px;\n          }\n\n          .form-grid {\n            grid-template-columns: 1fr;\n            gap: 20px;\n          }\n\n          .form-actions {\n            justify-content: center;\n          }\n\n          .btn-primary {\n            width: 100%;\n            justify-content: center;\n          }\n        }\n      "})]})}},31738:(e,n,a)=>{a.d(n,{A:()=>r});var t=a(65043),i=a(70579);function r(){const[e,n]=(0,t.useState)(""),[a,r]=(0,t.useState)("");return(0,t.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),a=await e.json();n(a.ip)}catch(e){console.error("Failed to fetch IP",e)}})(),(()=>{const e=(new Date).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});r(e)})()}),[]),(0,i.jsx)(i.Fragment,{children:(0,i.jsxs)("div",{className:"d-flex flex-column gap-1 p-2 ipaddbox",children:[(0,i.jsxs)("h4",{children:["Date: ",(0,i.jsxs)("span",{children:["(",a,")"]})]}),(0,i.jsxs)("h4",{children:["IP Address: ",(0,i.jsx)("span",{children:e})]})]})})}},42552:(e,n,a)=>{a.d(n,{A:()=>b});var t=a(65043),i=(a(38421),a(73216)),r=a(53579),s=a(35475),o=a(50423),l=a(42983),c=a(9463),d=a(86213),p=a(31387),m=a(31738),h=a(47196),u=a(70579);const x=[{label:"Dashboard",href:"/user/dashboard",icon:(0,u.jsx)(h.oeo,{size:18})},{label:"Add New Company",href:"/user/addcompany",icon:(0,u.jsx)(h.S2e,{size:18})},{label:"My Companies",href:"/user/companylist",icon:(0,u.jsx)(h.S2e,{size:18})},{label:"Manage Signatory",icon:(0,u.jsx)(h.dIq,{size:18}),dropdown:[{label:"Add New Signatory",href:"/user/add-new-signatory",icon:(0,u.jsx)(h.dIq,{size:16})},{label:"Signatory List",href:"/user/signatorylist",icon:(0,u.jsx)(h._cd,{size:16})},{label:"Approve Signatories",href:"/user/approval/signature",icon:(0,u.jsx)(h.dIq,{size:16})}]},{label:"Settings",icon:(0,u.jsx)(h.XuQ,{size:18}),dropdown:[{label:"Profile Settings",href:"/user/settings/profile",icon:(0,u.jsx)(h.dIq,{size:16})}]}],f=[{path:"/crm/addnew-investor",menuHref:"/crm/investor-directory"},{path:"/crm/edit-investor/:id",menuHref:"/crm/investor-directory"},{path:"/crm/investor-report-detail-record-round/:id",menuHref:"/crm/investorreport"},{path:"/user/signatory/activity/:id/:signatory_id",menuHref:"/user/signatorylist"},{path:"/crm/investor-report-detail/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-report-detail-due-diligence/:id",menuHref:"/crm/investorreport"},{path:"/crm/investor-record-round-reports-confirm/:id",menuHref:"/crm/investorreport"},{path:"/edit-record-round/:id",menuHref:"/record-round-list"},{path:"/createrecord",menuHref:"/record-round-list"}],g=e=>{const n=f.find((n=>(0,p.B6)({path:n.path,end:!0},e)));return n?n.menuHref:e};function b(e){let{isCollapsed:n,setIsCollapsed:a}=e;const[b,y]=(0,t.useState)(""),v=(0,i.Zp)(),[j,_]=(0,t.useState)(null),[w,N]=(0,t.useState)([]),[C,k]=(0,t.useState)(!1);(0,t.useEffect)((()=>{const e=()=>{window.innerWidth<786?(k(!0),q&&q(!0)):(k(!1),q&&q(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[C]);const[S,O]=(0,t.useState)(!1),z="https://capavate.com/api/user/",E=void 0!==n?n:C,q=a||k,A=localStorage.getItem("OwnerLoginData"),I=JSON.parse(A);(0,t.useEffect)((()=>{const e=localStorage.getItem("OwnerLoginData");if(e){const n=JSON.parse(e);y(n);const a=(new Date).getTime();if(!(n.expiry&&a>n.expiry)){const e=n.expiry-a,t=setTimeout((()=>{localStorage.removeItem("OwnerLoginData"),v("/user/login")}),e);return()=>clearTimeout(t)}localStorage.removeItem("OwnerLoginData"),v("/user/login")}else v("/user/login")}),[v]),(0,t.useEffect)((()=>{D()}),[]);const D=async()=>{let e={user_id:I.id};try{0===(await d.A.post(z+"checkUserLogin",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.length&&(localStorage.removeItem("OwnerLoginData"),v("/user/login"))}catch(n){console.error("Error fetching modules:",n)}};(0,t.useEffect)((()=>{M();const e=localStorage.getItem("selectedDropdown");e&&_(Number(e));const n=localStorage.getItem("sidebarCollapsed");if(null!==n){const e=JSON.parse(n);a?a(e):k(e)}}),[]);const M=async()=>{let e={id:""};try{const n=await d.A.post(z+"getModules",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});N(n.data.results)}catch(n){console.error("Error fetching modules:",n)}},F=(0,i.zy)(),W=(F.pathname,!E||S),L=g(F.pathname);return(0,u.jsxs)(u.Fragment,{children:[(0,u.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(E?"collapsed p-3":"p-4"),children:[(0,u.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(E?"justify-content-center":"justify-content-between"),children:[!E&&(0,u.jsx)(s.N_,{to:"/user/dashboard",className:"logo",children:(0,u.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,u.jsx)(r.V4,{className:"d-flex justify-content-end",children:(0,u.jsxs)("button",{type:"button",onClick:()=>{const e=!E;q(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[E&&(0,u.jsx)(l.A,{strokeWidth:2}),!E&&(0,u.jsx)(c.A,{strokeWidth:2})]})})]}),(0,u.jsx)(r.vT,{isOpen:W,children:(0,u.jsx)(r.c0,{children:x.map(((e,n)=>{var a;const t=j===n||e.dropdown&&e.dropdown.some((e=>{const n=g(F.pathname);return n===e.href||n.startsWith(e.href)}))||"modules"===e.dynamicDropdownKey&&w.some((e=>{const n="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return F.pathname===n})),i=(null===(a=e.matchPaths)||void 0===a?void 0:a.some((e=>(0,p.B6)({path:e,end:!1},F.pathname))))||F.pathname===e.href||e.dropdown&&e.dropdown.some((e=>(f[F.pathname]||F.pathname)===e.href||(f[F.pathname]||F.pathname).startsWith(e.href)))||"modules"===e.dynamicDropdownKey&&w.some((e=>{const n="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`;return F.pathname===n}));return(0,u.jsx)(r.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,u.jsxs)(u.Fragment,{children:[(0,u.jsx)(r.C,{title:e.label,onClick:()=>(e=>{const n=j===e?null:e;E&&q(!E);_(n),localStorage.setItem("selectedDropdown",null!==n?n:"")})(n),children:(0,u.jsxs)("div",{className:"d-flex gap-2 align-items-center justify-content-between w-100",children:[(0,u.jsxs)("div",{className:"d-flex gap-2 align-items-start",children:[e.icon,W&&e.label]}),W&&(0,u.jsx)(r.i3,{isOpen:t,children:(0,u.jsx)(o.pte,{})})]})}),t&&(0,u.jsxs)(r.rI,{title:e.label,className:""+(W?"":"p-0"),children:[(0,u.jsx)("hr",{className:"my-2"}),e.dropdown&&e.dropdown.map(((e,n)=>{f[F.pathname]||F.pathname;const a=L===e.href||L.startsWith(e.href);return(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(s.N_,{to:e.href,className:`sidebar d-flex align-items-start gap-2 ${W?"":"w-fit"} ${a?"active":""}`,children:[e.icon,W&&e.label]})},n)})),"modules"===e.dynamicDropdownKey&&(0,u.jsxs)(u.Fragment,{children:[w.map(((e,n)=>{const a="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,t=F.pathname===a;return(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(s.N_,{to:a,title:e.name,className:`sidebar d-flex align-items-start gap-2 ${W?"":"w-fit"} ${t?"active":""}`,children:[(0,u.jsx)(h.MO3,{size:16}),W&&e.name]})},n)})),(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(s.N_,{title:"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video",to:"/advicevideos",className:`sidebar d-flex align-items-start gap-2 ${W?"":"w-fit"} ${"/advicevideos"===F.pathname?"active":""}`,children:[(0,u.jsx)(h.xi0,{size:16}),W&&"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,u.jsxs)(s.N_,{to:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${W?"":"w-fit"} ${i?"active":""}`,children:[e.icon,W&&e.label]})},n)}))})}),(0,u.jsx)(m.A,{})]}),(0,u.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 71px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,n,a)=>{a.d(n,{$K:()=>s,CB:()=>l,Cd:()=>b,I0:()=>d,Jq:()=>h,R3:()=>j,Zw:()=>m,dN:()=>f,hJ:()=>g,jh:()=>c,mO:()=>i,mg:()=>o,nj:()=>y,pd:()=>v,uM:()=>u,vE:()=>r,z6:()=>p});var t=a(5464);const i=t.default.div`
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
`,r=t.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,s=(t.default.div`
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
`),o=t.default.div`
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
`,l=t.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=t.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=t.default.div`
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
`,h=(t.default.div`
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
`),u=(t.default.div`
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
`),x=(t.default.div`
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
`),f=((0,t.default)(x)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,t.default)(x)`
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
  display: ${e=>{let{show:n}=e;return n?"flex":"none"}};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`,b=t.default.div`
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
`,y=t.default.button`
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
`,v=t.default.input`
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
`},77266:(e,n,a)=>{a.d(n,{A:()=>c});var t=a(65043),i=a(35475),r=a(75200),s=a(45394),o=a(53579),l=(a(86213),a(70579));const c=function(){const[e,n]=(0,t.useState)(!1),[a,c]=(0,t.useState)(""),[d,p]=(0,t.useState)(!1);return(0,l.jsxs)("div",{className:"top_bar",children:[(0,l.jsx)(o.SD,{children:(0,l.jsx)("div",{className:"container-fluid",children:(0,l.jsx)("div",{className:"d-flex gap-4 position-relative",children:(0,l.jsx)(o.FC,{className:"d-flex align-items-center justify-content-end gap-3 w-100",children:(0,l.jsx)(i.N_,{to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("OwnerLoginData"),window.location.href="/user/login"},title:"Logout",className:"logout_btn_global",children:(0,l.jsx)(r.QeK,{})})})})})}),d&&a&&(0,l.jsx)("div",{className:"main_popup-overlay",children:(0,l.jsxs)("div",{className:"popup-container",children:[(0,l.jsxs)("div",{className:"d-flex align-items-center gap-3 mb-3 justify-content-between",children:[(0,l.jsx)("h2",{className:"popup-title",children:"Credit Balance"}),(0,l.jsx)("button",{type:"button",className:"close_btn_global",onClick:()=>{p(!1)},"aria-label":"Close",children:(0,l.jsx)(s.LwM,{size:24})})]}),(0,l.jsxs)("ul",{className:"popup-list",children:[(0,l.jsxs)("li",{children:["Access to Dataroom + Investor reporting for 1 year (till"," ",(0,l.jsx)("strong",{children:(m=a.valid_until,new Date(m).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"}))}),")"]}),(0,l.jsxs)("li",{children:["Due diligence documents generated:"," ",(0,l.jsx)("strong",{children:a.total_generated})," / 1 allowed"]}),(0,l.jsxs)("li",{children:["Credit Balance Left:"," ",(0,l.jsx)("strong",{children:a.credit_balance})]}),a.extra_generations>0&&(0,l.jsx)("li",{className:"warn",children:(0,l.jsxs)("strong",{children:[a.extra_generations," additional generation(s) will incur \u20ac100 each"]})})]})]})})]});var m}}}]);
//# sourceMappingURL=9033.d432951e.chunk.js.map