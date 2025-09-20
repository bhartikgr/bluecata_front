"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[9592],{29592:(e,n,a)=>{a.r(n),a.d(n,{default:()=>x});var t=a(65043),r=a(62837),s=a(86213),i=a(73216),l=a(60184),o=a(55930),d=a(49535),c=a(65469),p=a(39845),m=a(70579);const x=function(){const{id:e,company_id:n}=(0,i.g)(),[a,x]=(0,t.useState)(""),h=(0,t.useRef)(null),[u,f]=(0,t.useState)(null),b=(0,i.Zp)();document.title="Company Capital Round List - Investor";const[g,j]=(0,t.useState)(!1);var N="https://blueprintcatalyst.com/api/user/capitalround/";const v=localStorage.getItem("InvestorData"),y=JSON.parse(v),[w,k]=(0,t.useState)(!1),[_,S]=(0,t.useState)("");(0,t.useEffect)((()=>{C()}),[]);const C=async()=>{let a={investor_id:y.id,capital_round_id:e};try{const e=await s.A.post(N+"getcheckCapitalMotionlist",a,{headers:{Accept:"application/json","Content-Type":"application/json"}});if(0===e.data.results.length)b("/investor/company/capital-round-list/"+n);else{const n=e.data.results[0];S(n),z(n)}}catch(t){}},z=async e=>{let n={user_id:y.id,id:e.sharerecordround_id};try{await s.A.post(N+"Capitalmotionviewed",n,{headers:{Accept:"application/json","Content-Type":"application/json"}})}catch(a){}};return(0,m.jsxs)(r.mO,{className:"investor-login-wrapper",children:[(0,m.jsx)("div",{className:"fullpage d-block",children:(0,m.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,m.jsx)(o.A,{isCollapsed:w,setIsCollapsed:k}),(0,m.jsx)("div",{className:"global_view "+(w?"global_view_col":""),children:(0,m.jsx)(r.$K,{className:"d-block p-md-4 p-3",children:(0,m.jsx)("div",{className:"container-fluid",children:(0,m.jsxs)("div",{className:"profile-card",children:[(0,m.jsxs)("div",{className:"profile-header ",children:[(0,m.jsx)("div",{className:"profile-icon",children:(0,m.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,m.jsx)("path",{d:"M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"}),(0,m.jsx)("path",{d:"M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z"})]})}),(0,m.jsxs)("div",{className:"profile-title",children:[(0,m.jsxs)("h2",{children:["(",_.company_name,") Capital Round Record"]}),(0,m.jsx)("p",{children:"Capital Record Round information"})]})]}),a&&(0,m.jsxs)("div",{className:g?"error_pop":"success_pop",children:[(0,m.jsx)("span",{className:"popup_text",children:a}),(0,m.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>x(""),children:"\xd7"})]}),(0,m.jsxs)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:[(0,m.jsxs)(d.o,{type:"button",className:"backbtn",onClick:()=>{b("/investor/company/capital-round-list/"+n)},children:[(0,m.jsx)(c.A,{size:16,className:"me-1"})," back"]}),(0,m.jsx)("h4",{className:"mainh1"})]}),(0,m.jsx)("div",{className:"profile-content",children:(0,m.jsxs)("form",{children:[(0,m.jsxs)("div",{className:"form-grid",children:[(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Name of Round"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.nameOfRound?_.nameOfRound:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Share Class Type"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.shareClassType?_.shareClassType:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),"OTHER"===_.shareClassType&&(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Custom Share Class Name"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.shareclassother?_.shareclassother:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Description"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.description?_.description:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Investment Instrument"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.instrumentType?_.instrumentType:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})}),"Preferred Equity"===_.instrumentType&&(()=>{let e={};try{const n=JSON.parse(_.instrument_type_data);e=JSON.parse(n)}catch(n){console.error("Error parsing preferred equity data:",n),e={}}return(0,m.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,m.jsx)("h5",{className:"pb-2",children:"Preferred Equity Details"}),(0,m.jsx)("label",{className:"form-label",children:"Preferred Valuation"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.preferred_valuation||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Add Warrants (optional)"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.hasWarrants_preferred?"Yes":"No"}),e.hasWarrants_preferred&&(0,m.jsxs)(m.Fragment,{children:[(0,m.jsx)("label",{className:"form-label",children:"Exercise Price (Strike Price)"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.exercisePrice_preferred||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Expiration Date"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.expirationDate_preferred||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Warrant Ratio"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.warrantRatio_preferred||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Type of Warrant"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.warrantType_preferred||"PUT"})]})]})})()]}),"Common Stock"===_.instrumentType&&(()=>{let e={};try{if(_.instrument_type_data){let n=_.instrument_type_data;"string"===typeof n&&(n=JSON.parse(n)),"string"===typeof n&&(n=JSON.parse(n)),e=n,console.log("Parsed common stock data:",e)}}catch(n){console.error("Error parsing common stock data:",n),e={}}return(0,m.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,m.jsx)("h5",{children:"Common Stock Details"}),(0,m.jsx)("label",{className:"form-label",children:"Company Valuation"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.common_stock_valuation||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Add Warrants (optional)"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.hasWarrants?"Yes":"No"}),e.hasWarrants&&(0,m.jsxs)(m.Fragment,{children:[(0,m.jsx)("label",{className:"form-label",children:"Exercise Price (Strike Price)"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.exercisePrice||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Expiration Date"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.expirationDate||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Warrant Ratio"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.warrantRatio||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Type of Warrant"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.warrantType||"CALL"})]})]})})(),"Convertible Note"===_.instrumentType&&(()=>{let e={};try{if(_.instrument_type_data){let n=_.instrument_type_data;"string"===typeof n&&(n=JSON.parse(n)),"string"===typeof n&&(n=JSON.parse(n)),e=n,console.log("Parsed convertible note data:",e)}}catch(n){console.error("Error parsing convertible note data:",n),e={}}return(0,m.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,m.jsx)("h5",{children:"Convertible Note Details"}),(0,m.jsx)("label",{className:"form-label",children:"Valuation Cap"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.valuationCap_note||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Discount Rate (%)"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.discountRate_note?`${e.discountRate_note}%`:(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Interest Rate (%)"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.interestRate_note?`${e.interestRate_note}%`:(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Maturity Date"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.maturityDate||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Convertible Trigger"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.convertibleTrigger?e.convertibleTrigger.replace(/_/g," & "):(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})})]})})(),"Safe"===_.instrumentType&&(()=>{let e={};try{if(_.instrument_type_data){let n=_.instrument_type_data;"string"===typeof n&&(n=JSON.parse(n)),"string"===typeof n&&(n=JSON.parse(n)),e=n,console.log("Parsed Safe data:",e)}}catch(n){console.error("Error parsing Safe data:",n),e={}}return(0,m.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,m.jsx)("h5",{children:"Safe Details"}),(0,m.jsx)("label",{className:"form-label",children:"Valuation Cap"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.valuationCap||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Discount Rate (%)"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.discountRate?`${e.discountRate}%`:(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Safe Type"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.safeType?e.safeType.replace(/_/g,"-").toLowerCase().replace(/\b\w/g,(e=>e.toUpperCase())):(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})})]})})(),"Venture/Bank DEBT"===_.instrumentType&&(()=>{let e={};try{if(_.instrument_type_data){let n=_.instrument_type_data;"string"===typeof n&&(n=JSON.parse(n)),"string"===typeof n&&(n=JSON.parse(n)),e=n,console.log("Parsed Venture/Bank DEBT data:",e)}}catch(n){console.error("Error parsing Venture/Bank DEBT data:",n),e={}}return(0,m.jsxs)("div",{className:"mt-3 p-3 border rounded bg-light",children:[(0,m.jsx)("h5",{children:"Venture/Bank DEBT Details"}),(0,m.jsx)("label",{className:"form-label",children:"Interest Rate (%)"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.interestRate?`${e.interestRate}%`:(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Repayment Schedule"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.repaymentSchedule||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Add Warrants (optional)"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.hasWarrants_Bank?"Yes":"No"}),e.hasWarrants_Bank&&(0,m.jsxs)(m.Fragment,{children:[(0,m.jsx)("label",{className:"form-label",children:"Exercise Price (Strike Price)"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.exercisePrice_bank||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Exercise Date"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.exercisedate_bank||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Warrant Ratio"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.warrantRatio_bank||(0,m.jsx)("span",{className:"text-muted",children:"Not provided"})}),(0,m.jsx)("label",{className:"form-label",children:"Type of Warrant"}),(0,m.jsx)("p",{className:"mb-3 fw-medium text-dark fs-6",children:e.warrantType_bank||"CALL"})]})]})})(),"OTHER"===_.instrumentType&&(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Custom Investment Instrument Name"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.customInstrument?_.customInstrument:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Amount"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.roundsize?Number(_.roundsize).toLocaleString("en-US"):(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Currency"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.currency?_.currency:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Total Shares"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.issuedshares?Number(_.issuedshares).toLocaleString("en-US"):(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Rights & Preferences"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.rights?_.rights:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Liquidation Preference Details"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.liquidationpreferences?_.liquidationpreferences:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Liquidation Participating"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.liquidation?_.liquidation:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),"OTHER"===_.liquidation&&(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Other"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.liquidation?_.liquidation:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Shares are convertible"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.convertible?_.convertible:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Convertible Type"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.convertibleType?_.convertibleType:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Shareholders Voting Rights"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.voting?_.voting:(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Term Sheet Name"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.termsheetFile&&JSON.parse(_.termsheetFile).length>0?(0,m.jsx)("ul",{className:"list-unstyled mb-0",children:JSON.parse(_.termsheetFile).map(((n,a)=>{const t=`https://blueprintcatalyst.com/api/${`upload/docs/doc_${_.user_id}`}/companyRound/${n}`;return(0,m.jsxs)("li",{className:"mb-1 d-flex align-items-center justify-content-between",children:[(0,m.jsxs)("div",{className:"fw-medium text-dark",children:[(0,m.jsx)("i",{className:"bi bi-file-earmark-text me-2 text-primary"}),n]}),(0,m.jsxs)("button",{onClick:()=>(async(n,a,t)=>{let r={user_id:y.id,capital_round_id:e,id:t};try{await s.A.post(N+"tersheetdownloadInvestor",r,{headers:{Accept:"application/json","Content-Type":"application/json"}});const e=document.createElement("a");e.href=n,e.download=n.split("/").pop(),document.body.appendChild(e),e.click(),document.body.removeChild(e)}catch(i){}})(t,_.id,_.sharerecordround_id),title:n,type:"button",rel:"noopener noreferrer",className:"btn btn-sm btn-outline-danger",children:[(0,m.jsx)(l.WCW,{})," Download"]})]},a)}))}):(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Subscription Document"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:_.subscriptiondocument&&JSON.parse(_.subscriptiondocument).length>0?(0,m.jsx)("ul",{className:"list-unstyled mb-0",children:JSON.parse(_.subscriptiondocument).map(((n,a)=>{const t=`https://blueprintcatalyst.com/api/${`upload/docs/doc_${_.user_id}`}/companyRound/${n}`;return(0,m.jsxs)("li",{className:"mb-1 d-flex align-items-center justify-content-between",children:[(0,m.jsxs)("div",{className:"fw-medium text-dark",children:[(0,m.jsx)("i",{className:"bi bi-file-earmark-text me-2 text-primary"}),n]}),(0,m.jsxs)("button",{title:n,type:"button",onClick:()=>(async(n,a,t)=>{let r={user_id:y.id,capital_round_id:e,id:t};try{await s.A.post(N+"subscriptiondownloadInvestor",r,{headers:{Accept:"application/json","Content-Type":"application/json"}});const e=document.createElement("a");e.href=n,e.download=n.split("/").pop(),document.body.appendChild(e),e.click(),document.body.removeChild(e)}catch(i){}})(t,_.id,_.sharerecordround_id),rel:"noopener noreferrer",className:"btn btn-sm btn-outline-danger",children:[(0,m.jsx)(l.WCW,{})," Download"]})]},a)}))}):(0,m.jsx)("span",{className:"text-muted",children:"N/A"})})]}),"Yes"===_.signature_status&&(0,m.jsxs)("div",{className:"form-group",children:[(0,m.jsx)("label",{htmlFor:"company_linkedin",className:"form-label label_bold",children:"Authorize Signature"}),(0,m.jsx)("div",{className:"form-control-plaintext",children:(0,m.jsx)("img",{src:_.signature,alt:"Signature"})})]})]}),"No"===_.signature_status&&(0,m.jsxs)("div",{children:[(0,m.jsx)("h5",{children:"Investor\u2019s Authorized Signature"}),(0,m.jsx)("p",{className:"text-muted small",children:"By signing below, you confirm your subscription to this investment round and agree to the terms outlined in the Subscription Document."}),(0,m.jsx)(p.A,{ref:h,penColor:"black",canvasProps:{width:500,height:200,className:"signature-canvas border"}}),(0,m.jsxs)("div",{className:"mt-2",children:[(0,m.jsx)("button",{type:"button",className:"global_btn w-fit me-2",onClick:async()=>{const e=h.current;if(!e)return;if(e.isEmpty())return j(!0),x("Please provide a signature first!"),void setTimeout((()=>{j(!1),x("")}),3500);const n=e.toDataURL("image/png");let a={user_id:y.id,id:_.sharerecordround_id,signature_authorize:n,company_id:_.user_id,reports:_};try{await s.A.post(N+"investorrecordAuthorize",a,{headers:{Accept:"application/json","Content-Type":"application/json"}});C(),j(!1),x("Your subscription has been signed successfully. Please proceed with the fund transfer. Shares will be formally allocated to you once the company confirms the receipt of funds"),setTimeout((()=>{}),1e4)}catch(t){}},children:"Save"}),(0,m.jsx)("button",{type:"button",className:"global_btn_clear w-fit me-2",onClick:()=>{h.current.clear(),f(null)},children:"Clear"})]}),u&&(0,m.jsxs)("div",{className:"mt-3",children:[(0,m.jsx)("h6",{children:"Preview:"}),(0,m.jsx)("img",{src:u,alt:"Signature"})]})]})]})})]})})})})]})}),(0,m.jsx)("style",{jsx:!0,children:"\n        .profile-card {\n          background: #fff;\n          border-radius: 16px;\n          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);\n          overflow: hidden;\n        }\n\n        .profile-header {\n          display: flex;\n          align-items: center;\n          padding: 24px 32px;\n          border-bottom: 1px solid #f1f3f4;\n          background: #efefef;\n        }\n\n        .profile-icon {\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          width: 48px;\n          height: 48px;\n          border-radius: 12px;\n          background: linear-gradient(\n            135deg,\n            var(--primary) 0%,\n            var(--primary-icon) 100%\n          );\n          color: white;\n          margin-right: 16px;\n        }\n\n        .profile-title h2 {\n          font-size: 24px;\n          font-weight: 600;\n          color: #0a0a0a;\n          margin: 0 0 4px 0;\n        }\n\n        .profile-title p {\n          color: #6b7280;\n          margin: 0;\n          font-size: 14px;\n        }\n\n        .profile-content {\n          padding: 32px;\n        }\n\n        .form-grid {\n          display: grid;\n          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n          gap: 24px;\n          margin-bottom: 32px;\n        }\n\n        .form-group {\n          display: flex;\n          flex-direction: column;\n        }\n\n        .form-label {\n          font-weight: 500;\n          color: #374151;\n          margin-bottom: 8px;\n          font-size: 14px;\n        }\n\n        .required {\n          color: #f63b3b;\n        }\n\n        .form-input {\n          padding: 10px 16px;\n          border: 1px solid #e5e7eb;\n          border-radius: 10px;\n          font-size: 0.9rem;\n          transition: all 0.2s ease;\n          background: #fff;\n        }\n\n        .form-input:focus {\n          outline: none;\n          border-color: #f63b3b;\n          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);\n        }\n\n        .form-input:disabled {\n          background-color: #f9fafb;\n          color: #6b7280;\n          cursor: not-allowed;\n        }\n\n        .input-note {\n          font-size: 12px;\n          color: #6b7280;\n          margin-top: 4px;\n        }\n\n        .phone-input {\n          padding: 10px 16px;\n          border: 1px solid #e5e7eb;\n          border-radius: 10px;\n          font-size: 0.9rem;\n          width: 100%;\n        }\n\n        .phone-input:focus {\n          outline: none;\n          border-color: #f63b3b;\n          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);\n        }\n\n        .input-with-icon {\n          position: relative;\n          display: flex;\n          align-items: center;\n        }\n\n        .input-icon {\n          position: absolute;\n          left: 12px;\n          color: #6b7280;\n          z-index: 1;\n        }\n\n        .input-with-icon .form-input {\n          padding-left: 40px;\n        }\n\n        .form-actions {\n          display: flex;\n          justify-content: flex-end;\n          border-top: 1px solid #f1f3f4;\n          padding-top: 24px;\n        }\n\n        .btn-primary {\n          display: inline-flex;\n          align-items: center;\n          gap: 8px;\n          background: linear-gradient(135deg, #f63b3b 0%, #e03535 100%);\n          color: white;\n          border: none;\n          border-radius: 8px;\n          padding: 12px 24px;\n          font-size: 16px;\n          font-weight: 500;\n          cursor: pointer;\n          transition: all 0.2s ease;\n        }\n\n        .btn-primary:hover:not(:disabled) {\n          transform: translateY(-2px);\n          box-shadow: 0 4px 12px rgba(246, 59, 59, 0.25);\n        }\n\n        .btn-primary:disabled {\n          opacity: 0.7;\n          cursor: not-allowed;\n          transform: none;\n        }\n\n        .spinner {\n          width: 16px;\n          height: 16px;\n          border: 2px solid rgba(255, 255, 255, 0.3);\n          border-radius: 50%;\n          border-top-color: white;\n          animation: spin 1s ease-in-out infinite;\n        }\n\n        @keyframes spin {\n          to {\n            transform: rotate(360deg);\n          }\n        }\n\n        .alert {\n          padding: 12px 16px;\n          border-radius: 8px;\n          margin-bottom: 24px;\n          font-weight: 500;\n        }\n\n        .alert-success {\n          background-color: #ecfdf5;\n          color: #065f46;\n          border: 1px solid #a7f3d0;\n        }\n\n        .alert-error {\n          background-color: #fef2f2;\n          color: #991b1b;\n          border: 1px solid #fecaca;\n        }\n\n        @media (max-width: 768px) {\n          .profile-header {\n            padding: 20px;\n          }\n\n          .profile-content {\n            padding: 20px;\n          }\n\n          .form-grid {\n            grid-template-columns: 1fr;\n            gap: 20px;\n          }\n\n          .form-actions {\n            justify-content: center;\n          }\n\n          .btn-primary {\n            width: 100%;\n            justify-content: center;\n          }\n        }\n      "})]})}},55930:(e,n,a)=>{a.d(n,{A:()=>b});var t=a(65043),r=(a(38421),a(73216)),s=a(75200),i=a(9463),l=a(53579),o=a(35475),d=a(50423),c=a(53639),p=a(14459),m=a(42983),x=a(31387),h=a(47196),u=a(70579);const f=[{label:"Dashboard",href:"/investor/dashboard",icon:(0,u.jsx)(h.oeo,{size:18})},{label:"Company",href:"/investor/company-list",icon:(0,u.jsx)(c.A,{size:18})},{label:"Profile",href:"/investor/investor-profile",icon:(0,u.jsx)(p.A,{size:18})}];const b=function(e){let{isCollapsed:n,setIsCollapsed:a}=e;const[c,p]=(0,t.useState)(!1),[b,g]=(0,t.useState)(""),j=(0,r.Zp)(),[N,v]=(0,t.useState)(null),[y,w]=(0,t.useState)([]),[k,_]=(0,t.useState)(!1);(0,t.useEffect)((()=>{const e=()=>{window.innerWidth<786?(_(!0),A&&A(!0)):(_(!1),A&&A(!1))};return e(),window.addEventListener("resize",e),()=>window.removeEventListener("resize",e)}),[k]);const[S,C]=(0,t.useState)(!1),z=void 0!==n?n:k,A=a||_;(0,t.useEffect)((()=>{const e=localStorage.getItem("InvestorData"),n=JSON.parse(e);g(n),null===n&&(localStorage.removeItem("InvestorData"),j("/user/login"))}),[]),(0,t.useEffect)((()=>{const e=localStorage.getItem("selectedDropdown");e&&v(Number(e));const n=localStorage.getItem("sidebarCollapsed");if(null!==n){const e=JSON.parse(n);a?a(e):_(e)}}),[]);const T=(0,r.zy)(),D=!z||S;return(0,u.jsxs)(u.Fragment,{children:[(0,u.jsxs)("div",{className:"main_sidenav scroll_nonw d-flex flex-column gap-5  "+(z?"collapsed p-3":"p-4"),children:[(0,u.jsxs)("div",{className:"d-flex align-items-center  gap-3 "+(z?"justify-content-center":"justify-content-between"),children:[!z&&(0,u.jsx)("a",{href:"/",className:"logo",children:(0,u.jsx)("img",{className:"w-100 h-100 object-fit-contain",src:"/logos/capavate.png",alt:"logo"})}),(0,u.jsx)(l.V4,{className:"d-flex justify-content-end",children:(0,u.jsxs)("button",{type:"button",onClick:()=>{const e=!z;A(e),localStorage.setItem("sidebarCollapsed",JSON.stringify(e))},children:[z&&(0,u.jsx)(m.A,{strokeWidth:2}),!z&&(0,u.jsx)(i.A,{strokeWidth:2})]})})]}),(0,u.jsx)(l.vT,{isOpen:D,children:(0,u.jsx)(l.c0,{children:f.map(((e,n)=>{var a;let t=!1;var r;"/investor/company-list"===e.href?t=T.pathname===e.href||T.pathname.startsWith("/investor/company"):t=(null===(r=e.matchPaths)||void 0===r?void 0:r.some((e=>(0,x.B6)({path:e,end:!1},T.pathname))))||T.pathname===e.href;return(0,u.jsx)(l.jl,{children:e.dropdown||e.dynamicDropdownKey?(0,u.jsxs)(u.Fragment,{children:[(0,u.jsx)(l.C,{title:e.label,onClick:()=>(e=>{const n=N===e?null:e;z&&A(!z);v(n),localStorage.setItem("selectedDropdown",null!==n?n:"")})(n),className:z&&!S?"justify-content-center px-0":"",children:(0,u.jsxs)("div",{className:"d-flex gap-2 align-items-center w-100 "+(z?"justify-content-center":"justify-content-between"),children:[(0,u.jsxs)("div",{className:"d-flex gap-2 align-items-start "+(z&&!S?"justify-content-center":""),children:[e.icon,D&&e.label]}),D&&(0,u.jsx)(l.i3,{isOpen:N===n,children:(0,u.jsx)(d.pte,{})})]})}),N===n&&D&&(0,u.jsxs)(l.rI,{children:[(0,u.jsx)("hr",{className:"my-2"}),null===(a=e.dropdown)||void 0===a?void 0:a.map(((e,n)=>{const a=T.pathname===e.href;return(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(o.N_,{title:e.label,to:e.href,className:"sidebar d-flex align-items-start gap-2 "+(a?"active":""),children:[e.icon,e.label]})},n)})),"modules"===e.dynamicDropdownKey&&(0,u.jsxs)(u.Fragment,{children:[y.map(((e,n)=>{const a="DATAROOM AND DUE DILIGENCE"===e.name?"/dataroom-Duediligence":`/moduleone/${e.id}`,t=T.pathname===a;return(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(o.N_,{title:e.name,to:a,className:"sidebar d-flex align-items-start gap-2 "+(t?"active":""),children:[(0,u.jsx)(h.MO3,{size:16}),e.name]})},n)})),(0,u.jsx)("li",{className:"list-none",children:(0,u.jsxs)(o.N_,{title:"VIDEO CONTENT: Investor Presentation Structure\r - Expert Advice Video",to:"/advicevideos",className:"sidebar d-flex align-items-start gap-2 "+("/advicevideos"===T.pathname?"active":""),children:[(0,u.jsx)(h.xi0,{size:16}),"VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"]})})]})]})]}):(0,u.jsxs)(o.N_,{to:e.href,title:e.label,className:`sidebar d-flex align-items-start gap-2 ${t?"active":""} ${z&&!S?"justify-content-center":""}`,children:[e.icon,D&&e.label]})},n)}))})}),(0,u.jsx)("div",{className:"d-flex  align-items-end gap-2 h-100 "+(z?"justify-content-center":"justify-content-end"),children:(0,u.jsx)(o.N_,{title:"Logout",to:"javascript:void(0)",onClick:()=>{localStorage.removeItem("InvestorData"),window.location.href="/investor/login"},className:"logout_investor_global ",children:(0,u.jsx)(s.QeK,{width:14})})})]}),(0,u.jsx)("style",{jsx:!0,children:"\n        .main_sidenav {\n          transition: width 0.3s ease;\n        }\n\n        .main_sidenav.collapsed {\n          width: 80px;\n        }\n\n        .main_sidenav.collapsed .logo {\n          display: flex;\n          justify-content: center;\n        }\n      "})]})}},62837:(e,n,a)=>{a.d(n,{$K:()=>i,CB:()=>o,Cd:()=>g,I0:()=>c,Jq:()=>x,R3:()=>v,Zw:()=>m,dN:()=>f,hJ:()=>b,jh:()=>d,mO:()=>r,mg:()=>l,nj:()=>j,pd:()=>N,uM:()=>h,vE:()=>s,z6:()=>p});var t=a(5464);const r=t.default.div`
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
`,s=t.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,i=(t.default.div`
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
`),l=t.default.div`
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
`,o=t.default.div`
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
`),f=((0,t.default)(u)`
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
`),b=t.default.div`
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
`,j=t.default.button`
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
`,N=t.default.input`
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
//# sourceMappingURL=9592.ad2b7842.chunk.js.map