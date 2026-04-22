"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[3716],{23086:(e,s,a)=>{a.d(s,{A:()=>c});var r=a(65043),t=a(35659),l=a(65490),i=a(25581),d=a(86213),n=a(70579);const c=e=>{let{formData:s,otherText:a,selected:c,visibleFields:o=[],isFirstRound:m=!1,foundersData:x=[],calculateTotalShares:p=()=>0,calculateTotalValue:h=()=>0,founderCount:u=0,CurrDisplay:b,id:j}=e;const f=e=>o.includes(e),g=e=>(e*(parseFloat(s.pricePerShare)||0)).toFixed(2),N=Number(String(h()).replace(/,/g,""))||0,v=Number(String(p()).replace(/,/g,""))||0,[y,w]=(0,r.useState)(null),k=i.J+"api/user/capitalround/",S=localStorage.getItem("SignatoryLoginData"),[T,C]=(0,r.useState)(""),_=JSON.parse(S);(0,r.useEffect)((()=>{P()}),[]);const P=async()=>{if(j)try{const e=await d.A.post(`${k}getPreviousFundingRound`,{company_id:_.companies[0].id});if(console.log("Current Round ID being filtered out:",j),e.data.success&&e.data.results){const s=e.data.results.filter((e=>e.id!==j&&e.id!==parseInt(j)));if(console.log(`Found ${s.length} previous rounds`),s.length>0){const e=s[s.length-1],a=e.total_shares_after;console.log("Using previous round:",{id:e.id,total_shares_after:a}),C(a)}else console.log("No previous rounds found (all rounds filtered out)"),C(0)}else console.log("No data received from API"),C(0)}catch(e){console.error("Error fetching previous funding round:",e),C(0)}else console.log("No current round ID available")};function F(e){const s=new Date(e);if(isNaN(s))return"";const a=s.getDate(),r=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][s.getMonth()],t=s.getFullYear();let l=s.getHours();s.getMinutes().toString().padStart(2,"0"),s.getSeconds().toString().padStart(2,"0");return l%=12,l=l||12,`${r} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${t}`}(0,r.useEffect)((()=>{j&&P()}),[j]);return(0,n.jsxs)("div",{className:"previous-section-summary mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,n.jsxs)("div",{className:"d-flex align-items-center mb-3 pb-2 border-bottom",children:[(0,n.jsx)("div",{style:{width:"45px",height:"45px"},className:"bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 p-1 rounded-circle me-3",children:(0,n.jsx)(t.xyf,{})}),(0,n.jsxs)("div",{children:[(0,n.jsx)("h3",{className:"mb-0 fw-semibold text-dark",children:m?"Round 0 - Incorporation Summary":"Preview Summary"}),(0,n.jsx)("p",{className:"text-muted small mb-0",children:m?"Founder shares allocation at incorporation":"Review your inputs before proceeding"})]})]}),m?(0,n.jsxs)("div",{className:"round-0-special-section",children:[(0,n.jsxs)("div",{className:"alert alert-info mb-3",children:[(0,n.jsx)("strong",{children:"Round 0 - Incorporation Details"}),(0,n.jsx)("p",{className:"mb-0 small",children:"Founder shares issued at incorporation"})]}),(0,n.jsxs)("div",{className:"row g-3",children:[f("shareclass")&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Name of Round:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.nameOfRound||"Founding Share Allocation"})]})}),"Round 0"===s.round_type&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsx)("div",{className:"card-body p-0",children:(0,n.jsx)("div",{className:"table-responsive",children:(0,n.jsxs)("table",{className:"table table-hover align-middle mb-0",children:[(0,n.jsx)("thead",{className:"table-light",children:(0,n.jsx)("tr",{children:(0,n.jsx)("th",{className:"ps-4 py-3 fw-semibold text-uppercase text-secondary small fw-semibold small text-muted border-0",style:{backgroundColor:"#f8f9fc"},colSpan:x.length,children:"Share Class Type"})})}),(0,n.jsxs)("tbody",{children:[(0,n.jsx)("tr",{children:x.map(((e,s)=>(0,n.jsxs)("td",{className:"text-center py-3 fw-semibold small text-muted",style:{border:"1px solid #dee2e6"},children:["Founder ",s+1]},s)))}),(0,n.jsx)("tr",{children:x.map(((e,s)=>{const a=parseInt(e.shares)||0,r=p();return r>0&&(a/r*100).toFixed(1),(0,n.jsx)("td",{className:"text-center py-3",style:{border:"1px solid #dee2e6"},children:(0,n.jsxs)("div",{className:"d-flex flex-column align-items-center",children:[(0,n.jsx)("div",{className:"avatar-sm mb-2",children:(0,n.jsx)("div",{className:"avatar-title bg-light-primary text-primary rounded-circle fw-bold",children:e.firstName?e.firstName.charAt(0).toUpperCase():e.lastName?e.lastName.charAt(0).toUpperCase():`${s+1}`})}),(0,n.jsx)("button",{type:"button",className:"btn btn-link p-0 text-decoration-none fw-semibold",onClick:()=>w(e),style:{border:"none",background:"none",cursor:"pointer"},children:e.firstName||""!==e.firstName?`${e.firstName} ${e.lastName||""}`.trim():`Founder ${s+1}`}),(0,n.jsx)("div",{className:"text-muted small mt-1",children:"common"===e.shareType?"Common":"preferred"===e.shareType?"Preferred":e.customShareType||"Other"})]})},s)}))})]})]})})})}),"Round 0"!==s.round_type&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Share Class Type:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.shareClassType||"Common Shares"})]})}),f("shareclass")&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Price Per Share:"}),(0,n.jsxs)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:[b,s.pricePerShare||"0.00"]})]})}),f("issuedshares")&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Total Shares Issued:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:(0,n.jsx)(l.A,{amount:s.issuedshares,currency:"",digit:2})})]})}),f("issuedshares")&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Total Incorporation Value:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:(0,n.jsx)(l.A,{amount:N,currency:b,digit:0})})]})}),f("shareclass")&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Number of Founders:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:u})]})}),"Round 0"===s.round_type&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsx)("div",{className:"card-body p-0",children:(0,n.jsx)("div",{className:"table-responsive",children:(0,n.jsxs)("table",{className:"table table-hover align-middle mb-0",children:[(0,n.jsx)("thead",{className:"table-light",children:(0,n.jsx)("tr",{children:(0,n.jsx)("th",{className:"ps-4 py-3 fw-semibold text-uppercase text-secondary small fw-semibold small text-muted border-0",style:{backgroundColor:"#f8f9fc"},colSpan:x.length,children:"Voting Rights:"})})}),(0,n.jsxs)("tbody",{children:[(0,n.jsx)("tr",{children:x.map(((e,s)=>(0,n.jsxs)("td",{className:"text-center py-3 fw-semibold small text-muted",style:{border:"1px solid #dee2e6"},children:["Founder ",s+1]},s)))}),(0,n.jsx)("tr",{children:x.map(((e,s)=>(parseInt(e.shares),p(),(0,n.jsx)("td",{className:"text-center py-3",style:{border:"1px solid #dee2e6"},children:(0,n.jsxs)("div",{className:"d-flex flex-column align-items-center",children:[(0,n.jsx)("div",{className:"avatar-sm mb-2",children:(0,n.jsx)("div",{className:"avatar-title bg-light-primary text-primary rounded-circle fw-bold",children:e.firstName?e.firstName.charAt(0).toUpperCase():e.lastName?e.lastName.charAt(0).toUpperCase():`${s+1}`})}),(0,n.jsx)("button",{type:"button",className:"btn btn-link p-0 text-decoration-none fw-semibold",onClick:()=>w(e),style:{border:"none",background:"none",cursor:"pointer"},children:e.firstName||""!==e.firstName?`${e.firstName} ${e.lastName||""}`.trim():`Founder ${s+1}`}),(0,n.jsx)("div",{className:"text-muted small mt-1",children:e.voting})]})},s))))})]})]})})})}),f("shareclass")&&x&&x.length>0&&(0,n.jsxs)("div",{className:"col-12",children:[(0,n.jsxs)("div",{className:"card border-0 shadow-sm",children:[(0,n.jsx)("div",{className:"card-header bg-white py-3 border-bottom",children:(0,n.jsxs)("div",{className:"d-flex justify-content-between align-items-center",children:[(0,n.jsxs)("h5",{className:"card-title mb-0 text-primary",children:[(0,n.jsx)("i",{className:"bi bi-people-fill me-2"}),"Founder Share Allocation"]}),(0,n.jsxs)("span",{className:"badge bg-primary rounded-pill",children:[x.length," Founder",x.length>1?"s":""]})]})}),(0,n.jsx)("div",{className:"card-body p-0",children:(0,n.jsx)("div",{className:"table-responsive",children:(0,n.jsxs)("table",{className:"table table-hover align-middle mb-0",children:[(0,n.jsx)("thead",{className:"table-light",children:(0,n.jsxs)("tr",{children:[(0,n.jsx)("th",{className:"ps-4 py-3 fw-semibold text-uppercase small text-muted border-0",children:"Founder"}),(0,n.jsx)("th",{className:"py-3 fw-semibold text-uppercase small text-muted border-0",children:"Numbers of Shares"}),(0,n.jsx)("th",{className:"py-3 fw-semibold text-uppercase small text-muted border-0",children:"Ownership"}),(0,n.jsx)("th",{className:"py-3 fw-semibold text-uppercase small text-muted border-0",children:"Value"}),(0,n.jsx)("th",{className:"pe-4 py-3 fw-semibold text-uppercase small text-muted border-0 text-end",children:"Actions"})]})}),(0,n.jsxs)("tbody",{children:[x.map(((e,s)=>{const a=parseInt(e.shares)||0,r=p(),t=r>0?(a/r*100).toFixed(2):"0.0",i=g?g(a):"0.00";return(0,n.jsxs)("tr",{className:"border-bottom",children:[(0,n.jsx)("td",{className:"ps-4 py-3",children:(0,n.jsxs)("div",{className:"d-flex align-items-center",children:[(0,n.jsx)("div",{className:"avatar-sm me-3",children:(0,n.jsx)("div",{className:"avatar-title bg-light-primary text-primary rounded-circle fw-bold",children:e.firstName?e.firstName.charAt(0).toUpperCase():e.lastName?e.lastName.charAt(0).toUpperCase():`F${s+1}`})}),(0,n.jsxs)("div",{children:[(0,n.jsx)("button",{type:"button",className:"btn btn-link p-0 text-decoration-none text-start fw-semibold",onClick:()=>w(e),style:{border:"none",background:"none",cursor:"pointer"},children:e.firstName||""!==e.firstName?`${e.firstName} ${e.lastName||""}`.trim():`Founder ${s+1}`}),(0,n.jsx)("div",{className:"text-muted small",children:"common"===e.shareType?"Common":"preferred"===e.shareType?"Preferred":e.customShareType||"Other"})]})]})}),(0,n.jsx)("td",{className:"py-3",children:(0,n.jsx)("span",{className:"fw-semibold",children:a.toLocaleString()})}),(0,n.jsx)("td",{className:"py-3",children:(0,n.jsxs)("div",{className:"d-flex align-items-center",children:[(0,n.jsx)("div",{className:"progress flex-grow-1 me-2",style:{height:"6px",width:"60px"},children:(0,n.jsx)("div",{className:"progress-bar bg-success",style:{width:`${t}%`}})}),(0,n.jsxs)("span",{className:"fw-semibold text-nowrap",children:[(0,n.jsx)(l.A,{amount:t,currency:"",digit:2}),"%"]})]})}),(0,n.jsx)("td",{className:"py-3",children:(0,n.jsxs)("span",{className:"fw-semibold text-success",children:[b,i]})}),(0,n.jsx)("td",{className:"pe-4 py-3 text-end",children:(0,n.jsxs)("button",{type:"button",className:"btn btn-outline-primary btn-sm",onClick:()=>w(e),children:[(0,n.jsx)("i",{className:"bi bi-eye me-1"}),"View"]})})]},s)})),p()>0&&(0,n.jsxs)("tr",{className:"bg-light-primary border-top",children:[(0,n.jsx)("td",{className:"ps-4 py-3 fw-bold",children:"Total"}),(0,n.jsx)("td",{className:"py-3 fw-bold",children:(0,n.jsx)(l.A,{amount:v,currency:"",digit:0})}),(0,n.jsxs)("td",{className:"py-3 fw-bold",children:[(0,n.jsx)(l.A,{amount:100,currency:"",digit:2}),"%"]}),(0,n.jsxs)("td",{className:"py-3 fw-bold text-success",children:[b?b.split(" ")[1]:"$",h?h():"0.00"]}),(0,n.jsx)("td",{className:"pe-4 py-3"})]})]})]})})})]}),y&&(0,n.jsx)("div",{className:"modal fade show",style:{display:"block",backgroundColor:"rgba(0,0,0,0.5)"},tabIndex:"-1",children:(0,n.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-lg",children:(0,n.jsxs)("div",{className:"modal-content border-0 shadow-lg",children:[(0,n.jsxs)("div",{className:"modal-header bgprimary text-white",children:[(0,n.jsx)("div",{className:"d-flex align-items-center",children:(0,n.jsxs)("div",{children:[(0,n.jsx)("h5",{className:"modal-title mb-0 text-white",children:y.firstName||""!==y.firstName?`${y.firstName} ${y.lastName||""}`.trim():"Founder Details"}),(0,n.jsx)("p",{className:"mb-0 text-white-50 small",children:"Founder Information & Share Details"})]})}),(0,n.jsx)("button",{type:"button",className:"btn-close btn-close-white",onClick:()=>w(null)})]}),(0,n.jsx)("div",{className:"modal-body p-4",children:(0,n.jsxs)("div",{className:"row",children:[(0,n.jsxs)("div",{className:"col-md-6 mb-4",children:[(0,n.jsxs)("h6",{className:"text-uppercase text-muted mb-3 small fw-bold",children:[(0,n.jsx)("i",{className:"bi bi-person me-2"}),"Personal Information"]}),(0,n.jsx)("div",{className:"card bg-light border-0",children:(0,n.jsxs)("div",{className:"card-body",children:[(0,n.jsxs)("div",{className:"mb-3",children:[(0,n.jsx)("label",{className:"form-label small text-muted mb-1",children:"First Name"}),(0,n.jsx)("div",{className:"fw-semibold",children:y.firstName||"-"})]}),(0,n.jsxs)("div",{className:"mb-3",children:[(0,n.jsx)("label",{className:"form-label small text-muted mb-1",children:"Last Name"}),(0,n.jsx)("div",{className:"fw-semibold",children:y.lastName||"-"})]}),(0,n.jsxs)("div",{className:"mb-3",children:[(0,n.jsx)("label",{className:"form-label small text-muted mb-1",children:"Email"}),(0,n.jsx)("div",{className:"fw-semibold text-truncate",children:y.email||"-"})]}),(0,n.jsxs)("div",{children:[(0,n.jsx)("label",{className:"form-label small text-muted mb-1",children:"Phone"}),(0,n.jsx)("div",{className:"fw-semibold",children:y.phone||"-"})]})]})})]}),(0,n.jsxs)("div",{className:"col-md-6 mb-4",children:[(0,n.jsxs)("h6",{className:"text-uppercase text-muted mb-3 small fw-bold",children:[(0,n.jsx)("i",{className:"bi bi-pie-chart me-2"}),"Share Information"]}),(0,n.jsx)("div",{className:"card bg-light border-0",children:(0,n.jsxs)("div",{className:"card-body",children:[(0,n.jsxs)("div",{className:"mb-3",children:[(0,n.jsx)("label",{className:"form-label small text-muted mb-1",children:"Shares"}),(0,n.jsx)("div",{className:"fw-semibold fs-5 text-primary",children:(parseInt(y.shares)||0).toLocaleString()})]}),(0,n.jsxs)("div",{className:"mb-3",children:[(0,n.jsx)("label",{className:"form-label small text-muted mb-1",children:"Ownership Percentage"}),(0,n.jsxs)("div",{className:"fw-semibold fs-5 text-success",children:[p()>0?((parseInt(y.shares)||0)/p()*100).toFixed(2):"0.0","%"]})]}),(0,n.jsxs)("div",{className:"mb-3",children:[(0,n.jsx)("label",{className:"form-label small text-muted mb-1",children:"Total Value"}),(0,n.jsxs)("div",{className:"fw-semibold fs-5 text-success",children:[b?b.split(" ")[1]:"$",g?g(parseInt(y.shares)||0):"0.00"]})]}),(0,n.jsxs)("div",{className:"mb-3",children:[(0,n.jsx)("label",{className:"form-label small text-muted mb-1",children:"Price Per Share"}),(0,n.jsxs)("div",{className:"fw-semibold",children:[b?b.split(" ")[1]:"$",s.pricePerShare||"0.00"]})]})]})})]}),(0,n.jsxs)("div",{className:"col-12",children:[(0,n.jsxs)("h6",{className:"text-uppercase text-muted mb-3 small fw-bold",children:[(0,n.jsx)("i",{className:"bi bi-gear me-2"}),"Share Details"]}),(0,n.jsx)("div",{className:"card bg-light border-0",children:(0,n.jsx)("div",{className:"card-body",children:(0,n.jsxs)("div",{className:"row",children:[(0,n.jsxs)("div",{className:"col-md-4 mb-3",children:[(0,n.jsx)("label",{className:"form-label small text-muted mb-1",children:"Share Type"}),(0,n.jsx)("div",{className:"fw-semibold",children:"common"===y.shareType?(0,n.jsx)("span",{className:"badge bg-primary",children:"Common Shares"}):"preferred"===y.shareType?(0,n.jsx)("span",{className:"badge bg-warning text-dark",children:"Preferred Shares"}):"other"===y.shareType&&y.customShareType?(0,n.jsx)("span",{className:"badge bg-secondary",children:y.customShareType}):(0,n.jsx)("span",{className:"badge bg-secondary",children:"Other"})})]}),(0,n.jsxs)("div",{className:"col-md-4 mb-3",children:[(0,n.jsx)("label",{className:"form-label small text-muted mb-1",children:"Share Class"}),(0,n.jsx)("div",{className:"fw-semibold",children:"other"===y.shareClass&&y.customShareClass?y.customShareClass:y.shareClass||"Class A"})]}),(0,n.jsxs)("div",{className:"col-md-4 mb-3",children:[(0,n.jsx)("label",{className:"form-label small text-muted mb-1",children:"Voting Rights"}),(0,n.jsx)("div",{className:"fw-semibold",children:"voting"===y.voting?(0,n.jsx)("span",{className:"badge bg-success",children:"Voting"}):(0,n.jsx)("span",{className:"badge bg-secondary",children:"Non-Voting"})})]})]})})})]})]})}),(0,n.jsx)("div",{className:"modal-footer border-top-0 bg-light rounded-bottom",children:(0,n.jsxs)("button",{type:"button",className:"btn btn-outline-secondary",onClick:()=>w(null),children:[(0,n.jsx)("i",{className:"bi bi-x-circle me-1"}),"Close"]})})]})})})]}),f("description")&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Description:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.description||(0,n.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),f("rights")&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Founder Rights & Preferences:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.rights||(0,n.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,n.jsx)("div",{className:"col-12",children:(0,n.jsx)("div",{className:"p-3 bg-warning bg-opacity-10 rounded-3",children:(0,n.jsxs)("small",{className:"text-muted",children:[(0,n.jsx)("strong",{children:"Note:"})," Round 0 represents company incorporation. Total shares will carry forward to future rounds, but price per share will be recalculated based on investment terms."]})})})]})]}):(0,n.jsxs)("div",{className:"row g-3",children:[f("shareclass")&&(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Name of Round:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.nameOfRound||(0,n.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Share Class Type:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:c||(0,n.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),"OTHER"===c&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Custom Share Class Name:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.shareclassother||(0,n.jsx)("span",{className:"text-muted",children:"Not provided"})})]})})]}),f("description")&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Description:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.description||(0,n.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),f("instrument")&&(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Investment Instrument:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:"Safe"===s.instrumentType?(0,n.jsx)("span",{children:"SAFE"}):s.instrumentType||(0,n.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),"OTHER"===s.instrumentType&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Custom Investment Instrument:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.customInstrument||(0,n.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),s.hasWarrants_preferred&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,n.jsx)("h6",{children:"Warrants Details"}),(0,n.jsxs)("div",{className:"row",children:[(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Warrant Type:"})," ","percentage"===s.warrantType?"By Percentage":"fixed"===s.warrantType?"Fixed Warrant":"Not specified"]}),"percentage"===s.warrantType&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Warrant Coverage:"})," ",s.warrant_coverage_percentage||"0","%"]}),"fixed"===s.warrantType&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Fixed Warrant Shares:"})," ",(0,n.jsx)(l.A,{amount:s.warrant_fixed_shares,currency:"",digit:""})," shares"]}),s.expirationDate_preferred&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Expiration Date:"})," ",F(s.expirationDate_preferred)]}),s.warrant_notes&&(0,n.jsxs)("div",{className:"col-12 mt-2",children:[(0,n.jsx)("strong",{children:"Additional Terms:"}),(0,n.jsx)("div",{className:"small text-muted",children:s.warrant_notes})]})]})]})}),"Common Stock"===s.instrumentType&&s.common_stock_valuation&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,n.jsx)("h6",{children:"Common Stock Details"}),(0,n.jsxs)("div",{className:"row",children:[(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Company Valuation:"})," $",Number(s.common_stock_valuation).toLocaleString()]}),s.hasWarrants&&(0,n.jsxs)(n.Fragment,{children:[(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Warrants:"})," Yes"]}),s.exercisePrice&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Exercise Price:"})," $",s.exercisePrice]}),s.expirationDate&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Expiration Date:"})," ",s.expirationDate]}),s.warrantRatio&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Warrant Ratio:"})," ",s.warrantRatio]}),s.warrantType&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Warrant Type:"})," ",s.warrantType]})]})]})]})}),"Preferred Equity"===s.instrumentType&&s.preferred_valuation&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,n.jsx)("h6",{children:"Preferred Equity Details"}),(0,n.jsxs)("div",{className:"row",children:[(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Company Valuation:"})," $",Number(s.preferred_valuation).toLocaleString()]}),s.hasWarrants_preferred&&(0,n.jsxs)(n.Fragment,{children:[(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Warrants:"})," Yes"]}),s.preferred_valuation&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Company Valuation:"})," $",s.preferred_valuation]}),s.warrant_coverage_percentage&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Warrant Coverage:"})," ",s.warrant_coverage_percentage,"%"]}),s.warrant_adjustment_direction&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Adjustment Direction:"})," ",s.warrant_adjustment_direction]}),s.warrant_adjustment_percent&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Adjustment Percent:"})," ",s.warrant_adjustment_percent,"%"]}),s.expirationDate_preferred&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Expiration Date:"})," ",s.expirationDate_preferred]}),s.warrantType_preferred&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Warrant Type:"})," ",s.warrantType_preferred]})]})]})]})}),"Safe"===s.instrumentType&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,n.jsx)("h6",{children:"SAFE Details"}),(0,n.jsxs)("div",{className:"row",children:[s.valuationCap&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Valuation Cap:"}),(0,n.jsx)(l.A,{amount:s.valuationCap,currency:b})]}),s.discountRate&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Discount Rate:"}),(0,n.jsx)(l.A,{amount:s.discountRate,currency:""}),"%"]}),s.safeType&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"SAFE Type:"})," ","PRE_MONEY"===s.safeType?"Pre-Money":"Post-Money"]})]})]})}),"Convertible Note"===s.instrumentType&&("Seed"===s.shareClassType||"Pre-Seed"===s.shareClassType||"Post-Seed"===s.shareClassType)&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,n.jsx)("h6",{children:"Convertible Note Details"}),(0,n.jsxs)("div",{className:"row",children:[s.valuationCap_note&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Valuation Cap:"}),(0,n.jsx)(l.A,{amount:s.valuationCap_note,currency:b})]}),s.discountRate_note&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Discount Rate:"})," ",s.discountRate_note||"0"===s.discountRate_note?Number(s.discountRate_note).toLocaleString(void 0,{minimumFractionDigits:2,maximumFractionDigits:2}):(0,n.jsx)("span",{className:"text-muted",children:"Not provided"}),"%"]}),s.maturityDate&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Maturity Date:"})," ",F(s.maturityDate)]}),s.interestRate_note&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Interest Rate:"})," ",s.interestRate_note,"%"]}),s.convertibleTrigger&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Conversion Trigger:"})," ",s.convertibleTrigger]})]})]})}),"Venture/Bank DEBT"===s.instrumentType&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,n.jsx)("h6",{children:"Venture/Bank Debt Details"}),(0,n.jsxs)("div",{className:"row",children:[s.interestRate&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Interest Rate:"})," ",s.interestRate,"%"]}),s.repaymentSchedule&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Repayment Schedule:"})," ",s.repaymentSchedule," months"]}),s.hasWarrants_Bank&&(0,n.jsxs)(n.Fragment,{children:[(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Warrants:"})," Yes"]}),s.exercisePrice_bank&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Exercise Price:"})," $",s.exercisePrice_bank]}),s.exercisedate_bank&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Expiration Date:"})," ",s.exercisedate_bank]}),s.warrantRatio_bank&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Warrant Ratio:"})," ",s.warrantRatio_bank]}),s.warrantType_bank&&(0,n.jsxs)("div",{className:"col-md-6",children:[(0,n.jsx)("strong",{children:"Warrant Type:"})," ",s.warrantType_bank]})]})]})]})})]}),f("roundsize")&&(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Investment Amount:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:(0,n.jsx)(l.A,{amount:s.roundsize,currency:b})})]})}),(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Currency:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:b||(0,n.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Target Investment Amount:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:(0,n.jsx)(l.A,{amount:s.round_target_money,currency:b})})]})}),(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Safe"===s.instrumentType||"Convertible Note"===s.instrumentType?"Company Valuation":"Pre-Money Valuation"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:(0,n.jsx)(l.A,{amount:s.pre_money,currency:b})})]})}),(s.instrumentType,s.instrumentType,["Seed","Pre-Seed","Post-Seed"].includes(s.shareClassType),null===c||void 0===c||c.includes("Series"),("OTHER"===s.instrumentType||"Preferred Equity"===s.instrumentType||"Common Stock"===s.instrumentType)&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Post-Money Valuation"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:(0,n.jsx)(l.A,{amount:s.post_money,currency:b})})]})})),("Safe"===s.instrumentType||"Preferred Equity"===s.instrumentType||"Convertible Note"===s.instrumentType||"Common Stock"===s.instrumentType)&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Pre-Money Option Pool (%)"}),(0,n.jsxs)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:[(0,n.jsx)(l.A,{amount:s.optionPoolPercent,currency:""}),"%"]})]})}),(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Post-Money Option Pool (%)"}),(0,n.jsxs)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:[(0,n.jsx)(l.A,{amount:s.optionPoolPercent_post,currency:""}),"%"]})]})}),(()=>{const e="Safe"===s.instrumentType,a="Common Stock"===s.instrumentType,r="Convertible Note"===s.instrumentType,t=["Seed","Pre-Seed","Post-Seed"].includes(s.shareClassType),i=null===c||void 0===c?void 0:c.includes("Series");return!(a||e&&t||e&&i||r&&i||r&&t||"Preferred Equity"===s.instrumentType)&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Total Shares Issued in this Round"}),!("Seed"===c&&"Safe"===s.instrumentType)&&(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:(0,n.jsx)(l.A,{amount:s.issuedshares,currency:b})}),"Seed"===c&&"Safe"===s.instrumentType&&(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:(0,n.jsx)("span",{className:"text-muted",children:"Not applicable for SAFE notes"})})]})})})()]}),f("issuedshares")&&(0,n.jsx)(n.Fragment,{children:s.roundStatus&&(0,n.jsx)("div",{className:"col-md-6",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Round Status:"}),(0,n.jsxs)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:[s.roundStatus,"CLOSED"===s.roundStatus&&(0,n.jsx)("span",{className:"text-muted small d-block mt-1",children:"Closed"})]})]})})}),f("rights")&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Rights & Preferences:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.rights||(0,n.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),f("liquidation")&&"Preferred Equity"===s.instrumentType&&(0,n.jsx)(n.Fragment,{children:(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Liquidation Preference:"}),(0,n.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.liquidationpreferences||(0,n.jsx)("span",{className:"text-muted",children:"Not provided"})})]})})}),f("termsheet")&&s.termsheetFile&&s.termsheetFile.length>0&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Term Sheet Files:"}),(0,n.jsx)("ul",{className:"mb-0 mt-2 ps-3",children:s.termsheetFile.map(((e,s)=>(0,n.jsxs)("li",{className:"mb-1 fw-medium text-dark",children:[(0,n.jsx)("i",{className:"bi bi-file-earmark-text me-2 text-primary"}),e.name]},s)))})]})}),f("subscription")&&s.subscriptiondocument&&s.subscriptiondocument.length>0&&(0,n.jsx)("div",{className:"col-12",children:(0,n.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,n.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Subscription Documents:"}),(0,n.jsx)("ul",{className:"mb-0 mt-2 ps-3",children:s.subscriptiondocument.map(((e,s)=>(0,n.jsxs)("li",{className:"mb-1 fw-medium text-dark",children:[(0,n.jsx)("i",{className:"bi bi-file-earmark-text me-2 text-primary"}),e.name]},s)))})]})})]})]})}},34939:(e,s,a)=>{a.d(s,{A:()=>l});var r=a(65043),t=a(70579);const l=function(e){let{message:s,onClose:a}=e;const[l,i]=(0,r.useState)("show");return(0,r.useEffect)((()=>{const e=setTimeout((()=>{i("")}),3500),s=setTimeout((()=>{a()}),3e3);return()=>{clearTimeout(e),clearTimeout(s)}}),[a]),(0,t.jsxs)("div",{className:`alert alert-danger alert-dismissible fade ${l}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:999999,minWidth:"300px",maxWidth:"90%"},children:[(0,t.jsx)("strong",{children:"Error!"})," ",s,(0,t.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:a})]})}},62837:(e,s,a)=>{a.d(s,{$K:()=>i,CB:()=>n,Cd:()=>j,I0:()=>o,Jq:()=>x,R3:()=>N,dN:()=>u,hJ:()=>b,jh:()=>c,mO:()=>t,mg:()=>d,nj:()=>f,pd:()=>g,uM:()=>p,vE:()=>l,z6:()=>m});var r=a(5464);const t=r.default.div`
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
`,l=r.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,i=(r.default.div`
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
`,r.default.div`
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
`,r.default.div`
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
`,r.default.div`
  display: block;
  height: 100%;
`),d=r.default.div`
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
`,n=r.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=r.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,o=r.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,m=r.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,x=(r.default.div`
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
`,r.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,r.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,r.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,r.default.div`
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
`),p=(r.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,r.default.div`
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
`),h=(r.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,r.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,r.default.div`
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
`,r.default.button`
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
`,r.default.div`
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
`,r.default.video`
  background-color: black;
  border: none;
`,r.default.div`
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
`,r.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,r.default.button`
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
`),u=((0,r.default)(h)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,r.default)(h)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,r.default.sup`
  color: var(--primary);
`),b=r.default.div`
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
`,j=r.default.div`
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
`,f=r.default.button`
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
`,g=r.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,N=r.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=3716.a36bf070.chunk.js.map