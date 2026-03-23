"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[8288],{43436:(e,s,t)=>{t.r(s),t.d(s,{default:()=>C});var a=t(65043),l=t(86213),o=t(56884),n=t(81906),r=t(25581),i=t(13190),d=t(62837),c=t(26632),p=(t(65016),t(78703)),m=t(12789),u=t(62585),x=t(70579);const f=[{id:0,label:"Contact Info",icon:"\ud83d\udccb"},{id:1,label:"Investor Profile",icon:"\ud83d\udc64"},{id:2,label:"Network Profile",icon:"\ud83c\udf10"}],b=["Less than $25k","$25k\u2013$50k","$50k\u2013$100k","$100k\u2013$250k","$250k\u2013$500k","$500k\u2013$1M","$1M\u2013$5M","$5M+"],h=["Accelerator","Advisor (consultant to companies)","Angel investor (Individual)","Angel network or angel club","Bank / Financial institution","Corporate venture capital / strategic corporate investor","Crowdfunding platform/crowd investor vehicle","Employee (via ESOP)","Family office (direct investing)","Fund\u2011of\u2011funds or investment company","Government (grant) or quasi\u2011government fund","Hedge fund","Impact or ESG\u2011focused investment fund","Incubator","Micro VC / emerging fund manager (pre\u2011seed/seed specialist)","Private equity/growth equity fund (late\u2011stage or special situations)","Representative of an accredited individual (advisor, family office CIO, etc.)","Syndicate lead or SPV manager (investing on behalf of a pooled vehicle)","Venture capital fund (institutional VC)"],g=["Yes \u2013 Accredited","No \u2013 Non-Accredited","Not Sure"],y=["Home Market Only","Home Country","Open to Global / Cross-Border"],v=["Pre-Seed","Seed","Series A","Series B","Series C+","Growth","Late Stage"],j=["Mentoring","Board Roles","Intros / Deal Flow","Portfolio Support","Passive"],_=["M&A Advisory","Buyouts","Mergers","Strategic Partnerships","PE Roll-ups","Distressed Assets","Cross-border M&A"],N={first_name:"",last_name:"",phone:"",city:"",country:"",linkedIn_profile:"",type_of_investor:"",accredited_status:"",bio_short:"",mailing_address:"",country_tax:"",tax_id:"",screen_name:"",job_title:"",company_name:"",company_country:"",company_website:"",industry_expertise:"",geo_focus:"",network_bio:"",notes:""},w=[{id:"full_sale_exits",label:"Full Sale Exits",description:"Interested in discussing full company sales and strategic exits."},{id:"recapitalizations",label:"Recapitalizations",description:"Curious about partial sales and majority recapitalizations."},{id:"ipos_listings",label:"IPOs/Listings",description:"Following conversations on IPOs and other public listing routes."},{id:"secondaries",label:"Secondaries",description:"Interested in private secondary transactions for startup equity."},{id:"structured_exits",label:"Structured Exits",description:"Exploring structured exit solutions (earn\u2011outs, vendor notes, rollover equity)."},{id:"buybacks_redemptions",label:"Buybacks/Redemptions",description:"Following best practices around company share buybacks and redemption programs."},{id:"mbos_sponsor",label:"MBOs/Sponsor Deals",description:"Interested in management buy\u2011outs/buy\u2011ins and sponsor\u2011led deals (PE/VC)."},{id:"partial_liquidity",label:"Partial Liquidity",description:"Focused on strategies for partial liquidity while preserving upside (secondaries, recaps, dividends)."},{id:"distress_assets",label:"Distress Assets",description:"Engaging with companies that are distressed."},{id:"cross_border_distribution",label:"Cross-border Distribution",description:"Product or service distribution channel development."},{id:"joint_ventures",label:"Joint Ventures / Strategic Partnerships",description:"Exploring partnerships for scale."}];function C(){const[e,s]=(0,a.useState)(0),[t,C]=(0,a.useState)(N),[k,S]=(0,a.useState)(null),[z,R]=(0,a.useState)({text:"",type:""}),[I,A]=(0,a.useState)(!1),[P,E]=(0,a.useState)(null),[M,F]=(0,a.useState)(null),[$,D]=(0,a.useState)([]),[O,q]=(0,a.useState)([]),[L,T]=(0,a.useState)([]),[J,V]=(0,a.useState)([]),[Y,H]=(0,a.useState)([]),[U,X]=(0,a.useState)(!1),[B,W]=(0,a.useState)({}),[G,K]=(0,a.useState)([]),[Z,Q]=(0,a.useState)([]),[ee,se]=(0,a.useState)([]),[te,ae]=(0,a.useState)(""),le=r.J+"api/user/investor/",oe=r.J+"api/user/capitalround/",ne=r.J+"api/user/investorreport/",re=r.J+"api/user/capitalround/",ie=JSON.parse(localStorage.getItem("InvestorData")||"{}"),de={code:ie.unique_code||""};document.title="Investor Profile",(0,a.useEffect)((()=>{s(0),ce(),pe(),xe()}),[]);const ce=async()=>{try{var e;const t=await l.A.post(le+"getinvestorData",{id:ie.id});if(console.log(ie),(null===(e=t.data.results)||void 0===e?void 0:e.length)>0){const e=t.data.results[0];if(S(e),C({first_name:e.first_name||"",last_name:e.last_name||"",phone:e.phone||"",city:e.city||"",country:e.country||"",linkedIn_profile:e.linkedIn_profile||"",type_of_investor:e.type_of_investor||"",accredited_status:e.accredited_status||"",bio_short:e.bio_short||"",mailing_address:e.mailing_address||"",country_tax:e.country_tax||"",tax_id:e.tax_id||"",screen_name:e.screen_name||"",job_title:e.job_title||"",company_name:e.company_name||"",company_country:e.company_country||"",company_website:e.company_website||"",industry_expertise:e.industry_expertise||"",geo_focus:e.geo_focus||"",network_bio:e.network_bio||"",notes:e.notes||"",invest_through_company:e.invest_through_company||"",investing_company_name:e.investing_company_name||"",current_job_title:e.current_job_title||"",investor_company_country:e.investor_company_country||"",investor_company_website:e.investor_company_website||""}),D(e.hands_on?e.hands_on.split(","):[]),q(e.ma_interests?e.ma_interests.split(","):[]),T(e.preferred_stages?e.preferred_stages.split(","):[]),V(e.cheque_size?e.cheque_size.split(","):[]),Q(e.capavate_interests?e.capavate_interests.split(","):[]),e.industry_expertise){const s=e.industry_expertise.split(",").map((e=>({value:e,label:e})));K(s)}if(e.profile_picture){var s="https://capavate.com/api/upload/investor/inv_"+e.id+"/"+e.profile_picture;console.log(s),F(s)}}else S({})}catch(t){console.error(t),S({})}},pe=async()=>{try{const e=await l.A.post(oe+"getallcountrySymbolList",{id:""});H(e.data.results||[])}catch(e){console.error(e)}},me=(0,a.useCallback)((e=>{const{name:s,value:t}=e.target;console.log(`Field changed: ${s} = ${t}`),C((e=>({...e,[s]:t})))}),[]),ue=function(e){R({text:e,type:arguments.length>1&&void 0!==arguments[1]?arguments[1]:"success"}),setTimeout((()=>R({text:"",type:""})),3e3)},xe=async()=>{let e={investor_id:""};try{const s=(await l.A.post(re+"getIndustryExpertise",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.map((e=>({value:e.value||e.name,label:e.name})));se(s)}catch(s){}},fe=(0,a.useRef)(e);(0,a.useEffect)((()=>{fe.current=e}),[e]);const be=async e=>{if(e.preventDefault(),2!==fe.current)return;let s=e.target.kyc_document?e.target.kyc_document.files:null,a=e.target.profile_picture?e.target.profile_picture.files[0]:null;if(t.phone.replace(/\D/g,"").length<10)return void W((e=>({...e,phone:"Phone number must be at least 10 digits"})));X(!0);let o=new FormData;o.append("id",k.id),o.append("first_name",t.first_name),o.append("last_name",t.last_name),o.append("email",ie.email),o.append("phone",t.phone),o.append("city",t.city),o.append("country",t.country),o.append("linkedIn_profile",t.linkedIn_profile),o.append("type_of_investor",t.type_of_investor),o.append("accredited_status",t.accredited_status),o.append("bio_short",t.bio_short),o.append("mailing_address",t.mailing_address),o.append("country_tax",t.country_tax),o.append("tax_id",t.tax_id),o.append("screen_name",t.screen_name),o.append("job_title",t.job_title),o.append("company_name",t.company_name),o.append("company_country",t.company_country),o.append("company_website",t.company_website),o.append("geo_focus",t.geo_focus),o.append("network_bio",t.network_bio),o.append("notes",t.notes),o.append("invest_through_company",t.invest_through_company),o.append("investing_company_name",t.investing_company_name),o.append("current_job_title",t.current_job_title),o.append("investor_company_country",t.investor_company_country),o.append("investor_company_website",t.investor_company_website),o.append("hands_on",$.join(",")),o.append("ma_interests",O.join(",")),o.append("preferred_stages",L.join(",")),o.append("cheque_size",J.join(","));const n=G.map((e=>e.value)).join(",");if(o.append("industry_expertise",n||t.industry_expertise),o.append("full_address",t.mailing_address),o.append("code",JSON.stringify(de)),o.append("capavate_interests",Z.join(",")),s&&s.length>0)for(let t=0;t<s.length;t++)o.append("kyc_document[]",s[t]);a&&o.append("profile_picture",a);try{await l.A.post(ne+"investorprofile",o,{headers:{"Content-Type":"multipart/form-data"}});ue("Profile saved successfully \u2713"),X(!1),ce(),setTimeout((()=>{ue("")}),8e3)}catch(r){console.error("Upload error:",r),X(!1),ue("Error saving profile","error")}},he=(0,a.useCallback)(((e,s,t)=>{s(e.includes(t)?e.filter((e=>e!==t)):[...e,t])}),[]),[ge,ye]=(0,a.useState)([]),[ve,je]=(0,a.useState)([]);(0,a.useEffect)((()=>{const e=m.A.getAllCountries();console.log(e),ye(e)}),[]);const _e=(0,a.useRef)([]);(0,a.useEffect)((()=>{if(console.log("=== useEffect RUNNING ==="),console.log("form.country:",t.country),console.log("countries.length:",ge.length),t.country&&ge.length>0){const e=ge.find((e=>e.name===t.country));if(console.log("selectedCountry:",e),e&&e.isoCode){console.log("ISO Code:",e.isoCode);const s=u.A.getCitiesOfCountry(e.isoCode);console.log("Raw cities from API:",s),console.log("Cities count:",null===s||void 0===s?void 0:s.length),s&&s.length>0?(_e.current=s,console.log("Setting cities with:",s),je([...s])):(console.log("No cities found for this country"),_e.current=[],je([]))}else console.log("Country not found or no ISO code"),je([])}else console.log("Condition not met - either no country or countries not loaded"),je([])}),[t.country,ge]),console.log(ve);const Ne=e=>{let{label:s,options:t,selected:a,setSelected:l}=e;return(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:s}),(0,x.jsx)("div",{className:"d-flex flex-wrap gap-2",children:t.map((e=>{const s=e.id||e,t=e.label||e;return(0,x.jsxs)("span",{onClick:()=>he(a,l,s),className:"badge rounded-pill px-3 py-2",style:{cursor:"pointer",fontSize:12,fontWeight:500,backgroundColor:a.includes(s)?"#CC0000":"#f1f5f9",color:a.includes(s)?"#fff":"#475569",border:"1.5px solid "+(a.includes(s)?"#CC0000":"#cbd5e1"),transition:"all 0.15s"},title:e.description||"",children:[a.includes(s)&&"\u2713 ",t]},s)}))})]})};if(null===k)return(0,x.jsx)("main",{children:(0,x.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,x.jsx)(o.A,{}),(0,x.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,x.jsx)(n.A,{}),(0,x.jsx)("div",{className:"d-flex justify-content-center align-items-center",style:{minHeight:400},children:(0,x.jsx)("div",{className:"spinner-border text-success",role:"status",children:(0,x.jsx)("span",{className:"visually-hidden",children:"Loading..."})})})]})]})});const we=[(0,x.jsxs)("div",{children:[(0,x.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,x.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Your Current Role/Work"}),(0,x.jsx)("small",{className:"text-muted",children:"Used for cap table management"})]}),(0,x.jsxs)("div",{className:"row",children:[(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Screen Name"}),(0,x.jsx)("input",{type:"text",name:"screen_name",className:"form-control form-control-sm",placeholder:"@JohnSmith",value:t.screen_name||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"}),(0,x.jsx)("small",{className:"text-muted d-block mt-2",style:{fontSize:"12px",color:"#6c757d"},children:"NOTE: Your screen name will be visible to all shareholders on the same cap table and across all social media sections of Capavate.com. Your portfolio companies, where you are a shareholder, will have access to your real name."})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Current Job Title"}),(0,x.jsx)("input",{type:"text",name:"job_title",className:"form-control form-control-sm",placeholder:"Managing Partner",value:t.job_title||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Current Company Name"}),(0,x.jsx)("input",{type:"text",name:"company_name",className:"form-control form-control-sm",placeholder:"Acme Ventures",value:t.company_name||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Country"}),(0,x.jsxs)("select",{name:"company_country",className:"form-select form-select-sm",value:t.company_country||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),Y.map((e=>(0,x.jsx)("option",{value:e.name||e.country_name,children:e.name||e.country_name},e.id||e.name)))]})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Website"}),(0,x.jsx)("input",{type:"url",name:"company_website",className:"form-control form-control-sm",placeholder:"https://acmeventures.com",value:t.company_website||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})})]}),(0,x.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,x.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Contact Information"}),(0,x.jsx)("small",{className:"text-muted",children:"Used for cap table management"})]}),(0,x.jsxs)("div",{className:"row",children:[(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["First Name ",(0,x.jsx)("span",{className:"text-danger ms-1",children:"*"})]}),(0,x.jsx)("input",{type:"text",name:"first_name",className:"form-control form-control-sm",placeholder:"John",value:t.first_name||"",onChange:me,required:!0,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["Last Name ",(0,x.jsx)("span",{className:"text-danger ms-1",children:"*"})]}),(0,x.jsx)("input",{type:"text",name:"last_name",className:"form-control form-control-sm",placeholder:"Smith",value:t.last_name||"",onChange:me,required:!0,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Contact (Email)"}),(0,x.jsx)("input",{type:"email",className:"form-control form-control-sm",value:ie.email||"",disabled:!0,readOnly:!0,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"}})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["Contact (Mobile) ",(0,x.jsx)("span",{className:"text-danger ms-1",children:"*"})]}),(0,x.jsx)(c.Ay,{required:!0,value:t.phone,name:"phone",defaultCountry:"CA",onChange:e=>{C({...t,phone:e}),e&&e.replace(/\D/g,"").length<10?ae("Phone number must be at least 10 digits"):ae("")},className:"phonregister form-control",placeholder:"Enter phone number",style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px",width:"100%"}}),te&&(0,x.jsx)("small",{style:{color:"red"},children:te})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Country"}),(0,x.jsxs)("select",{name:"country",className:"form-select form-select-sm",value:t.country,onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),ge.map((e=>(0,x.jsx)("option",{value:e.name,children:e.name},e.isoCode)))]})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"City"}),(0,x.jsxs)("select",{name:"city",className:"form-select form-select-sm",value:t.city,onChange:me,disabled:!t.country,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px",backgroundColor:t.country?"white":"#f8f9fa"},children:[(0,x.jsx)("option",{value:"",children:t.country?"\u2014 Select City \u2014":"\u2014 Select Country First \u2014"}),ve.map((e=>(0,x.jsx)("option",{value:e.name,children:e.name},e.name)))]})]})})]})]},"s0"),(0,x.jsxs)("div",{children:[(0,x.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,x.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Investor Profile"}),(0,x.jsx)("small",{className:"text-muted",children:"Used for cap table management"})]}),(0,x.jsxs)("div",{className:"row",children:[(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Type of Investor"}),(0,x.jsxs)("select",{name:"type_of_investor",className:"form-select form-select-sm",value:t.type_of_investor||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select \u2014"}),h.map((e=>(0,x.jsx)("option",{value:e,children:e},e)))]})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Accredited Status"}),(0,x.jsxs)("select",{name:"accredited_status",className:"form-select form-select-sm",value:t.accredited_status||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select \u2014"}),g.map((e=>(0,x.jsx)("option",{value:e,children:e},e)))]})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"One sentence that describes you (max 240 chars)"}),(0,x.jsx)("textarea",{name:"bio_short",className:"form-control form-control-sm",rows:3,maxLength:240,placeholder:"I'm an angel investor focused on...",value:t.bio_short||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"}}),(0,x.jsx)("small",{className:"text-muted",children:"Max 240 characters"})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"LinkedIn or Professional Profile"}),(0,x.jsx)("input",{type:"text",name:"linkedIn_profile",className:"form-control form-control-sm",placeholder:"https://linkedin.com/in/...",value:t.linkedIn_profile||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsxs)("div",{className:"col-md-12",children:[(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Do you invest through a company?"}),(0,x.jsxs)("div",{className:"d-flex gap-3",children:[(0,x.jsxs)("div",{className:"form-check",children:[(0,x.jsx)("input",{type:"radio",name:"invest_through_company",id:"investYes",className:"form-check-input",value:"yes",checked:"yes"===t.invest_through_company,onChange:me}),(0,x.jsx)("label",{className:"form-check-label",htmlFor:"investYes",children:"Yes"})]}),(0,x.jsxs)("div",{className:"form-check",children:[(0,x.jsx)("input",{type:"radio",name:"invest_through_company",id:"investNo",className:"form-check-input",value:"no",checked:"no"===t.invest_through_company,onChange:me}),(0,x.jsx)("label",{className:"form-check-label",htmlFor:"investNo",children:"No"})]})]})]}),"yes"===t.invest_through_company&&(0,x.jsxs)(x.Fragment,{children:[(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Investing Company Name"}),(0,x.jsx)("input",{type:"text",name:"investing_company_name",className:"form-control form-control-sm",placeholder:"e.g., Acme Capital Partners",value:t.investing_company_name||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]}),(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Current Job Title"}),(0,x.jsx)("input",{type:"text",name:"current_job_title",className:"form-control form-control-sm",placeholder:"e.g., Managing Partner, CFO",value:t.current_job_title||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]}),(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Country"}),(0,x.jsxs)("select",{name:"investor_company_country",className:"form-select form-select-sm",value:t.investor_company_country,onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),ge.map((e=>(0,x.jsx)("option",{value:e.name,children:e.name},e.isoCode)))]})]}),(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Full Mailing Address"}),(0,x.jsx)("input",{type:"text",name:"mailing_address",className:"form-control form-control-sm",placeholder:"123 Main St, Suite 400...",value:t.mailing_address||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]}),(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Website"}),(0,x.jsx)("input",{type:"url",name:"investor_company_website",className:"form-control form-control-sm",placeholder:"https://www.example.com",value:t.investor_company_website||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})]})]}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Country of Tax Residency"}),(0,x.jsxs)("select",{name:"country_tax",className:"form-select form-select-sm",value:t.country_tax||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),Y.map((e=>(0,x.jsx)("option",{value:e.name||e.country_name,children:e.name||e.country_name},e.id||e.name)))]})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Tax ID or National ID"}),(0,x.jsx)("input",{type:"text",name:"tax_id",className:"form-control form-control-sm",placeholder:"XXX-XXX-XXX",value:t.tax_id||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"KYC / AML Documentation"}),(0,x.jsx)("input",{type:"file",name:"kyc_document",className:"form-control form-control-sm mb-2",style:{borderRadius:8,border:"1.5px solid #e2e8f0"},multiple:!0}),k.kyc_document&&(()=>{try{const e=JSON.parse(k.kyc_document);if(e.length>0)return(0,x.jsxs)("div",{className:"mt-2",children:[(0,x.jsxs)("small",{className:"text-success d-block mb-2",children:["\u2713 ",e.length," document(s) already uploaded"]}),(0,x.jsx)("div",{className:"d-flex flex-wrap gap-2",children:e.map(((e,s)=>{const t="https://capavate.com/api/upload/investor/inv_"+k.id+"/"+e,a=e.split(".").pop().toLowerCase(),l=["jpg","jpeg","png","gif","webp","svg","bmp"].includes(a),o=()=>l?"\ud83d\uddbc\ufe0f":"pdf"===a?"\ud83d\udcc4":["doc","docx"].includes(a)?"\ud83d\udcdd":["xls","xlsx","csv"].includes(a)?"\ud83d\udcca":["txt","rtf"].includes(a)?"\ud83d\udcc3":["zip","rar","7z"].includes(a)?"\ud83d\udddc\ufe0f":"\ud83d\udcc1";return(0,x.jsxs)("div",{className:"card p-2",style:{width:"160px"},children:[l?(0,x.jsx)("img",{src:t,alt:`KYC ${s+1}`,style:{width:"100%",height:"90px",objectFit:"cover",borderRadius:"4px"},onError:e=>{e.target.onerror=null,e.target.style.display="none",e.target.parentElement.innerHTML=`\n                                      <div class="d-flex justify-content-center align-items-center" \n                                        style="height:90px; background:#f8f9fa; border-radius:4px">\n                                        <span style="font-size: 32px;">${o()}</span>\n                                      </div>\n                                    `}}):(0,x.jsx)("div",{className:"d-flex justify-content-center align-items-center",style:{height:"90px",background:"#f8f9fa",borderRadius:"4px"},children:(0,x.jsx)("span",{style:{fontSize:"32px"},children:o()})}),(0,x.jsxs)("div",{className:"mt-2",children:[(0,x.jsx)("small",{className:"d-block text-truncate",title:e,children:e}),(0,x.jsx)("small",{className:"text-muted d-block",children:a?a.toUpperCase():"FILE"})]}),(0,x.jsxs)("div",{className:"d-flex justify-content-center gap-1 mt-2",children:[(0,x.jsx)("button",{type:"button",className:"btn btn-sm btn-outline-primary",onClick:()=>window.open(t,"_blank"),style:{fontSize:"11px",padding:"2px 8px"},title:"View in browser",children:"View"}),(0,x.jsx)("a",{href:t,download:!0,className:"btn btn-sm btn-outline-success",style:{fontSize:"11px",padding:"2px 8px"},title:"Download file",children:"Download"})]})]},s)}))})]})}catch(e){return console.error("Error parsing KYC documents:",e),(0,x.jsx)("small",{className:"text-warning d-block mt-1",children:"\u26a0 Error loading documents"})}})(),(0,x.jsx)("small",{className:"text-muted d-block mt-2",children:"Upload passport, ID, address proof, or any relevant documentation (multiple files allowed)"})]})})]})]},"s1"),(0,x.jsxs)("div",{children:[(0,x.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,x.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Capavate Angel Investor Network Profile"}),(0,x.jsx)("small",{className:"text-muted",children:"Visible to founders on the platform"})]}),(0,x.jsxs)("div",{className:"row",children:[(0,x.jsx)("div",{className:"col-md-12 mb-3",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Profile Picture"}),(0,x.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[M?(0,x.jsx)("img",{src:M,alt:"preview",className:"rounded-circle",style:{width:64,height:64,objectFit:"cover",border:"2px solid #CC0000"}}):(0,x.jsx)("div",{className:"rounded-circle d-flex align-items-center justify-content-center",style:{width:64,height:64,background:"#f1f5f9",fontSize:28},children:"\ud83d\udc64"}),(0,x.jsx)("input",{type:"file",accept:"image/*",name:"profile_picture",onChange:e=>{const s=e.target.files[0];s&&(E(s),F(URL.createObjectURL(s)))},className:"form-control form-control-sm w-auto",style:{borderRadius:8,border:"1.5px solid #e2e8f0"}})]})]})}),(0,x.jsx)("div",{className:"col-12",children:(0,x.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,x.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["INDUSTRY EXPERTISE",(0,x.jsx)("span",{className:"text-muted",style:{fontSize:"12px",marginLeft:"5px"},children:"(you can select multiple)"})]}),(0,x.jsx)(d.Jq,{children:(0,x.jsx)("div",{style:{width:"100%",position:"relative"},children:(0,x.jsx)(p.Ay,{isMulti:!0,name:"industry_expertise",options:ee,value:G,onChange:e=>{K(e)},placeholder:"Select industries...",className:"basic-multi-select",classNamePrefix:"select",styles:{control:e=>({...e,minHeight:"45px",border:"1px solid #dee2e6",borderRadius:"8px","&:hover":{borderColor:"#CC0000"}}),menu:e=>({...e,zIndex:9999}),multiValue:e=>({...e,backgroundColor:"#CC0000",color:"white"}),multiValueLabel:e=>({...e,color:"white"}),multiValueRemove:e=>({...e,color:"white","&:hover":{backgroundColor:"#CC0000",color:"white"}})},theme:e=>({...e,colors:{...e.colors,primary:"#CC0000",primary25:"#e6f7f5"}})})})}),G.length>0&&(0,x.jsxs)("small",{className:"text-muted",children:["Selected: ",G.length," industries"]})]})}),(0,x.jsxs)("div",{className:"col-md-12 mb-3",children:[(0,x.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["Typical Cheque Size",(0,x.jsx)("span",{className:"ms-2 fw-normal text-muted",style:{textTransform:"none",letterSpacing:0,fontSize:11},children:"\u2014 select multiple"})]}),(0,x.jsx)("div",{className:"d-flex flex-wrap gap-2",children:b.map((e=>{const s=J.includes(e);return(0,x.jsxs)("span",{onClick:()=>V((s=>s.includes(e)?s.filter((s=>s!==e)):[...s,e])),style:{cursor:"pointer",userSelect:"none",padding:"6px 14px",borderRadius:20,fontSize:12,fontWeight:500,backgroundColor:s?"#CC0000":"#f1f5f9",color:s?"#fff":"#475569",border:"1.5px solid "+(s?"#CC0000":"#cbd5e1"),transition:"all 0.15s"},children:[s&&"\u2713 ",e]},e)}))})]}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Geography Focus"}),(0,x.jsxs)("select",{name:"geo_focus",className:"form-select form-select-sm",value:t.geo_focus||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select \u2014"}),y.map((e=>(0,x.jsx)("option",{value:e,children:e},e)))]})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsx)(Ne,{label:"Preferred Stage",options:v,selected:L,setSelected:T})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsx)(Ne,{label:"Hands\u2011on vs Hands\u2011off",options:j,selected:$,setSelected:D})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Network Bio"}),(0,x.jsx)("textarea",{name:"network_bio",className:"form-control form-control-sm",rows:3,maxLength:1e3,placeholder:"Tell founders about your background...",value:t.network_bio||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"}}),(0,x.jsx)("small",{className:"text-muted",children:"Max 1000 characters"})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsx)(Ne,{label:"M&A Interests",options:_,selected:O,setSelected:q})}),(0,x.jsxs)("div",{className:"col-12 mt-4",children:[(0,x.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,x.jsxs)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:[(0,x.jsx)(i.A,{size:18,className:"me-2"}),"Capavate Angel Network Interests"]}),(0,x.jsx)("small",{className:"text-muted",children:"I'm focused on the following M&A and investment topics:"})]}),(0,x.jsx)("div",{className:"row",children:(0,x.jsxs)("div",{className:"col-12",children:[(0,x.jsx)(Ne,{label:"Investment Interests",options:w,selected:Z,setSelected:Q}),Z.length>0&&(0,x.jsxs)("div",{className:"mt-3 p-3 bg-light rounded",children:[(0,x.jsx)("small",{className:"text-muted fw-bold",children:"Selected Interests:"}),(0,x.jsx)("ul",{className:"mt-2 mb-0",children:Z.map((e=>{const s=w.find((s=>s.id===e));return s?(0,x.jsx)("li",{className:"mb-1",children:(0,x.jsxs)("small",{children:[(0,x.jsxs)("span",{className:"fw-bold",children:[s.label,":"]})," ",s.description]})},e):null}))})]})]})})]}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Notes"}),(0,x.jsx)("textarea",{name:"notes",className:"form-control form-control-sm",rows:3,placeholder:"Any additional notes...",value:t.notes||"",onChange:me,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"}})]})})]})]},"s2")];return(0,x.jsx)("main",{children:(0,x.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,x.jsx)(o.A,{}),(0,x.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,x.jsx)(n.A,{}),(0,x.jsx)("section",{className:"px-md-3 py-4",children:(0,x.jsxs)("div",{className:"container-fluid",children:[(0,x.jsxs)("div",{className:"mb-4",children:[(0,x.jsx)("h4",{className:"fw-bold mb-0",children:"Investor Profile"}),(0,x.jsx)("small",{className:"text-muted",children:"Manage your contact info, investor details, and network presence"})]}),z.text&&(0,x.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(I?"error_pop":"success_pop"),children:[(0,x.jsx)("div",{className:"d-flex align-items-start gap-2",children:(0,x.jsx)("span",{className:"d-block",children:z.text})}),(0,x.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>R("",""),children:"\xd7"})]}),B.phone&&(0,x.jsx)("div",{className:"alert alert-danger py-2 px-3 mb-3",style:{borderRadius:10},children:B.phone}),(0,x.jsx)("div",{className:"d-flex align-items-center mb-4 gap-0",style:{background:"#f8fafc",borderRadius:14,padding:6,border:"1.5px solid #e2e8f0"},children:f.map(((t,l)=>(0,x.jsxs)(a.Fragment,{children:[(0,x.jsxs)("button",{type:"button",onClick:()=>s(t.id),className:"btn d-flex align-items-center gap-2 flex-grow-1 justify-content-center",style:{borderRadius:10,fontWeight:600,fontSize:14,padding:"10px 16px",background:e===t.id?"#CC0000":"transparent",color:e===t.id?"#fff":"#64748b",border:"none",transition:"all 0.2s"},children:[(0,x.jsx)("span",{style:{fontSize:18},children:t.icon}),(0,x.jsx)("span",{className:"d-none d-md-inline",children:t.label})]}),l<f.length-1&&(0,x.jsx)("span",{style:{color:"#cbd5e1",fontSize:18,flexShrink:0},children:"\u203a"})]},t.id)))}),(0,x.jsx)("div",{className:"card border-0 shadow-sm",style:{borderRadius:16},children:(0,x.jsx)("div",{className:"card-body p-4",children:(0,x.jsxs)("form",{onSubmit:be,children:[(0,x.jsx)("div",{style:{minHeight:400},children:we[e]}),(0,x.jsxs)("div",{className:"d-flex justify-content-between align-items-center mt-4 pt-3 border-top",children:[(0,x.jsx)("button",{type:"button",className:"btn btn-outline-secondary btn-sm px-4",onClick:()=>s((e=>Math.max(0,e-1))),disabled:0===e,style:{borderRadius:8},children:"\u2190 Previous"}),(0,x.jsxs)("span",{className:"text-muted small",children:["Step ",e+1," of ",f.length]}),2===e?(0,x.jsx)("button",{type:"button",className:"btn btn-sm px-4 ee",disabled:U,onClick:be,style:{borderRadius:8,background:"#CC0000",color:"#fff",fontWeight:600},children:U?(0,x.jsxs)(x.Fragment,{children:[(0,x.jsx)("span",{className:"spinner-border spinner-border-sm me-2",role:"status","aria-hidden":"true"}),"Saving..."]}):"Save Changes \u2713"}):(0,x.jsx)("button",{type:"button",className:"btn btn-sm px-4",onClick:()=>s((e=>e+1)),style:{borderRadius:8,background:"#CC0000",color:"#fff",fontWeight:600},children:"Next \u2192"})]})]})})})]})})]})]})})}},62837:(e,s,t)=>{t.d(s,{$K:()=>n,CB:()=>i,Cd:()=>g,I0:()=>c,Jq:()=>u,R3:()=>j,Zw:()=>m,dN:()=>b,hJ:()=>h,jh:()=>d,mO:()=>l,mg:()=>r,nj:()=>y,pd:()=>v,uM:()=>x,vE:()=>o,z6:()=>p});var a=t(5464);const l=a.default.div`
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
`,o=a.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,n=(a.default.div`
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
`),r=a.default.div`
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
`,i=a.default.div`
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
`),f=(a.default.div`
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
`),b=((0,a.default)(f)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(f)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,a.default.sup`
  color: var(--primary);
`),h=a.default.div`
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
`,g=a.default.div`
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
`}}]);
//# sourceMappingURL=8288.9dcc120e.chunk.js.map