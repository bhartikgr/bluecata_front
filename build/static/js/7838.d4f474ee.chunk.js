"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[7838],{6058:(e,s,i)=>{i.d(s,{Fq:()=>m,yP:()=>x});var a=i(65043),t=i(17304);const r="label";function l(e,s){"function"===typeof e?e(s):e&&(e.current=s)}function n(e,s){e.labels=s}function d(e,s){let i=arguments.length>2&&void 0!==arguments[2]?arguments[2]:r;const a=[];e.datasets=s.map((s=>{const t=e.datasets.find((e=>e[i]===s[i]));return t&&s.data&&!a.includes(t)?(a.push(t),Object.assign(t,s),t):{...s}}))}function o(e){let s=arguments.length>1&&void 0!==arguments[1]?arguments[1]:r;const i={labels:[],datasets:[]};return n(i,e.labels),d(i,e.datasets,s),i}function c(e,s){const{height:i=150,width:r=300,redraw:c=!1,datasetIdKey:p,type:h,data:x,options:m,plugins:u=[],fallbackContent:f,updateMode:b,...g}=e,v=(0,a.useRef)(null),j=(0,a.useRef)(null),w=()=>{v.current&&(j.current=new t.t1(v.current,{type:h,data:o(x,p),options:m&&{...m},plugins:u}),l(s,j.current))},y=()=>{l(s,null),j.current&&(j.current.destroy(),j.current=null)};return(0,a.useEffect)((()=>{!c&&j.current&&m&&function(e,s){const i=e.options;i&&s&&Object.assign(i,s)}(j.current,m)}),[c,m]),(0,a.useEffect)((()=>{!c&&j.current&&n(j.current.config.data,x.labels)}),[c,x.labels]),(0,a.useEffect)((()=>{!c&&j.current&&x.datasets&&d(j.current.config.data,x.datasets,p)}),[c,x.datasets]),(0,a.useEffect)((()=>{j.current&&(c?(y(),setTimeout(w)):j.current.update(b))}),[c,m,x.labels,x.datasets,b]),(0,a.useEffect)((()=>{j.current&&(y(),setTimeout(w))}),[h]),(0,a.useEffect)((()=>(w(),()=>y())),[]),a.createElement("canvas",{ref:v,role:"img",height:i,width:r,...g},f)}const p=(0,a.forwardRef)(c);function h(e,s){return t.t1.register(s),(0,a.forwardRef)(((s,i)=>a.createElement(p,{...s,ref:i,type:e})))}const x=h("bar",t.A6),m=h("pie",t.P$)},25015:()=>{},57838:(e,s,i)=>{i.r(s),i.d(s,{default:()=>c});var a=i(65043),t=(i(25015),i(43328)),r=(i(38421),i(62837)),l=i(44710),n=i(6058),d=i(17304),o=i(70579);function c(){const[e]=(0,a.useState)({equity:{totalShares:"10,000,000",optionPool:"15%",investorStakes:"62%",valuation:"$25M"},shareholders:{labels:["Founders","Series A Investors","Series B Investors","Option Pool","Employees"],data:[35,25,20,15,5],colors:["#081828","#092f4e","#10395c","#1a588d","#2577bd","#2577bd"]},openRound:{type:"Series B",target:"$8M",raised:"$5.2M",preMoney:"$22M",closeDate:"Dec 15, 2023"},investors:{total:24,contacts:42,messages:[{name:"John Smith",firm:"VC Partners",message:"When will the next report be available?",time:"2h ago"},{name:"Sarah Johnson",firm:"Capital Growth",message:"Request for additional metrics...",time:"1d ago"}]},dataRoom:{completion:78,recentUploads:[{name:"Financials Q3 2023",description:"Updated projections",time:"Today"},{name:"Cap Table",description:"Latest revision",time:"Yesterday"}]},accessLogs:[{name:"David Wilson",action:"Viewed Financial Reports",time:"Today, 4:00 PM"},{name:"Emily Chen",action:"Downloaded Cap Table",time:"Today, 5:00 PM"},{name:"Michael Brown",action:"Viewed Pitch Deck",time:"Yesterday, 10:00 AM"}]}),s={labels:e.shareholders.labels,datasets:[{data:e.shareholders.data,backgroundColor:e.shareholders.colors,borderWidth:0}]};return(0,a.useEffect)((()=>{document.title="Dashboard Page"}),[]),(0,o.jsx)(o.Fragment,{children:(0,o.jsx)(r.mO,{children:(0,o.jsx)("div",{className:"fullpage d-block",children:(0,o.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,o.jsx)(l.A,{}),(0,o.jsxs)("div",{className:"global_view",children:[(0,o.jsx)(t.A,{}),(0,o.jsx)(r.$K,{className:"d-block p-md-4 p-3",children:(0,o.jsx)("div",{className:"container-fluid",children:(0,o.jsx)(r.mg,{id:"step5",children:(0,o.jsxs)("div",{className:"row",children:[(0,o.jsxs)("div",{className:"col-md-12",children:[(0,o.jsx)("div",{className:"pb-3 bar_design",children:(0,o.jsx)("h4",{className:"h5 mb-0",children:"Dashboard History"})}),(0,o.jsxs)("div",{class:"row gap-0 dashboard-top",children:[(0,o.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,o.jsxs)("div",{class:"p-3",children:[(0,o.jsx)("p",{class:"small fw-medium mb-1",children:"Total Shares"}),(0,o.jsx)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:(0,o.jsx)("p",{class:"h4 fw-semibold mb-0",children:e.equity.totalShares})})]})}),(0,o.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,o.jsxs)("div",{class:"p-3",children:[(0,o.jsx)("p",{class:"small fw-medium mb-1",children:"Total Reports Shared"}),(0,o.jsx)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:(0,o.jsx)("p",{class:"h4 fw-semibold mb-0",children:e.equity.totalShares})})]})}),(0,o.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,o.jsxs)("div",{class:"p-3",children:[(0,o.jsx)("p",{class:"small fw-medium mb-1",children:"Total Document Shared"}),(0,o.jsx)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:(0,o.jsx)("p",{class:"h4 fw-semibold mb-0",children:e.equity.totalShares})})]})}),(0,o.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,o.jsxs)("div",{class:"p-3",children:[(0,o.jsx)("p",{class:"small fw-medium mb-1",children:"Investor Stakes"}),(0,o.jsx)("p",{class:"h4 fw-semibold mb-0",children:e.equity.investorStakes})]})})]})]}),(0,o.jsx)("div",{className:"col-12 my-4",children:(0,o.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,o.jsx)("div",{class:"card-header",children:(0,o.jsx)("h3",{class:"card-title",children:"Open Round Info"})}),(0,o.jsxs)("div",{class:"info-section",children:[(0,o.jsxs)("div",{class:"info-item",children:[(0,o.jsx)("div",{class:"info-label",children:"Round Type"}),(0,o.jsx)("div",{class:"info-value",children:e.openRound.type})]}),(0,o.jsxs)("div",{class:"info-item",children:[(0,o.jsx)("div",{class:"info-label",children:"Target Raise"}),(0,o.jsx)("div",{class:"info-value",children:e.openRound.target})]}),(0,o.jsxs)("div",{class:"info-item",children:[(0,o.jsx)("div",{class:"info-label",children:"Raised to Date"}),(0,o.jsxs)("div",{class:"info-value",children:[" ",e.openRound.raised]})]}),(0,o.jsxs)("div",{class:"info-item",children:[(0,o.jsx)("div",{class:"info-label",children:"Pre-money Valuation"}),(0,o.jsxs)("div",{class:"info-value",children:[" ",e.openRound.preMoney]})]}),(0,o.jsxs)("div",{class:"info-item",children:[(0,o.jsx)("div",{class:"info-label",children:"Expected Close"}),(0,o.jsxs)("div",{class:"info-value",children:[" ",e.openRound.closeDate]})]})]}),(0,o.jsxs)("div",{class:"progress-container",children:[(0,o.jsxs)("div",{class:"progress-info",children:[(0,o.jsx)("div",{class:"progress-label",children:"Fundraising Progress"}),(0,o.jsx)("div",{class:"progress-value",children:"65%"})]}),(0,o.jsx)("div",{class:"progress-bar",children:(0,o.jsx)("div",{class:"progress-fill",style:{width:"65%"}})})]}),(0,o.jsxs)("div",{class:"access-logs",children:[(0,o.jsx)("h4",{class:"section-title",children:"Access Logs"}),(0,o.jsxs)("table",{class:"log-table",children:[(0,o.jsx)("thead",{children:(0,o.jsxs)("tr",{children:[(0,o.jsx)("th",{children:"User"}),(0,o.jsx)("th",{children:"Action"}),(0,o.jsx)("th",{children:"Time"})]})}),(0,o.jsx)("tbody",{children:e.accessLogs.map(((e,s)=>(0,o.jsxs)("tr",{children:[(0,o.jsx)("td",{className:"",children:(0,o.jsx)("small",{className:"",children:e.name})}),(0,o.jsx)("td",{className:"",children:(0,o.jsx)("small",{className:"",children:e.action})}),(0,o.jsx)("td",{className:"",children:(0,o.jsx)("small",{children:e.time})})]},s)))})]})]})]})}),(0,o.jsxs)("div",{className:"mb-5 bar_design",children:[(0,o.jsx)("h4",{className:"h5 mb-3",children:"Dilution Forecast"}),(0,o.jsx)("div",{className:"barchart modern-chart",children:(0,o.jsx)(n.yP,{data:{labels:["Current","After Series B","After Series C"],datasets:[{label:"Founders",data:[35,28,22],backgroundColor:"#081828"},{label:"Series A",data:[25,20,16],backgroundColor:"#092f4e"},{label:"Series B",data:[0,20,16],backgroundColor:"#10395c"},{label:"Option Pool",data:[15,15,15],backgroundColor:"#1a588d"},{label:"Employees",data:[5,5,5],backgroundColor:"#2577bd"},{label:"Series C",data:[0,0,15],backgroundColor:"#2a85d3"}]},options:{responsive:!0,plugins:{legend:{position:"top"},title:{display:!0,text:"Ownership Distribution Forecast"}},scales:{x:{stacked:!0},y:{stacked:!0,max:100,ticks:{callback:function(e){return e+"%"}}}}}})})]}),(0,o.jsxs)("div",{class:"dashboard-grid",children:[(0,o.jsxs)("div",{class:"dashboard_card modern-chart",children:[(0,o.jsx)("div",{class:"card-header",children:(0,o.jsx)("h3",{class:"card-title",children:"Shareholder Breakdown"})}),(0,o.jsx)("div",{className:"h-100 d-flex justify-content-center align-items-center",children:(0,o.jsx)("div",{class:"chart-container  mb-4",children:(0,o.jsx)(n.Fq,{data:s,options:{responsive:!0,plugins:{legend:{position:"bottom"}}}})})})]}),(0,o.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,o.jsx)("div",{class:"card-header",children:(0,o.jsx)("h3",{class:"card-title",children:"Investor Reporting"})}),(0,o.jsxs)("div",{class:"stats-grid",children:[(0,o.jsxs)("div",{class:"stat-card",children:[(0,o.jsx)("div",{class:"stat-label",children:"Total Investors"}),(0,o.jsx)("div",{class:"stat-value",children:"24"})]}),(0,o.jsxs)("div",{class:"stat-card",children:[(0,o.jsx)("div",{class:"stat-label",children:"Investor Contacts"}),(0,o.jsx)("div",{class:"stat-value",children:"42"})]})]}),(0,o.jsxs)("div",{class:"messages-section",children:[(0,o.jsx)("h4",{class:"section-title",children:"Messages From Investors"}),(0,o.jsx)("div",{class:"message-item",children:(0,o.jsxs)("div",{class:"message-content",children:[(0,o.jsxs)("div",{class:"message-header",children:[(0,o.jsx)("div",{class:"message-sender",children:"John Smith"}),(0,o.jsx)("div",{class:"message-time",children:"2h ago"})]}),(0,o.jsx)("div",{class:"message-firm",children:"VC Partners"}),(0,o.jsx)("div",{class:"message-text",children:"When will the next report be available?"})]})}),(0,o.jsx)("div",{class:"message-item",children:(0,o.jsxs)("div",{class:"message-content",children:[(0,o.jsxs)("div",{class:"message-header",children:[(0,o.jsx)("div",{class:"message-sender",children:"Sarah Johnson"}),(0,o.jsx)("div",{class:"message-time",children:"1d ago"})]}),(0,o.jsx)("div",{class:"message-firm",children:"Capital Growth"}),(0,o.jsx)("div",{class:"message-text",children:"Request for additional metrics..."})]})})]}),(0,o.jsxs)("div",{class:"access-logs",children:[(0,o.jsx)("h4",{class:"section-title",children:"Access Logs"}),(0,o.jsxs)("table",{class:"log-table",children:[(0,o.jsx)("thead",{children:(0,o.jsxs)("tr",{children:[(0,o.jsx)("th",{children:"User"}),(0,o.jsx)("th",{children:"Action"}),(0,o.jsx)("th",{children:"Time"})]})}),(0,o.jsx)("tbody",{children:e.accessLogs.map(((e,s)=>(0,o.jsxs)("tr",{children:[(0,o.jsx)("td",{className:"",children:(0,o.jsx)("small",{className:"",children:e.name})}),(0,o.jsx)("td",{className:"",children:(0,o.jsx)("small",{className:"",children:e.action})}),(0,o.jsx)("td",{className:"",children:(0,o.jsx)("small",{children:e.time})})]},s)))})]})]})]})]}),(0,o.jsx)("div",{className:"col-12 mt-4",children:(0,o.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,o.jsx)("div",{class:"card-header mb-5",children:(0,o.jsx)("h3",{class:"card-title",children:"Data Room Status"})}),(0,o.jsxs)("div",{class:"progress-container",children:[(0,o.jsxs)("div",{class:"progress-info",children:[(0,o.jsx)("div",{class:"progress-label",children:"Completion Status"}),(0,o.jsxs)("div",{class:"progress-value",children:[e.dataRoom.completion,"%"]})]}),(0,o.jsx)("div",{class:"progress-bar",children:(0,o.jsx)("div",{class:"progress-fill",style:{width:`${e.dataRoom.completion}%`}})})]}),(0,o.jsx)("div",{class:"info-section",children:(0,o.jsxs)("div",{class:"info-item d-flex flex-column gap-2 w-100",children:[(0,o.jsxs)("h4",{class:"section-title w-100 text-start",children:[" ","Recent Uploadss"]}),(0,o.jsx)("div",{class:"info-value w-100",children:(0,o.jsx)("ul",{className:"list-group list-group-flush",children:e.dataRoom.recentUploads.map(((e,s)=>(0,o.jsx)("li",{className:"list-group-item py-3",children:(0,o.jsxs)("div",{className:"d-flex flex-column",children:[(0,o.jsxs)("div",{className:"d-flex justify-content-between align-items-center mb-1",children:[(0,o.jsx)("h5",{className:"mb-0 small fw-medium",children:e.name}),(0,o.jsx)("small",{className:"text-muted",children:e.time})]}),(0,o.jsx)("small",{className:"text-muted",children:e.description})]})},s)))})})]})}),(0,o.jsxs)("div",{class:"access-logs",children:[(0,o.jsx)("h4",{class:"section-title",children:"Access Logs"}),(0,o.jsxs)("table",{class:"log-table",children:[(0,o.jsx)("thead",{children:(0,o.jsxs)("tr",{children:[(0,o.jsx)("th",{children:"User"}),(0,o.jsx)("th",{children:"Action"}),(0,o.jsx)("th",{children:"Time"})]})}),(0,o.jsx)("tbody",{children:e.accessLogs.map(((e,s)=>(0,o.jsxs)("tr",{children:[(0,o.jsx)("td",{className:"",children:(0,o.jsx)("small",{className:"",children:e.name})}),(0,o.jsx)("td",{className:"",children:(0,o.jsx)("small",{className:"",children:e.action})}),(0,o.jsx)("td",{className:"",children:(0,o.jsx)("small",{children:e.time})})]},s)))})]})]})]})})]})})})})]})]})})})})}d.t1.register(d.PP,d.kc,d.E8,d.No,d.FN,d.Bs,d.hE,d.m_,d.s$)},62837:(e,s,i)=>{i.d(s,{$K:()=>l,CB:()=>d,Cd:()=>g,I0:()=>c,Jq:()=>x,R3:()=>w,Zw:()=>h,dN:()=>f,hJ:()=>b,jh:()=>o,mO:()=>t,mg:()=>n,nj:()=>v,pd:()=>j,uM:()=>m,vE:()=>r,z6:()=>p});var a=i(5464);const t=a.default.div`
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
`,l=(a.default.div`
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
`,d=a.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,o=a.default.div`
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
    stroke: var(--primary-icon);
    stroke-width: 1.2;
  }
`),m=(a.default.div`
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
`),u=(a.default.div`
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
`),f=((0,a.default)(u)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(u)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,a.default.sup`
  color: var(--primary);
`),b=a.default.div`
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
`,v=a.default.button`
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
`,j=a.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,w=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=7838.d4f474ee.chunk.js.map