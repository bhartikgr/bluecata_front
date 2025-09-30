"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[1925],{23086:(e,s,a)=>{a.d(s,{A:()=>i});a(65043);var t=a(35659),r=a(70579);const i=e=>{let{formData:s,otherText:a,selected:i,visibleFields:l=[]}=e;const n=e=>l.includes(e);return(0,r.jsxs)("div",{className:"previous-section-summary mb-4 p-4 bg-white border rounded-3 shadow-sm",children:[(0,r.jsxs)("div",{className:"d-flex align-items-center mb-3 pb-2 border-bottom",children:[(0,r.jsx)("div",{style:{width:"45px",height:"45px"},className:"bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 p-1 rounded-circle me-3",children:(0,r.jsx)(t.xyf,{})}),(0,r.jsxs)("div",{children:[(0,r.jsx)("h3",{className:"mb-0 fw-semibold text-dark",children:"Preview Summary"}),(0,r.jsx)("p",{className:"text-muted small mb-0",children:"Review your inputs before proceeding"})]})]}),(0,r.jsxs)("div",{className:"row g-3",children:[n("shareclass")&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Name of Round:"}),(0,r.jsxs)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:[s.nameOfRound," ",s.shareClassType||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})]})]})}),(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Share Class Type:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:i||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),"OTHER"===i&&(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Custom Share Class Name:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.shareclassother||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})})]}),n("description")&&(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Description:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.description||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),n("instrument")&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Investment Instrument:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.instrumentType||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),"OTHER"===s.instrumentType&&(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Custom Investment Instrument Name:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.customInstrument||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),"Common Stock"===s.instrumentType&&(0,r.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,r.jsx)("h5",{children:"Common Stock Details"}),(0,r.jsx)("label",{className:"form-label",children:"Company Valuation"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.common_stock_valuation||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("label",{className:"form-label",children:"Add Warrants (optional)"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.hasWarrants?"Yes":"No"}),s.hasWarrants&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("label",{className:"form-label",children:"Exercise Price (Strike Price)"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.exercisePrice||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("label",{className:"form-label",children:"Expiration Date"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.expirationDate||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("label",{className:"form-label",children:"Warrant Ratio"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.warrantRatio||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("label",{className:"form-label",children:"Type of Warrant"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.warrantType||"CALL"})]})]}),"Preferred Equity"===s.instrumentType&&(0,r.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,r.jsx)("h5",{children:"Preferred Equity Details"}),(0,r.jsx)("label",{className:"form-label",children:"Company Valuation"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.preferred_valuation||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("label",{className:"form-label",children:"Add Warrants (optional)"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.hasWarrants_preferred?"Yes":"No"}),s.hasWarrants_preferred&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("label",{className:"form-label",children:"Exercise Price (Strike Price)"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.exercisePrice_preferred||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("label",{className:"form-label",children:"Expiration Date"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.expirationDate_preferred||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("label",{className:"form-label",children:"Warrant Ratio"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.warrantRatio_preferred||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("label",{className:"form-label",children:"Type of Warrant"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.warrantType_preferred||"CALL"})]})]}),"Safe"===s.instrumentType&&(0,r.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,r.jsx)("h5",{children:"SAFE Details"}),(0,r.jsx)("label",{className:"form-label",children:"Valuation Cap"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.valuationCap||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsxs)("small",{className:"text-muted mb-3 d-block",children:["Sets the maximum company valuation at which the SAFE converts to equity.",(0,r.jsx)("br",{}),(0,r.jsx)("strong",{children:"Tip:"})," Lower cap = more equity for investors, higher cap = better for founders."]}),(0,r.jsx)("label",{className:"form-label",children:"Discount Rate (%)"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.discountRate||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsxs)("small",{className:"text-muted mb-3 d-block",children:["Gives investors a percentage discount on the future equity round.",(0,r.jsx)("br",{}),"Typical range: 10\u201325%.",(0,r.jsx)("br",{}),"Higher discount = more equity for investors."]}),(0,r.jsx)("label",{className:"form-label",children:"SAFE Type"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:"PRE_MONEY"===s.safeType?"Pre-Money SAFE":"POST_MONEY"===s.safeType?"Post-Money SAFE":(0,r.jsx)("span",{className:"text-muted",children:"Not selected"})})]}),"Venture/Bank DEBT"===s.instrumentType&&(0,r.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,r.jsx)("h5",{children:"Venture/Bank Debt Details"}),(0,r.jsx)("label",{className:"form-label",children:"Interest Rate (%)"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.interestRate||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("small",{className:"text-muted d-block mb-3",children:"Typically higher than traditional loans due to the risk profile of startups."}),(0,r.jsx)("label",{className:"form-label",children:"Repayment Schedule (months)"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.repaymentSchedule||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("small",{className:"text-muted d-block mb-3",children:"Most venture debt comes with interest-only payments initially, followed by a lump-sum principal repayment (bullet structure)."}),(0,r.jsx)("label",{className:"form-label",children:"Add Warrants (optional)"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.hasWarrants_Bank?"Yes":"No"}),s.hasWarrants_Bank&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("label",{className:"form-label",children:"Exercise Price (Strike Price)"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.exercisePrice_bank||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("label",{className:"form-label",children:"Expiration Date"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.exercisedate_bank||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("label",{className:"form-label",children:"Warrant Ratio"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.warrantRatio_bank||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("label",{className:"form-label",children:"Type of Warrant"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:"CALL"===s.warrantType_bank?"Call Warrant (buy shares)":"PUT"===s.warrantType_bank?"Put Warrant (sell shares)":(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})]}),"Convertible Note"===s.instrumentType&&(0,r.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,r.jsx)("h5",{children:"Convertible Note Details"}),(0,r.jsx)("label",{className:"form-label",children:"Valuation Cap"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.valuationCap_note||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("small",{className:"text-muted d-block mb-3",children:"Maximum company valuation at which the note converts into equity. Lower caps = more equity for investors; higher caps = better for founders."}),(0,r.jsx)("label",{className:"form-label",children:"Discount Rate (%)"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.discountRate_note||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("small",{className:"text-muted d-block mb-3",children:"Percentage discount applied to the share price in the next equity round. Rewards early investors for risk-taking."}),(0,r.jsx)("label",{className:"form-label",children:"Maturity Date"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.maturityDate||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("small",{className:"text-muted d-block mb-3",children:"Deadline for conversion or repayment. Typical range: 12\u201324 months."}),(0,r.jsx)("label",{className:"form-label",children:"Interest Rate (%)"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:s.interestRate_note||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,r.jsx)("small",{className:"text-muted d-block mb-3",children:"Annual interest accrued on the principal. Most notes convert interest into equity."}),(0,r.jsx)("label",{className:"form-label",children:"Convertible Trigger"}),(0,r.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:"QUALIFIED_FINANCING"===s.convertibleTrigger?"Qualified Equity Financing":"ACQUISITION_IPO"===s.convertibleTrigger?"Acquisition or IPO":"MATURITY_DATE"===s.convertibleTrigger?"Reaching Maturity Date":(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})]}),n("roundsize")&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Amount:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.roundsize})]})}),(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Currency:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.currency||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})})]}),n("issuedshares")&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Total Shares:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.issuedshares?Number(s.issuedshares).toLocaleString("en-US"):(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),s.roundStatus&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("div",{className:"col-md-6 mb-4",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsxs)("span",{className:"text-secondary small fw-semibold text-uppercase",children:["Is this round closed or active"," "]}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.roundStatus?"CLOSED"===s.roundStatus?"CLOSED":"ACTIVE":(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,r.jsx)("div",{className:"col-md-6 mb-4",children:(0,r.jsx)("div",{className:"p-3 bg-light rounded-3 h-100",children:"CLOSED"===s.roundStatus&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsxs)("span",{className:"text-secondary small fw-semibold text-uppercase",children:["Date Round Closed"," "]}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.dateroundclosed?s.dateroundclosed:(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})})})]})]}),n("rights")&&(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Rights & Preferences:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.rights||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),n("liquidation")&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Liquidation Preference Details:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.liquidationpreferences||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Liquidation Participating:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.liquidation&&s.liquidation.length>0?s.liquidation.join(", "):(0,r.jsx)("span",{className:"text-muted",children:"N/A"})})]})}),n("liquidation")&&s.liquidation&&s.liquidation.includes("OTHER")&&(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Other:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.liquidationOther||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})})]}),n("convertible")&&(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Shares are convertible:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.convertible||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),n("convertible")&&"Yes"===s.convertible&&(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Convertible Type:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.convertibleType||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),n("voting")&&(0,r.jsx)("div",{className:"col-md-6",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3 h-100",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Shareholders Voting Rights:"}),(0,r.jsx)("p",{className:"mb-0 mt-1 fw-medium text-dark fs-6",children:s.voting||(0,r.jsx)("span",{className:"text-muted",children:"Not provided"})})]})}),n("termsheet")&&s.termsheetFile&&s.termsheetFile.length>0&&(0,r.jsx)("div",{className:"col-12",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Term Sheet Name(s):"}),(0,r.jsx)("ul",{className:"mb-0 mt-2 ps-3",children:s.termsheetFile.map(((e,s)=>(0,r.jsxs)("li",{className:"mb-1 fw-medium text-dark",children:[(0,r.jsx)("i",{className:"bi bi-file-earmark-text me-2 text-primary"}),e.name]},s)))})]})}),n("subscription")&&s.subscriptiondocument&&s.subscriptiondocument.length>0&&(0,r.jsx)("div",{className:"col-12",children:(0,r.jsxs)("div",{className:"p-3 bg-light rounded-3",children:[(0,r.jsx)("span",{className:"text-secondary small fw-semibold text-uppercase",children:"Subscription Document:"}),(0,r.jsx)("ul",{className:"mb-0 mt-2 ps-3",children:s.subscriptiondocument.map(((e,s)=>(0,r.jsxs)("li",{className:"mb-1 fw-medium text-dark",children:[(0,r.jsx)("i",{className:"bi bi-file-earmark-text me-2 text-primary"}),e.name]},s)))})]})})]})]})}},34939:(e,s,a)=>{a.d(s,{A:()=>i});var t=a(65043),r=a(70579);const i=function(e){let{message:s,onClose:a}=e;const[i,l]=(0,t.useState)("show");return(0,t.useEffect)((()=>{const e=setTimeout((()=>{l("")}),3500),s=setTimeout((()=>{a()}),3e3);return()=>{clearTimeout(e),clearTimeout(s)}}),[a]),(0,r.jsxs)("div",{className:`alert alert-danger alert-dismissible fade ${i}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:999999,minWidth:"300px",maxWidth:"90%"},children:[(0,r.jsx)("strong",{children:"Error!"})," ",s,(0,r.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:a})]})}},37022:(e,s,a)=>{a.d(s,{A:()=>i});var t=a(65043),r=a(70579);const i=function(e){let{message:s,onConfirm:a,onCancel:i}=e;const l=(0,t.useRef)(null),n=(0,t.useRef)(null);return(0,t.useEffect)((()=>{const e=e=>{"Escape"===e.key&&i(),"Enter"===e.key&&a()};return document.addEventListener("keydown",e),n.current.focus(),document.body.style.overflow="hidden",()=>{document.removeEventListener("keydown",e),document.body.style.overflow="unset"}}),[a,i]),(0,r.jsxs)("div",{className:"modal-backdrop",style:{position:"fixed",top:0,left:0,width:"100%",height:"100%",backgroundColor:"rgba(0, 0, 0, 0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,opacity:0,animation:"fadeIn 0.3s ease-out forwards",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)"},onClick:i,children:[(0,r.jsxs)("div",{ref:l,className:"modal-content",style:{backgroundColor:"white",padding:"2rem",borderRadius:"12px",boxShadow:"0 10px 30px rgba(0, 0, 0, 0.15), 0 0 10px rgba(220, 53, 69, 0.2)",maxWidth:"450px",width:"90%",transform:"scale(0.9) translateY(-20px)",animation:"scaleIn 0.3s ease-out forwards",border:"1px solid rgba(220, 53, 69, 0.2)"},onClick:e=>e.stopPropagation(),children:[(0,r.jsx)("div",{className:"modal-icon",style:{textAlign:"center",marginBottom:"1.5rem"},children:(0,r.jsx)("svg",{width:"56",height:"56",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",style:{color:"#dc3545"},children:(0,r.jsx)("path",{d:"M12 9V14M12 17V17.01M5.07183 19H18.9282C20.4678 19 21.4301 17.3333 20.6603 16L13.7321 4C12.9623 2.66667 11.0378 2.66667 10.268 4L3.33978 16C2.56998 17.3333 3.53223 19 5.07183 19Z",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})})}),(0,r.jsx)("h3",{className:"modal-title",style:{textAlign:"center",margin:"0 0 1rem 0",color:"#dc3545",fontSize:"1.5rem",fontWeight:"600"},children:"Confirm Action"}),(0,r.jsx)("p",{className:"modal-message",style:{textAlign:"center",margin:"0 0 2rem 0",color:"#495057",fontSize:"1rem",lineHeight:"1.5"},children:s}),(0,r.jsxs)("div",{className:"modal-actions",style:{display:"flex",justifyContent:"center",gap:"1rem"},children:[(0,r.jsx)("button",{type:"button",className:"btn-cancel",onClick:i,style:{padding:"0.75rem 1.5rem",backgroundColor:"#f8f9fa",color:"#495057",border:"1px solid #dee2e6",borderRadius:"6px",fontWeight:"500",fontSize:"1rem",cursor:"pointer",transition:"all 0.2s ease",minWidth:"100px"},onMouseOver:e=>{e.target.style.backgroundColor="#e9ecef",e.target.style.transform="translateY(-2px)"},onMouseOut:e=>{e.target.style.backgroundColor="#f8f9fa",e.target.style.transform="translateY(0)"},children:"Cancel"}),(0,r.jsx)("button",{type:"button",className:"btn-confirm",ref:n,onClick:a,style:{padding:"0.75rem 1.5rem",backgroundColor:"#dc3545",color:"white",border:"none",borderRadius:"6px",fontWeight:"500",fontSize:"1rem",cursor:"pointer",transition:"all 0.2s ease",minWidth:"100px",boxShadow:"0 4px 6px rgba(220, 53, 69, 0.3)"},onMouseOver:e=>{e.target.style.backgroundColor="#bd2130",e.target.style.transform="translateY(-2px)",e.target.style.boxShadow="0 6px 8px rgba(220, 53, 69, 0.4)"},onMouseOut:e=>{e.target.style.backgroundColor="#dc3545",e.target.style.transform="translateY(0)",e.target.style.boxShadow="0 4px 6px rgba(220, 53, 69, 0.3)"},children:"Confirm"})]})]}),(0,r.jsx)("style",{children:"\n          @keyframes fadeIn {\n            from { opacity: 0; }\n            to { opacity: 1; }\n          }\n          \n          @keyframes scaleIn {\n            from { \n              transform: scale(0.9) translateY(-20px);\n              opacity: 0;\n            }\n            to { \n              transform: scale(1) translateY(0);\n              opacity: 1;\n            }\n          }\n          \n          .btn-cancel:focus, .btn-confirm:focus {\n            outline: 2px solid #3d8bfd;\n            outline-offset: 2px;\n          }\n        "})]})}},62837:(e,s,a)=>{a.d(s,{$K:()=>l,CB:()=>d,Cd:()=>g,I0:()=>c,Jq:()=>x,R3:()=>v,Zw:()=>p,dN:()=>b,hJ:()=>f,jh:()=>o,mO:()=>r,mg:()=>n,nj:()=>N,pd:()=>j,uM:()=>h,vE:()=>i,z6:()=>m});var t=a(5464);const r=t.default.div`
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
`,i=t.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,l=(t.default.div`
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
`,d=t.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,o=t.default.div`
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
`,m=t.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,p=t.default.div`
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
`),b=((0,t.default)(u)`
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
`),f=t.default.div`
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
`,N=t.default.button`
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
`,j=t.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,v=t.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=1925.c0f54250.chunk.js.map