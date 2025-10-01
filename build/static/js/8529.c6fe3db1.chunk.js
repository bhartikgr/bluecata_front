"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[8529],{6058:(e,t,a)=>{a.d(t,{Fq:()=>m,yP:()=>u});var s=a(65043),n=a(17304);const i="label";function r(e,t){"function"===typeof e?e(t):e&&(e.current=t)}function o(e,t){e.labels=t}function l(e,t){let a=arguments.length>2&&void 0!==arguments[2]?arguments[2]:i;const s=[];e.datasets=t.map((t=>{const n=e.datasets.find((e=>e[a]===t[a]));return n&&t.data&&!s.includes(n)?(s.push(n),Object.assign(n,t),n):{...t}}))}function d(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:i;const a={labels:[],datasets:[]};return o(a,e.labels),l(a,e.datasets,t),a}function c(e,t){const{height:a=150,width:i=300,redraw:c=!1,datasetIdKey:p,type:h,data:u,options:m,plugins:x=[],fallbackContent:f,updateMode:g,...v}=e,b=(0,s.useRef)(null),j=(0,s.useRef)(null),y=()=>{b.current&&(j.current=new n.t1(b.current,{type:h,data:d(u,p),options:m&&{...m},plugins:x}),r(t,j.current))},w=()=>{r(t,null),j.current&&(j.current.destroy(),j.current=null)};return(0,s.useEffect)((()=>{!c&&j.current&&m&&function(e,t){const a=e.options;a&&t&&Object.assign(a,t)}(j.current,m)}),[c,m]),(0,s.useEffect)((()=>{!c&&j.current&&o(j.current.config.data,u.labels)}),[c,u.labels]),(0,s.useEffect)((()=>{!c&&j.current&&u.datasets&&l(j.current.config.data,u.datasets,p)}),[c,u.datasets]),(0,s.useEffect)((()=>{j.current&&(c?(w(),setTimeout(y)):j.current.update(g))}),[c,m,u.labels,u.datasets,g]),(0,s.useEffect)((()=>{j.current&&(w(),setTimeout(y))}),[h]),(0,s.useEffect)((()=>(y(),()=>w())),[]),s.createElement("canvas",{ref:b,role:"img",height:a,width:i,...v},f)}const p=(0,s.forwardRef)(c);function h(e,t){return n.t1.register(t),(0,s.forwardRef)(((t,a)=>s.createElement(p,{...t,ref:a,type:e})))}const u=h("bar",n.A6),m=h("pie",n.P$)},28529:(e,t,a)=>{a.r(t),a.d(t,{default:()=>p});var s=a(65043),n=(a(25015),a(43328)),i=(a(38421),a(62837)),r=a(44710),o=a(6058),l=a(17304),d=a(86213),c=a(70579);function p(){var e,t,a,l,p,h;const u="https://blueprintcatalyst.com/api/user/dashboard/",m=localStorage.getItem("SignatoryLoginData"),x=JSON.parse(m),[f,g]=(0,s.useState)(""),[v,b]=(0,s.useState)(""),[j,y]=(0,s.useState)({round_type:"",target_raise:0,raised_to_date:0,expected_close:"",fundraising_progress:"0%",progresswidth:0,currency:"USD",remaining_amount:0,total_investors:0}),[w,_]=(0,s.useState)([]),[N,k]=(0,s.useState)([]),[S,C]=(0,s.useState)([]),[A,$]=(0,s.useState)([]),[E,z]=(0,s.useState)([]),[D,F]=(0,s.useState)([]),[R,T]=(0,s.useState)("0"),[U,P]=(0,s.useState)({option_pool:{total_option_pool_percentage:0,total_option_pool_shares:0,available_percentage:0,allocated_percentage:0},latest_valuation:{valuation_amount:0,currency:"",price_per_share:0,total_company_shares:0},summary:{total_company_shares:0,latest_valuation:0,option_pool_percentage:0}}),[I,L]=(0,s.useState)([]),[M,O]=(0,s.useState)(!1),[W,V]=(0,s.useState)(""),[B,J]=(0,s.useState)(""),[q,K]=(0,s.useState)({labels:[],datasets:[]}),[G,H]=(0,s.useState)({labels:[],datasets:[{data:[],backgroundColor:[],borderColor:"#ffffff",borderWidth:2,hoverBorderWidth:3,hoverOffset:10}]}),[Y,Q]=(0,s.useState)("");(0,s.useEffect)((()=>{Z()}),[]);const Z=async()=>{let e={id:""};try{var t=(await d.A.post("https://blueprintcatalyst.com/api/user/capitalround/getallcountrySymbolList",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results;L(t)}catch(a){}};(0,s.useEffect)((()=>{X()}),[]);const X=async()=>{let e={company_id:x.companies[0].id};try{var t=(await d.A.post(u+"getCompanyName",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results;t.length>0&&J(t[0])}catch(a){}};(0,s.useEffect)((()=>{ce()}),[]),(0,s.useEffect)((()=>{ae(),se(),ne(),ie(),ee(),le()}),[]);const ee=async()=>{const e={company_id:x.companies[0].id};O(!0),V("");try{const t=await d.A.post(u+"getCompanyOptionPoolLastestValuation",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});t.data&&t.data.success?P(t.data.data):(V("Failed to fetch data"),console.error("API Error:",t.data.message))}catch(t){V("Error fetching option pool and valuation data"),console.error("Error generating summary",t)}finally{O(!1)}},te=e=>{const t=null===e||void 0===e?void 0:e.replace(/[\$\s]/g,"").toUpperCase(),a=I.find((e=>{var a;return(null===(a=e.currency_code)||void 0===a?void 0:a.toUpperCase())===t}));return(null===a||void 0===a?void 0:a.currency_symbol)||""},ae=async e=>{const t={company_id:x.companies[0].id};try{const e=await d.A.post(u+"getTotalinvestor",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});Q(e.data.results.length)}catch(a){console.error("Error generating summary",a)}},se=async e=>{const t={company_id:x.companies[0].id};try{const e=await d.A.post(u+"getTotalinvestorcontact",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});C(e.data.results.length)}catch(a){console.error("Error generating summary",a)}},ne=async e=>{const t={company_id:x.companies[0].id};try{const e=await d.A.post(u+"getinvestorreportLogs",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});k(e.data.results)}catch(a){console.error("Error generating summary",a)}},ie=async e=>{const t={company_id:x.companies[0].id};try{const e=await d.A.post(u+"getinvestorDatarromreportLogs",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});z(e.data.results)}catch(a){console.error("Error generating summary",a)}};(0,s.useEffect)((()=>{pe(),he(),ue(),de(),oe(),re()}),[]);const re=async()=>{const e={company_id:x.companies[0].id};try{const t=await d.A.post(u+"getInvestorRequestCompanyInvest",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});F(t.data.results)}catch(t){console.error("Error generating summary",t)}},oe=async()=>{const e={company_id:x.companies[0].id};try{const t=await d.A.post(u+"getrecentuploadFile",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});$(t.data.results)}catch(t){console.error("Error generating summary",t)}},le=async()=>{ge(!0),be(null);const e={company_id:x.companies[0].id};try{const t=await d.A.post(u+"getShareholder",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(t.data&&t.data.shareholders){const{labels:e,data:a,colors:s}=t.data.shareholders,n=[],i=[],r=[];e.forEach(((e,t)=>{a[t]>0&&(i.push(e),n.push(parseFloat(a[t])),r.push(s[t]))}));const o={labels:i,datasets:[{data:n,backgroundColor:r,borderColor:"#ffffff",borderWidth:2,hoverBorderWidth:3,hoverOffset:10,hoverBackgroundColor:r.map((e=>e+"CC"))}]};H(o),be(null)}else be("No shareholder data available")}catch(i){var t,a,s,n;console.error("Error fetching shareholder data:",i);const e=(null===(t=i.response)||void 0===t||null===(a=t.data)||void 0===a?void 0:a.error)||(null===(s=i.response)||void 0===s||null===(n=s.data)||void 0===n?void 0:n.message)||"Failed to load shareholder breakdown";be(e)}finally{ge(!1)}},de=async()=>{O(!0),V(null);try{const e=await d.A.post(u+"getDilutionForecast",{company_id:x.companies[0].id});e.data&&e.data.labels?K({labels:e.data.labels,datasets:e.data.datasets}):V("No dilution data available")}catch(e){console.error("Error generating dilution forecast:",e),V("Failed to load dilution forecast")}finally{O(!1)}},ce=async()=>{const e={company_id:x.companies[0].id};try{const t=await d.A.post(u+"getCompanyTotalShares",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});g(t.data.results)}catch(t){console.error("Error generating summary",t)}};(0,s.useEffect)((()=>{if(v&&v.length>0){let e=0,t=0;v.forEach((a=>{e+=a.total_issued_shares||0,a.investors.forEach((e=>{t+=e.issued_shares||0}))}));T((e>0?t/e*100:0).toFixed(2))}}),[v]);const pe=async()=>{const e={company_id:x.companies[0].id,Companyshares:f.company_shares};try{const a=await d.A.post(u+"getCompanystokes",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(a.data.results.length>0){var t=a.data.results;b(t)}}catch(a){console.error("Error generating summary",a)}},he=async()=>{const e={company_id:x.companies[0].id};try{const t=await d.A.post(u+"getCompanyopenround",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(t.data&&t.data.success){const e=t.data.roundInfo;y(e)}else V("No active round found"),console.error("API Error:",t.data.message)}catch(t){console.error("Error generating summary",t)}},ue=async()=>{const e={company_id:x.companies[0].id};try{const t=(await d.A.post(u+"getCompanyopenroundUserLog",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;t.length>0&&_(t)}catch(t){console.error("Error generating summary",t)}},[me]=(0,s.useState)({equity:{totalShares:"10,000,000",optionPool:"0%",investorStakes:"62%",valuation:"$25M"},shareholders:{labels:["Founders","Series A Investors","Series B Investors","Option Pool","Employees"],data:[35,25,20,15,5],colors:["#081828","#092f4e","#10395c","#1a588d","#2577bd","#2577bd"]},openRound:{type:"Series B",target:"$8M",raised:"$5.2M",preMoney:"$22M",closeDate:"Dec 15, 2023"},investors:{total:24,contacts:42,messages:[{name:"John Smith",firm:"VC Partners",message:"When will the next report be available?",time:"2h ago"},{name:"Sarah Johnson",firm:"Capital Growth",message:"Request for additional metrics...",time:"1d ago"}]},dataRoom:{completion:78,recentUploads:[{name:"Financials Q3 2023",description:"Updated projections",time:"Today"},{name:"Cap Table",description:"Latest revision",time:"Yesterday"}]},accessLogs:[{name:"David Wilson",action:"Viewed Financial Reports",time:"Today, 4:00 PM"},{name:"Emily Chen",action:"Downloaded Cap Table",time:"Today, 5:00 PM"},{name:"Michael Brown",action:"Viewed Pitch Deck",time:"Yesterday, 10:00 AM"}]}),xe={responsive:!0,maintainAspectRatio:!1,animation:{duration:0},plugins:{legend:{position:"top",labels:{generateLabels:function(e){if(!e||!e.data)return[];const t=e.data;return t.labels.length&&t.datasets.length?t.datasets.map(((t,a)=>({text:t.label,fillStyle:t.backgroundColor,strokeStyle:t.borderColor||t.backgroundColor,lineWidth:t.borderWidth||0,hidden:!e.isDatasetVisible(a),index:a}))):[]}},onClick:(e,t,a)=>{try{const e=t.index,s=a.chart;if(s&&s.isDatasetVisible&&"function"===typeof s.setDatasetVisibility){const t=s.isDatasetVisible(e);s.setDatasetVisibility(e,!t),s.update()}}catch(W){console.warn("Legend click error:",W)}}},title:{display:!0,text:"Ownership Dilution Forecast",font:{size:16,weight:"bold"}},tooltip:{callbacks:{label:function(e){try{return`${e.dataset.label}: ${e.parsed.y.toFixed(1)}%`}catch(W){return`${e.dataset.label}: ${e.parsed.y}%`}},footer:function(e){try{let t=0;return e.forEach((function(e){t+=e.parsed.y})),`Total: ${t.toFixed(1)}%`}catch(W){return""}}}}},scales:{x:{stacked:!0,title:{display:!0,text:"Funding Rounds"}},y:{stacked:!0,max:100,min:0,title:{display:!0,text:"Ownership Percentage"},ticks:{callback:function(e){return e+"%"}}}},interaction:{mode:"index",intersect:!1},onHover:(e,t,a)=>{},onClick:(e,t,a)=>{}},[fe,ge]=(0,s.useState)(!1),[ve,be]=(0,s.useState)(null),je={responsive:!0,maintainAspectRatio:!1,plugins:{legend:{position:"bottom",labels:{usePointStyle:!0,pointStyle:"circle",padding:15,font:{size:11,weight:"500"},generateLabels:function(e){const t=e.data;return t.labels.length&&t.datasets.length?t.labels.map(((e,a)=>({text:`${e}: ${t.datasets[0].data[a]}%`,fillStyle:t.datasets[0].backgroundColor[a],strokeStyle:t.datasets[0].borderColor,lineWidth:t.datasets[0].borderWidth,hidden:isNaN(t.datasets[0].data[a])||0===t.datasets[0].data[a],index:a}))):[]}}},tooltip:{callbacks:{label:function(e){return`${e.label||""}: ${e.parsed}%`}},backgroundColor:"rgba(0,0,0,0.8)",titleColor:"#fff",bodyColor:"#fff",borderColor:"rgba(255,255,255,0.2)",borderWidth:1,cornerRadius:8,displayColors:!0,usePointStyle:!0},datalabels:{display:function(e){return e.parsed>5},color:"#ffffff",font:{weight:"bold",size:10},formatter:function(e){return e+"%"}}},elements:{arc:{borderWidth:2,hoverBorderWidth:3}},animation:{animateRotate:!0,animateScale:!0,duration:1e3,easing:"easeInOutQuart"},interaction:{intersect:!1,mode:"nearest"}};(0,s.useEffect)((()=>{document.title="Dashboard Page"}),[]);const[ye,we]=(0,s.useState)(!1);function _e(e){const t=new Date(e);if(isNaN(t))return"";const a=t.getDate(),s=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],n=t.getFullYear();let i=t.getHours();const r=t.getMinutes().toString().padStart(2,"0"),o=(t.getSeconds().toString().padStart(2,"0"),i>=12?"PM":"AM");return i%=12,i=i||12,`${s} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${n} ${i}:${r} ${o}`}const Ne=function(e){if(!e||0===e)return"0";const t=te(arguments.length>1&&void 0!==arguments[1]?arguments[1]:"USD"),a=Number(String(e).replace(/,/g,""));return a>=1e6?`${t}${(a/1e6).toFixed(1)}M`:a>=1e3?`${t}${(a/1e3).toFixed(1)}K`:`${t}${a.toLocaleString("en-US")}`};return(0,c.jsx)(c.Fragment,{children:(0,c.jsx)(i.mO,{children:(0,c.jsx)("div",{className:"fullpage d-block",children:(0,c.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,c.jsx)(r.A,{isCollapsed:ye,setIsCollapsed:we}),(0,c.jsxs)("div",{className:"global_view "+(ye?"global_view_col":""),children:[(0,c.jsx)(n.A,{}),(0,c.jsx)(i.$K,{className:"d-block p-md-4 p-3",children:(0,c.jsx)("div",{className:"container-fluid",children:(0,c.jsx)(i.mg,{id:"step5",children:(0,c.jsxs)("div",{className:"row",children:[(0,c.jsxs)("div",{className:"col-md-12",children:[(0,c.jsxs)("div",{className:"pb-3 bar_design d-flex justify-content-between align-items-center",children:[(0,c.jsx)("h4",{className:"h5 mb-0",children:"Equity Snapshot"}),(0,c.jsxs)("h4",{className:"h5 mb-0",children:["Company Name (",(0,c.jsx)("strong",{children:B.company_name}),")"]})]}),(0,c.jsxs)("div",{class:"row gap-0 dashboard-top",children:[(0,c.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,c.jsxs)("div",{class:"p-3",children:[(0,c.jsx)("p",{class:"small fw-medium mb-1",children:"Total Shares"}),(0,c.jsx)("div",{className:"d-flex align-items-center gap-3 justify-content-between",children:(0,c.jsxs)("p",{class:"h4 fw-semibold mb-0",children:[te(f.currency),Number(String(f.totalCompanyShares).replace(/,/g,"")).toLocaleString("en-US")]})})]})}),(0,c.jsx)("div",{className:"col-6 col-md-3 p-0 bor",children:(0,c.jsxs)("div",{className:"p-3",children:[(0,c.jsx)("p",{className:"small fw-medium mb-1",children:"Option Pool"}),M?(0,c.jsxs)("div",{className:"d-flex align-items-center",children:[(0,c.jsx)("div",{className:"spinner-border spinner-border-sm me-2",role:"status",children:(0,c.jsx)("span",{className:"visually-hidden",children:"Loading..."})}),(0,c.jsx)("span",{className:"small",children:"Loading..."})]}):W?(0,c.jsx)("p",{className:"h4 fw-semibold mb-0 text-danger",children:"0"}):(0,c.jsxs)("div",{children:[(0,c.jsx)("p",{className:"h4 fw-semibold mb-0",children:(Se=null===(e=U.option_pool)||void 0===e?void 0:e.total_option_pool_percentage,Se&&0!==Se?`${parseFloat(Se).toFixed(1)}%`:"0%")}),(0,c.jsxs)("small",{className:"text-muted",children:[(ke=null===(t=U.option_pool)||void 0===t?void 0:t.total_option_pool_shares,ke&&0!==ke?ke>=1e6?`${(ke/1e6).toFixed(1)}M`:ke>=1e3?`${(ke/1e3).toFixed(1)}K`:ke.toLocaleString():"0")," ","shares"]})]})]})}),(0,c.jsx)("div",{class:"col-6 col-md-3 p-0 bor",children:(0,c.jsxs)("div",{class:"p-3",children:[(0,c.jsx)("p",{class:"small fw-medium mb-1",children:"Investor Stakes"}),(0,c.jsxs)("p",{class:"h4 fw-semibold mb-0",children:[R||0,"%"]})]})}),(0,c.jsx)("div",{className:"col-6 col-md-3 p-0",children:(0,c.jsxs)("div",{className:"p-3",children:[(0,c.jsx)("p",{className:"small fw-medium mb-1",children:"Latest Valuation"}),M?(0,c.jsxs)("div",{className:"d-flex align-items-center",children:[(0,c.jsx)("div",{className:"spinner-border spinner-border-sm me-2",role:"status",children:(0,c.jsx)("span",{className:"visually-hidden",children:"Loading..."})}),(0,c.jsx)("span",{className:"small",children:"Loading..."})]}):W?(0,c.jsx)("p",{className:"h4 fw-semibold mb-0 text-danger",children:"0"}):(0,c.jsxs)("div",{children:[(0,c.jsx)("p",{className:"h4 fw-semibold mb-0",children:function(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"USD";if(!e||0===e)return"$0";const a=(()=>{const e={};return I.forEach((t=>{if(t.currency_code){const a=t.currency_code.replace(/[\$\s]/g,"").toUpperCase();if(e[a]=a,t.currency_symbol){const s=`${a} ${t.currency_symbol}`.trim();e[s]=a}}})),e})();let s=t;if(t)if(a[t])s=a[t];else{s=t.replace(/[\$\s]/g,"").toUpperCase();s={CAD:"CAD",USD:"USD",EUR:"EUR",GBP:"GBP",INR:"INR"}[s]||"USD"}try{const t=new Intl.NumberFormat("en-US",{style:"currency",currency:s,minimumFractionDigits:0,maximumFractionDigits:0});return e>=1e6?t.format(e/1e6)+"M":e>=1e3?t.format(e/1e3)+"K":t.format(e)}catch(W){console.warn(`Invalid currency code: ${t}, falling back to manual format`);const s=te(t);return e>=1e6?`${s}${(e/1e6).toFixed(1)}M`:e>=1e3?`${s}${(e/1e3).toFixed(1)}K`:`${s}${e.toLocaleString()}`}}(null===(a=U.latest_valuation)||void 0===a?void 0:a.valuation_amount,null===(l=U.latest_valuation)||void 0===l?void 0:l.currency)}),(null===(p=U.latest_valuation)||void 0===p?void 0:p.price_per_share)>0&&(0,c.jsxs)("small",{className:"text-muted",children:["$",U.latest_valuation.price_per_share.toFixed(2),"/share"]})]})]})})]})]}),(0,c.jsx)("div",{className:"col-12 my-4",children:(0,c.jsxs)("div",{class:"dashboard_card  modern-chart m-0",children:[(0,c.jsx)("div",{class:"card-header",children:(0,c.jsx)("h3",{class:"card-title",children:"Open Round Info"})}),(0,c.jsxs)("div",{className:"info-section",children:[(0,c.jsxs)("div",{className:"info-item",children:[(0,c.jsx)("div",{className:"info-label",children:"Round Type"}),(0,c.jsx)("div",{className:"info-value",children:(null===j||void 0===j?void 0:j.round_type)||"No Active Round"})]}),(0,c.jsxs)("div",{className:"info-item",children:[(0,c.jsx)("div",{className:"info-label",children:"Target Raise"}),(0,c.jsx)("div",{className:"info-value",children:Ne(null===j||void 0===j?void 0:j.target_raise,null===j||void 0===j?void 0:j.currency)})]}),(0,c.jsxs)("div",{className:"info-item",children:[(0,c.jsx)("div",{className:"info-label",children:"Raised till Date"}),(0,c.jsxs)("div",{className:"info-value",children:[(0,c.jsx)("span",{className:"raised-amount",children:Ne(null===j||void 0===j?void 0:j.raised_to_date,null===j||void 0===j?void 0:j.currency)}),(null===j||void 0===j?void 0:j.total_investors)>0&&(0,c.jsxs)("small",{className:"text-muted d-block",children:["from ",j.total_investors," ","investor",1!==j.total_investors?"s":""]})]})]}),(0,c.jsxs)("div",{className:"info-item",children:[(0,c.jsx)("div",{className:"info-label",children:"Pre-money Valuation"}),(0,c.jsx)("div",{className:"info-value",children:Ne((()=>{var e,t;const a=Number(String(null!==(e=null===f||void 0===f?void 0:f.company_shares)&&void 0!==e?e:"0").replace(/,/g,"")),s=(null===j||void 0===j?void 0:j.raised_to_date)||0;if((null===U||void 0===U||null===(t=U.latest_valuation)||void 0===t?void 0:t.price_per_share)>0){const e=a*U.latest_valuation.price_per_share-s;return e>0?e:0}return a})(),(null===j||void 0===j?void 0:j.currency)||(null===U||void 0===U||null===(h=U.latest_valuation)||void 0===h?void 0:h.currency))})]}),(0,c.jsxs)("div",{className:"info-item",children:[(0,c.jsx)("div",{className:"info-label",children:"Expected Close"}),(0,c.jsx)("div",{className:"info-value",children:(e=>{if(!e)return"Not Set";try{return new Date(e).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"})}catch(W){return e}})(null===j||void 0===j?void 0:j.expected_close)})]}),(null===j||void 0===j?void 0:j.remaining_amount)>0&&(0,c.jsxs)("div",{className:"info-item",children:[(0,c.jsx)("div",{className:"info-label",children:"Remaining Amount"}),(0,c.jsx)("div",{className:"info-value text-warning",children:Ne(j.remaining_amount,null===j||void 0===j?void 0:j.currency)})]})]}),(0,c.jsxs)("div",{className:"progress-container",children:[(0,c.jsxs)("div",{className:"progress-info",children:[(0,c.jsx)("div",{className:"progress-label",children:"Fundraising Progress"}),(0,c.jsx)("div",{className:"progress-value",children:(null===j||void 0===j?void 0:j.fundraising_progress)||"0%"})]}),(0,c.jsx)("div",{className:"progress-bar",children:(0,c.jsx)("div",{className:"progress-fill",style:{width:`${Math.min((null===j||void 0===j?void 0:j.progresswidth)||0,100)}%`,backgroundColor:(e=>e>=80?"#28a745":e>=50?"#ffc107":e>=25?"#fd7e14":"#dc3545")((null===j||void 0===j?void 0:j.progresswidth)||0),transition:"width 0.3s ease-in-out"}})}),(0,c.jsx)("div",{className:"progress-details mt-2",children:(0,c.jsxs)("small",{className:"text-muted",children:[(null===j||void 0===j?void 0:j.progress_status)&&(0,c.jsx)("span",{className:"badge bg-secondary me-2",children:j.progress_status}),(null===j||void 0===j?void 0:j.raised_to_date)>0&&(null===j||void 0===j?void 0:j.target_raise)>0&&(0,c.jsxs)(c.Fragment,{children:[Ne(j.raised_to_date,null===j||void 0===j?void 0:j.currency)," of ",Ne(j.target_raise,null===j||void 0===j?void 0:j.currency)]})]})})]}),(0,c.jsxs)("div",{className:"row px-3",children:[(0,c.jsx)("div",{className:"my-4 col-md-6",children:(0,c.jsxs)("div",{className:"dashboard_card modern-chart h-100",children:[(0,c.jsx)("div",{className:"card-header",children:(0,c.jsx)("h3",{className:"card-title",children:"Dilution Forecast"})}),(0,c.jsx)("div",{className:"card-body h-100",children:M?(0,c.jsx)("div",{className:"d-flex justify-content-center align-items-center h-100",children:(0,c.jsx)("div",{className:"spinner-border",role:"status",children:(0,c.jsx)("span",{className:"visually-hidden",children:"Loading..."})})}):W?(0,c.jsx)("div",{className:"alert alert-warning h-100 d-flex align-items-center justify-content-center",children:"0"}):q.labels.length>0?(0,c.jsx)("div",{style:{height:"300px"},children:(0,c.jsx)(o.yP,{data:q,options:xe})}):(0,c.jsx)("div",{className:"alert alert-info h-100 d-flex align-items-center justify-content-center",children:"No rounds found. Create a round to see dilution forecast."})})]})}),(0,c.jsx)("div",{className:"my-4 col-md-6",children:(0,c.jsxs)("div",{className:"dashboard_card modern-chart h-100",children:[(0,c.jsx)("div",{className:"card-header d-flex justify-content-between align-items-center",children:(0,c.jsx)("h3",{className:"card-title mb-0",children:"Shareholder Breakdown"})}),(0,c.jsx)("div",{className:"card-body d-flex justify-content-center align-items-center",style:{minHeight:"400px"},children:fe?(0,c.jsxs)("div",{className:"text-center",children:[(0,c.jsx)("div",{className:"spinner-border text-primary mb-3",role:"status",children:(0,c.jsx)("span",{className:"visually-hidden",children:"Loading..."})}),(0,c.jsx)("p",{className:"text-muted",children:"Loading shareholder data..."})]}):ve?(0,c.jsxs)("div",{className:"alert alert-warning text-center",children:[(0,c.jsx)("i",{className:"fas fa-exclamation-triangle fa-2x mb-3 text-warning"}),(0,c.jsx)("h6",{children:"Unable to load shareholder data"}),(0,c.jsx)("p",{className:"mb-3",children:ve}),(0,c.jsx)("button",{onClick:le,className:"btn btn-sm btn-primary",children:"Try Again"})]}):G.labels.length>0?(0,c.jsx)("div",{className:"chart-container",style:{width:"100%",maxWidth:"350px",height:"350px"},children:(0,c.jsx)(o.Fq,{data:G,options:je})}):(0,c.jsxs)("div",{className:"alert alert-info text-center",children:[(0,c.jsx)("i",{className:"fas fa-users fa-2x mb-3 text-info"}),(0,c.jsx)("h6",{children:"No Shareholders Found"}),(0,c.jsx)("p",{className:"mb-3",children:"Add investors to see shareholder breakdown"}),(0,c.jsx)("button",{onClick:()=>{},className:"btn btn-sm btn-success",children:"Add Investors"})]})})]})})]}),(0,c.jsxs)("div",{class:"access-logs",children:[(0,c.jsx)("h4",{class:"section-title",children:"Recent Activity"}),(0,c.jsxs)("table",{class:"log-table",children:[(0,c.jsx)("thead",{children:(0,c.jsxs)("tr",{children:[(0,c.jsx)("th",{children:"User"}),(0,c.jsx)("th",{children:"Class Type"}),(0,c.jsx)("th",{children:"Action"}),(0,c.jsx)("th",{children:"Date"})]})}),(0,c.jsx)("tbody",{children:(null===w||void 0===w?void 0:w.length)>0?w.map(((e,t)=>(0,c.jsxs)("tr",{children:[(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.first_name," ",e.last_name]})}),(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.shareClassType," (",e.nameOfRound,")"]})}),(0,c.jsx)("td",{style:{padding:"4px 12px",borderRadius:"12px",fontWeight:"600",backgroundColor:"#065f46",fontSize:"12px",display:"inline-block"},children:(0,c.jsx)("small",{style:{color:"#fff"},children:e.access_status})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:_e(e.activity_date)})})]},t))):(0,c.jsx)("tr",{children:(0,c.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No records found"})})})]})]}),(0,c.jsx)("div",{class:"access-logs",children:(0,c.jsxs)("table",{class:"log-table",children:[(0,c.jsx)("thead",{children:(0,c.jsxs)("tr",{children:[(0,c.jsx)("th",{children:"User"}),(0,c.jsx)("th",{children:"Action"}),(0,c.jsx)("th",{children:"Description"}),(0,c.jsx)("th",{children:"Date"})]})}),(0,c.jsx)("tbody",{children:(null===D||void 0===D?void 0:D.length)>0?D.map(((e,t)=>(0,c.jsxs)("tr",{children:[(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.first_name," ",e.last_name]})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:e.action})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:e.description})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:_e(e.created_at)})})]},t))):(0,c.jsx)("tr",{children:(0,c.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No records found"})})})]})})]})}),(0,c.jsx)("div",{class:"col-12 mb-4",children:(0,c.jsxs)("div",{class:"dashboard_card  modern-chart h-100",children:[(0,c.jsx)("div",{class:"card-header",children:(0,c.jsx)("h3",{class:"card-title",children:"Investor Reporting"})}),(0,c.jsxs)("div",{class:"stats-grid",children:[(0,c.jsxs)("div",{class:"stat-card",children:[(0,c.jsx)("div",{class:"stat-label",children:"Total Investors"}),(0,c.jsx)("div",{class:"stat-value",children:Y})]}),(0,c.jsxs)("div",{class:"stat-card",children:[(0,c.jsx)("div",{class:"stat-label",children:"Investor Contacts"}),(0,c.jsx)("div",{class:"stat-value",children:S})]})]}),(0,c.jsxs)("div",{class:"messages-section",children:[(0,c.jsx)("h4",{class:"section-title",children:"Messages From Investors"}),(0,c.jsx)("div",{class:"message-item",children:(0,c.jsxs)("div",{class:"message-content",children:[(0,c.jsxs)("div",{class:"message-header",children:[(0,c.jsx)("div",{class:"message-sender",children:"John Smith"}),(0,c.jsx)("div",{class:"message-time",children:"2h ago"})]}),(0,c.jsx)("div",{class:"message-firm",children:"VC Partners"}),(0,c.jsx)("div",{class:"message-text",children:"When will the next report be available?"})]})}),(0,c.jsx)("div",{class:"message-item",children:(0,c.jsxs)("div",{class:"message-content",children:[(0,c.jsxs)("div",{class:"message-header",children:[(0,c.jsx)("div",{class:"message-sender",children:"Sarah Johnson"}),(0,c.jsx)("div",{class:"message-time",children:"1d ago"})]}),(0,c.jsx)("div",{class:"message-firm",children:"Capital Growth"}),(0,c.jsx)("div",{class:"message-text",children:"Request for additional metrics..."})]})})]}),(0,c.jsxs)("div",{class:"access-logs",children:[(0,c.jsx)("h4",{class:"section-title",children:"Recent Activity"}),(0,c.jsxs)("table",{class:"log-table",children:[(0,c.jsx)("thead",{children:(0,c.jsxs)("tr",{children:[(0,c.jsx)("th",{children:"User"}),(0,c.jsx)("th",{children:"Action"}),(0,c.jsx)("th",{children:"Date Of View"})]})}),(0,c.jsx)("tbody",{children:(null===N||void 0===N?void 0:N.length)>0?N.map(((e,t)=>(0,c.jsxs)("tr",{children:[(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.first_name," ",e.last_name]})}),(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.document_name," (",e.access_status,")"]})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:_e(e.date_view)})})]},t))):(0,c.jsx)("tr",{children:(0,c.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No records found"})})})]})]})]})}),(0,c.jsx)("div",{className:"col-12",children:(0,c.jsxs)("div",{class:"dashboard_card  modern-chart h-100",children:[(0,c.jsx)("div",{class:"card-header",children:(0,c.jsx)("h3",{class:"card-title",children:"Data Room Status"})}),(0,c.jsx)("div",{class:"info-section",children:(0,c.jsxs)("div",{class:"info-item d-flex flex-column gap-2 w-100",children:[(0,c.jsxs)("h4",{class:"section-title w-100 text-start",children:[" ","Recent Uploads"]}),(0,c.jsxs)("table",{class:"log-table",children:[(0,c.jsx)("thead",{children:(0,c.jsxs)("tr",{children:[(0,c.jsx)("th",{children:"File Name"}),(0,c.jsx)("th",{children:"Item Name"}),(0,c.jsx)("th",{children:"Upload Date"})]})}),(0,c.jsx)("tbody",{children:(null===A||void 0===A?void 0:A.length)>0?A.map(((e,t)=>(0,c.jsxs)("tr",{children:[(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:e.doc_name})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:e.name})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:_e(e.created_at)})})]},t))):(0,c.jsx)("tr",{children:(0,c.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No records found"})})})]})]})}),(0,c.jsxs)("div",{class:"access-logs",children:[(0,c.jsx)("h4",{class:"section-title",children:"Recent Activity"}),(0,c.jsxs)("table",{class:"log-table",children:[(0,c.jsx)("thead",{children:(0,c.jsxs)("tr",{children:[(0,c.jsx)("th",{children:"User"}),(0,c.jsx)("th",{children:"Action"}),(0,c.jsx)("th",{children:"Date Of View"})]})}),(0,c.jsx)("tbody",{children:(null===E||void 0===E?void 0:E.length)>0?E.map(((e,t)=>(0,c.jsxs)("tr",{children:[(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.first_name," ",e.last_name]})}),(0,c.jsx)("td",{children:(0,c.jsxs)("small",{children:[e.document_name," (",e.access_status,")"]})}),(0,c.jsx)("td",{children:(0,c.jsx)("small",{children:_e(e.date_view)})})]},t))):(0,c.jsx)("tr",{children:(0,c.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No records found"})})})]})]})]})})]})})})})]})]})})})});var ke,Se}l.t1.register(l.PP,l.kc,l.E8,l.No,l.FN,l.Bs,l.hE,l.m_,l.s$)},62837:(e,t,a)=>{a.d(t,{$K:()=>r,CB:()=>l,Cd:()=>v,I0:()=>c,Jq:()=>u,R3:()=>y,Zw:()=>h,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>n,mg:()=>o,nj:()=>b,pd:()=>j,uM:()=>m,vE:()=>i,z6:()=>p});var s=a(5464);const n=s.default.div`
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
`,i=s.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,r=(s.default.div`
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
`,s.default.div`
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
`,s.default.div`
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
`,s.default.div`
  display: block;
  height: 100%;
`),o=s.default.div`
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
`,l=s.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=s.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=s.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=s.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,h=s.default.div`
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
`,u=(s.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,s.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,s.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,s.default.div`
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
`),m=(s.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,s.default.div`
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
`),x=(s.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,s.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,s.default.div`
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
`,s.default.button`
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
`,s.default.div`
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
`,s.default.video`
  background-color: black;
  border: none;
`,s.default.div`
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
`,s.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,s.default.button`
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
`),f=((0,s.default)(x)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,s.default)(x)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,s.default.sup`
  color: var(--primary);
`),g=s.default.div`
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
`,v=s.default.div`
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
`,b=s.default.button`
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
`,j=s.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,y=s.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=8529.c6fe3db1.chunk.js.map