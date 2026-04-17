"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[1161],{62837:(e,t,i)=>{i.d(t,{$K:()=>r,CB:()=>l,Cd:()=>v,I0:()=>c,Jq:()=>h,R3:()=>w,dN:()=>x,hJ:()=>g,jh:()=>d,mO:()=>n,mg:()=>o,nj:()=>f,pd:()=>b,uM:()=>p,vE:()=>s,z6:()=>u});var a=i(5464);const n=a.default.div`
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
`,s=a.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,r=(a.default.div`
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
`),o=a.default.div`
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
`,u=a.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,h=(a.default.div`
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
`),p=(a.default.div`
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
`),x=((0,a.default)(m)`
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
  color: var(--primary);
`),g=a.default.div`
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
`,v=a.default.div`
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
`,f=a.default.button`
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
`,b=a.default.input`
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
`},86621:(e,t,i)=>{i.d(t,{A:()=>j});var a=i(65043),n=i(27879),s=i(70579);const r={SAFE:"\ud83d\udcc4","Convertible Debt":"\ud83d\udcb5","Preferred Equity":"\u2b50","Common Equity":"\ud83d\udcca",Warrants:"\ud83c\udfab","Instrument Comparisons":"\u2696\ufe0f","Investor Reporting":"\ud83d\udcc8","Data Room & Due Diligence":"\ud83d\udd0d","Dilution & Ownership Modeling":"\ud83e\uddee","Fundraising Rounds & Process":"\ud83d\ude80","Valuation Fundamentals":"\ud83d\udc8e","Vesting & Equity Compensation":"\u23f3","Governance & Shareholder Rights":"\ud83c\udfdb\ufe0f","M&A, Exits & Liquidity":"\ud83e\udd1d","Angel Investing Fundamentals":"\ud83d\udc7c","Founder-Investor Relationships":"\ud83e\udd1d","Term Sheet Structure and Fundamentals":"\ud83d\udccb"},o={SAFE:"Simple Agreements for Future Equity \u2014 mechanics, caps, discounts, and conversion.","Convertible Debt":"Convertible notes, interest, maturity, and how debt converts to equity.","Preferred Equity":"Liquidation preferences, anti-dilution, and preferred share structures.","Common Equity":"Ordinary shares, voting rights, and common stock fundamentals.",Warrants:"Warrant mechanics, exercise prices, and strategic use in deal structures.","Instrument Comparisons":"Side-by-side analysis of SAFEs, notes, preferred equity, and more.","Investor Reporting":"What to report, how often, and building trust through transparency.","Data Room & Due Diligence":"Preparing for investor scrutiny \u2014 documents, structure, and best practices.","Dilution & Ownership Modeling":"Modeling ownership changes across rounds, options, and conversions.","Fundraising Rounds & Process":"From pre-seed through Series A+ \u2014 process, timing, and strategy.","Valuation Fundamentals":"Pre-money, post-money, and how valuations are set and negotiated.","Vesting & Equity Compensation":"Vesting schedules, cliffs, ESOPs, and equity-based compensation.","Governance & Shareholder Rights":"Board seats, voting, protective provisions, and shareholder agreements.","M&A, Exits & Liquidity":"Mergers, acquisitions, secondary sales, and paths to liquidity.","Angel Investing Fundamentals":"How angel investing works \u2014 deal flow, evaluation, and portfolio strategy.","Founder-Investor Relationships":"Building trust, managing expectations, and maintaining alignment.","Term Sheet Structure and Fundamentals":"Key terms, clauses, and how to read and negotiate a term sheet."},l={instruments:["SAFE","Convertible Debt","Preferred Equity","Common Equity","Warrants","Instrument Comparisons"],fundraising:["Fundraising Rounds & Process","Valuation Fundamentals","Term Sheet Structure and Fundamentals","Dilution & Ownership Modeling"],operations:["Investor Reporting","Data Room & Due Diligence","Vesting & Equity Compensation","Governance & Shareholder Rights"],strategy:["Angel Investing Fundamentals","Founder-Investor Relationships","M&A, Exits & Liquidity"]},d={instruments:"Equity Instruments",fundraising:"Fundraising & Valuation",operations:"Operations & Governance",strategy:"Relationships & Strategy"},c={instruments:(0,s.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,s.jsx)("path",{d:"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"}),(0,s.jsx)("polyline",{points:"14 2 14 8 20 8"})]}),fundraising:(0,s.jsx)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,s.jsx)("path",{d:"M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"})}),operations:(0,s.jsx)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,s.jsx)("path",{d:"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"})}),strategy:(0,s.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,s.jsx)("path",{d:"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"}),(0,s.jsx)("circle",{cx:"9",cy:"7",r:"4"}),(0,s.jsx)("path",{d:"M23 21v-2a4 4 0 0 0-3-3.87"}),(0,s.jsx)("path",{d:"M16 3.13a4 4 0 0 1 0 7.75"})]})},u={founder:["Fundraising Rounds & Process","SAFE","Valuation Fundamentals","Dilution & Ownership Modeling","Vesting & Equity Compensation","Term Sheet Structure and Fundamentals","Convertible Debt","Data Room & Due Diligence","Founder-Investor Relationships","Investor Reporting"],investor:["Angel Investing Fundamentals","Data Room & Due Diligence","Governance & Shareholder Rights","M&A, Exits & Liquidity","Investor Reporting","Instrument Comparisons","Preferred Equity","SAFE","Convertible Debt","Warrants","Common Equity","Term Sheet Structure and Fundamentals","Valuation Fundamentals"]},h=[{q:"What is a SAFE and how does it work?",cat:"SAFE"},{q:"What is pre-money vs post-money valuation?",cat:"Valuation Fundamentals"},{q:"What is a liquidation preference?",cat:"Preferred Equity"},{q:"How does equity dilution work?",cat:"Dilution & Ownership Modeling"},{q:"What are the key terms in a term sheet?",cat:"Term Sheet Structure and Fundamentals"},{q:"What is a vesting schedule and why does it matter?",cat:"Vesting & Equity Compensation"},{q:"What should a data room include?",cat:"Data Room & Due Diligence"},{q:"What is angel investing?",cat:"Angel Investing Fundamentals"}];function p(e){let{onOpenArticle:t}=e;const i=h.map((e=>{let t=n.n.find((t=>t.category===e.cat&&t.question.toLowerCase().includes(e.q.toLowerCase().slice(0,20))));return t||(t=n.n.find((t=>t.category===e.cat))),t?{...e,article:t}:null})).filter(Boolean);return(0,s.jsxs)("div",{className:"edu-quickstart",children:[(0,s.jsx)("div",{className:"edu-quickstart-header",children:(0,s.jsx)("div",{className:"edu-quickstart-title",children:"Start here"})}),(0,s.jsx)("div",{className:"edu-quickstart-scroll",children:(0,s.jsx)("div",{className:"edu-quickstart-track",children:[...i,...i].map(((e,i)=>(0,s.jsxs)("button",{className:"edu-quickstart-card",onClick:()=>t(e.cat,e.article.question),children:[(0,s.jsxs)("div",{className:"edu-quickstart-cat",children:[r[e.cat]||"\ud83d\udcda"," ",e.cat]}),(0,s.jsx)("div",{className:"edu-quickstart-q",children:e.article.question}),(0,s.jsx)("div",{className:"edu-quickstart-meta",children:"Read answer \u2192"})]},i)))})})]})}function m(e){let{cat:t,onClick:i}=e;const a=r[t.name]||"\ud83d\udcda",n=o[t.name]||"";return(0,s.jsxs)("button",{className:"edu-cat-card",onClick:()=>i(t.name),children:[(0,s.jsx)("div",{className:"edu-cat-icon",children:a}),(0,s.jsxs)("div",{className:"edu-cat-info",children:[(0,s.jsx)("h3",{className:"edu-cat-name",children:t.name}),(0,s.jsx)("p",{className:"edu-cat-desc",children:n})]}),(0,s.jsx)("span",{className:"edu-cat-count",children:t.count}),(0,s.jsx)("svg",{className:"edu-cat-arrow",width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,s.jsx)("path",{d:"M5 12h14M12 5l7 7-7 7"})})]})}function x(e){let{onSelectCategory:t,onSelectPath:i,onOpenArticle:a}=e;return(0,s.jsxs)("div",{id:"view-categories",className:"edu-view edu-view--active",children:[(0,s.jsx)(p,{onOpenArticle:a}),(0,s.jsxs)("div",{className:"edu-paths",children:[(0,s.jsx)("div",{className:"edu-paths-header",children:(0,s.jsxs)("h2",{className:"section-title",children:["Choose your ",(0,s.jsx)("em",{children:"path"})]})}),(0,s.jsx)("div",{className:"edu-paths-grid",children:[{id:"founder",icon:"\ud83d\ude80",label:"I'm a Founder",desc:"Raising capital, structuring rounds, managing your cap table, and keeping investors aligned.",topics:["Fundraising","SAFEs","Valuation","Dilution","Vesting","Term Sheets"],cta:"Explore founder topics"},{id:"investor",icon:"\ud83d\udcbc",label:"I'm an Investor",desc:"Evaluating deals, structuring investments, understanding instruments, and managing portfolios.",topics:["Angel Investing","Due Diligence","Governance","Exits & M&A","Reporting","Instruments"],cta:"Explore investor topics"}].map((e=>(0,s.jsxs)("button",{className:"edu-path-card edu-path-card--"+("founder"===e.id?"founder":"investor"),onClick:()=>i(e.id),children:[(0,s.jsx)("div",{className:"edu-path-icon",children:e.icon}),(0,s.jsx)("div",{className:"edu-path-label",children:e.label}),(0,s.jsx)("p",{className:"edu-path-desc",children:e.desc}),(0,s.jsx)("div",{className:"edu-path-topics",children:e.topics.map((e=>(0,s.jsx)("span",{className:"edu-path-topic",children:e},e)))}),(0,s.jsxs)("div",{className:"edu-path-cta",children:[(0,s.jsx)("span",{children:e.cta}),(0,s.jsx)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,s.jsx)("path",{d:"M5 12h14M12 5l7 7-7 7"})})]})]},e.id)))})]}),(0,s.jsxs)("div",{className:"edu-categories-section",children:[(0,s.jsx)("div",{className:"edu-categories-header",children:(0,s.jsxs)("h2",{className:"section-title",children:["All ",(0,s.jsx)("em",{children:"categories"})]})}),Object.keys(l).map((e=>{const i=l[e].map((e=>n.i.find((t=>t.name===e)))).filter(Boolean);return(0,s.jsxs)("div",{className:"edu-cat-group",children:[(0,s.jsxs)("div",{className:"edu-cat-group-label",children:[c[e],(0,s.jsx)("span",{children:d[e]})]}),(0,s.jsx)("div",{className:"edu-category-grid",children:i.map((e=>(0,s.jsx)(m,{cat:e,onClick:t},e.name)))})]},e)}))]})]})}const g=[{name:"LinkedIn",icon:()=>(0,s.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,s.jsx)("path",{d:"M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"})}),url:(e,t)=>"https://www.linkedin.com/sharing/share-offsite/?url="+t},{name:"X",icon:()=>(0,s.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,s.jsx)("path",{d:"M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"})}),url:(e,t)=>"https://twitter.com/intent/tweet?text="+e+"&url="+t},{name:"Reddit",icon:()=>(0,s.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,s.jsx)("path",{d:"M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 000-.462.342.342 0 00-.462 0c-.545.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.205-.095z"})}),url:(e,t)=>"https://www.reddit.com/submit?url="+t+"&title="+e},{name:"Quora",icon:()=>(0,s.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,s.jsx)("path",{d:"M12.738 18.587c-.926-1.644-2.086-3.32-4.082-3.32-.497 0-1.025.109-1.49.344l-.65-1.3c.893-.737 2.117-1.177 3.553-1.177 2.467 0 3.86 1.259 4.918 2.85.364-1.049.564-2.285.564-3.737 0-5.112-2.237-8.476-6.294-8.476-4.034 0-6.294 3.364-6.294 8.476 0 5.09 2.26 8.398 6.294 8.398 1.318 0 2.45-.348 3.481-1.058zM12.2 24C5.484 24 0 18.627 0 12S5.484 0 12.2 0C18.917 0 24 5.373 24 12s-5.084 12-11.8 12z"})}),url:(e,t)=>"https://www.quora.com/share?url="+t},{name:"Discord",icon:()=>(0,s.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,s.jsx)("path",{d:"M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1569 2.4189z"})}),url:(e,t)=>"https://discord.com/channels/@me"},{name:"Slack",icon:()=>(0,s.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,s.jsx)("path",{d:"M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z"})}),url:(e,t)=>"https://slack.com/"},{name:"WeChat",icon:()=>(0,s.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,s.jsx)("path",{d:"M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm3.68 4.025c-3.655 0-6.622 2.467-6.622 5.51 0 3.044 2.967 5.51 6.622 5.51.424 0 .85-.044 1.271-.118a.67.67 0 01.552.076l1.47.861a.251.251 0 00.129.042c.12 0 .224-.103.224-.228 0-.055-.024-.109-.037-.163l-.301-1.144a.457.457 0 01.165-.514C21.11 19.158 22 17.573 22 15.526c0-3.043-2.967-5.51-6.622-5.51h-.1zm-2.382 2.725c.496 0 .898.407.898.911a.904.904 0 01-.898.91.904.904 0 01-.898-.91c0-.504.402-.911.898-.911zm4.766 0c.496 0 .898.407.898.911a.904.904 0 01-.898.91.904.904 0 01-.898-.91c0-.504.402-.911.898-.911z"})}),url:(e,t)=>"https://web.wechat.com/"},{name:"Weibo",icon:()=>(0,s.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,s.jsx)("path",{d:"M10.098 20.323c-3.977.391-7.414-1.406-7.672-4.02-.259-2.609 2.759-5.047 6.74-5.441 3.979-.394 7.413 1.404 7.671 4.018.259 2.6-2.759 5.049-6.737 5.439l-.002.004zM16.26 8.882c-.21-.664-.876-.99-1.49-.726-.609.266-.93.94-.719 1.596.213.663.88.987 1.488.722.612-.265.932-.939.72-1.592zm1.597-1.147c-.591-1.876-2.462-2.782-4.202-2.024-1.718.748-2.622 2.794-2.022 4.632.593 1.86 2.472 2.772 4.198 2.028 1.74-.748 2.632-2.788 2.026-4.636zM20.2 7.17c-1.098-3.49-4.56-5.168-7.797-3.753-3.197 1.397-4.865 5.19-3.744 8.448a.15.15 0 00.056.075c1.106 3.47 4.554 5.153 7.783 3.76 3.19-1.375 4.858-5.16 3.752-8.435-.012-.032-.032-.064-.05-.095zM4.452 14.2c-.027-.156-.147-.308-.38-.267-.237.04-.358.209-.334.376.024.16.15.31.377.27.237-.039.36-.214.337-.38zm-.69.55c-.09-.15-.273-.218-.413-.154-.136.065-.177.218-.09.37.09.15.271.218.41.158.14-.06.183-.216.093-.374zM20.74 4.157c-1.463-1.857-3.684-2.672-5.577-2.37a.46.46 0 00-.382.528.457.457 0 00.527.382c1.55-.248 3.374.41 4.583 1.943 1.21 1.533 1.46 3.49.825 5.046a.459.459 0 00.258.593.456.456 0 00.594-.258c.783-1.916.48-4.004-.828-5.864z"})}),url:(e,t)=>"https://service.weibo.com/share/share.php?url="+t+"&title="+e}];function v(e){let{articleTitle:t}=e;const i=encodeURIComponent(window.location.href),a=encodeURIComponent(t+" \u2014 Capavate Education");return(0,s.jsxs)("div",{className:"edu-share-bar",children:[(0,s.jsx)("span",{className:"edu-share-label",children:"Share"}),(0,s.jsx)("div",{className:"edu-share-icons",children:g.map((e=>(0,s.jsx)("a",{className:"edu-share-btn",href:e.url(a,i),target:"_blank",rel:"noopener noreferrer",title:`Share on ${e.name}`,"aria-label":`Share on ${e.name}`,children:e.icon()},e.name)))})]})}function f(e){let{article:t,index:i,total:a,onPrev:n,onNext:o,isMobile:l,onMobileBack:d}=e;if(!t)return(0,s.jsx)("div",{className:"edu-reading-pane",id:"edu-reading-pane",children:(0,s.jsxs)("div",{className:"edu-reading-empty",style:{display:"flex"},children:[(0,s.jsxs)("svg",{width:"48",height:"48",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"1.2",opacity:"0.3",children:[(0,s.jsx)("path",{d:"M4 19.5A2.5 2.5 0 016.5 17H20"}),(0,s.jsx)("path",{d:"M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"})]}),(0,s.jsx)("p",{children:"Select an article from the list to start reading."})]})});const c=t.answer.split(/(?<=\.\s)/),u=Math.ceil(c.length/3),h=[];for(let s=0;s<c.length;s+=u)h.push(c.slice(s,s+u).join(""));return(0,s.jsx)("div",{className:"edu-reading-pane"+(l?" edu-reading-pane--visible":""),id:"edu-reading-pane",children:(0,s.jsxs)("div",{className:"edu-reading-article",style:{display:"block"},children:[l&&(0,s.jsxs)("button",{className:"edu-mobile-back",style:{display:"flex"},onClick:d,children:[(0,s.jsx)("svg",{width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,s.jsx)("path",{d:"M19 12H5M12 19l-7-7 7-7"})}),"Back to list"]}),(0,s.jsxs)("div",{className:"edu-reading-nav-top",children:[(0,s.jsxs)("span",{className:"edu-reading-cat",children:[r[t.category]||""," ",t.category]}),(0,s.jsxs)("span",{className:"edu-reading-pos",children:[i+1," of ",a]})]}),(0,s.jsx)("h2",{className:"edu-reading-title",children:t.question}),(0,s.jsx)(v,{articleTitle:t.question}),(0,s.jsx)("div",{className:"edu-reading-body",children:h.map(((e,t)=>(0,s.jsx)("p",{children:e},t)))}),t.capavate_for_you&&(0,s.jsxs)("div",{className:"edu-reading-callout",children:[(0,s.jsx)("div",{className:"edu-reading-callout-bar"}),(0,s.jsxs)("div",{className:"edu-reading-callout-inner",children:[(0,s.jsx)("div",{className:"edu-reading-callout-label",children:"Capavate for you"}),(0,s.jsx)("p",{children:t.capavate_for_you})]})]}),t.tags&&t.tags.length>0&&(0,s.jsx)("div",{className:"edu-reading-tags",children:t.tags.map((e=>(0,s.jsx)("span",{className:"edu-tag",children:e},e)))}),(0,s.jsxs)("div",{className:"edu-reading-nav-bottom",children:[(0,s.jsxs)("button",{className:"edu-nav-btn",onClick:n,style:{visibility:i>0?"visible":"hidden"},children:[(0,s.jsx)("svg",{width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,s.jsx)("path",{d:"M19 12H5M12 19l-7-7 7-7"})}),"Previous"]}),(0,s.jsxs)("button",{className:"edu-nav-btn",onClick:o,style:{visibility:i<a-1?"visible":"hidden"},children:["Next",(0,s.jsx)("svg",{width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,s.jsx)("path",{d:"M5 12h14M12 5l7 7-7 7"})})]})]})]})})}function b(e){let{topbarTitle:t,topbarCount:i,articles:n,onBack:r,onFilterChange:o,filterValue:l}=e;const[d,c]=(0,a.useState)(-1),[u,h]=(0,a.useState)(!1),p=(0,a.useRef)(null);(0,a.useEffect)((()=>{c(-1),h(!1)}),[n]);const m=(0,a.useCallback)((e=>{c(e),window.innerWidth<=768&&h(!0),setTimeout((()=>{var e;const t=null===(e=p.current)||void 0===e?void 0:e.querySelector(".edu-list-item--active");t&&t.scrollIntoView({block:"nearest",behavior:"smooth"})}),50)}),[]);(0,a.useEffect)((()=>{const e=e=>{var t;d<0||"INPUT"!==(null===(t=document.activeElement)||void 0===t?void 0:t.tagName)&&("ArrowUp"!==e.key&&"ArrowLeft"!==e.key||(e.preventDefault(),d>0&&m(d-1)),"ArrowDown"!==e.key&&"ArrowRight"!==e.key||(e.preventDefault(),d<n.length-1&&m(d+1)))};return document.addEventListener("keydown",e),()=>document.removeEventListener("keydown",e)}),[d,n.length,m]);const x=d>=0?n[d]:null;"undefined"!==typeof window&&window.innerWidth;return(0,s.jsxs)("div",{id:"view-detail",className:"edu-view edu-view--active",children:[(0,s.jsxs)("div",{className:"edu-topbar",children:[(0,s.jsxs)("button",{className:"edu-back-btn",onClick:r,children:[(0,s.jsx)("svg",{width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:(0,s.jsx)("path",{d:"M19 12H5M12 19l-7-7 7-7"})}),(0,s.jsx)("span",{children:"All Categories"})]}),(0,s.jsx)("span",{className:"edu-topbar-title",children:t}),(0,s.jsx)("span",{className:"edu-topbar-count",children:i})]}),(0,s.jsxs)("div",{className:"edu-split",children:[(0,s.jsxs)("div",{className:"edu-list-pane"+(u?" edu-list-pane--hidden":""),id:"edu-list-pane",children:[(0,s.jsxs)("div",{className:"edu-list-search",children:[(0,s.jsxs)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,s.jsx)("circle",{cx:"11",cy:"11",r:"8"}),(0,s.jsx)("path",{d:"M21 21l-4.35-4.35"})]}),(0,s.jsx)("input",{type:"text",className:"edu-filter-input",placeholder:"Filter articles...",value:l,onChange:e=>o(e.target.value)})]}),(0,s.jsx)("div",{className:"edu-list-scroll",ref:p,children:0===n.length?(0,s.jsxs)("div",{className:"edu-no-results",children:[(0,s.jsx)("p",{children:"No articles match your filter."}),(0,s.jsx)("button",{className:"edu-clear-filter-btn",onClick:()=>o(""),children:"Clear filter"})]}):(0,s.jsx)("div",{className:"edu-articles-list",children:n.map(((e,t)=>(0,s.jsxs)("button",{className:"edu-list-item"+(t===d?" edu-list-item--active":""),onClick:()=>m(t),children:[(0,s.jsx)("span",{className:"edu-list-num",children:t+1}),(0,s.jsx)("span",{className:"edu-list-question",children:e.question})]},t)))})})]}),(0,s.jsx)(f,{article:x,index:d,total:n.length,onPrev:()=>d>0&&m(d-1),onNext:()=>d<n.length-1&&m(d+1),isMobile:u,onMobileBack:()=>h(!1)})]})]})}function w(){const[e,t]=(0,a.useState)({name:"",email:"",role:"founder",question:""}),[i,n]=(0,a.useState)(!1),[r,o]=(0,a.useState)({}),l=e=>{const{name:i,value:a}=e.target;t((e=>({...e,[i]:a}))),r[i]&&o((e=>({...e,[i]:""})))};return(0,s.jsx)("section",{className:"edu-ask-section",id:"ask",children:(0,s.jsx)("div",{className:"container",children:(0,s.jsxs)("div",{className:"edu-ask-inner",children:[(0,s.jsxs)("div",{className:"edu-ask-text",children:[(0,s.jsx)("div",{className:"section-label",style:{color:"var(--capavate-gold)"},children:"Can't find an answer?"}),(0,s.jsxs)("h2",{className:"section-title",children:["Ask our ",(0,s.jsx)("em",{children:"team directly."})]}),(0,s.jsx)("p",{className:"section-body",children:"Submit your question and our team will respond with a clear, investor-grade answer. The best questions may be added to the knowledge base for everyone."})]}),(0,s.jsxs)("div",{className:"edu-ask-form",children:[(0,s.jsxs)("div",{className:"edu-form-group",children:[(0,s.jsx)("label",{htmlFor:"ask-name",className:"edu-form-label",children:"Your name"}),(0,s.jsx)("input",{type:"text",id:"ask-name",name:"name",className:"edu-form-input"+(r.name?" edu-form-input--error":""),placeholder:"Jane Smith",value:e.name,onChange:l}),r.name&&(0,s.jsx)("span",{className:"edu-form-error",children:r.name})]}),(0,s.jsxs)("div",{className:"edu-form-group",children:[(0,s.jsx)("label",{htmlFor:"ask-email",className:"edu-form-label",children:"Email"}),(0,s.jsx)("input",{type:"email",id:"ask-email",name:"email",className:"edu-form-input"+(r.email?" edu-form-input--error":""),placeholder:"jane@example.com",value:e.email,onChange:l}),r.email&&(0,s.jsx)("span",{className:"edu-form-error",children:r.email})]}),(0,s.jsxs)("div",{className:"edu-form-group",children:[(0,s.jsx)("label",{htmlFor:"ask-role",className:"edu-form-label",children:"I am a..."}),(0,s.jsxs)("select",{id:"ask-role",name:"role",className:"edu-form-select ",value:e.role,onChange:l,children:[(0,s.jsx)("option",{value:"founder",children:"Founder"}),(0,s.jsx)("option",{value:"investor",children:"Investor"}),(0,s.jsx)("option",{value:"advisor",children:"Advisor"}),(0,s.jsx)("option",{value:"other",children:"Other"})]})]}),(0,s.jsxs)("div",{className:"edu-form-group edu-form-group--full",children:[(0,s.jsx)("label",{htmlFor:"ask-question",className:"edu-form-label",children:"Your question"}),(0,s.jsx)("textarea",{id:"ask-question",name:"question",className:"edu-form-input edu-form-textarea"+(r.question?" edu-form-input--error":""),placeholder:"What would you like to know about fundraising, equity, or cap tables?",rows:4,value:e.question,onChange:l}),r.question&&(0,s.jsx)("span",{className:"edu-form-error",children:r.question})]}),!i&&(0,s.jsx)("button",{type:"button",className:"btn btn-primary btn-large edu-ask-submit",onClick:()=>{const i=(()=>{const t={};return e.name.trim()||(t.name="Name is required."),e.email.trim()?/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)||(t.email="Enter a valid email address."):t.email="Email is required.",e.question.trim()||(t.question="Please enter your question."),t})();Object.keys(i).length>0?o(i):(o({}),n(!0),t({name:"",email:"",role:"founder",question:""}),setTimeout((()=>{n(!1)}),3500))},children:"Submit Question \u2192"}),i&&(0,s.jsxs)("div",{className:"edu-ask-success",children:[(0,s.jsx)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,s.jsx)("path",{d:"M20 6L9 17l-5-5"})}),"Question delivered \u2014 our team will review it and get back to you shortly."]})]})]})})})}function j(e){let{section:t=!0}=e;const[i,r]=(0,a.useState)("categories"),[o,l]=(0,a.useState)(""),[d,c]=(0,a.useState)(""),[h,p]=(0,a.useState)([]),[m,g]=(0,a.useState)(""),[v,f]=(0,a.useState)([]),[j,k]=(0,a.useState)(""),[y,N]=(0,a.useState)(!1),C=(0,a.useRef)(null);(0,a.useEffect)((()=>{if(window.location.hash){const e=decodeURIComponent(window.location.hash.slice(1)),t=n.i.find((t=>t.name.toLowerCase().replace(/\s+/g,"-")===e.toLowerCase()));t&&z(t.name)}}),[]);const q=()=>{C.current&&window.scrollTo({top:C.current.offsetTop-80,behavior:"smooth"})},z=e=>{const t=n.n.filter((t=>t.category===e));f(t),p(t),l(e),c(`${t.length} articles`),g(""),r("detail"),q()},M=(0,a.useRef)(null);return(0,s.jsxs)("main",{className:"edu-company-body",children:[(0,s.jsx)("section",{className:"edu-hero",children:(0,s.jsx)("div",{className:"container",children:(0,s.jsxs)("div",{className:"container edu-hero-inner",children:[(0,s.jsxs)("div",{className:"edu-hero-left",children:[(0,s.jsx)("h1",{className:"edu-hero-title",children:"Knowledge Base"}),(0,s.jsx)("div",{className:"edu-hero-meta",children:"660+ articles \xb7 Free & open access"})]}),(0,s.jsx)("div",{className:"edu-hero-right",children:(0,s.jsxs)("div",{className:"edu-search-bar",children:[(0,s.jsxs)("svg",{className:"edu-search-icon",width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,s.jsx)("circle",{cx:"11",cy:"11",r:"8"}),(0,s.jsx)("path",{d:"M21 21l-4.35-4.35"})]}),(0,s.jsx)("input",{type:"text",className:"edu-search-input",placeholder:"Search articles \u2014 try 'valuation cap' or 'dilution'",autoComplete:"off",value:j,onChange:e=>{const t=e.target.value;k(t),N(t.length>0),clearTimeout(M.current),M.current=setTimeout((()=>(e=>{if(!e.trim())return void r("categories");const t=e.toLowerCase(),i=n.n.filter((e=>e.question.toLowerCase().includes(t)||e.answer.toLowerCase().includes(t)||e.tags&&e.tags.some((e=>e.toLowerCase().includes(t)))));f(i),p(i),l(`Search: "${e}"`),c(`${i.length} result${1!==i.length?"s":""}`),g(""),r("detail"),q()})(t)),300)}}),y&&(0,s.jsx)("button",{className:"edu-search-clear","aria-label":"Clear search",onClick:()=>{k(""),N(!1),r("categories")},children:(0,s.jsx)("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:(0,s.jsx)("path",{d:"M18 6L6 18M6 6l12 12"})})})]})})]})})}),(0,s.jsx)("section",{className:"edu-main",ref:C,children:(0,s.jsx)("div",{className:"container",children:"categories"===i?(0,s.jsx)(x,{onSelectCategory:z,onSelectPath:e=>{const t=u[e]||[],i=n.n.filter((e=>t.includes(e.category))),a="founder"===e?"Founder Path":"Investor Path";f(i),p(i),l(a),c(`${i.length} articles`),g(""),r("detail"),q()},onOpenArticle:(e,t)=>{z(e)}}):(0,s.jsx)(b,{topbarTitle:o,topbarCount:d,articles:h,filterValue:m,onFilterChange:e=>{if(g(e),!e.trim())return void p(v);const t=e.toLowerCase();p(v.filter((e=>e.question.toLowerCase().includes(t))))},onBack:()=>{r("categories"),k(""),N(!1),q()}})})}),t&&(0,s.jsx)(w,{})]})}}}]);
//# sourceMappingURL=1161.247e84b7.chunk.js.map