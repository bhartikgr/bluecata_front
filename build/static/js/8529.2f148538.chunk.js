"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[8529],{28529:(e,s,t)=>{t.r(s),t.d(s,{default:()=>p});var a=t(65043),i=(t(25015),t(43328)),r=(t(38421),t(62837)),n=t(44710),o=t(6058),l=t(17304),d=t(86213),c=t(70579);function p(){var e,s,t,l,p,h;const x="https://blueprintcatalyst.com/backend/api/user/dashboard/",u=localStorage.getItem("UserLoginData"),m=JSON.parse(u),[g,f]=(0,a.useState)(""),[b,v]=(0,a.useState)(""),[j,y]=(0,a.useState)(""),[w,k]=(0,a.useState)([]),[_,S]=(0,a.useState)([]),[A,z]=(0,a.useState)([]),[C,N]=(0,a.useState)([]),[T,E]=(0,a.useState)([]),[D,$]=(0,a.useState)({labels:[],datasets:[]}),[R,F]=(0,a.useState)({labels:[],datasets:[{data:[],backgroundColor:[],borderWidth:0}]}),[P,L]=(0,a.useState)("");(0,a.useEffect)((()=>{q()}),[]),(0,a.useEffect)((()=>{M(),I(),U(),O()}),[]);const M=async e=>{const s={user_id:m.id};try{const e=await d.A.post(x+"getTotalinvestor",s,{headers:{Accept:"application/json","Content-Type":"application/json"}});L(e.data.results.length)}catch(t){console.error("Error generating summary",t)}},I=async e=>{const s={user_id:m.id};try{const e=await d.A.post(x+"getTotalinvestorcontact",s,{headers:{Accept:"application/json","Content-Type":"application/json"}});z(e.data.results.length)}catch(t){console.error("Error generating summary",t)}},U=async e=>{const s={user_id:m.id};try{const e=await d.A.post(x+"getinvestorreportLogs",s,{headers:{Accept:"application/json","Content-Type":"application/json"}});S(e.data.results)}catch(t){console.error("Error generating summary",t)}},O=async e=>{const s={user_id:m.id};try{const e=await d.A.post(x+"getinvestorDatarromreportLogs",s,{headers:{Accept:"application/json","Content-Type":"application/json"}});E(e.data.results)}catch(t){console.error("Error generating summary",t)}};(0,a.useEffect)((()=>{B(),W(),Y(),V(),J()}),[]);const J=async()=>{const e={user_id:m.id};try{const s=await d.A.post(x+"getrecentuploadFile",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});N(s.data.results)}catch(s){console.error("Error generating summary",s)}},V=async()=>{const e={user_id:m.id,totalcompanyshare:g.company_shares};try{const s=await d.A.post(x+"getDilutionForecast",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});$(s.data)}catch(s){console.error("Error generating summary",s)}},q=async()=>{const e={user_id:m.id};try{const s=await d.A.post(x+"getCompanyTotalShares",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});f(s.data.results[0]),(async e=>{const s={user_id:m.id,totalcompanyshare:e.company_shares};try{const e=await d.A.post(x+"getShareholder",s,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(e.data);const t={labels:e.data.shareholders.labels,datasets:[{data:e.data.shareholders.data,backgroundColor:e.data.shareholders.colors,borderWidth:0}]};F(t)}catch(t){console.error("Error generating summary",t)}})(s.data.results[0])}catch(s){console.error("Error generating summary",s)}},B=async()=>{const e={user_id:m.id,Companyshares:g.company_shares};try{const t=await d.A.post(x+"getCompanystokes",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(t.data.results.length>0){var s=t.data.results[0];v(s)}}catch(t){console.error("Error generating summary",t)}},W=async()=>{const e={user_id:m.id};try{const s=(await d.A.post(x+"getCompanyopenround",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.roundInfo;y(s)}catch(s){console.error("Error generating summary",s)}},Y=async()=>{const e={user_id:m.id};try{const s=(await d.A.post(x+"getCompanyopenroundUserLog",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;s.length>0&&k(s)}catch(s){console.error("Error generating summary",s)}},[G]=(0,a.useState)({equity:{totalShares:"10,000,000",optionPool:"15%",investorStakes:"62%",valuation:"$25M"},shareholders:{labels:["Founders","Series A Investors","Series B Investors","Option Pool","Employees"],data:[35,25,20,15,5],colors:["#081828","#092f4e","#10395c","#1a588d","#2577bd","#2577bd"]},openRound:{type:"Series B",target:"$8M",raised:"$5.2M",preMoney:"$22M",closeDate:"Dec 15, 2023"},investors:{total:24,contacts:42,messages:[{name:"John Smith",firm:"VC Partners",message:"When will the next report be available?",time:"2h ago"},{name:"Sarah Johnson",firm:"Capital Growth",message:"Request for additional metrics...",time:"1d ago"}]},dataRoom:{completion:78,recentUploads:[{name:"Financials Q3 2023",description:"Updated projections",time:"Today"},{name:"Cap Table",description:"Latest revision",time:"Yesterday"}]},accessLogs:[{name:"David Wilson",action:"Viewed Financial Reports",time:"Today, 4:00 PM"},{name:"Emily Chen",action:"Downloaded Cap Table",time:"Today, 5:00 PM"},{name:"Michael Brown",action:"Viewed Pitch Deck",time:"Yesterday, 10:00 AM"}]});(0,a.useEffect)((()=>{document.title="Dashboard Page"}),[]);const[K,H]=(0,a.useState)(!1);function Q(e){const s=new Date(e);if(isNaN(s))return"";const t=s.getDate(),a=["January","February","March","April","May","June","July","August","September","October","November","December"][s.getMonth()],i=s.getFullYear();return`${a} ${t}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(t)}, ${i}`}return(0,c.jsx)(c.Fragment,{children:(0,c.jsx)(r.mO,{children:(0,c.jsx)("div",{className:"fullpage d-block",children:(0,c.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,c.jsx)(n.A,{isCollapsed:K,setIsCollapsed:H}),(0,c.jsxs)("div",{className:"global_view "+(K?"global_view_col":""),children:[(0,c.jsx)(i.A,{}),(0,c.jsx)(r.$K,{className:"d-block p-4",children:(0,c.jsx)("div",{className:"container-fluid",children:(0,c.jsx)(r.mg,{id:"step5",children:(0,c.jsxs)("div",{className:"row",children:[(0,c.jsxs)("div",{className:"col-md-12",children:[(0,c.jsx)("div",{className:"pb-3 bar_design",children:(0,c.jsx)("h4",{className:"h5 mb-0",children:"Equity Snapshot"})}),(0,c.jsxs)("div",{class:"row gap-0 dashboard-top",children:[(0,c.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,c.jsxs)("div",{class:"p-3",children:[(0,c.jsx)("p",{class:"small fw-medium mb-1",children:"Total Shares"}),(0,c.jsx)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:(0,c.jsxs)("p",{class:"h4 fw-semibold mb-0",children:["$",Number(null!==(e=null===g||void 0===g?void 0:g.company_shares)&&void 0!==e?e:0).toLocaleString("en-US")]})})]})}),(0,c.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,c.jsxs)("div",{class:"p-3",children:[(0,c.jsx)("p",{class:"small fw-medium mb-1",children:"Option Pool"}),(0,c.jsx)("p",{class:"h4 fw-semibold mb-0",children:G.equity.optionPool})]})}),(0,c.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,c.jsxs)("div",{class:"p-3",children:[(0,c.jsx)("p",{class:"small fw-medium mb-1",children:"Investor Stakes"}),(0,c.jsxs)("p",{class:"h4 fw-semibold mb-0",children:[null!==(s=null===b||void 0===b?void 0:b.stake_percent)&&void 0!==s?s:0,"%"]})]})}),(0,c.jsx)("div",{class:"col-6 col-md-3 p-0",children:(0,c.jsxs)("div",{class:"p-3",children:[(0,c.jsx)("p",{class:"small fw-medium mb-1",children:"Latest Valuation"}),(0,c.jsxs)("p",{class:"h4 fw-semibold mb-0",children:["$",Number(null!==(t=null===b||void 0===b?void 0:b.post_money_valuation)&&void 0!==t?t:0).toLocaleString("en-US")]})]})})]})]}),(0,c.jsx)("div",{className:"col-12 my-4",children:(0,c.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,c.jsx)("div",{class:"card-header",children:(0,c.jsx)("h3",{class:"card-title",children:"Open Round Info"})}),(0,c.jsxs)("div",{class:"info-section",children:[(0,c.jsxs)("div",{class:"info-item",children:[(0,c.jsx)("div",{class:"info-label",children:"Round Type"}),(0,c.jsx)("div",{class:"info-value",children:null!==(l=null===j||void 0===j?void 0:j.round_type)&&void 0!==l?l:""})]}),(0,c.jsxs)("div",{class:"info-item",children:[(0,c.jsx)("div",{class:"info-label",children:"Target Raise"}),(0,c.jsxs)("div",{class:"info-value",children:["$",Number(null!==(p=null===j||void 0===j?void 0:j.target_raise)&&void 0!==p?p:0).toLocaleString("en-US")]})]}),(0,c.jsxs)("div",{class:"info-item",children:[(0,c.jsx)("div",{class:"info-label",children:"Raised till Date"}),(0,c.jsxs)("div",{class:"info-value",children:[" ",j.raised_to_date]})]}),(0,c.jsxs)("div",{class:"info-item",children:[(0,c.jsx)("div",{class:"info-label",children:"Pre-money Valuation"}),(0,c.jsxs)("div",{class:"info-value",children:[" ","$",Number(null!==(h=null===g||void 0===g?void 0:g.company_shares)&&void 0!==h?h:0).toLocaleString("en-US")]})]}),(0,c.jsxs)("div",{class:"info-item",children:[(0,c.jsx)("div",{class:"info-label",children:"Expected Close"}),(0,c.jsxs)("div",{class:"info-value",children:[" ",j.expected_close]})]})]}),(0,c.jsxs)("div",{class:"progress-container",children:[(0,c.jsxs)("div",{class:"progress-info",children:[(0,c.jsx)("div",{class:"progress-label",children:"Fundraising Progress"}),(0,c.jsx)("div",{class:"progress-value",children:j.fundraising_progress})]}),(0,c.jsx)("div",{class:"progress-bar",children:(0,c.jsx)("div",{class:"progress-fill",style:{width:`${j.progresswidth}%`}})})]}),(0,c.jsxs)("div",{class:"access-logs",children:[(0,c.jsx)("h4",{class:"section-title",children:"Access Logs"}),(0,c.jsxs)("table",{class:"log-table",children:[(0,c.jsx)("thead",{children:(0,c.jsxs)("tr",{children:[(0,c.jsx)("th",{children:"User"}),(0,c.jsx)("th",{children:"Action"}),(0,c.jsx)("th",{children:"Time"})]})}),(0,c.jsx)("tbody",{children:(null===w||void 0===w?void 0:w.length)>0?w.map(((e,s)=>(0,c.jsxs)("tr",{children:[(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.first_name," ",e.last_name]})}),(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.nameOfRound," ",e.shareClassType," ",e.access_status]})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:Q(e.activity_date)})})]},s))):(0,c.jsx)("tr",{children:(0,c.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No records found"})})})]})]})]})}),(0,c.jsxs)("div",{className:"mb-5 bar_design",children:[(0,c.jsx)("h4",{className:"h5 mb-3",children:"Dilution Forecast"}),(0,c.jsx)("div",{className:"barchart modern-chart",children:(0,c.jsx)(o.yP,{data:D,options:{responsive:!0,plugins:{legend:{position:"top"},title:{display:!0,text:"Ownership Distribution Forecast"}},scales:{x:{stacked:!0},y:{stacked:!0,max:100,ticks:{callback:function(e){return e+"%"}}}}}})})]}),(0,c.jsxs)("div",{class:"dashboard-grid",children:[(0,c.jsxs)("div",{class:"dashboard_card modern-chart",children:[(0,c.jsx)("div",{class:"card-header",children:(0,c.jsx)("h3",{class:"card-title",children:"Shareholder Breakdown"})}),(0,c.jsx)("div",{className:"h-100 d-flex justify-content-center align-items-center",children:(0,c.jsx)("div",{class:"chart-container  mb-4",children:(0,c.jsx)(o.Fq,{data:R,options:{responsive:!0,plugins:{legend:{position:"bottom"}}}})})})]}),(0,c.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,c.jsx)("div",{class:"card-header",children:(0,c.jsx)("h3",{class:"card-title",children:"Investor Reporting"})}),(0,c.jsxs)("div",{class:"stats-grid",children:[(0,c.jsxs)("div",{class:"stat-card",children:[(0,c.jsx)("div",{class:"stat-label",children:"Total Investors"}),(0,c.jsx)("div",{class:"stat-value",children:P})]}),(0,c.jsxs)("div",{class:"stat-card",children:[(0,c.jsx)("div",{class:"stat-label",children:"Investor Contacts"}),(0,c.jsx)("div",{class:"stat-value",children:A})]})]}),(0,c.jsxs)("div",{class:"messages-section",children:[(0,c.jsx)("h4",{class:"section-title",children:"Messages From Investors"}),(0,c.jsx)("div",{class:"message-item",children:(0,c.jsxs)("div",{class:"message-content",children:[(0,c.jsxs)("div",{class:"message-header",children:[(0,c.jsx)("div",{class:"message-sender",children:"John Smith"}),(0,c.jsx)("div",{class:"message-time",children:"2h ago"})]}),(0,c.jsx)("div",{class:"message-firm",children:"VC Partners"}),(0,c.jsx)("div",{class:"message-text",children:"When will the next report be available?"})]})}),(0,c.jsx)("div",{class:"message-item",children:(0,c.jsxs)("div",{class:"message-content",children:[(0,c.jsxs)("div",{class:"message-header",children:[(0,c.jsx)("div",{class:"message-sender",children:"Sarah Johnson"}),(0,c.jsx)("div",{class:"message-time",children:"1d ago"})]}),(0,c.jsx)("div",{class:"message-firm",children:"Capital Growth"}),(0,c.jsx)("div",{class:"message-text",children:"Request for additional metrics..."})]})})]}),(0,c.jsxs)("div",{class:"access-logs",children:[(0,c.jsx)("h4",{class:"section-title",children:"Access Logs"}),(0,c.jsxs)("table",{class:"log-table",children:[(0,c.jsx)("thead",{children:(0,c.jsxs)("tr",{children:[(0,c.jsx)("th",{children:"User"}),(0,c.jsx)("th",{children:"Action"}),(0,c.jsx)("th",{children:"Date Of View"})]})}),(0,c.jsx)("tbody",{children:(null===_||void 0===_?void 0:_.length)>0?_.map(((e,s)=>(0,c.jsxs)("tr",{children:[(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.first_name," ",e.last_name]})}),(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.document_name," (",e.access_status,")"]})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:Q(e.date_view)})})]},s))):(0,c.jsx)("tr",{children:(0,c.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No records found"})})})]})]})]})]}),(0,c.jsx)("div",{className:"col-12 mt-4",children:(0,c.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,c.jsx)("div",{class:"card-header mb-5",children:(0,c.jsx)("h3",{class:"card-title",children:"Data Room Status"})}),(0,c.jsxs)("div",{class:"progress-container",children:[(0,c.jsxs)("div",{class:"progress-info",children:[(0,c.jsx)("div",{class:"progress-label",children:"Completion Status"}),(0,c.jsxs)("div",{class:"progress-value",children:[G.dataRoom.completion,"%"]})]}),(0,c.jsx)("div",{class:"progress-bar",children:(0,c.jsx)("div",{class:"progress-fill",style:{width:`${G.dataRoom.completion}%`}})})]}),(0,c.jsx)("div",{class:"info-section",children:(0,c.jsxs)("div",{class:"info-item d-flex flex-column gap-2 w-100",children:[(0,c.jsxs)("h4",{class:"section-title w-100 text-start",children:[" ","Recent Uploads"]}),(0,c.jsxs)("table",{class:"log-table",children:[(0,c.jsx)("thead",{children:(0,c.jsxs)("tr",{children:[(0,c.jsx)("th",{children:"File Name"}),(0,c.jsx)("th",{children:"Item Name"}),(0,c.jsx)("th",{children:"Upload Date"})]})}),(0,c.jsx)("tbody",{children:(null===C||void 0===C?void 0:C.length)>0?C.map(((e,s)=>(0,c.jsxs)("tr",{children:[(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:e.doc_name})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:e.name})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:Q(e.created_at)})})]},s))):(0,c.jsx)("tr",{children:(0,c.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No records found"})})})]})]})}),(0,c.jsxs)("div",{class:"access-logs",children:[(0,c.jsx)("h4",{class:"section-title",children:"Access Logs"}),(0,c.jsxs)("table",{class:"log-table",children:[(0,c.jsx)("thead",{children:(0,c.jsxs)("tr",{children:[(0,c.jsx)("th",{children:"User"}),(0,c.jsx)("th",{children:"Action"}),(0,c.jsx)("th",{children:"Date Of View"})]})}),(0,c.jsx)("tbody",{children:(null===T||void 0===T?void 0:T.length)>0?T.map(((e,s)=>(0,c.jsxs)("tr",{children:[(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.first_name," ",e.last_name]})}),(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.document_name," (",e.access_status,")"]})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:Q(e.date_view)})})]},s))):(0,c.jsx)("tr",{children:(0,c.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No records found"})})})]})]})]})})]})})})})]})]})})})})}l.t1.register(l.PP,l.kc,l.E8,l.No,l.FN,l.Bs,l.hE,l.m_,l.s$)},62837:(e,s,t)=>{t.d(s,{$K:()=>n,CB:()=>l,Cd:()=>b,I0:()=>c,Jq:()=>x,R3:()=>y,Zw:()=>h,dN:()=>g,hJ:()=>f,jh:()=>d,mO:()=>i,mg:()=>o,nj:()=>v,pd:()=>j,uM:()=>u,vE:()=>r,z6:()=>p});var a=t(5464);const i=a.default.div`
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
  background: var(--primary-color);
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
    font-size: 1.3rem;
    font-weight: 500;
    color:#000;
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
    border-radius: 50px;
    background: #00000012;
  }

  textarea {
    padding: 6px 8px 6px 35px;
    font-size: 16px;
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
    border-radius: 50px;
    display: inline-block;
    padding: 8px 20px;
    font-size: 16px;
    width: 100%;
  }

  .nextbtn {
    background: var(--primary-color);
    color: #fff;

    &:hover {
      background: var(--primary-color);
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
`,h=a.default.div`
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
    margin-top:2px;
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
    stroke: #ff3c3e;
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
    color: var(--primary-color);
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
`),m=(a.default.div`
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
  border-radius: 50%;
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
`),g=((0,a.default)(m)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(m)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,a.default.sup`
  color: var(--primary-color);
`),f=a.default.div`
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
`,v=a.default.button`
  position: absolute;
  top: -8px;
  right: -8px;
  border: none;
  background: #111;
  color: #fff;
  padding: 0px;
  border-radius: 100%;
  cursor: pointer;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  height: 26px;
`,j=a.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 16px;
`,y=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=8529.2f148538.chunk.js.map