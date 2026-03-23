"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[8288],{43436:(e,s,a)=>{a.r(s),a.d(s,{default:()=>C});var t=a(65043),l=a(86213),o=a(56884),r=a(81906),n=a(25581),i=a(13190),d=a(62837),c=a(26632),p=(a(65016),a(78703)),m=a(12789),u=a(62585),x=a(70579);const f=[{id:0,label:"Contact Info",icon:"\ud83d\udccb"},{id:1,label:"Investor Profile",icon:"\ud83d\udc64"},{id:2,label:"Network Profile",icon:"\ud83c\udf10"}],b=["Less than $25k","$25k\u2013$50k","$50k\u2013$100k","$100k\u2013$250k","$250k\u2013$500k","$500k\u2013$1M","$1M\u2013$5M","$5M+"],h=["Accelerator","Advisor (consultant to companies)","Angel investor (Individual)","Angel network or angel club","Bank / Financial institution","Corporate venture capital / strategic corporate investor","Crowdfunding platform/crowd investor vehicle","Employee (via ESOP)","Family office (direct investing)","Fund\u2011of\u2011funds or investment company","Government (grant) or quasi\u2011government fund","Hedge fund","Impact or ESG\u2011focused investment fund","Incubator","Micro VC / emerging fund manager (pre\u2011seed/seed specialist)","Private equity/growth equity fund (late\u2011stage or special situations)","Representative of an accredited individual (advisor, family office CIO, etc.)","Syndicate lead or SPV manager (investing on behalf of a pooled vehicle)","Venture capital fund (institutional VC)"],g=["Yes \u2013 Accredited","No \u2013 Non-Accredited","Not Sure"],y=["Home Market Only","Home Country","Open to Global / Cross-Border"],v=["Pre-Seed","Seed","Series A","Series B","Series C+","Growth","Late Stage"],j=["Mentoring","Board Roles","Intros / Deal Flow","Portfolio Support","Passive"],_=["M&A Advisory","Buyouts","Mergers","Strategic Partnerships","PE Roll-ups","Distressed Assets","Cross-border M&A"],N={first_name:"",last_name:"",phone:"",city:"",country:"",linkedIn_profile:"",type_of_investor:"",accredited_status:"",bio_short:"",mailing_address:"",country_tax:"",tax_id:"",screen_name:"",job_title:"",company_name:"",company_country:"",company_website:"",industry_expertise:"",geo_focus:"",network_bio:"",notes:""},w=[{id:"full_sale_exits",label:"Full Sale Exits",description:"Interested in discussing full company sales and strategic exits."},{id:"recapitalizations",label:"Recapitalizations",description:"Curious about partial sales and majority recapitalizations."},{id:"ipos_listings",label:"IPOs/Listings",description:"Following conversations on IPOs and other public listing routes."},{id:"secondaries",label:"Secondaries",description:"Interested in private secondary transactions for startup equity."},{id:"structured_exits",label:"Structured Exits",description:"Exploring structured exit solutions (earn\u2011outs, vendor notes, rollover equity)."},{id:"buybacks_redemptions",label:"Buybacks/Redemptions",description:"Following best practices around company share buybacks and redemption programs."},{id:"mbos_sponsor",label:"MBOs/Sponsor Deals",description:"Interested in management buy\u2011outs/buy\u2011ins and sponsor\u2011led deals (PE/VC)."},{id:"partial_liquidity",label:"Partial Liquidity",description:"Focused on strategies for partial liquidity while preserving upside (secondaries, recaps, dividends)."},{id:"distress_assets",label:"Distress Assets",description:"Engaging with companies that are distressed."},{id:"cross_border_distribution",label:"Cross-border Distribution",description:"Product or service distribution channel development."},{id:"joint_ventures",label:"Joint Ventures / Strategic Partnerships",description:"Exploring partnerships for scale."}];function C(){const[e,s]=(0,t.useState)(0),[a,C]=(0,t.useState)(N),[k,S]=(0,t.useState)(null),[z,R]=(0,t.useState)({text:"",type:""}),[I,A]=(0,t.useState)(!1),[P,E]=(0,t.useState)(null),[M,F]=(0,t.useState)(null),[$,L]=(0,t.useState)([]),[q,D]=(0,t.useState)([]),[O,T]=(0,t.useState)([]),[J,Y]=(0,t.useState)([]),[V,H]=(0,t.useState)([]),[X,B]=(0,t.useState)(!1),[U,W]=(0,t.useState)({}),[K,G]=(0,t.useState)([]),[Z,Q]=(0,t.useState)([]),[ee,se]=(0,t.useState)([]),[ae,te]=(0,t.useState)(""),le=n.J+"api/user/investor/",oe=n.J+"api/user/capitalround/",re=n.J+"api/user/investorreport/",ne=n.J+"api/user/capitalround/",ie=JSON.parse(localStorage.getItem("InvestorData")||"{}"),de={code:ie.unique_code||""},[ce,pe]=(0,t.useState)([]),[me,ue]=(0,t.useState)(null);document.title="Investor Profile",(0,t.useEffect)((()=>{s(0),ye(),ve(),Ne()}),[]);const xe=(0,t.useRef)(m.A.getAllCountries()).current,[fe,be]=(0,t.useState)([]),[he,ge]=(0,t.useState)("IN"),ye=async()=>{try{var e;const a=await l.A.post(le+"getinvestorData",{id:ie.id});if(console.log(ie),(null===(e=a.data.results)||void 0===e?void 0:e.length)>0){const e=a.data.results[0];if(S(e),C({first_name:e.first_name||"",last_name:e.last_name||"",phone:e.phone||"",city:e.city||"",country:e.country||"",linkedIn_profile:e.linkedIn_profile||"",type_of_investor:e.type_of_investor||"",accredited_status:e.accredited_status||"",bio_short:e.bio_short||"",mailing_address:e.mailing_address||"",country_tax:e.country_tax||"",tax_id:e.tax_id||"",screen_name:e.screen_name||"",job_title:e.job_title||"",company_name:e.company_name||"",company_country:e.company_country||"",company_website:e.company_website||"",industry_expertise:e.industry_expertise||"",geo_focus:e.geo_focus||"",network_bio:e.network_bio||"",notes:e.notes||"",invest_through_company:e.invest_through_company||"",investing_company_name:e.investing_company_name||"",current_job_title:e.current_job_title||"",investor_company_country:e.investor_company_country||"",investor_company_website:e.investor_company_website||""}),L(e.hands_on?e.hands_on.split(","):[]),D(e.ma_interests?e.ma_interests.split(","):[]),T(e.preferred_stages?e.preferred_stages.split(","):[]),Y(e.cheque_size?e.cheque_size.split(","):[]),Q(e.capavate_interests?e.capavate_interests.split(","):[]),e.industry_expertise){const s=e.industry_expertise.split(",").map((e=>({value:e,label:e})));G(s)}if(e.profile_picture){var s="https://capavate.com/api/upload/investor/inv_"+e.id+"/"+e.profile_picture;console.log(s),F(s)}}else S({})}catch(a){console.error(a),S({})}},ve=async()=>{try{const e=await l.A.post(oe+"getallcountrySymbolList",{id:""});H(e.data.results||[])}catch(e){console.error(e)}},je=(0,t.useCallback)((e=>{const{name:s,value:a}=e.target;C("country"===s?e=>({...e,country:a,city:"",phone:""}):e=>({...e,[s]:a}))}),[]),_e=function(e){R({text:e,type:arguments.length>1&&void 0!==arguments[1]?arguments[1]:"success"}),setTimeout((()=>R({text:"",type:""})),3e3)},Ne=async()=>{let e={investor_id:""};try{const s=(await l.A.post(ne+"getIndustryExpertise",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results.map((e=>({value:e.value||e.name,label:e.name})));se(s)}catch(s){}},we=(0,t.useRef)(e);(0,t.useEffect)((()=>{we.current=e}),[e]);const Ce=async e=>{if(e.preventDefault(),2!==we.current)return;console.log("KYC Files from state:",ce),console.log("Profile Picture from state:",me),B(!0);let s=new FormData;s.append("id",k.id),s.append("first_name",a.first_name),s.append("last_name",a.last_name),s.append("email",ie.email),s.append("phone",a.phone),s.append("city",a.city),s.append("country",a.country),s.append("linkedIn_profile",a.linkedIn_profile),s.append("type_of_investor",a.type_of_investor),s.append("accredited_status",a.accredited_status),s.append("bio_short",a.bio_short),s.append("mailing_address",a.mailing_address),s.append("country_tax",a.country_tax),s.append("tax_id",a.tax_id),s.append("screen_name",a.screen_name),s.append("job_title",a.job_title),s.append("company_name",a.company_name),s.append("company_country",a.company_country),s.append("company_website",a.company_website),s.append("geo_focus",a.geo_focus),s.append("network_bio",a.network_bio),s.append("notes",a.notes),s.append("invest_through_company",a.invest_through_company),s.append("investing_company_name",a.investing_company_name),s.append("current_job_title",a.current_job_title),s.append("investor_company_country",a.investor_company_country),s.append("investor_company_website",a.investor_company_website),s.append("hands_on",$.join(",")),s.append("ma_interests",q.join(",")),s.append("preferred_stages",O.join(",")),s.append("cheque_size",J.join(","));const t=K.map((e=>e.value)).join(",");if(s.append("industry_expertise",t||a.industry_expertise),s.append("full_address",a.mailing_address),s.append("code",JSON.stringify(de)),s.append("capavate_interests",Z.join(",")),ce&&ce.length>0)for(let a=0;a<ce.length;a++)s.append("kyc_document[]",ce[a]);me&&s.append("profile_picture",me);try{await l.A.post(re+"investorprofile",s,{headers:{"Content-Type":"multipart/form-data"}});_e("Profile saved successfully \u2713"),B(!1),ye(),setTimeout((()=>{_e("")}),8e3)}catch(o){console.error("Upload error:",o),B(!1),_e("Error saving profile","error")}},ke=(0,t.useCallback)(((e,s,a)=>{s(e.includes(a)?e.filter((e=>e!==a)):[...e,a])}),[]);(0,t.useEffect)((()=>{if(!a.country)return void be([]);console.log(a.country);const e=xe.find((e=>e.name===a.country));if(null===e||void 0===e||!e.isoCode)return void be([]);ge(e.isoCode);const s=u.A.getCitiesOfCountry(e.isoCode);be(s&&s.length>0?s:[])}),[a.country]);const Se=e=>{let{label:s,options:a,selected:t,setSelected:l}=e;return(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:s}),(0,x.jsx)("div",{className:"d-flex flex-wrap gap-2",children:a.map((e=>{const s=e.id||e,a=e.label||e;return(0,x.jsxs)("span",{onClick:()=>ke(t,l,s),className:"badge rounded-pill px-3 py-2",style:{cursor:"pointer",fontSize:12,fontWeight:500,backgroundColor:t.includes(s)?"#CC0000":"#f1f5f9",color:t.includes(s)?"#fff":"#475569",border:"1.5px solid "+(t.includes(s)?"#CC0000":"#cbd5e1"),transition:"all 0.15s"},title:e.description||"",children:[t.includes(s)&&"\u2713 ",a]},s)}))})]})};if(null===k)return(0,x.jsx)("main",{children:(0,x.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,x.jsx)(o.A,{}),(0,x.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,x.jsx)(r.A,{}),(0,x.jsx)("div",{className:"d-flex justify-content-center align-items-center",style:{minHeight:400},children:(0,x.jsx)("div",{className:"spinner-border text-success",role:"status",children:(0,x.jsx)("span",{className:"visually-hidden",children:"Loading..."})})})]})]})});const ze=[(0,x.jsxs)("div",{children:[(0,x.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,x.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Your Current Role/Work"}),(0,x.jsx)("small",{className:"text-muted",children:"Used for cap table management"})]}),(0,x.jsxs)("div",{className:"row",children:[(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Screen Name"}),(0,x.jsx)("input",{type:"text",name:"screen_name",className:"form-control form-control-sm",placeholder:"@JohnSmith",value:a.screen_name||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"}),(0,x.jsx)("small",{className:"text-muted d-block mt-2",style:{fontSize:"12px",color:"#6c757d"},children:"NOTE: Your screen name will be visible to all shareholders on the same cap table and across all social media sections of Capavate.com. Your portfolio companies, where you are a shareholder, will have access to your real name."})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Current Job Title"}),(0,x.jsx)("input",{type:"text",name:"job_title",className:"form-control form-control-sm",placeholder:"Managing Partner",value:a.job_title||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Current Company Name"}),(0,x.jsx)("input",{type:"text",name:"company_name",className:"form-control form-control-sm",placeholder:"Acme Ventures",value:a.company_name||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Country"}),(0,x.jsxs)("select",{name:"company_country",className:"form-select form-select-sm",value:a.company_country||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),V.map((e=>(0,x.jsx)("option",{value:e.name||e.country_name,children:e.name||e.country_name},e.id||e.name)))]})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Website"}),(0,x.jsx)("input",{type:"url",name:"company_website",className:"form-control form-control-sm",placeholder:"https://acmeventures.com",value:a.company_website||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})})]}),(0,x.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,x.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Contact Information"}),(0,x.jsx)("small",{className:"text-muted",children:"Used for cap table management"})]}),(0,x.jsxs)("div",{className:"row",children:[(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["First Name ",(0,x.jsx)("span",{className:"text-danger ms-1",children:"*"})]}),(0,x.jsx)("input",{type:"text",name:"first_name",className:"form-control form-control-sm",placeholder:"John",value:a.first_name||"",onChange:je,required:!0,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["Last Name ",(0,x.jsx)("span",{className:"text-danger ms-1",children:"*"})]}),(0,x.jsx)("input",{type:"text",name:"last_name",className:"form-control form-control-sm",placeholder:"Smith",value:a.last_name||"",onChange:je,required:!0,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Contact (Email)"}),(0,x.jsx)("input",{type:"email",className:"form-control form-control-sm",value:ie.email||"",disabled:!0,readOnly:!0,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"}})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Country"}),(0,x.jsxs)("select",{name:"country",className:"form-select form-select-sm",value:a.country,onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),xe.map((e=>(0,x.jsx)("option",{value:e.name,children:e.name},e.isoCode)))]})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Contact (Mobile)"}),(0,x.jsx)(c.Ay,{value:a.phone||"",name:"phone",defaultCountry:he,onChange:e=>{C({...a,phone:e||""})},className:"phonregister form-control",placeholder:"Enter phone number",style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px",width:"100%"}},he),ae&&(0,x.jsx)("small",{style:{color:"red"},children:ae})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"City"}),(0,x.jsxs)("select",{name:"city",className:"form-select form-select-sm",value:a.city,onChange:je,disabled:!a.country,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px",backgroundColor:a.country?"white":"#f8f9fa"},children:[(0,x.jsx)("option",{value:"",children:a.country?"\u2014 Select City \u2014":"\u2014 Select Country First \u2014"}),fe.map(((e,s)=>(0,x.jsx)("option",{value:e.name,children:e.name},`${e.stateCode}-${e.name}-${s}`)))]})]})})]})]},"s0"),(0,x.jsxs)("div",{children:[(0,x.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,x.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Investor Profile"}),(0,x.jsx)("small",{className:"text-muted",children:"Used for cap table management"})]}),(0,x.jsxs)("div",{className:"row",children:[(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Type of Investor"}),(0,x.jsxs)("select",{name:"type_of_investor",className:"form-select form-select-sm",value:a.type_of_investor||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select \u2014"}),h.map((e=>(0,x.jsx)("option",{value:e,children:e},e)))]})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Accredited Status"}),(0,x.jsxs)("select",{name:"accredited_status",className:"form-select form-select-sm",value:a.accredited_status||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select \u2014"}),g.map((e=>(0,x.jsx)("option",{value:e,children:e},e)))]})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"One sentence that describes you (max 240 chars)"}),(0,x.jsx)("textarea",{name:"bio_short",className:"form-control form-control-sm",rows:3,maxLength:240,placeholder:"I'm an angel investor focused on...",value:a.bio_short||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"}}),(0,x.jsx)("small",{className:"text-muted",children:"Max 240 characters"})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"LinkedIn or Professional Profile"}),(0,x.jsx)("input",{type:"text",name:"linkedIn_profile",className:"form-control form-control-sm",placeholder:"https://linkedin.com/in/...",value:a.linkedIn_profile||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsxs)("div",{className:"col-md-12",children:[(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Do you invest through a company?"}),(0,x.jsxs)("div",{className:"d-flex gap-3",children:[(0,x.jsxs)("div",{className:"form-check",children:[(0,x.jsx)("input",{type:"radio",name:"invest_through_company",id:"investYes",className:"form-check-input",value:"yes",checked:"yes"===a.invest_through_company,onChange:je}),(0,x.jsx)("label",{className:"form-check-label",htmlFor:"investYes",children:"Yes"})]}),(0,x.jsxs)("div",{className:"form-check",children:[(0,x.jsx)("input",{type:"radio",name:"invest_through_company",id:"investNo",className:"form-check-input",value:"no",checked:"no"===a.invest_through_company,onChange:je}),(0,x.jsx)("label",{className:"form-check-label",htmlFor:"investNo",children:"No"})]})]})]}),"yes"===a.invest_through_company&&(0,x.jsxs)(x.Fragment,{children:[(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Investing Company Name"}),(0,x.jsx)("input",{type:"text",name:"investing_company_name",className:"form-control form-control-sm",placeholder:"e.g., Acme Capital Partners",value:a.investing_company_name||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]}),(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Current Job Title"}),(0,x.jsx)("input",{type:"text",name:"current_job_title",className:"form-control form-control-sm",placeholder:"e.g., Managing Partner, CFO",value:a.current_job_title||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]}),(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Country"}),(0,x.jsxs)("select",{name:"investor_company_country",className:"form-select form-select-sm",value:a.investor_company_country,onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),xe.map((e=>(0,x.jsx)("option",{value:e.name,children:e.name},e.isoCode)))]})]}),(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Full Mailing Address"}),(0,x.jsx)("input",{type:"text",name:"mailing_address",className:"form-control form-control-sm",placeholder:"123 Main St, Suite 400...",value:a.mailing_address||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]}),(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Website"}),(0,x.jsx)("input",{type:"url",name:"investor_company_website",className:"form-control form-control-sm",placeholder:"https://www.example.com",value:a.investor_company_website||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})]})]}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Country of Tax Residency"}),(0,x.jsxs)("select",{name:"country_tax",className:"form-select form-select-sm",value:a.country_tax||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),V.map((e=>(0,x.jsx)("option",{value:e.name||e.country_name,children:e.name||e.country_name},e.id||e.name)))]})]})}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Tax ID or National ID"}),(0,x.jsx)("input",{type:"text",name:"tax_id",className:"form-control form-control-sm",placeholder:"XXX-XXX-XXX",value:a.tax_id||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"KYC / AML Documentation"}),(0,x.jsx)("input",{type:"file",name:"kyc_document",className:"form-control form-control-sm mb-2",onChange:e=>{const s=Array.from(e.target.files);console.log("KYC files selected:",s),pe(s)},style:{borderRadius:8,border:"1.5px solid #e2e8f0"},multiple:!0}),k.kyc_document&&(()=>{try{const e=JSON.parse(k.kyc_document);if(e.length>0)return(0,x.jsxs)("div",{className:"mt-2",children:[(0,x.jsxs)("small",{className:"text-success d-block mb-2",children:["\u2713 ",e.length," document(s) already uploaded"]}),(0,x.jsx)("div",{className:"d-flex flex-wrap gap-2",children:e.map(((e,s)=>{const a="https://capavate.com/api/upload/investor/inv_"+k.id+"/"+e,t=e.split(".").pop().toLowerCase(),l=["jpg","jpeg","png","gif","webp","svg","bmp"].includes(t),o=()=>l?"\ud83d\uddbc\ufe0f":"pdf"===t?"\ud83d\udcc4":["doc","docx"].includes(t)?"\ud83d\udcdd":["xls","xlsx","csv"].includes(t)?"\ud83d\udcca":["txt","rtf"].includes(t)?"\ud83d\udcc3":["zip","rar","7z"].includes(t)?"\ud83d\udddc\ufe0f":"\ud83d\udcc1";return(0,x.jsxs)("div",{className:"card p-2",style:{width:"160px"},children:[l?(0,x.jsx)("img",{src:a,alt:`KYC ${s+1}`,style:{width:"100%",height:"90px",objectFit:"cover",borderRadius:"4px"},onError:e=>{e.target.onerror=null,e.target.style.display="none",e.target.parentElement.innerHTML=`\n                                      <div class="d-flex justify-content-center align-items-center" \n                                        style="height:90px; background:#f8f9fa; border-radius:4px">\n                                        <span style="font-size: 32px;">${o()}</span>\n                                      </div>\n                                    `}}):(0,x.jsx)("div",{className:"d-flex justify-content-center align-items-center",style:{height:"90px",background:"#f8f9fa",borderRadius:"4px"},children:(0,x.jsx)("span",{style:{fontSize:"32px"},children:o()})}),(0,x.jsxs)("div",{className:"mt-2",children:[(0,x.jsx)("small",{className:"d-block text-truncate",title:e,children:e}),(0,x.jsx)("small",{className:"text-muted d-block",children:t?t.toUpperCase():"FILE"})]}),(0,x.jsxs)("div",{className:"d-flex justify-content-center gap-1 mt-2",children:[(0,x.jsx)("button",{type:"button",className:"btn btn-sm btn-outline-primary",onClick:()=>window.open(a,"_blank"),style:{fontSize:"11px",padding:"2px 8px"},title:"View in browser",children:"View"}),(0,x.jsx)("a",{href:a,download:!0,className:"btn btn-sm btn-outline-success",style:{fontSize:"11px",padding:"2px 8px"},title:"Download file",children:"Download"})]})]},s)}))})]})}catch(e){return console.error("Error parsing KYC documents:",e),(0,x.jsx)("small",{className:"text-warning d-block mt-1",children:"\u26a0 Error loading documents"})}})(),(0,x.jsx)("small",{className:"text-muted d-block mt-2",children:"Upload passport, ID, address proof, or any relevant documentation (multiple files allowed)"})]})}),(0,x.jsx)("div",{className:"col-md-12 mb-3",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Profile Picture"}),(0,x.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[M?(0,x.jsx)("img",{src:M,alt:"preview",className:"rounded-circle",style:{width:64,height:64,objectFit:"cover",border:"2px solid #CC0000"}}):(0,x.jsx)("div",{className:"rounded-circle d-flex align-items-center justify-content-center",style:{width:64,height:64,background:"#f1f5f9",fontSize:28},children:"\ud83d\udc64"}),(0,x.jsx)("input",{type:"file",accept:"image/*",name:"profile_picture",onChange:e=>{const s=e.target.files[0];s&&(ue(s),F(URL.createObjectURL(s)))},className:"form-control form-control-sm w-auto",style:{borderRadius:8,border:"1.5px solid #e2e8f0"}})]})]})})]})]},"s1"),(0,x.jsxs)("div",{children:[(0,x.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,x.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Capavate Angel Investor Network Profile"}),(0,x.jsx)("small",{className:"text-muted",children:"Visible to founders on the platform"})]}),(0,x.jsxs)("div",{className:"row",children:[(0,x.jsx)("div",{className:"col-12",children:(0,x.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,x.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["INDUSTRY EXPERTISE",(0,x.jsx)("span",{className:"text-muted",style:{fontSize:"12px",marginLeft:"5px"},children:"(you can select multiple)"})]}),(0,x.jsx)(d.Jq,{children:(0,x.jsx)("div",{style:{width:"100%",position:"relative"},children:(0,x.jsx)(p.Ay,{isMulti:!0,name:"industry_expertise",options:ee,value:K,onChange:e=>{G(e)},placeholder:"Select industries...",className:"basic-multi-select",classNamePrefix:"select",styles:{control:e=>({...e,minHeight:"45px",border:"1px solid #dee2e6",borderRadius:"8px","&:hover":{borderColor:"#CC0000"}}),menu:e=>({...e,zIndex:9999}),multiValue:e=>({...e,backgroundColor:"#CC0000",color:"white"}),multiValueLabel:e=>({...e,color:"white"}),multiValueRemove:e=>({...e,color:"white","&:hover":{backgroundColor:"#CC0000",color:"white"}})},theme:e=>({...e,colors:{...e.colors,primary:"#CC0000",primary25:"#e6f7f5"}})})})}),K.length>0&&(0,x.jsxs)("small",{className:"text-muted",children:["Selected: ",K.length," industries"]})]})}),(0,x.jsxs)("div",{className:"col-md-12 mb-3",children:[(0,x.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["Typical Cheque Size",(0,x.jsx)("span",{className:"ms-2 fw-normal text-muted",style:{textTransform:"none",letterSpacing:0,fontSize:11},children:"\u2014 select multiple"})]}),(0,x.jsx)("div",{className:"d-flex flex-wrap gap-2",children:b.map((e=>{const s=J.includes(e);return(0,x.jsxs)("span",{onClick:()=>Y((s=>s.includes(e)?s.filter((s=>s!==e)):[...s,e])),style:{cursor:"pointer",userSelect:"none",padding:"6px 14px",borderRadius:20,fontSize:12,fontWeight:500,backgroundColor:s?"#CC0000":"#f1f5f9",color:s?"#fff":"#475569",border:"1.5px solid "+(s?"#CC0000":"#cbd5e1"),transition:"all 0.15s"},children:[s&&"\u2713 ",e]},e)}))})]}),(0,x.jsx)("div",{className:"col-md-6",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Geography Focus"}),(0,x.jsxs)("select",{name:"geo_focus",className:"form-select form-select-sm",value:a.geo_focus||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,x.jsx)("option",{value:"",children:"\u2014 Select \u2014"}),y.map((e=>(0,x.jsx)("option",{value:e,children:e},e)))]})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsx)(Se,{label:"Preferred Stage",options:v,selected:O,setSelected:T})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsx)(Se,{label:"Hands\u2011on vs Hands\u2011off",options:j,selected:$,setSelected:L})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Network Bio"}),(0,x.jsx)("textarea",{name:"network_bio",className:"form-control form-control-sm",rows:3,maxLength:1e3,placeholder:"Tell founders about your background...",value:a.network_bio||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"}}),(0,x.jsx)("small",{className:"text-muted",children:"Max 1000 characters"})]})}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsx)(Se,{label:"M&A Interests",options:_,selected:q,setSelected:D})}),(0,x.jsxs)("div",{className:"col-12 mt-4",children:[(0,x.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,x.jsxs)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:[(0,x.jsx)(i.A,{size:18,className:"me-2"}),"Capavate Angel Network Interests"]}),(0,x.jsx)("small",{className:"text-muted",children:"I'm focused on the following M&A and investment topics:"})]}),(0,x.jsx)("div",{className:"row",children:(0,x.jsxs)("div",{className:"col-12",children:[(0,x.jsx)(Se,{label:"Investment Interests",options:w,selected:Z,setSelected:Q}),Z.length>0&&(0,x.jsxs)("div",{className:"mt-3 p-3 bg-light rounded",children:[(0,x.jsx)("small",{className:"text-muted fw-bold",children:"Selected Interests:"}),(0,x.jsx)("ul",{className:"mt-2 mb-0",children:Z.map((e=>{const s=w.find((s=>s.id===e));return s?(0,x.jsx)("li",{className:"mb-1",children:(0,x.jsxs)("small",{children:[(0,x.jsxs)("span",{className:"fw-bold",children:[s.label,":"]})," ",s.description]})},e):null}))})]})]})})]}),(0,x.jsx)("div",{className:"col-md-12",children:(0,x.jsxs)("div",{className:"mb-3",children:[(0,x.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Notes"}),(0,x.jsx)("textarea",{name:"notes",className:"form-control form-control-sm",rows:3,placeholder:"Any additional notes...",value:a.notes||"",onChange:je,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"}})]})})]})]},"s2")];return(0,x.jsx)("main",{children:(0,x.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,x.jsx)(o.A,{}),(0,x.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,x.jsx)(r.A,{}),(0,x.jsx)("section",{className:"px-md-3 py-4",children:(0,x.jsxs)("div",{className:"container-fluid",children:[(0,x.jsxs)("div",{className:"mb-4",children:[(0,x.jsx)("h4",{className:"fw-bold mb-0",children:"Investor Profile"}),(0,x.jsx)("small",{className:"text-muted",children:"Manage your contact info, investor details, and network presence"})]}),z.text&&(0,x.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(I?"error_pop":"success_pop"),children:[(0,x.jsx)("div",{className:"d-flex align-items-start gap-2",children:(0,x.jsx)("span",{className:"d-block",children:z.text})}),(0,x.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>R("",""),children:"\xd7"})]}),U.phone&&(0,x.jsx)("div",{className:"alert alert-danger py-2 px-3 mb-3",style:{borderRadius:10},children:U.phone}),(0,x.jsx)("div",{className:"d-flex align-items-center mb-4 gap-0",style:{background:"#f8fafc",borderRadius:14,padding:6,border:"1.5px solid #e2e8f0"},children:f.map(((a,l)=>(0,x.jsxs)(t.Fragment,{children:[(0,x.jsxs)("button",{type:"button",onClick:()=>s(a.id),className:"btn d-flex align-items-center gap-2 flex-grow-1 justify-content-center",style:{borderRadius:10,fontWeight:600,fontSize:14,padding:"10px 16px",background:e===a.id?"#CC0000":"transparent",color:e===a.id?"#fff":"#64748b",border:"none",transition:"all 0.2s"},children:[(0,x.jsx)("span",{style:{fontSize:18},children:a.icon}),(0,x.jsx)("span",{className:"d-none d-md-inline",children:a.label})]}),l<f.length-1&&(0,x.jsx)("span",{style:{color:"#cbd5e1",fontSize:18,flexShrink:0},children:"\u203a"})]},a.id)))}),(0,x.jsx)("div",{className:"card border-0 shadow-sm",style:{borderRadius:16},children:(0,x.jsx)("div",{className:"card-body p-4",children:(0,x.jsxs)("form",{onSubmit:Ce,children:[(0,x.jsx)("div",{style:{minHeight:400},children:ze[e]}),(0,x.jsxs)("div",{className:"d-flex justify-content-between align-items-center mt-4 pt-3 border-top",children:[(0,x.jsx)("button",{type:"button",className:"btn btn-outline-secondary btn-sm px-4",onClick:()=>s((e=>Math.max(0,e-1))),disabled:0===e,style:{borderRadius:8},children:"\u2190 Previous"}),(0,x.jsxs)("span",{className:"text-muted small",children:["Step ",e+1," of ",f.length]}),2===e?(0,x.jsx)("button",{type:"button",className:"btn btn-sm px-4 ee",disabled:X,onClick:Ce,style:{borderRadius:8,background:"#CC0000",color:"#fff",fontWeight:600},children:X?(0,x.jsxs)(x.Fragment,{children:[(0,x.jsx)("span",{className:"spinner-border spinner-border-sm me-2",role:"status","aria-hidden":"true"}),"Saving..."]}):"Save Changes \u2713"}):(0,x.jsx)("button",{type:"button",className:"btn btn-sm px-4",onClick:()=>s((e=>e+1)),style:{borderRadius:8,background:"#CC0000",color:"#fff",fontWeight:600},children:"Next \u2192"})]})]})})})]})})]})]})})}},62837:(e,s,a)=>{a.d(s,{$K:()=>r,CB:()=>i,Cd:()=>g,I0:()=>c,Jq:()=>u,R3:()=>j,Zw:()=>m,dN:()=>b,hJ:()=>h,jh:()=>d,mO:()=>l,mg:()=>n,nj:()=>y,pd:()=>v,uM:()=>x,vE:()=>o,z6:()=>p});var t=a(5464);const l=t.default.div`
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
`,r=(t.default.div`
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
`),n=t.default.div`
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
`,i=t.default.div`
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
`,u=(t.default.div`
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
`),x=(t.default.div`
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
`),f=(t.default.div`
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
`),b=((0,t.default)(f)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,t.default)(f)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,t.default.sup`
  color: var(--primary);
`),h=t.default.div`
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
`,g=t.default.div`
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
`}}]);
//# sourceMappingURL=8288.c458ce83.chunk.js.map