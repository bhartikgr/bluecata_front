"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[1925],{23086:(e,s,a)=>{a.d(s,{A:()=>i});var r=a(65043),t=a(35659),l=a(70579);const i=e=>{let{formData:s,otherText:a,selected:i,visibleFields:d=[],isFirstRound:n=!1,foundersData:o=[],calculateTotalShares:c=()=>0,calculateTotalValue:m=()=>0,founderCount:x=0}=e;const p=e=>d.includes(e),h=e=>(e*(parseFloat(s.pricePerShare)||0)).toFixed(2),[u,b]=(0,r.useState)(null);return(0,l.jsxs)("div",{className:"previous-section-summary mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,l.jsxs)("div",{className:"d-flex align-items-center mb-3 pb-2 border-bottom",children:[(0,l.jsx)("div",{style:{width:"45px",height:"45px"},className:"bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 p-1 rounded-circle me-3",children:(0,l.jsx)(t.xyf,{})}),(0,l.jsxs)("div",{children:[(0,l.jsx)("h3",{className:"mb-0 fw-semibold text-dark",children:n?"Round 0 - Incorporation Summary":"Preview Summary"}),(0,l.jsx)("p",{className:"text-muted small mb-0",children:n?"Founder shares allocation at incorporation":"Review your inputs before proceeding"})]})]}),n?(0,l.jsxs)("div",{className:"round-0-special-section",children:[(0,l.jsxs)("div",{className:"alert alert-info mb-3",children:[(0,l.jsx)("strong",{children:"Round 0 - Incorporation Details"}),(0,l.jsx)("p",{className:"mb-0 small",children:"Founder shares issued at incorporation"})]}),(0,l.jsxs)("div",{className:"row g-3",children:[p("shareclass")&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Name of Round:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.nameOfRound||"Founding Share Allocation"})]})}),p("shareclass")&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Share Class Type:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.shareClassType||"Common Shares"})]})}),p("shareclass")&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Price Per Share:"}),(0,l.jsxs)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:["$",s.pricePerShare||"0.01"]})]})}),p("issuedshares")&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Total Shares Issued:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.issuedshares?Number(s.issuedshares).toLocaleString("en-US"):c().toLocaleString()})]})}),p("issuedshares")&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Total Incorporation Value:"}),(0,l.jsxs)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:["$",m()]})]})}),p("shareclass")&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Number of Founders:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:x})]})}),p("shareclass")&&o&&o.length>0&&(0,l.jsxs)("div",{className:"col-12",children:[(0,l.jsxs)("div",{className:"card border-0 shadow-sm",children:[(0,l.jsx)("div",{className:"card-header bg-white py-3 border-bottom",children:(0,l.jsxs)("div",{className:"d-flex justify-content-between align-items-center",children:[(0,l.jsxs)("h5",{className:"card-title mb-0 text-primary",children:[(0,l.jsx)("i",{className:"bi bi-people-fill me-2"}),"Founder Share Allocation"]}),(0,l.jsxs)("span",{className:"badge bg-primary rounded-pill",children:[o.length," Founder",o.length>1?"s":""]})]})}),(0,l.jsx)("div",{className:"card-body p-0",children:(0,l.jsx)("div",{className:"table-responsive",children:(0,l.jsxs)("table",{className:"table table-hover align-middle mb-0",children:[(0,l.jsx)("thead",{className:"table-light",children:(0,l.jsxs)("tr",{children:[(0,l.jsx)("th",{className:"ps-4 py-3 fw-semibold text-uppercase small text-muted border-0",children:"Founder"}),(0,l.jsx)("th",{className:"py-3 fw-semibold text-uppercase small text-muted border-0",children:"Numbers of Shares"}),(0,l.jsx)("th",{className:"py-3 fw-semibold text-uppercase small text-muted border-0",children:"Ownership"}),(0,l.jsx)("th",{className:"py-3 fw-semibold text-uppercase small text-muted border-0",children:"Value"}),(0,l.jsx)("th",{className:"pe-4 py-3 fw-semibold text-uppercase small text-muted border-0 text-end",children:"Actions"})]})}),(0,l.jsxs)("tbody",{children:[o.map(((e,a)=>{const r=parseInt(e.shares)||0,t=c(),i=t>0?(r/t*100).toFixed(1):"0.0",d=h?h(r):"0.00";return(0,l.jsxs)("tr",{className:"border-bottom",children:[(0,l.jsx)("td",{className:"ps-4 py-3",children:(0,l.jsxs)("div",{className:"d-flex align-items-center",children:[(0,l.jsx)("div",{className:"avatar-sm me-3",children:(0,l.jsx)("div",{className:"avatar-title bg-light-primary text-primary rounded-circle fw-bold",children:e.firstName?e.firstName.charAt(0).toUpperCase():e.lastName?e.lastName.charAt(0).toUpperCase():`F${a+1}`})}),(0,l.jsxs)("div",{children:[(0,l.jsx)("button",{type:"button",className:"btn btn-link p-0 text-decoration-none text-start fw-semibold",onClick:()=>b(e),style:{border:"none",background:"none",cursor:"pointer"},children:e.firstName||""!==e.firstName?`${e.firstName} ${e.lastName||""}`.trim():`Founder ${a+1}`}),(0,l.jsx)("div",{className:"text-muted small",children:"common"===e.shareType?"Common":"preferred"===e.shareType?"Preferred":e.customShareType||"Other"})]})]})}),(0,l.jsx)("td",{className:"py-3",children:(0,l.jsx)("span",{className:"fw-semibold",children:r.toLocaleString()})}),(0,l.jsx)("td",{className:"py-3",children:(0,l.jsxs)("div",{className:"d-flex align-items-center",children:[(0,l.jsx)("div",{className:"progress flex-grow-1 me-2",style:{height:"6px",width:"60px"},children:(0,l.jsx)("div",{className:"progress-bar bg-success",style:{width:`${i}%`}})}),(0,l.jsxs)("span",{className:"fw-semibold text-nowrap",children:[i,"%"]})]})}),(0,l.jsx)("td",{className:"py-3",children:(0,l.jsxs)("span",{className:"fw-semibold text-success",children:[s.currency?s.currency.split(" ")[1]:"$",d]})}),(0,l.jsx)("td",{className:"pe-4 py-3 text-end",children:(0,l.jsxs)("button",{type:"button",className:"btn btn-outline-primary btn-sm",onClick:()=>b(e),children:[(0,l.jsx)("i",{className:"bi bi-eye me-1"}),"View"]})})]},a)})),c()>0&&(0,l.jsxs)("tr",{className:"bg-light-primary border-top",children:[(0,l.jsx)("td",{className:"ps-4 py-3 fw-bold",children:"Total"}),(0,l.jsx)("td",{className:"py-3 fw-bold",children:c().toLocaleString()}),(0,l.jsx)("td",{className:"py-3 fw-bold",children:"100%"}),(0,l.jsxs)("td",{className:"py-3 fw-bold text-success",children:[s.currency?s.currency.split(" ")[1]:"$",m?m():"0.00"]}),(0,l.jsx)("td",{className:"pe-4 py-3"})]})]})]})})})]}),u&&(0,l.jsx)("div",{className:"modal fade show",style:{display:"block",backgroundColor:"rgba(0,0,0,0.5)"},tabIndex:"-1",children:(0,l.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-lg",children:(0,l.jsxs)("div",{className:"modal-content border-0 shadow-lg",children:[(0,l.jsxs)("div",{className:"modal-header bgprimary text-white",children:[(0,l.jsx)("div",{className:"d-flex align-items-center",children:(0,l.jsxs)("div",{children:[(0,l.jsx)("h5",{className:"modal-title mb-0 text-white",children:u.firstName||""!==u.firstName?`${u.firstName} ${u.lastName||""}`.trim():"Founder Details"}),(0,l.jsx)("p",{className:"mb-0 text-white-50 small",children:"Founder Information & Share Details"})]})}),(0,l.jsx)("button",{type:"button",className:"btn-close btn-close-white",onClick:()=>b(null)})]}),(0,l.jsx)("div",{className:"modal-body p-4",children:(0,l.jsxs)("div",{className:"row",children:[(0,l.jsxs)("div",{className:"col-md-6 mb-4",children:[(0,l.jsxs)("h6",{className:"text-uppercase text-muted mb-3 small fw-bold",children:[(0,l.jsx)("i",{className:"bi bi-person me-2"}),"Personal Information"]}),(0,l.jsx)("div",{className:"card bg-light border-0",children:(0,l.jsxs)("div",{className:"card-body",children:[(0,l.jsxs)("div",{className:"mb-3",children:[(0,l.jsx)("label",{className:"form-label small text-muted mb-1",children:"First Name"}),(0,l.jsx)("div",{className:"fw-semibold",children:u.firstName||"-"})]}),(0,l.jsxs)("div",{className:"mb-3",children:[(0,l.jsx)("label",{className:"form-label small text-muted mb-1",children:"Last Name"}),(0,l.jsx)("div",{className:"fw-semibold",children:u.lastName||"-"})]}),(0,l.jsxs)("div",{className:"mb-3",children:[(0,l.jsx)("label",{className:"form-label small text-muted mb-1",children:"Email"}),(0,l.jsx)("div",{className:"fw-semibold text-truncate",children:u.email||"-"})]}),(0,l.jsxs)("div",{children:[(0,l.jsx)("label",{className:"form-label small text-muted mb-1",children:"Phone"}),(0,l.jsx)("div",{className:"fw-semibold",children:u.phone||"-"})]})]})})]}),(0,l.jsxs)("div",{className:"col-md-6 mb-4",children:[(0,l.jsxs)("h6",{className:"text-uppercase text-muted mb-3 small fw-bold",children:[(0,l.jsx)("i",{className:"bi bi-pie-chart me-2"}),"Share Information"]}),(0,l.jsx)("div",{className:"card bg-light border-0",children:(0,l.jsxs)("div",{className:"card-body",children:[(0,l.jsxs)("div",{className:"mb-3",children:[(0,l.jsx)("label",{className:"form-label small text-muted mb-1",children:"Shares"}),(0,l.jsx)("div",{className:"fw-semibold fs-5 text-primary",children:(parseInt(u.shares)||0).toLocaleString()})]}),(0,l.jsxs)("div",{className:"mb-3",children:[(0,l.jsx)("label",{className:"form-label small text-muted mb-1",children:"Ownership Percentage"}),(0,l.jsxs)("div",{className:"fw-semibold fs-5 text-success",children:[c()>0?((parseInt(u.shares)||0)/c()*100).toFixed(1):"0.0","%"]})]}),(0,l.jsxs)("div",{className:"mb-3",children:[(0,l.jsx)("label",{className:"form-label small text-muted mb-1",children:"Total Value"}),(0,l.jsxs)("div",{className:"fw-semibold fs-5 text-success",children:[s.currency?s.currency.split(" ")[1]:"$",h?h(parseInt(u.shares)||0):"0.00"]})]}),(0,l.jsxs)("div",{className:"mb-3",children:[(0,l.jsx)("label",{className:"form-label small text-muted mb-1",children:"Price Per Share"}),(0,l.jsxs)("div",{className:"fw-semibold",children:[s.currency?s.currency.split(" ")[1]:"$",s.pricePerShare||"0.00"]})]})]})})]}),(0,l.jsxs)("div",{className:"col-12",children:[(0,l.jsxs)("h6",{className:"text-uppercase text-muted mb-3 small fw-bold",children:[(0,l.jsx)("i",{className:"bi bi-gear me-2"}),"Share Details"]}),(0,l.jsx)("div",{className:"card bg-light border-0",children:(0,l.jsx)("div",{className:"card-body",children:(0,l.jsxs)("div",{className:"row",children:[(0,l.jsxs)("div",{className:"col-md-4 mb-3",children:[(0,l.jsx)("label",{className:"form-label small text-muted mb-1",children:"Share Type"}),(0,l.jsx)("div",{className:"fw-semibold",children:"common"===u.shareType?(0,l.jsx)("span",{className:"badge bg-primary",children:"Common Shares"}):"preferred"===u.shareType?(0,l.jsx)("span",{className:"badge bg-warning text-dark",children:"Preferred Shares"}):"other"===u.shareType&&u.customShareType?(0,l.jsx)("span",{className:"badge bg-secondary",children:u.customShareType}):(0,l.jsx)("span",{className:"badge bg-secondary",children:"Other"})})]}),(0,l.jsxs)("div",{className:"col-md-4 mb-3",children:[(0,l.jsx)("label",{className:"form-label small text-muted mb-1",children:"Share Class"}),(0,l.jsx)("div",{className:"fw-semibold",children:"other"===u.shareClass&&u.customShareClass?u.customShareClass:u.shareClass||"Class A"})]}),(0,l.jsxs)("div",{className:"col-md-4 mb-3",children:[(0,l.jsx)("label",{className:"form-label small text-muted mb-1",children:"Voting Rights"}),(0,l.jsx)("div",{className:"fw-semibold",children:"voting"===u.voting?(0,l.jsx)("span",{className:"badge bg-success",children:"Voting"}):(0,l.jsx)("span",{className:"badge bg-secondary",children:"Non-Voting"})})]})]})})})]})]})}),(0,l.jsx)("div",{className:"modal-footer border-top-0 bg-light rounded-bottom",children:(0,l.jsxs)("button",{type:"button",className:"btn btn-outline-secondary",onClick:()=>b(null),children:[(0,l.jsx)("i",{className:"bi bi-x-circle me-1"}),"Close"]})})]})})})]}),p("description")&&(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Description:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.description||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),p("rights")&&(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Founder Rights & Preferences:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.rights||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),p("voting")&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Voting Rights:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.voting||"Yes"})]})}),p("convertible")&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Shares Convertible:"}),(0,l.jsxs)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:[s.convertible||"No","Yes"===s.convertible&&s.convertibleType&&` (${s.convertibleType})`]})]})}),(0,l.jsx)("div",{className:"col-12",children:(0,l.jsx)("div",{className:"p-3 bg-warning bg-opacity-10 rounded-3",children:(0,l.jsxs)("small",{className:"text-muted",children:[(0,l.jsx)("strong",{children:"Note:"})," Round 0 represents company incorporation. Total shares will carry forward to future rounds, but price per share will be recalculated based on investment terms."]})})})]})]}):(0,l.jsxs)("div",{className:"row g-3",children:[p("shareclass")&&(0,l.jsxs)(l.Fragment,{children:[(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Name of Round:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.nameOfRound||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Share Class Type:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:i||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),"OTHER"===i&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Custom Share Class Name:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.shareclassother||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})})]}),p("description")&&(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Description:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.description||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),p("instrument")&&(0,l.jsxs)(l.Fragment,{children:[(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Investment Instrument:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.instrumentType||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),"OTHER"===s.instrumentType&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Custom Investment Instrument:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.customInstrument||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),"Common Stock"===s.instrumentType&&s.common_stock_valuation&&(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,l.jsx)("h6",{children:"Common Stock Details"}),(0,l.jsxs)("div",{className:"row",children:[(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Company Valuation:"})," $",Number(s.common_stock_valuation).toLocaleString()]}),s.hasWarrants&&(0,l.jsxs)(l.Fragment,{children:[(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Warrants:"})," Yes"]}),s.exercisePrice&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Exercise Price:"})," $",s.exercisePrice]}),s.expirationDate&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Expiration Date:"})," ",s.expirationDate]}),s.warrantRatio&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Warrant Ratio:"})," ",s.warrantRatio]}),s.warrantType&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Warrant Type:"})," ",s.warrantType]})]})]})]})}),"Preferred Equity"===s.instrumentType&&s.preferred_valuation&&(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,l.jsx)("h6",{children:"Preferred Equity Details"}),(0,l.jsxs)("div",{className:"row",children:[(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Company Valuation:"})," $",Number(s.preferred_valuation).toLocaleString()]}),s.hasWarrants_preferred&&(0,l.jsxs)(l.Fragment,{children:[(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Warrants:"})," Yes"]}),s.preferred_valuation&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Company Valuation:"})," $",s.preferred_valuation]}),s.warrant_coverage_percentage&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Warrant Coverage:"})," ",s.warrant_coverage_percentage,"%"]}),s.warrant_adjustment_direction&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Adjustment Direction:"})," ",s.warrant_adjustment_direction]}),s.warrant_adjustment_percent&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Adjustment Percent:"})," ",s.warrant_adjustment_percent,"%"]}),s.expirationDate_preferred&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Expiration Date:"})," ",s.expirationDate_preferred]}),s.warrantType_preferred&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Warrant Type:"})," ",s.warrantType_preferred]})]})]})]})}),"Safe"===s.instrumentType&&(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,l.jsx)("h6",{children:"SAFE Details"}),(0,l.jsxs)("div",{className:"row",children:[s.valuationCap&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Valuation Cap:"})," $",Number(s.valuationCap).toLocaleString()]}),s.discountRate&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Discount Rate:"})," ",s.discountRate,"%"]}),s.safeType&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"SAFE Type:"})," ","PRE_MONEY"===s.safeType?"Pre-Money":"Post-Money"]})]})]})}),"Convertible Note"===s.instrumentType&&(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,l.jsx)("h6",{children:"Convertible Note Details"}),(0,l.jsxs)("div",{className:"row",children:[s.valuationCap_note&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Valuation Cap:"})," $",Number(s.valuationCap_note).toLocaleString()]}),s.discountRate_note&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Discount Rate:"})," ",s.discountRate_note,"%"]}),s.maturityDate&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Maturity Date:"})," ",s.maturityDate]}),s.interestRate_note&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Interest Rate:"})," ",s.interestRate_note,"%"]}),s.convertibleTrigger&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Conversion Trigger:"})," ",s.convertibleTrigger]})]})]})}),"Venture/Bank DEBT"===s.instrumentType&&(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,l.jsx)("h6",{children:"Venture/Bank Debt Details"}),(0,l.jsxs)("div",{className:"row",children:[s.interestRate&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Interest Rate:"})," ",s.interestRate,"%"]}),s.repaymentSchedule&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Repayment Schedule:"})," ",s.repaymentSchedule," months"]}),s.hasWarrants_Bank&&(0,l.jsxs)(l.Fragment,{children:[(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Warrants:"})," Yes"]}),s.exercisePrice_bank&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Exercise Price:"})," $",s.exercisePrice_bank]}),s.exercisedate_bank&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Expiration Date:"})," ",s.exercisedate_bank]}),s.warrantRatio_bank&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Warrant Ratio:"})," ",s.warrantRatio_bank]}),s.warrantType_bank&&(0,l.jsxs)("div",{className:"col-md-6",children:[(0,l.jsx)("strong",{children:"Warrant Type:"})," ",s.warrantType_bank]})]})]})]})})]}),p("roundsize")&&(0,l.jsxs)(l.Fragment,{children:[(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Investment Amount:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.roundsize||"0"===s.roundsize?`${s.currency} ${Number(s.roundsize).toLocaleString()}`:(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Investor Post-Money Ownership(%):"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.investorPostMoney?`${s.investorPostMoney}`:(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Currency:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.currency||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Pre-Money Valuation"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.pre_money||"0"===s.pre_money?Number(s.pre_money).toLocaleString():(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Post-Money Valuation"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.post_money||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Pre-Money Option Pool (%)"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.optionPoolPercent||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Total Shares Issued in this Round"}),!("Seed"===i&&"Safe"===s.instrumentType)&&(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.issuedshares||"0"===s.issuedshares?Number(s.issuedshares).toLocaleString():(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})}),"Seed"===i&&"Safe"===s.instrumentType&&(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:(0,l.jsx)("span",{className:"text-muted",children:"Not applicable for SAFE notes"})})]})})]}),p("issuedshares")&&(0,l.jsx)(l.Fragment,{children:s.roundStatus&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Round Status:"}),(0,l.jsxs)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:[s.roundStatus,"CLOSED"===s.roundStatus&&s.dateroundclosed&&(0,l.jsxs)("span",{className:"text-muted small d-block mt-1",children:["Closed on: ",s.dateroundclosed]})]})]})})}),p("rights")&&(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Rights & Preferences:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.rights||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),p("liquidation")&&(0,l.jsxs)(l.Fragment,{children:[(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Liquidation Preference:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.liquidationpreferences||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Liquidation Type:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.liquidation&&s.liquidation.length>0?s.liquidation.join(", "):(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})}),s.liquidation&&s.liquidation.includes("OTHER")&&s.liquidationOther&&(0,l.jsxs)("p",{className:"mb-0 mt-2 fw-medium text-dark",children:[(0,l.jsx)("strong",{children:"Custom:"})," ",s.liquidationOther]})]})})]}),p("convertible")&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Convertible:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.convertible||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),p("convertible")&&"Yes"===s.convertible&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Convertible Type:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.convertibleType||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),p("voting")&&(0,l.jsx)("div",{className:"col-md-6",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Voting Rights:"}),(0,l.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.voting||(0,l.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),p("termsheet")&&s.termsheetFile&&s.termsheetFile.length>0&&(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Term Sheet Files:"}),(0,l.jsx)("ul",{className:"mb-0 mt-2 ps-3",children:s.termsheetFile.map(((e,s)=>(0,l.jsxs)("li",{className:"mb-1 fw-medium text-dark",children:[(0,l.jsx)("i",{className:"bi bi-file-earmark-text me-2 text-primary"}),e.name]},s)))})]})}),p("subscription")&&s.subscriptiondocument&&s.subscriptiondocument.length>0&&(0,l.jsx)("div",{className:"col-12",children:(0,l.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,l.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Subscription Documents:"}),(0,l.jsx)("ul",{className:"mb-0 mt-2 ps-3",children:s.subscriptiondocument.map(((e,s)=>(0,l.jsxs)("li",{className:"mb-1 fw-medium text-dark",children:[(0,l.jsx)("i",{className:"bi bi-file-earmark-text me-2 text-primary"}),e.name]},s)))})]})})]})]})}},34939:(e,s,a)=>{a.d(s,{A:()=>l});var r=a(65043),t=a(70579);const l=function(e){let{message:s,onClose:a}=e;const[l,i]=(0,r.useState)("show");return(0,r.useEffect)((()=>{const e=setTimeout((()=>{i("")}),3500),s=setTimeout((()=>{a()}),3e3);return()=>{clearTimeout(e),clearTimeout(s)}}),[a]),(0,t.jsxs)("div",{className:`alert alert-danger alert-dismissible fade ${l}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:999999,minWidth:"300px",maxWidth:"90%"},children:[(0,t.jsx)("strong",{children:"Error!"})," ",s,(0,t.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:a})]})}},37022:(e,s,a)=>{a.d(s,{A:()=>l});var r=a(65043),t=a(70579);const l=function(e){let{message:s,onConfirm:a,onCancel:l}=e;const i=(0,r.useRef)(null),d=(0,r.useRef)(null);return(0,r.useEffect)((()=>{const e=e=>{"Escape"===e.key&&l(),"Enter"===e.key&&a()};return document.addEventListener("keydown",e),d.current.focus(),document.body.style.overflow="hidden",()=>{document.removeEventListener("keydown",e),document.body.style.overflow="unset"}}),[a,l]),(0,t.jsxs)("div",{className:"modal-backdrop",style:{position:"fixed",top:0,left:0,width:"100%",height:"100%",backgroundColor:"rgba(0, 0, 0, 0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,opacity:0,animation:"fadeIn 0.3s ease-out forwards",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)"},onClick:l,children:[(0,t.jsxs)("div",{ref:i,className:"modal-content",style:{backgroundColor:"white",padding:"2rem",borderRadius:"12px",boxShadow:"0 10px 30px rgba(0, 0, 0, 0.15), 0 0 10px rgba(220, 53, 69, 0.2)",maxWidth:"450px",width:"90%",transform:"scale(0.9) translateY(-20px)",animation:"scaleIn 0.3s ease-out forwards",border:"1px solid rgba(220, 53, 69, 0.2)"},onClick:e=>e.stopPropagation(),children:[(0,t.jsx)("div",{className:"modal-icon",style:{textAlign:"center",marginBottom:"1.5rem"},children:(0,t.jsx)("svg",{width:"56",height:"56",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",style:{color:"#dc3545"},children:(0,t.jsx)("path",{d:"M12 9V14M12 17V17.01M5.07183 19H18.9282C20.4678 19 21.4301 17.3333 20.6603 16L13.7321 4C12.9623 2.66667 11.0378 2.66667 10.268 4L3.33978 16C2.56998 17.3333 3.53223 19 5.07183 19Z",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})})}),(0,t.jsx)("h3",{className:"modal-title",style:{textAlign:"center",margin:"0 0 1rem 0",color:"#dc3545",fontSize:"1.5rem",fontWeight:"600"},children:"Confirm Action"}),(0,t.jsx)("p",{className:"modal-message",style:{textAlign:"center",margin:"0 0 2rem 0",color:"#495057",fontSize:"1rem",lineHeight:"1.5"},children:s}),(0,t.jsxs)("div",{className:"modal-actions",style:{display:"flex",justifyContent:"center",gap:"1rem"},children:[(0,t.jsx)("button",{type:"button",className:"btn-cancel",onClick:l,style:{padding:"0.75rem 1.5rem",backgroundColor:"#f8f9fa",color:"#495057",border:"1px solid #dee2e6",borderRadius:"6px",fontWeight:"500",fontSize:"1rem",cursor:"pointer",transition:"all 0.2s ease",minWidth:"100px"},onMouseOver:e=>{e.target.style.backgroundColor="#e9ecef",e.target.style.transform="translateY(-2px)"},onMouseOut:e=>{e.target.style.backgroundColor="#f8f9fa",e.target.style.transform="translateY(0)"},children:"Cancel"}),(0,t.jsx)("button",{type:"button",className:"btn-confirm",ref:d,onClick:a,style:{padding:"0.75rem 1.5rem",backgroundColor:"#dc3545",color:"white",border:"none",borderRadius:"6px",fontWeight:"500",fontSize:"1rem",cursor:"pointer",transition:"all 0.2s ease",minWidth:"100px",boxShadow:"0 4px 6px rgba(220, 53, 69, 0.3)"},onMouseOver:e=>{e.target.style.backgroundColor="#bd2130",e.target.style.transform="translateY(-2px)",e.target.style.boxShadow="0 6px 8px rgba(220, 53, 69, 0.4)"},onMouseOut:e=>{e.target.style.backgroundColor="#dc3545",e.target.style.transform="translateY(0)",e.target.style.boxShadow="0 4px 6px rgba(220, 53, 69, 0.3)"},children:"Confirm"})]})]}),(0,t.jsx)("style",{children:"\n          @keyframes fadeIn {\n            from { opacity: 0; }\n            to { opacity: 1; }\n          }\n          \n          @keyframes scaleIn {\n            from { \n              transform: scale(0.9) translateY(-20px);\n              opacity: 0;\n            }\n            to { \n              transform: scale(1) translateY(0);\n              opacity: 1;\n            }\n          }\n          \n          .btn-cancel:focus, .btn-confirm:focus {\n            outline: 2px solid #3d8bfd;\n            outline-offset: 2px;\n          }\n        "})]})}},62837:(e,s,a)=>{a.d(s,{$K:()=>i,CB:()=>n,Cd:()=>g,I0:()=>c,Jq:()=>p,R3:()=>v,Zw:()=>x,dN:()=>b,hJ:()=>f,jh:()=>o,mO:()=>t,mg:()=>d,nj:()=>j,pd:()=>N,uM:()=>h,vE:()=>l,z6:()=>m});var r=a(5464);const t=r.default.div`
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
`,o=r.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=r.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,m=r.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,x=r.default.div`
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
`,p=(r.default.div`
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
`),h=(r.default.div`
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
`),u=(r.default.div`
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
`),b=((0,r.default)(u)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,r.default)(u)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,r.default.sup`
  color: var(--primary);
`),f=r.default.div`
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
`,g=r.default.div`
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
`,j=r.default.button`
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
`,N=r.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,v=r.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=1925.07f5706a.chunk.js.map