/*! For license information please see 4097.8d2e3e39.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[4097],{5244:(e,t,s)=>{s.d(t,{A:()=>a});const a=(0,s(77784).A)("archive",[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",key:"1s80jp"}],["path",{d:"M10 12h4",key:"a56b0p"}]])},43436:(e,t,s)=>{s.r(t),s.d(t,{default:()=>k});var a=s(65043),l=s(86213),o=s(92334),n=s(81906),r=s(25581),i=s(13190),d=s(62837),c=s(26632),p=(s(65016),s(78703)),m=s(12789),u=s(62585),x=s(24910),f=s(70579);const h=[{id:0,label:"Contact Info",icon:"\ud83d\udccb"},{id:1,label:"Investor Profile",icon:"\ud83d\udc64"},{id:2,label:"Network Profile",icon:"\ud83c\udf10"}],b=["Less than $25k","$25k\u2013$50k","$50k\u2013$100k","$100k\u2013$250k","$250k\u2013$500k","$500k\u2013$1M","$1M\u2013$5M","$5M+"],g=["Accelerator","Advisor (consultant to companies)","Angel investor (Individual)","Angel network or angel club","Bank / Financial institution","Corporate venture capital / strategic corporate investor","Crowdfunding platform/crowd investor vehicle","Employee (via ESOP)","Family office (direct investing)","Fund\u2011of\u2011funds or investment company","Government (grant) or quasi\u2011government fund","Hedge fund","Impact or ESG\u2011focused investment fund","Incubator","Micro VC / emerging fund manager (pre\u2011seed/seed specialist)","Private equity/growth equity fund (late\u2011stage or special situations)","Representative of an accredited individual (advisor, family office CIO, etc.)","Syndicate lead or SPV manager (investing on behalf of a pooled vehicle)","Venture capital fund (institutional VC)"],y=["Yes \u2013 Accredited","No \u2013 Non-Accredited","Not Sure"],v=["Home Market Only","Home Country","Open to Global / Cross-Border"],j=["Pre-Seed","Seed","Series A","Series B","Series C+","Growth","Late Stage"],_=["Mentoring","Board Roles","Intros / Deal Flow","Portfolio Support","Passive"],N=["M&A Advisory","Buyouts","Mergers","Strategic Partnerships","PE Roll-ups","Distressed Assets","Cross-border M&A"],w={first_name:"",last_name:"",phone:"",city:"",country:"",linkedIn_profile:"",type_of_investor:"",accredited_status:"",bio_short:"",mailing_address:"",country_tax:"",tax_id:"",screen_name:"",job_title:"",company_name:"",company_country:"",state:"",country_code:"",company_website:"",industry_expertise:"",geo_focus:"",network_bio:"",notes:"",stateCode:""},C=[{id:"full_sale_exits",label:"Full Sale Exits",description:"Interested in discussing full company sales and strategic exits."},{id:"recapitalizations",label:"Recapitalizations",description:"Curious about partial sales and majority recapitalizations."},{id:"ipos_listings",label:"IPOs/Listings",description:"Following conversations on IPOs and other public listing routes."},{id:"secondaries",label:"Secondaries",description:"Interested in private secondary transactions for startup equity."},{id:"structured_exits",label:"Structured Exits",description:"Exploring structured exit solutions (earn\u2011outs, vendor notes, rollover equity)."},{id:"buybacks_redemptions",label:"Buybacks/Redemptions",description:"Following best practices around company share buybacks and redemption programs."},{id:"mbos_sponsor",label:"MBOs/Sponsor Deals",description:"Interested in management buy\u2011outs/buy\u2011ins and sponsor\u2011led deals (PE/VC)."},{id:"partial_liquidity",label:"Partial Liquidity",description:"Focused on strategies for partial liquidity while preserving upside (secondaries, recaps, dividends)."},{id:"distress_assets",label:"Distress Assets",description:"Engaging with companies that are distressed."},{id:"cross_border_distribution",label:"Cross-border Distribution",description:"Product or service distribution channel development."},{id:"joint_ventures",label:"Joint Ventures / Strategic Partnerships",description:"Exploring partnerships for scale."}];function k(){const[e,t]=(0,a.useState)(""),[s,k]=(0,a.useState)(""),[S,z]=(0,a.useState)([]),[R,A]=(0,a.useState)(""),[I,P]=(0,a.useState)(0),[$,M]=(0,a.useState)(w),[E,F]=(0,a.useState)(null),[O,q]=(0,a.useState)({text:"",type:""}),[D,L]=(0,a.useState)(!1),[T,B]=(0,a.useState)(null),[J,V]=(0,a.useState)(null),[Y,H]=(0,a.useState)([]),[X,U]=(0,a.useState)([]),[W,K]=(0,a.useState)([]),[G,Q]=(0,a.useState)([]),[Z,ee]=(0,a.useState)([]),[te,se]=(0,a.useState)(!1),[ae,le]=(0,a.useState)({}),[oe,ne]=(0,a.useState)([]),[re,ie]=(0,a.useState)([]),[de,ce]=(0,a.useState)([]),[pe,me]=(0,a.useState)(""),[ue,xe]=(0,a.useState)([]),fe=r.J+"api/user/investor/",he=r.J+"api/user/capitalround/",be=r.J+"api/user/investorreport/",ge=r.J+"api/user/capitalround/",ye=JSON.parse(localStorage.getItem("InvestorData")||"{}"),ve=null===ye||void 0===ye?void 0:ye.access_token,je={code:ye.unique_code||""},[_e,Ne]=(0,a.useState)([]),[we,Ce]=(0,a.useState)(null);document.title="Investor Profile";(0,a.useEffect)((()=>{P(0),Ie(),Pe(),Ee()}),[]);const ke=(0,a.useRef)(m.A.getAllCountries()).current,[Se,ze]=(0,a.useState)([]),[Re,Ae]=(0,a.useState)("CA"),Ie=async()=>{try{var s;const o=await l.A.post(fe+"getinvestorData",{id:ye.id},{headers:{Authorization:`Bearer ${ve}`}});if(console.log(ye),(null===(s=o.data.results)||void 0===s?void 0:s.length)>0){const s=o.data.results[0];if(F(s),M({first_name:s.first_name||"",last_name:s.last_name||"",phone:s.phone||"",city:s.city||"",state:s.state||"",country:s.country||"",linkedIn_profile:s.linkedIn_profile||"",type_of_investor:s.type_of_investor||"",accredited_status:s.accredited_status||"",bio_short:s.bio_short||"",mailing_address:s.mailing_address||"",country_tax:s.country_tax||"",tax_id:s.tax_id||"",screen_name:s.screen_name||"",job_title:s.job_title||"",company_name:s.company_name||"",company_country:s.company_country||"",company_website:s.company_website||"",industry_expertise:s.industry_expertise||"",network_bio:s.network_bio||"",notes:s.notes||"",invest_through_company:s.invest_through_company||"",investing_company_name:s.investing_company_name||"",current_job_title:s.current_job_title||"",investor_company_country:s.investor_company_country||"",investor_company_website:s.investor_company_website||""}),t(s.stateCode),k(s.countrycode),s.country){const t=ke.find((e=>e.name===s.country));if(null!==t&&void 0!==t&&t.isoCode){Ae(t.isoCode);const a=u.A.getCitiesOfState(s.countrycode,s.stateCode),l=(S.find((t=>t.isoCode===e)),x.Ay.getStatesOfCountry(null===t||void 0===t?void 0:t.isoCode));ze(a),console.log(a),z(l)}}if(xe(s.geo_focus?s.geo_focus.split(","):[]),H(s.hands_on?s.hands_on.split(","):[]),U(s.ma_interests?s.ma_interests.split(","):[]),K(s.preferred_stages?s.preferred_stages.split(","):[]),Q(s.cheque_size?s.cheque_size.split(","):[]),ie(s.capavate_interests?s.capavate_interests.split(","):[]),s.industry_expertise){const e=s.industry_expertise.split(",").map((e=>({value:e,label:e})));ne(e)}if(s.profile_picture){var a="https://capavate.com/api/upload/investor/inv_"+s.id+"/"+s.profile_picture;console.log(a),V(a)}}else F({})}catch(o){console.error(o),F({})}},Pe=async()=>{try{const e=await l.A.post(he+"getallcountrySymbolList",{id:""},{headers:{Authorization:`Bearer ${ve}`}});ee(e.data.results||[])}catch(e){console.error(e)}},$e=(0,a.useCallback)((e=>{const{name:t,value:s}=e.target;M("country"===t?e=>({...e,country:s,city:"",phone:""}):e=>({...e,[t]:s}))}),[]),Me=function(e){q({text:e,type:arguments.length>1&&void 0!==arguments[1]?arguments[1]:"success"}),setTimeout((()=>q({text:"",type:""})),3e3)},Ee=async()=>{let e={investor_id:""};try{const t=(await l.A.post(ge+"getIndustryExpertise",e,{headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${ve}`}})).data.results.map((e=>({value:e.value||e.name,label:e.name})));ce(t)}catch(t){}},Fe=(0,a.useRef)(I);(0,a.useEffect)((()=>{Fe.current=I}),[I]);const Oe=async t=>{if(t.preventDefault(),2!==Fe.current)return;console.log("KYC Files from state:",_e),console.log("Profile Picture from state:",we),se(!0);let a=new FormData;const o=ue.filter((e=>"string"===typeof e&&"[object Object]"!==e)).filter((e=>v.includes(e)));a.append("id",E.id),a.append("first_name",$.first_name),a.append("last_name",$.last_name),a.append("email",ye.email),a.append("phone",$.phone),a.append("city",$.city),a.append("country",$.country),a.append("linkedIn_profile",$.linkedIn_profile),a.append("type_of_investor",$.type_of_investor),a.append("accredited_status",$.accredited_status),a.append("bio_short",$.bio_short),a.append("mailing_address",$.mailing_address),a.append("country_tax",$.country_tax),a.append("tax_id",$.tax_id),a.append("screen_name",$.screen_name),a.append("job_title",$.job_title),a.append("company_name",$.company_name),a.append("company_country",$.company_country),a.append("company_website",$.company_website),a.append("geo_focus",o),a.append("network_bio",$.network_bio),a.append("notes",$.notes),a.append("invest_through_company",$.invest_through_company),a.append("investing_company_name",$.investing_company_name),a.append("current_job_title",$.current_job_title),a.append("investor_company_country",$.investor_company_country),a.append("investor_company_website",$.investor_company_website),a.append("state",$.state),a.append("stateCode",e),a.append("countrycode",s),a.append("hands_on",Y.join(",")),a.append("ma_interests",X.join(",")),a.append("preferred_stages",W.join(",")),a.append("cheque_size",G.join(","));const n=oe.map((e=>e.value)).join(",");if(a.append("industry_expertise",n||$.industry_expertise),a.append("full_address",$.mailing_address),a.append("code",JSON.stringify(je)),a.append("capavate_interests",re.join(",")),_e&&_e.length>0)for(let e=0;e<_e.length;e++)a.append("kyc_document[]",_e[e]);we&&a.append("profile_picture",we);try{await l.A.post(be+"investorprofile",a,{headers:{"Content-Type":"multipart/form-data",Authorization:`Bearer ${ve}`}});Me("Profile saved successfully \u2713"),se(!1),Ie(),setTimeout((()=>{Me("")}),8e3)}catch(r){console.error("Upload error:",r),se(!1),Me("Error saving profile","error")}},qe=(0,a.useCallback)(((e,t,s)=>{t(e.includes(s)?e.filter((e=>e!==s)):[...e,s])}),[]),De=e=>{let{label:t,options:s,selected:a,setSelected:l}=e;return(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:t}),(0,f.jsx)("div",{className:"d-flex flex-wrap gap-2",children:s.map((e=>{const t=e.id||e,s=e.label||e;return(0,f.jsxs)("span",{onClick:()=>qe(a,l,t),className:"badge rounded-pill px-3 py-2",style:{cursor:"pointer",fontSize:12,fontWeight:500,backgroundColor:a.includes(t)?"#CC0000":"#f1f5f9",color:a.includes(t)?"#fff":"#475569",border:"1.5px solid "+(a.includes(t)?"#CC0000":"#cbd5e1"),transition:"all 0.15s"},title:e.description||"",children:[a.includes(t)&&"\u2713 ",s]},t)}))})]})};if(null===E)return(0,f.jsx)("main",{children:(0,f.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,f.jsx)(o.A,{}),(0,f.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,f.jsx)(n.A,{}),(0,f.jsx)("div",{className:"d-flex justify-content-center align-items-center",style:{minHeight:400},children:(0,f.jsx)("div",{className:"spinner-border text-success",role:"status",children:(0,f.jsx)("span",{className:"visually-hidden",children:"Loading..."})})})]})]})});const Le=[(0,f.jsxs)("div",{children:[(0,f.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,f.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Your Current Role/Work"}),(0,f.jsx)("small",{className:"text-muted",children:"Used for cap table management"})]}),(0,f.jsxs)("div",{className:"row",children:[(0,f.jsx)("div",{className:"col-12",children:(0,f.jsx)("div",{className:"row",children:(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3 important-section",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Screen Name"}),(0,f.jsx)("input",{type:"text",name:"screen_name",className:"form-control form-control-sm",placeholder:"@JohnSmith",value:$.screen_name||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"}),(0,f.jsx)("small",{className:"d-block mt-2",style:{fontSize:"12px",color:"#CC0000"},children:"NOTE: Your screen name will be visible to all shareholders on the same cap table and across all social media sections of Capavate.com. Your portfolio companies, where you are a shareholder, will have access to your real name."})]})})})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Current Company Name"}),(0,f.jsx)("input",{type:"text",name:"company_name",className:"form-control form-control-sm",placeholder:"Acme Ventures",value:$.company_name||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Country"}),(0,f.jsxs)("select",{name:"company_country",className:"form-select form-select-sm",value:$.company_country||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,f.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),Z.map((e=>(0,f.jsx)("option",{value:e.name||e.country_name,children:e.name||e.country_name},e.id||e.name)))]})]})}),(0,f.jsx)("div",{className:"col-md-12",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Current Job Title"}),(0,f.jsx)("input",{type:"text",name:"job_title",className:"form-control form-control-sm",placeholder:"Managing Partner",value:$.job_title||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,f.jsx)("div",{className:"col-md-12",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Website"}),(0,f.jsx)("input",{type:"url",name:"company_website",className:"form-control form-control-sm",placeholder:"https://acmeventures.com",value:$.company_website||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})})]}),(0,f.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,f.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Contact Information"}),(0,f.jsx)("small",{className:"text-muted",children:"Used for cap table management"})]}),(0,f.jsxs)("div",{className:"row",children:[(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["First Name ",(0,f.jsx)("span",{className:"text-danger ms-1",children:"*"})]}),(0,f.jsx)("input",{type:"text",name:"first_name",className:"form-control form-control-sm",placeholder:"John",value:$.first_name||"",onChange:$e,required:!0,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["Last Name ",(0,f.jsx)("span",{className:"text-danger ms-1",children:"*"})]}),(0,f.jsx)("input",{type:"text",name:"last_name",className:"form-control form-control-sm",placeholder:"Smith",value:$.last_name||"",onChange:$e,required:!0,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Contact (Email)"}),(0,f.jsx)("input",{type:"email",className:"form-control form-control-sm",value:ye.email||"",disabled:!0,readOnly:!0,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"}})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Country"}),(0,f.jsxs)("select",{name:"country",className:"form-select form-select-sm",value:$.country,onChange:e=>{e.target.value;const t=e.target.options[e.target.selectedIndex].text,s=ke.find((e=>e.name===t));if(null!==s&&void 0!==s&&s.isoCode){Ae(s.isoCode),k(null===s||void 0===s?void 0:s.isoCode),M((e=>({...e,country:t,country_code:null===s||void 0===s?void 0:s.isoCode})));const e=x.Ay.getStatesOfCountry(null===s||void 0===s?void 0:s.isoCode);ze([]),z(e)}},style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,f.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),ke.map((e=>(0,f.jsx)("option",{value:e.name,children:e.name},e.isoCode)))]})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"State"}),(0,f.jsxs)("select",{name:"state",className:"form-select form-select-sm",value:e,onChange:e=>{A(e.target.value);const a=e.target.value;console.log(s,a),t(a);const l=u.A.getCitiesOfState(s,a),o=S.find((e=>e.isoCode===a)),n=o?o.name:"";M((e=>({...e,state:n}))),ze(l)},disabled:!$.country,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px",backgroundColor:$.country?"white":"#f8f9fa"},children:[(0,f.jsx)("option",{value:"",children:$.country?"\u2014 Select State \u2014":"\u2014 Select Country First \u2014"}),S.map(((e,t)=>(0,f.jsx)("option",{value:e.isoCode,children:e.name},`${e.stateCode}-${e.name}-${t}`)))]})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"City"}),(0,f.jsxs)("select",{name:"city",className:"form-select form-select-sm",value:$.city,onChange:$e,disabled:!$.country,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px",backgroundColor:$.country?"white":"#f8f9fa"},children:[(0,f.jsx)("option",{value:"",children:$.country?"\u2014 Select City \u2014":"\u2014 Select Country First \u2014"}),Se.map(((e,t)=>(0,f.jsx)("option",{value:e.name,children:e.name},`${e.stateCode}-${e.name}-${t}`)))]})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Contact (Mobile)"}),(0,f.jsx)(c.Ay,{value:$.phone||"",name:"phone",defaultCountry:Re,onChange:e=>{M({...$,phone:e||""})},className:"phonregister form-control",placeholder:"Enter phone number",style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px",width:"100%"}},Re),pe&&(0,f.jsx)("small",{style:{color:"red"},children:pe})]})})]})]},"s0"),(0,f.jsxs)("div",{children:[(0,f.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,f.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Investor Profile"}),(0,f.jsx)("small",{className:"text-muted",children:"Used for cap table management"})]}),(0,f.jsxs)("div",{className:"row",children:[(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Type of Investor"}),(0,f.jsxs)("select",{name:"type_of_investor",className:"form-select form-select-sm",value:$.type_of_investor||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,f.jsx)("option",{value:"",children:"\u2014 Select \u2014"}),g.map((e=>(0,f.jsx)("option",{value:e,children:e},e)))]})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Accredited Status"}),(0,f.jsxs)("select",{name:"accredited_status",className:"form-select form-select-sm",value:$.accredited_status||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,f.jsx)("option",{value:"",children:"\u2014 Select \u2014"}),y.map((e=>(0,f.jsx)("option",{value:e,children:e},e)))]})]})}),(0,f.jsx)("div",{className:"col-md-12",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Network Bio: One sentence that describes you (max 500 characters)"}),(0,f.jsx)("textarea",{name:"bio_short",className:"form-control form-control-sm",rows:3,maxLength:500,placeholder:"Toronto-based angel backing B2B SaaS and fintech, hands-on with fundraising and go-to-market...",value:$.bio_short||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"}}),(0,f.jsx)("small",{className:"text-muted",children:"Max 500 characters"})]})}),(0,f.jsx)("div",{className:"col-md-12",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"LinkedIn or Professional Profile"}),(0,f.jsx)("input",{type:"text",name:"linkedIn_profile",className:"form-control form-control-sm",placeholder:"https://linkedin.com/in/...",value:$.linkedIn_profile||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,f.jsxs)("div",{className:"col-md-12",children:[(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Do you invest through a company?"}),(0,f.jsxs)("div",{className:"d-flex gap-3",children:[(0,f.jsxs)("div",{className:"form-check",children:[(0,f.jsx)("input",{type:"radio",name:"invest_through_company",id:"investYes",className:"form-check-input",value:"yes",checked:"yes"===$.invest_through_company,onChange:$e}),(0,f.jsx)("label",{className:"form-check-label",htmlFor:"investYes",children:"Yes"})]}),(0,f.jsxs)("div",{className:"form-check",children:[(0,f.jsx)("input",{type:"radio",name:"invest_through_company",id:"investNo",className:"form-check-input",value:"no",checked:"no"===$.invest_through_company,onChange:$e}),(0,f.jsx)("label",{className:"form-check-label",htmlFor:"investNo",children:"No"})]})]})]}),"yes"===$.invest_through_company&&(0,f.jsxs)(f.Fragment,{children:[(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Investing Company Name"}),(0,f.jsx)("input",{type:"text",name:"investing_company_name",className:"form-control form-control-sm",placeholder:"e.g., Acme Capital Partners",value:$.investing_company_name||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]}),(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Current Job Title"}),(0,f.jsx)("input",{type:"text",name:"current_job_title",className:"form-control form-control-sm",placeholder:"e.g., Managing Partner, CFO",value:$.current_job_title||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]}),(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Country"}),(0,f.jsxs)("select",{name:"investor_company_country",className:"form-select form-select-sm",value:$.investor_company_country,onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,f.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),ke.map((e=>(0,f.jsx)("option",{value:e.name,children:e.name},e.isoCode)))]})]}),(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Full Mailing Address"}),(0,f.jsx)("input",{type:"text",name:"mailing_address",className:"form-control form-control-sm",placeholder:"123 Main St, Suite 400...",value:$.mailing_address||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]}),(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Company Website"}),(0,f.jsx)("input",{type:"url",name:"investor_company_website",className:"form-control form-control-sm",placeholder:"https://www.example.com",value:$.investor_company_website||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})]})]}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Country of Tax Residency"}),(0,f.jsxs)("select",{name:"country_tax",className:"form-select form-select-sm",value:$.country_tax||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},children:[(0,f.jsx)("option",{value:"",children:"\u2014 Select Country \u2014"}),Z.map((e=>(0,f.jsx)("option",{value:e.name||e.country_name,children:e.name||e.country_name},e.id||e.name)))]})]})}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Tax ID or National ID"}),(0,f.jsx)("input",{type:"text",name:"tax_id",className:"form-control form-control-sm",placeholder:"XXX-XXX-XXX",value:$.tax_id||"",onChange:$e,style:{borderRadius:8,border:"1.5px solid #e2e8f0",padding:"10px 14px"},autoComplete:"off"})]})}),(0,f.jsx)("div",{className:"col-md-12",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"KYC / AML Documentation"}),(0,f.jsx)("input",{type:"file",name:"kyc_document",className:"form-control form-control-sm mb-2",onChange:e=>{const t=Array.from(e.target.files);console.log("KYC files selected:",t),Ne(t)},style:{borderRadius:8,border:"1.5px solid #e2e8f0"},multiple:!0}),E.kyc_document&&(()=>{try{const e=JSON.parse(E.kyc_document);if(e.length>0)return(0,f.jsxs)("div",{className:"mt-2",children:[(0,f.jsxs)("small",{className:"text-success d-block mb-2",children:["\u2713 ",e.length," document(s) already uploaded"]}),(0,f.jsx)("div",{className:"d-flex flex-wrap gap-2",children:e.map(((e,t)=>{const s="https://capavate.com/api/upload/investor/inv_"+E.id+"/"+e,a=e.split(".").pop().toLowerCase(),l=["jpg","jpeg","png","gif","webp","svg","bmp"].includes(a),o=()=>l?"\ud83d\uddbc\ufe0f":"pdf"===a?"\ud83d\udcc4":["doc","docx"].includes(a)?"\ud83d\udcdd":["xls","xlsx","csv"].includes(a)?"\ud83d\udcca":["txt","rtf"].includes(a)?"\ud83d\udcc3":["zip","rar","7z"].includes(a)?"\ud83d\udddc\ufe0f":"\ud83d\udcc1";return(0,f.jsxs)("div",{className:"card p-2",style:{width:"160px"},children:[l?(0,f.jsx)("img",{src:s,alt:`KYC ${t+1}`,style:{width:"100%",height:"90px",objectFit:"cover",borderRadius:"4px"},onError:e=>{e.target.onerror=null,e.target.style.display="none",e.target.parentElement.innerHTML=`\n                                      <div class="d-flex justify-content-center align-items-center" \n                                        style="height:90px; background:#f8f9fa; border-radius:4px">\n                                        <span style="font-size: 32px;">${o()}</span>\n                                      </div>\n                                    `}}):(0,f.jsx)("div",{className:"d-flex justify-content-center align-items-center",style:{height:"90px",background:"#f8f9fa",borderRadius:"4px"},children:(0,f.jsx)("span",{style:{fontSize:"32px"},children:o()})}),(0,f.jsxs)("div",{className:"mt-2",children:[(0,f.jsx)("small",{className:"d-block text-truncate",title:e,children:e}),(0,f.jsx)("small",{className:"text-muted d-block",children:a?a.toUpperCase():"FILE"})]}),(0,f.jsxs)("div",{className:"d-flex justify-content-center gap-1 mt-2",children:[(0,f.jsx)("button",{type:"button",className:"btn btn-sm btn-outline-primary",onClick:()=>window.open(s,"_blank"),style:{fontSize:"11px",padding:"2px 8px"},title:"View in browser",children:"View"}),(0,f.jsx)("a",{href:s,download:!0,className:"btn btn-sm btn-outline-success",style:{fontSize:"11px",padding:"2px 8px"},title:"Download file",children:"Download"})]})]},t)}))})]})}catch(e){return console.error("Error parsing KYC documents:",e),(0,f.jsx)("small",{className:"text-warning d-block mt-1",children:"\u26a0 Error loading documents"})}})(),(0,f.jsx)("small",{className:"text-muted d-block mt-2",children:"Upload passport, ID, address proof, or any relevant documentation (multiple files allowed)"})]})}),(0,f.jsx)("div",{className:"col-md-12 mb-3",children:(0,f.jsxs)("div",{className:"mb-3",children:[(0,f.jsx)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:"Profile Picture"}),(0,f.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[J?(0,f.jsx)("img",{src:J,alt:"preview",className:"rounded-circle",style:{width:64,height:64,objectFit:"cover",border:"2px solid #CC0000"}}):(0,f.jsx)("div",{className:"rounded-circle d-flex align-items-center justify-content-center",style:{width:64,height:64,background:"#f1f5f9",fontSize:28},children:"\ud83d\udc64"}),(0,f.jsx)("input",{type:"file",accept:"image/*",name:"profile_picture",onChange:e=>{const t=e.target.files[0];t&&(Ce(t),V(URL.createObjectURL(t)))},className:"form-control form-control-sm w-auto",style:{borderRadius:8,border:"1.5px solid #e2e8f0"}})]})]})})]})]},"s1"),(0,f.jsxs)("div",{children:[(0,f.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,f.jsx)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:"Capavate Angel Investor Network Profile"}),(0,f.jsx)("small",{className:"text-muted",children:"Visible to founders on the platform"})]}),(0,f.jsxs)("div",{className:"row",children:[(0,f.jsx)("div",{className:"col-12",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,f.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["INDUSTRY EXPERTISE",(0,f.jsx)("span",{className:"text-muted",style:{fontSize:"12px",marginLeft:"5px"},children:"(you can select multiple)"})]}),(0,f.jsx)(d.Jq,{children:(0,f.jsx)("div",{style:{width:"100%",position:"relative"},children:(0,f.jsx)(p.Ay,{isMulti:!0,name:"industry_expertise",options:de,value:oe,onChange:e=>{ne(e)},placeholder:"Select industries...",className:"basic-multi-select",classNamePrefix:"select",styles:{control:e=>({...e,minHeight:"45px",border:"1px solid #dee2e6",borderRadius:"8px","&:hover":{borderColor:"#CC0000"}}),menu:e=>({...e,zIndex:9999}),multiValue:e=>({...e,backgroundColor:"#CC0000",color:"white"}),multiValueLabel:e=>({...e,color:"white"}),multiValueRemove:e=>({...e,color:"white","&:hover":{backgroundColor:"#CC0000",color:"white"}})},theme:e=>({...e,colors:{...e.colors,primary:"#CC0000",primary25:"#e6f7f5"}})})})}),oe.length>0&&(0,f.jsxs)("small",{className:"text-muted",children:["Selected: ",oe.length," industries"]})]})}),(0,f.jsxs)("div",{className:"col-md-12 mb-3",children:[(0,f.jsxs)("label",{className:"form-label fw-semibold small text-uppercase",style:{letterSpacing:"0.05em",color:"#4a5568"},children:["Typical Cheque Size",(0,f.jsx)("span",{className:"ms-2 fw-normal text-muted",style:{textTransform:"none",letterSpacing:0,fontSize:11},children:"\u2014 select multiple"})]}),(0,f.jsx)("div",{className:"d-flex flex-wrap gap-2",children:b.map((e=>{const t=G.includes(e);return(0,f.jsxs)("span",{onClick:()=>Q((t=>t.includes(e)?t.filter((t=>t!==e)):[...t,e])),style:{cursor:"pointer",userSelect:"none",padding:"6px 14px",borderRadius:20,fontSize:12,fontWeight:500,backgroundColor:t?"#CC0000":"#f1f5f9",color:t?"#fff":"#475569",border:"1.5px solid "+(t?"#CC0000":"#cbd5e1"),transition:"all 0.15s"},children:[t&&"\u2713 ",e]},e)}))})]}),(0,f.jsx)("div",{className:"col-md-6",children:(0,f.jsx)(De,{label:"Geography Focus",options:v,selected:ue,setSelected:xe})}),(0,f.jsx)("div",{className:"col-md-12",children:(0,f.jsx)(De,{label:"Preferred Stage",options:j,selected:W,setSelected:K})}),(0,f.jsx)("div",{className:"col-md-12",children:(0,f.jsx)(De,{label:"Hands\u2011on vs Hands\u2011off",options:_,selected:Y,setSelected:H})}),(0,f.jsx)("div",{className:"col-md-12",children:(0,f.jsx)(De,{label:"M&A Interests",options:N,selected:X,setSelected:U})}),(0,f.jsxs)("div",{className:"col-12 mt-4",children:[(0,f.jsxs)("div",{className:"mb-4 pb-2 border-bottom",children:[(0,f.jsxs)("h5",{className:"fw-bold mb-0",style:{color:"#CC0000"},children:[(0,f.jsx)(i.A,{size:18,className:"me-2"}),"Capavate Angel Network Interests"]}),(0,f.jsx)("small",{className:"text-muted",children:"I'm focused on the following M&A and investment topics:"})]}),(0,f.jsx)("div",{className:"row",children:(0,f.jsxs)("div",{className:"col-12",children:[(0,f.jsx)(De,{label:"Investment Interests",options:C,selected:re,setSelected:ie}),re.length>0&&(0,f.jsxs)("div",{className:"mt-3 p-3 bg-light rounded",children:[(0,f.jsx)("small",{className:"text-muted fw-bold",children:"Selected Interests:"}),(0,f.jsx)("ul",{className:"mt-2 mb-0",children:re.map((e=>{const t=C.find((t=>t.id===e));return t?(0,f.jsx)("li",{className:"mb-1",children:(0,f.jsxs)("small",{children:[(0,f.jsxs)("span",{className:"fw-bold",children:[t.label,":"]})," ",t.description]})},e):null}))})]})]})})]})]})]},"s2")];return(0,f.jsx)("main",{children:(0,f.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,f.jsx)(o.A,{}),(0,f.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,f.jsx)(n.A,{}),(0,f.jsx)("section",{className:"px-md-3 py-4",children:(0,f.jsxs)("div",{className:"container-fluid",children:[(0,f.jsxs)("div",{className:"mb-4",children:[(0,f.jsx)("h4",{className:"fw-bold mb-0",children:"Investor Profile"}),(0,f.jsx)("small",{className:"text-muted",children:"Manage your contact info, investor details, and network presence"})]}),O.text&&(0,f.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(D?"error_pop":"success_pop"),children:[(0,f.jsx)("div",{className:"d-flex align-items-start gap-2",children:(0,f.jsx)("span",{className:"d-block",children:O.text})}),(0,f.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>q("",""),children:"\xd7"})]}),ae.phone&&(0,f.jsx)("div",{className:"alert alert-danger py-2 px-3 mb-3",style:{borderRadius:10},children:ae.phone}),(0,f.jsx)("div",{className:"d-flex align-items-center mb-4 gap-0",style:{background:"#f8fafc",borderRadius:14,padding:6,border:"1.5px solid #e2e8f0"},children:h.map(((e,t)=>(0,f.jsxs)(a.Fragment,{children:[(0,f.jsxs)("button",{type:"button",onClick:()=>P(e.id),className:"btn d-flex align-items-center gap-2 flex-grow-1 justify-content-center",style:{borderRadius:10,fontWeight:600,fontSize:14,padding:"10px 16px",background:I===e.id?"#CC0000":"transparent",color:I===e.id?"#fff":"#64748b",border:"none",transition:"all 0.2s"},children:[(0,f.jsx)("span",{style:{fontSize:18},children:e.icon}),(0,f.jsx)("span",{className:"d-none d-md-inline",children:e.label})]}),t<h.length-1&&(0,f.jsx)("span",{style:{color:"#cbd5e1",fontSize:18,flexShrink:0},children:"\u203a"})]},e.id)))}),(0,f.jsx)("div",{className:"card border-0 shadow-sm",style:{borderRadius:16},children:(0,f.jsx)("div",{className:"card-body p-4",children:(0,f.jsxs)("form",{onSubmit:Oe,children:[(0,f.jsx)("div",{style:{minHeight:400},children:Le[I]}),(0,f.jsxs)("div",{className:"d-flex justify-content-between align-items-center mt-4 pt-3 border-top",children:[(0,f.jsx)("button",{type:"button",className:"btn btn-outline-secondary btn-sm px-4",onClick:()=>P((e=>Math.max(0,e-1))),disabled:0===I,style:{borderRadius:8},children:"\u2190 Previous"}),(0,f.jsxs)("span",{className:"text-muted small",children:["Step ",I+1," of ",h.length]}),2===I?(0,f.jsx)("button",{type:"button",className:"btn btn-sm px-4 ee",disabled:te,onClick:Oe,style:{borderRadius:8,background:"#CC0000",color:"#fff",fontWeight:600},children:te?(0,f.jsxs)(f.Fragment,{children:[(0,f.jsx)("span",{className:"spinner-border spinner-border-sm me-2",role:"status","aria-hidden":"true"}),"Saving..."]}):"Save Changes \u2713"}):(0,f.jsx)("button",{type:"button",className:"btn btn-sm px-4",onClick:()=>P((e=>e+1)),style:{borderRadius:8,background:"#CC0000",color:"#fff",fontWeight:600},children:"Next \u2192"})]})]})})})]})})]})]})})}},62837:(e,t,s)=>{s.d(t,{$K:()=>n,CB:()=>i,Cd:()=>b,I0:()=>c,Jq:()=>m,R3:()=>v,dN:()=>f,hJ:()=>h,jh:()=>d,mO:()=>l,mg:()=>r,nj:()=>g,pd:()=>y,uM:()=>u,vE:()=>o,z6:()=>p});var a=s(5464);const l=a.default.div`
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
`,m=(a.default.div`
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
`,a.default.div`
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
`),x=(a.default.div`
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
`),f=((0,a.default)(x)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(x)`
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
`,g=a.default.button`
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
`,y=a.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,v=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=4097.8d2e3e39.chunk.js.map