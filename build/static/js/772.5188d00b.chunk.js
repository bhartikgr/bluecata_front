/*! For license information please see 772.5188d00b.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[772],{41680:(e,a,n)=>{n.d(a,{A:()=>i});const i=(0,n(77784).A)("file-text",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]])},62837:(e,a,n)=>{n.d(a,{$K:()=>s,CB:()=>o,Cd:()=>b,I0:()=>d,Jq:()=>h,R3:()=>j,Zw:()=>p,dN:()=>x,hJ:()=>f,jh:()=>c,mO:()=>t,mg:()=>r,nj:()=>y,pd:()=>v,uM:()=>u,vE:()=>l,z6:()=>m});var i=n(5464);const t=i.default.div`
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
`,l=i.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,s=(i.default.div`
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
`,i.default.div`
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
`,i.default.div`
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
`,i.default.div`
  display: block;
  height: 100%;
`),r=i.default.div`
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
`,o=i.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=i.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=i.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,m=i.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,p=i.default.div`
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
`,h=(i.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,i.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,i.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,i.default.div`
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
`),u=(i.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,i.default.div`
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
`),g=(i.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,i.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,i.default.div`
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
`,i.default.button`
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
`,i.default.div`
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
`,i.default.video`
  background-color: black;
  border: none;
`,i.default.div`
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
`,i.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,i.default.button`
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
`),x=((0,i.default)(g)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,i.default)(g)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,i.default.sup`
  color: var(--primary);
`),f=i.default.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: ${e=>{let{show:a}=e;return a?"flex":"none"}};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`,b=i.default.div`
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
`,y=i.default.button`
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
`,v=i.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,j=i.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},65877:(e,a,n)=>{n.r(a),n.d(a,{default:()=>N});var i=n(65043),t=n(77266),l=n(42552),s=(n(38421),n(53579)),r=(n(83656),n(86213)),o=n(73216),c=n(26632),d=(n(65016),n(62837)),m=n(24910),p=n(62585),h=(n(9191),n(25581)),u=n(57943),g=n(78384),x=n(76245),f=n(77819),b=n(82054),y=n(70579);function v(e){let{show:a,onClose:n,onAccept:t,companyName:l="Your Company"}=e;const[s,r]=(0,i.useState)(!1),[o,c]=(0,i.useState)("");return a?(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)("div",{className:"modal fade show",style:{display:"block",backgroundColor:"rgba(0, 0, 0, 0.6)",backdropFilter:"blur(4px)"},children:(0,y.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-xl",children:(0,y.jsxs)("div",{className:"modal-content",style:{borderRadius:"20px",border:"none",boxShadow:"0 25px 50px -12px rgba(0, 0, 0, 0.25)",overflow:"hidden"},children:[(0,y.jsx)("div",{style:{background:"linear-gradient(135deg, #FF3E41 0%, #FF3E41 100%)",padding:"24px 32px",borderBottom:"1px solid rgba(255, 62, 65, 0.25)"},children:(0,y.jsxs)("div",{className:"d-flex justify-content-between align-items-center",children:[(0,y.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[(0,y.jsx)("div",{style:{width:"48px",height:"48px",background:"rgba(255, 62, 65, 0.25)",borderRadius:"12px",display:"flex",alignItems:"center",justifyContent:"center"},children:(0,y.jsx)(g.A,{size:28,color:"#FF3E41"})}),(0,y.jsxs)("div",{children:[(0,y.jsx)("h4",{style:{margin:0,fontSize:"1.75rem",fontWeight:"700",color:"#fff",letterSpacing:"-0.5px"},children:"ACKNOWLEDGEMENT"}),(0,y.jsx)("p",{style:{color:"rgba(255,255,255,0.7)",margin:"4px 0 0 0",fontSize:"0.95rem"},children:"Signatory Designation"})]})]}),(0,y.jsx)("button",{onClick:n,style:{background:"rgba(255,255,255,0.1)",border:"none",cursor:"pointer",width:"40px",height:"40px",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s"},onMouseEnter:e=>e.target.style.background="rgba(255,255,255,0.2)",onMouseLeave:e=>e.target.style.background="rgba(255,255,255,0.1)",children:(0,y.jsx)(x.A,{size:20,color:"#fff"})})]})}),(0,y.jsxs)("div",{style:{padding:"32px"},children:[(0,y.jsxs)("div",{style:{border:"1px solid #e9ecef",borderRadius:"16px",overflow:"hidden"},children:[(0,y.jsx)("div",{style:{background:"#f8f9fa",padding:"16px 24px",borderBottom:"1px solid #e9ecef",borderLeft:"4px solid #FF3E41"},children:(0,y.jsx)("h5",{style:{margin:0,fontWeight:"700",fontSize:"1.1rem",color:"#212529",textTransform:"uppercase",letterSpacing:"0.5px"},children:"COPY SIGNATORY"})}),(0,y.jsxs)("div",{style:{padding:"24px"},children:[(0,y.jsxs)("p",{style:{fontSize:"1rem",color:"#212529",marginBottom:"20px",lineHeight:"1.6"},children:["You are being designated as a ",(0,y.jsxs)("strong",{children:["Signatory for ",(0,y.jsx)("span",{style:{color:"#FF3E41"},children:l})]})," on the Capavate platform, operated by BluePrint Catalyst Limited."]}),(0,y.jsx)("p",{style:{fontWeight:"600",marginBottom:"16px",color:"#212529"},children:"As a Signatory, you acknowledge and agree that:"}),(0,y.jsx)("ul",{style:{paddingLeft:"20px",marginBottom:"24px"},children:[`You are authorised by <strong>${l}</strong> to act in this capacity, including managing fundraising rounds, inviting investors via the CRM, confirming investments, and updating the cap table.`,`All actions you take as a Signatory are legally binding on <strong>${l}</strong> and are your sole responsibility.`,"You will not use this role to transmit information that is false, misleading, defamatory, or in violation of applicable securities law.","Capavate and BluePrint Catalyst Limited act solely as a technology platform and bear no liability whatsoever for your actions or decisions as Signatory, including any errors, omissions, or disputes arising therefrom.",'This designation is governed by the <strong><a href="https://capavate.com/privacy-policy" target="_blank" rel="noopener noreferrer" style="color: #FF3E41; text-decoration: underline;">Capavate Platform Terms</a></strong> and the laws of Hong Kong SAR.'].map(((e,a)=>(0,y.jsxs)("li",{style:{marginBottom:"12px",color:"#495057",lineHeight:"1.6",fontSize:"0.95rem",position:"relative",paddingLeft:"8px"},children:[(0,y.jsx)("span",{style:{color:"#FF3E41",fontWeight:"bold",marginRight:"8px"},children:"\u2022"}),(0,y.jsx)("span",{dangerouslySetInnerHTML:{__html:e}})]},a)))}),(0,y.jsxs)("div",{style:{background:"#f8f9fa",borderRadius:"12px",padding:"20px",border:o?"1px solid #FF3E41":"1px solid #e9ecef",boxShadow:o?"0 0 0 3px rgba(255, 62, 65, 0.1)":"none"},children:[(0,y.jsxs)("div",{className:"form-check",style:{paddingLeft:"32px"},children:[(0,y.jsx)("input",{type:"checkbox",className:"form-check-input",id:"signatoryConfirm",checked:s,onChange:e=>{r(e.target.checked),e.target.checked&&c("")},style:{width:"20px",height:"20px",marginLeft:"-32px",cursor:"pointer",accentColor:"#FF3E41"}}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"signatoryConfirm",style:{cursor:"pointer",fontSize:"0.95rem",color:"#212529",lineHeight:"1.5"},children:(0,y.jsxs)("strong",{children:["I confirm I am authorised to act as Signatory for ",(0,y.jsx)("span",{style:{color:"#FF3E41"},children:l})," and accept full responsibility for all actions taken under this role."]})})]}),o&&(0,y.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:"8px",marginTop:"12px",color:"#FF3E41",fontSize:"0.9rem"},children:[(0,y.jsx)(f.A,{size:16}),(0,y.jsx)("span",{children:o})]})]})]})]}),(0,y.jsxs)("div",{style:{display:"flex",gap:"16px",justifyContent:"flex-end",marginTop:"32px"},children:[(0,y.jsx)("button",{type:"button",onClick:n,style:{padding:"12px 28px",borderRadius:"10px",border:"1px solid #dee2e6",background:"#fff",color:"#495057",fontSize:"0.95rem",fontWeight:"500",cursor:"pointer",transition:"all 0.2s"},onMouseEnter:e=>{e.target.style.background="#f8f9fa",e.target.style.borderColor="#ced4da"},onMouseLeave:e=>{e.target.style.background="#fff",e.target.style.borderColor="#dee2e6"},children:"Cancel"}),(0,y.jsxs)("button",{type:"button",onClick:()=>{s?(c(""),t()):c("Please confirm that you are authorised to act as Signatory")},style:{padding:"12px 32px",borderRadius:"10px",border:"none",background:s?"linear-gradient(135deg, #FF3E41 0%, #E03537 100%)":"#FF3E41",color:"#fff",fontSize:"0.95rem",fontWeight:"600",cursor:s?"pointer":"not-allowed",opacity:s?1:.5,transition:"all 0.2s",display:"flex",alignItems:"center",gap:"8px",boxShadow:s?"0 4px 12px rgba(255, 62, 65, 0.3)":"none"},disabled:!s,onMouseEnter:e=>{s&&(e.target.style.background="linear-gradient(135deg, #E03537 0%, #C03032 100%)",e.target.style.transform="translateY(-1px)",e.target.style.boxShadow="0 6px 16px rgba(255, 62, 65, 0.4)")},onMouseLeave:e=>{s&&(e.target.style.background="linear-gradient(135deg, #FF3E41 0%, #E03537 100%)",e.target.style.transform="translateY(0)",e.target.style.boxShadow="0 4px 12px rgba(255, 62, 65, 0.3)")},children:[(0,y.jsx)(b.A,{size:18}),"Accept & Activate Signatory Role"]})]})]})]})})}),(0,y.jsx)("div",{className:"modal-backdrop fade show",onClick:n,style:{position:"fixed",top:0,left:0,width:"100%",height:"100%",backgroundColor:"rgba(0, 0, 0, 0.6)",zIndex:1040}})]}):null}var j=n(30007);function N(){var e;const a=localStorage.getItem("OwnerLoginData"),n=JSON.parse(a),g=h.J+"api/user/",x=h.J+"api/user/company/";var f=h.J+"api/user/capitalround/";document.title="Add Company";const[b,N]=(0,i.useState)(!1),[_,k]=(0,i.useState)(""),[C,S]=(0,i.useState)(""),w=(0,i.useRef)(null),[F,A]=(0,i.useState)(!1),[E,O]=(0,i.useState)(0),[P,L]=(0,i.useState)(0),[q,z]=(0,i.useState)(0),[Y,M]=(0,i.useState)(!0),[T,W]=(0,i.useState)(!1),[I,R]=(0,i.useState)(!1),[D,V]=(0,i.useState)(!1),[B,H]=(0,i.useState)(""),[J,K]=(0,i.useState)(!1),[U,$]=(0,i.useState)(!1),[G,Z]=(0,i.useState)({phone:"",city_step2:"",unit_number:"",company_street_address:"",company_industory:"",company_name:"",year_registration:"",company_website:"",employee_number:"",company_linkedin:"",descriptionStep4:"",problemStep4:"",solutionStep4:"",company_state:"",company_postal_code:"",company_country:"",company_email:"",jurisdiction_country:"",entity_structure:"",mailing_address:"",office_address:"",articles:"",articles_files:"",business_number:"",entity_name:"",jurisdiction:""}),[Q,X]=(0,i.useState)(""),[ee,ae]=(0,i.useState)(!1),ne=(0,o.Zp)(),[ie,te]=(0,i.useState)([]),le={Argentina:["SA (Sociedad An\xf3nima)","SRL (Sociedad de Responsabilidad Limitada)","SCS","SCA","Cooperative","Sole Proprietorship"],Australia:["Pty Ltd","Public Company","Sole Trader","Trust","Incorporated Association","Cooperative","Indigenous Corporation"],Austria:["GmbH","AG","OG (General Partnership)","KG (Limited Partnership)","Verein (Association)","Stiftung (Foundation)"],Belgium:["SA/NV","SRL/BV","Cooperative Society","ASBL/VZW (Nonprofit)","Partnership","Sole Proprietorship"],Brazil:["LTDA","SA (open/closed)","MEI (Microentrepreneur)","EIRELI","S.A.S.","Cooperative","Sole Proprietorship"],Canada:["Corporation","Sole Proprietorship","Partnership","Cooperative","Not-for-Profit","Trust","ULC (Unlimited Liability)"],Chile:["SRL","SA","SpA (Simplified Joint Stock)","EIRL (Individual Limited Liability)","Cooperative"],China:["LLC","Company Limited by Shares","WFOE (Wholly Foreign-Owned Enterprise)","JV","Sole Proprietorship"],Colombia:["SA","SAS","SRL","SCA","SCS","Cooperative","Simplified Stock Company"],"Czech Republic":["s.r.o.","a.s.","v.o.s.","k.s.","Cooperative","Foundation","Sole Proprietorship"],Denmark:["ApS","A/S","I/S","K/S","Cooperative","Foundation"],Egypt:["Joint Stock Company","LLC","Partnership","Sole Proprietorship","Cooperative"],Estonia:["O\xdc (Private Limited)","AS (Public Limited)","T\xdc (General Partnership)","U\xdc (Limited Partnership)","MT\xdc (Nonprofit)"],Finland:["Oy","Oyj","Ay","Ky","Cooperative","Foundation"],France:["SARL","SA","SAS","SNC","SCS","SCOP (Worker Co-op)","Association","Foundation"],Germany:["GmbH","AG","OHG","KG","e.V. (Nonprofit)","Stiftung","KGaA (Limited Partnership with Shares)"],Greece:["AE","EPE","OE","EE","Cooperative","Nonprofit Association"],"Hong Kong":["Ltd","Sole Proprietorship","Partnership","NGO"],Hungary:["Kft","Rt","Bt","Kkt","Cooperative","Foundation"],India:["Pvt Ltd","Public Ltd","LLP","OPC (One Person Company)","Section 8 Company (Nonprofit)","Trust","Society"],Indonesia:["PT","CV","Firm","Cooperative","Foundation"],Ireland:["Ltd","PLC","DAC","CLG","ULC","Sole Trader","Partnership"],Israel:["Ltd","Partnership","Cooperative Society","Amutah (Nonprofit)"],Italy:["S.p.A.","S.r.l.","S.a.s.","S.n.c.","Cooperative","Foundation"],Japan:["KK (Kabushiki Kaisha)","GK (Godo Kaisha)","NPO","Tokumei Kumiai (Silent Partnership)","Foundation"],Kenya:["Ltd","PLC","Partnership","Sole Proprietorship","NGO","Cooperative"],Luxembourg:["S\xe0rl","SA","SCA","SCSp","Cooperative","Foundation"],Malaysia:["Sdn Bhd","Berhad","LLP","Sole Proprietorship","Cooperative"],Mexico:["S.A. de C.V.","S. de R.L. de C.V.","S.C.","A.C.","Cooperative"],Netherlands:["BV","NV","VOF","CV","Stichting (Foundation)","Cooperative"],"New Zealand":["Ltd","Partnership","Trust","Incorporated Society"],Nigeria:["Ltd","PLC","Business Name","Incorporated Trustees","Cooperative"],Norway:["AS","ASA","ANS","DA","Cooperative","Foundation"],Pakistan:["Pvt Ltd","Public Ltd","Partnership","Sole Proprietorship","NGO"],Peru:["SA","SAC","SRL","Cooperative"],Philippines:["Corporation","Partnership","Sole Proprietorship","Cooperative"],Poland:["Sp. z o.o.","S.A.","S.C.","S.J.","Cooperative","Foundation"],Portugal:["Lda","SA","S.C.","Cooperative","Foundation"],Romania:["SRL","SA","SNC","SCS","Cooperative","Foundation"],Russia:["OOO","AO","IP","Non-commercial Organization","Foundation"],"Saudi Arabia":["LLC","Joint Stock Company","Sole Proprietorship","Cooperative"],Singapore:["Pte Ltd","Ltd","LLP","Sole Proprietorship","VCC (Variable Capital Company -- Funds)","Cooperative"],"South Africa":["Pty Ltd","CC","NPC (Nonprofit)","Sole Proprietor","Cooperative"],"South Korea":["Yuhan Hoesa (Ltd)","Chusik Hoesa (Corp)","Hapja Hoesa (LP)","Cooperative"],Spain:["SA","SL","S.C.","S.Coop","Foundation","Association"],Sweden:["AB","HB","KB","Enskild Firma","Cooperative","Foundation"],Switzerland:["AG","GmbH","Kollektivgesellschaft","Kommanditgesellschaft","Stiftung","Verein"],Thailand:["Ltd","Partnership","Sole Proprietorship","Cooperative"],Turkey:["A.\u015e.","Ltd. \u015eti.","Kollektif \u015eirket","Komandit \u015eirket","Cooperative","Foundation"],Ukraine:["TOV","AT","PP","Cooperative","Foundation"],"United Arab Emirates":["LLC","PJSC","Sole Establishment","Free Zone Company","Offshore Company"],"United Kingdom":["Ltd","PLC","LLP","Sole Trader","CIC","CIO","Charitable Trust"],"United States":["LLC","C Corp","S Corp","B Corp","L3C","Series LLC","Sole Proprietorship","Partnership","501(c)(3)","REIT","PC (Professional Corp)"]},[se,re]=(0,i.useState)(G.jurisdiction_country||""),[oe,ce]=(0,i.useState)(G.entity_type||""),[de,me]=(0,i.useState)("");(0,i.useEffect)((()=>{pe(),he()}),[]);const pe=async()=>{let e={investor_id:""};try{const a=await r.A.post(f+"getIndustryExpertise",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});te(a.data.results)}catch(a){}},he=async()=>{let e={user_id:n.id};try{const a=await r.A.post(g+"getUserAcknowlegment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(a.data),0===a.data.results.length&&(K(!0),$(!0)),H(a.data.results)}catch(a){}};(0,i.useEffect)((()=>{ge()}),[]),(0,i.useEffect)((()=>{ue()}),[]);const ue=async()=>{const e={user_id:n.id};try{const a=await r.A.post(x+"getUserOwnerDetail",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});a.data.results.length>0&&X(a.data.results[0])}catch(a){console.error("Error generating summary",a)}},ge=async()=>{let e={user_id:n.id};try{const a=await r.A.post(g+"getcompanydetail",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});S(a.data.results[0])}catch(a){console.error("Error fetching company details:",a)}},[xe,fe]=(0,i.useState)(!1),[be,ye]=(0,i.useState)(null),[ve,je]=(0,i.useState)({strategic_priorities:[],interested_in:[],seeking_partners:[],not_consider:[],competitors:[{name:"",url:"",reason:""},{name:"",url:"",reason:""},{name:"",url:"",reason:""}],isPubliclyTraded:"",board_of_directors:"",ongoing_disputes:"",regulatory_compliance:"",legal_representation:"",law_firm_name:"",legal_referral:"",legal_compliance_review:"",accounting_firm:"",accounting_firm_name:"",accounting_referral:"",audited_financials:"",saas_model:"",holds_ip:"",operating_geographies:[],customer_segments:[],exclusivity_clauses:"",dependence_risk:"",long_term_contracts:"",readiness_reason:"",value_proposition:"",live_summary:""}),Ne=(e,a,n)=>{je((i=>({...i,[e]:n?[...i[e],a]:i[e].filter((e=>e!==a))})))},_e=(e,a,n)=>{const i=[...ve.competitors];i[e][a]=n,je((e=>({...e,competitors:i})))},ke=(e,a)=>{je((n=>({...n,[e]:a})))},Ce=(e,a)=>{je((n=>({...n,[e]:a})))},[Se,we]=(0,i.useState)({isFounder:"",isCeo:"",isPresident:"",firstName:"",lastName:"",email:"",phone:"",linkedIn:"",signatureRole:""}),Fe=e=>!!new RegExp("^(https?:\\/\\/)?((([a-zA-Z0-9\\-])+\\.)+[a-zA-Z]{2,})(\\:[0-9]{1,5})?(\\/.*)?$","i").test(e),[Ae,Ee]=(0,i.useState)("");(0,i.useEffect)((()=>{Oe()}),[]);const Oe=async()=>{try{const e=await r.A.post(g+"getallcountry",G,{headers:{Accept:"application/json","Content-Type":"application/json"}});Qe(e.data.results)}catch(e){}},[Pe,Le]=(0,i.useState)([{first_name:"",last_name:"",email:"",confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:"",isFounder:""}]),[qe,ze]=(0,i.useState)(Pe.map((()=>({emailMatch:""})))),Ye=(e,a)=>{let{name:n,value:i}=a.target;n.startsWith("isFounder")&&(n="isFounder");const t=[...Pe];t[e][n]=i;const l=[...qe];if(l[e]||(l[e]={}),"signatory_email"===n||"signatory_confirm_email"===n){const a=t[e].signatory_email,n=t[e].signatory_confirm_email;l[e].emailMatch=a&&n&&a!==n?"Emails do not match!":""}if("signatory_email"===n&&!t[e].isCurrentUser){const a=t.map(((e,a)=>({email:e.signatory_email,index:a}))),n=a.filter(((e,n)=>e.email&&a.findIndex((a=>a.email===e.email))!==n));n.length>0?l[e].emailMatch="Email must be unique!":t[e].signatory_email===t[e].signatory_confirm_email&&(l[e].emailMatch="")}"signature_role"===n&&"Other"!==i&&(t[e].other_role=""),Le(t),ze(l)},[Me,Te]=(0,i.useState)("");(0,i.useEffect)((()=>{if("Yes"===Me){if(!Pe.some((e=>e.isCurrentUser))){const e={first_name:Q.first_name||"",last_name:Q.last_name||"",signatory_email:Q.email||"",signatory_confirm_email:Q.email||"",linked_in:"",phone:Q.phone_number||"",signature_role:"Chief Executive Officer (CEO) \u2013 Visionary and strategic leader",other_role:"",isCurrentUser:!0};Le([e]),ze([{emailMatch:""}])}}else"No"===Me&&(Le([{first_name:"",last_name:"",signatory_email:"",signatory_confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:"",isCurrentUser:!1}]),ze([{emailMatch:""}]))}),[Me,Q]);const[We,Ie]=(0,i.useState)({emailMatch:""}),[Re,De]=(0,i.useState)([]),[Ve,Be]=(0,i.useState)(null),[He,Je]=(0,i.useState)(""),[Ke,Ue]=(0,i.useState)(""),[$e,Ge]=(0,i.useState)(!0),[Ze,Qe]=(0,i.useState)([]),[Xe,ea]=(0,i.useState)(""),[aa,na]=(0,i.useState)([]),ia=Ze.map((e=>({value:e.code,label:e.name}))),ta=Ze.map((e=>({value:e.name,label:e.name}))),la=e=>{const{name:a,value:n}=e.target;Z((e=>({...e,[a]:n}))),"email"!==a&&"confirm_email"!==a||("email"===a&&n!==G.confirm_email||"confirm_email"===a&&n!==G.email?Ie((e=>({...e,emailMatch:"Emails do not match."}))):Ie((e=>({...e,emailMatch:""}))))},[sa,ra]=(0,i.useState)(!1);return(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)(s.mO,{children:(0,y.jsx)("div",{className:"fullpage d-block",children:(0,y.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,y.jsx)(l.A,{isCollapsed:sa,setIsCollapsed:ra}),(0,y.jsxs)("div",{className:"global_view "+(sa?"global_view_col":""),children:[(0,y.jsx)(t.A,{}),(0,y.jsx)(s.$K,{className:"d-block p-md-4 p-3",children:(0,y.jsxs)("div",{className:"container-fluid",children:[_&&(0,y.jsx)("div",{className:""+(b?" mt-3 error_pop":"success_pop mt-3"),children:_}),(0,y.jsxs)("div",{className:"profile-card",children:[Y&&(0,y.jsx)("div",{className:"profile-header",children:(0,y.jsxs)("div",{className:"d-flex align-items-center justify-content-between gap-3 w-100",children:[(0,y.jsxs)("div",{className:"d-flex align-items-center justify-content-start gap-2",children:[(0,y.jsx)("div",{className:"profile-icon",children:(0,y.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,y.jsx)("path",{d:"M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"}),(0,y.jsx)("path",{d:"M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z"})]})}),(0,y.jsx)("div",{className:"profile-title",children:(0,y.jsx)("h2",{children:"Company Contact Info"})})]}),(0,y.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"1/4"})]})}),(0,y.jsx)("div",{className:"profile-content",children:(0,y.jsxs)("div",{className:"row g-3",children:[(0,y.jsx)("div",{className:"col-12 m-0 p-0",children:Y&&(0,y.jsxs)("form",{onSubmit:()=>{if(""!==G.company_website){if(!Fe(G.company_website))return w.current.scrollIntoView({behavior:"smooth",block:"center"}),void A(!0);A(!1)}W(!0),M(!1)},method:"post",action:"javascript:void(0)",children:[(0,y.jsxs)("div",{className:"row g-3",children:[(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"company_name",className:"label_fontWeight",children:["Name of Company"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{value:G.company_name,required:!0,type:"text",name:"company_name",id:"company_name",onChange:la,className:"form-control",placeholder:"Enter company name"})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"company_name",className:"label_fontWeight",children:["Company Email"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{value:G.company_email,required:!0,type:"text",name:"company_email",id:"company_email",onChange:la,className:"form-control",placeholder:"Enter company email"})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"Industry",className:"label_fontWeight",children:["Industry ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{id:"Industry",value:G.company_industory,className:"form-select",onChange:la,name:"company_industory",required:!0,children:[(0,y.jsx)("option",{value:"",children:"Industry"}),ie.map(((e,a)=>(0,y.jsx)("option",{value:e.value||e.name,children:e.name},a)))]})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"phone",className:"label_fontWeight",children:["Phone ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)(c.Ay,{required:!0,value:G.phone,name:"phone",defaultCountry:"CA",onChange:e=>{Z({...G,phone:e}),e&&e.replace(/\D/g,"").length<10?Ee("Phone number must be at least 10 digits"):Ee("")},className:"phonregister form-control",placeholder:"Enter phone number"}),Ae&&(0,y.jsx)("small",{style:{color:"red"},children:Ae})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"company_website",className:"label_fontWeight",children:["Company Website / URL"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{ref:w,type:"text",required:!0,value:G.company_website,onChange:la,name:"company_website",id:"company_website",className:"form-control",placeholder:"Enter your company url"}),F&&(0,y.jsx)("div",{style:{fontSize:"13px"},className:"text-danger fw-semibold",children:"Please enter valid website url (eg:www.domain.com)"})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"employee_number",className:"label_fontWeight",children:["Number of Employees"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{required:!0,onChange:la,defaultValue:G.employee_number,name:"employee_number",id:"employee_number",className:"form-select",children:[(0,y.jsx)("option",{value:"",children:"Select employee count range"}),(0,y.jsx)("option",{value:"1-10",children:"1-10 employees"}),(0,y.jsx)("option",{value:"11-50",children:"11-50 employees"}),(0,y.jsx)("option",{value:"51-200",children:"51-200 employees"}),(0,y.jsx)("option",{value:"201-500",children:"201-500 employees"}),(0,y.jsx)("option",{value:"501-1000",children:"501-1000 employees"}),(0,y.jsx)("option",{value:"1000+",children:"1000+ employees"})]})]}),(0,y.jsxs)("div",{className:"col-6",children:[(0,y.jsxs)("label",{style:{fontWeight:"600",fontSize:"1rem"},children:["Date of Incorporation/Registration"," ",(0,y.jsx)("span",{className:"required",children:"*"}),(0,y.jsx)("span",{className:"tooltip-icon","data-tooltip-id":"tt-cat-1","data-tooltip-html":'\n                                        <div class="d-flex flex-column gap-1 tip-content">\n                                          <ul style="margin:0; padding-left:15px;">\n                                            <li>Must match article of incorporation</li>\n                                          </ul>\n                                        </div>\n                                      ',children:(0,y.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip",style:{cursor:"pointer"}})}),(0,y.jsx)(u.m_,{id:"tt-cat-1",place:"top",effect:"solid",clickable:!0,delayShow:200,delayHide:100,className:"custom-tooltip"})]}),(0,y.jsxs)("div",{className:"form-group mb-3",children:[(0,y.jsx)("input",{type:"text",required:!0,placeholder:"MM/DD/YYYY",defaultValue:G.year_registration?(()=>{const e=new Date(G.year_registration);return`${String(e.getMonth()+1).padStart(2,"0")}/${String(e.getDate()).padStart(2,"0")}/${e.getFullYear()}`})():"",name:"year_registration",id:"year_registration",className:"form-control",maxLength:10,onChange:e=>{const a=e.target,n=a.selectionStart;let i=a.value.replace(/\D/g,"").slice(0,8),t=i;i.length>2&&(t=i.slice(0,2)+"/"+i.slice(2)),i.length>4&&(t=i.slice(0,2)+"/"+i.slice(2,4)+"/"+i.slice(4)),a.value=t;t.length,a.value.length;a.setSelectionRange(t.length,t.length);const l=t.split("/");if(3===l.length&&4===l[2].length){const[e,a,n]=l,i=new Date(`${n}-${e}-${a}`);isNaN(i.getTime())||Z((e=>({...e,year_registration:i.toISOString()})))}}}),(0,y.jsxs)("small",{className:"text-muted d-block mt-1",children:["Format: ",(0,y.jsx)("strong",{children:"MM/DD/YYYY"})]})]})]}),(0,y.jsxs)("div",{className:"col-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["One-sentence headliner about the company"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("textarea",{required:!0,id:"description",name:"descriptionStep4",className:"form-control",maxLength:"400",value:G.descriptionStep4,onChange:e=>{const a=e.target.value,{name:n,value:i}=e.target;Z((e=>({...e,[n]:i}))),O(a.length)},placeholder:"Max 400 characters..."}),(0,y.jsxs)("div",{className:"char-count",children:[E,"/400"]})]}),(0,y.jsxs)("div",{className:"col-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["What problem are you solving?"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("textarea",{required:!0,id:"problem",name:"problemStep4",className:"form-control",maxLength:"600",value:G.problemStep4,onChange:e=>{const a=e.target.value,{name:n,value:i}=e.target;Z((e=>({...e,[n]:i}))),L(a.length)},placeholder:"Max 600 characters..."}),(0,y.jsxs)("div",{className:"char-count",children:[P,"/600"]})]}),(0,y.jsxs)("div",{className:"col-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["What is Your Solution to the Problem?"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("textarea",{required:!0,id:"solution",name:"solutionStep4",className:"form-control",maxLength:"600",value:G.solutionStep4,onChange:e=>{const a=e.target.value,{name:n,value:i}=e.target;Z((e=>({...e,[n]:i}))),z(a.length)},placeholder:"Max 600 characters..."}),(0,y.jsxs)("div",{className:"char-count",children:[q,"/600"]})]})]}),(0,y.jsx)("div",{className:"col-12",children:(0,y.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,y.jsx)("div",{className:"flex-shrink-0"}),(0,y.jsx)("div",{className:"d-flex flex-row flex-shrink-0 gap-2",children:(0,y.jsx)("button",{type:"submit",className:"global_btn px-4 py-2 fn_size_sm active d-flex align-items-center gap-2",children:"Next"})})]})})]})}),(0,y.jsx)("div",{className:"col-12 m-0 p-0",children:T&&(0,y.jsx)(y.Fragment,{children:(0,y.jsxs)("form",{onSubmit:e=>{e.preventDefault();const a=[...qe];let n=!1;Pe.forEach(((e,i)=>{a[i]||(a[i]={});const t=e.signatory_email,l=e.signatory_confirm_email;if(t&&l&&t!==l?(a[i].emailMatch="Emails do not match!",n=!0):a[i].emailMatch="",!e.isCurrentUser){const e=Pe.map((e=>e.signatory_email)).filter((e=>e&&e===t));e.length>1&&(a[i].emailMatch="Email must be unique!",n=!0)}(e.phone||"").replace(/\D/g,"").length<10?(a[i].phone="Phone number must be at least 10 digits",n=!0):a[i].phone=""})),ze(a),n||(W(!1),R(!0))},method:"post",action:"javascript:void(0)",children:[(0,y.jsx)("div",{className:"row g-3",children:(0,y.jsx)("div",{className:"d-flex flex-column gap-3 my-4",children:(0,y.jsxs)("div",{className:"d-flex justify-content-between gap-2 pt-3 align-items-start",children:[(0,y.jsxs)("div",{className:"flex-grow-1 d-flex flex-column gap-2",children:[(0,y.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"2/4"}),(0,y.jsx)("h4",{children:"Signatories for the Company"}),(0,y.jsx)("p",{className:"text-muted mb-0",style:{fontSize:"14px",lineHeight:"1.4"},children:"Signatories are the only users on the platform with the legal authority to bind the company to contracts and agreements. They have exclusive access to create, edit, delete, and confirm capital raise rounds, maintaining full control over the company's fundraising activities. These permissions are not available to any other users."})]}),(0,y.jsx)("button",{type:"button",onClick:()=>{if(Pe.length>=3)return N(!0),k("You can only add up to three signatories total."),void setTimeout((()=>{k(""),N(!1)}),3e3);const e=Pe.map((e=>e.signatory_email)).filter(Boolean),a=new Set(e);if(e.length!==a.size)return N(!0),k("Please make sure all existing emails are unique before adding a new signatory."),void setTimeout((()=>{k(""),N(!1)}),3e3);Le([...Pe,{first_name:"",last_name:"",signatory_email:"",signatory_confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:"",isFounder:"",isCurrentUser:!1}]),ze([...qe,{emailMatch:""}])},className:"global_btn w-fit",style:{flexShrink:0},children:"+ Add A New Signatory"})]})})}),(0,y.jsxs)("div",{className:"col-md-6 mb-4 ",children:[(0,y.jsxs)("label",{htmlFor:"formally_legally",className:"label_fontWeight pb-2",children:["Can you formally/legally initiate a new round of investment on behalf of this company? ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)(d.z6,{id:"companyStage",children:[(0,y.jsxs)(d.Zw,{children:[(0,y.jsx)("input",{type:"radio",name:"formally_legally",required:!0,value:"Yes",onChange:e=>Te(e.target.value),id:"concept",checked:"Yes"===Me}),(0,y.jsx)("label",{htmlFor:"concept",children:"Yes"})]}),(0,y.jsxs)(d.Zw,{children:[(0,y.jsx)("input",{type:"radio",name:"formally_legally",value:"No",onChange:e=>Te(e.target.value),id:"planning5",required:!0,checked:"No"===Me}),(0,y.jsx)("label",{htmlFor:"planning5",children:"No"})]})]}),"Yes"===Me&&(0,y.jsx)("div",{className:"alert alert-info mt-2",children:(0,y.jsx)("small",{children:(0,y.jsx)("strong",{children:"\u2713 You have been automatically added as the primary signatory."})})})]}),Pe.map(((e,a)=>{var n,i;return(0,y.jsxs)("div",{className:"d-flex flex-column gap-4 mb-4",children:[e.isCurrentUser&&(0,y.jsxs)("div",{className:"alert alert-success",children:[(0,y.jsx)("strong",{children:"Primary Signatory (You)"})," ","- Auto-populated from your profile"]}),(0,y.jsxs)("div",{className:"row gy-3",style:{border:"1px solid #e5e7eb",borderRadius:"8px",padding:"20px",backgroundColor:e.isCurrentUser?"#f8f9fa":"#fff"},children:[(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["First Name"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{type:"text",name:"first_name",value:e.first_name,onChange:e=>Ye(a,e),placeholder:"Enter first name",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Last Name"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{type:"text",name:"last_name",value:e.last_name,onChange:e=>Ye(a,e),placeholder:"Enter last name",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Email"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{type:"email",name:"signatory_email",value:e.signatory_email,onChange:e=>Ye(a,e),placeholder:"Enter email",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Confirm Email"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{type:"email",name:"signatory_confirm_email",value:e.signatory_confirm_email,onChange:e=>Ye(a,e),placeholder:"Confirm email",className:"form-control",required:!0,disabled:e.isCurrentUser}),(null===(n=qe[a])||void 0===n?void 0:n.emailMatch)&&(0,y.jsx)("div",{className:"text-danger text-start fw-semibold",style:{fontSize:"13px"},children:qe[a].emailMatch})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsx)("label",{className:"label_fontWeight",children:"LinkedIn Profile"}),(0,y.jsx)("input",{type:"text",name:"linked_in",value:e.linked_in,onChange:e=>Ye(a,e),placeholder:"Enter LinkedIn profile URL",className:"form-control"})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Phone Number"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)(c.Ay,{required:!0,name:"signatory_phone",defaultCountry:"CA",value:e.phone,onChange:e=>((e,a)=>{const n=[...Pe];n[e].phone=a,Le(n);const i=[...qe];(a?a.replace(/\D/g,"").length:0)<10?i[e]={...i[e],phone:"Phone number must be at least 10 digits"}:i[e]&&delete i[e].phone,ze(i)})(a,e),className:"phonregister form-control",placeholder:"Enter phone number"}),(null===(i=qe[a])||void 0===i?void 0:i.phone)&&(0,y.jsx)("div",{className:"text-danger text-start fw-semibold",style:{fontSize:"13px"},children:qe[a].phone})]}),(0,y.jsxs)("div",{className:"col-md-12",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Role"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{name:"signature_role",value:e.signature_role,onChange:e=>Ye(a,e),className:"form-select",required:!0,children:[(0,y.jsx)("option",{value:"",children:"Choose Role"}),(0,y.jsx)("option",{value:"President",children:"President"}),(0,y.jsx)("option",{value:"Chief Executive Officer (CEO) \u2013 Visionary and strategic leader",children:"Chief Executive Officer (CEO) \u2013 Visionary and strategic leader"}),(0,y.jsx)("option",{value:"Chief Operating Officer (COO) \u2013 Oversees daily operations",children:"Chief Operating Officer (COO) \u2013 Oversees daily operations"}),(0,y.jsx)("option",{value:"Chief Financial Officer (CFO) \u2013 Manages finances and fundraising",children:"Chief Financial Officer (CFO) \u2013 Manages finances and fundraising"}),(0,y.jsx)("option",{value:"Chief Investment Officer (CIO) \u2013 Manages engagements with investors and shareholders",children:"Chief Investment Officer (CIO) \u2013 Manages engagements with investors and shareholders"}),(0,y.jsx)("option",{value:"Chief Technology Officer (CTO) \u2013 Leads product and tech development",children:"Chief Technology Officer (CTO) \u2013 Leads product and tech development"}),(0,y.jsx)("option",{value:"Chief Marketing Officer (CMO) \u2013 Drives brand and customer acquisition",children:"Chief Marketing Officer (CMO) \u2013 Drives brand and customer acquisition"}),(0,y.jsx)("option",{value:"Chief Product Officer (CPO) \u2013 Owns product strategy and roadmap",children:"Chief Product Officer (CPO) \u2013 Owns product strategy and roadmap"}),(0,y.jsx)("option",{value:"Chief Revenue Officer (CRO) \u2013 Focuses on sales and revenue growth",children:"Chief Revenue Officer (CRO) \u2013 Focuses on sales and revenue growth"}),(0,y.jsx)("option",{value:"Chief People Officer (CPO) \u2013 Builds company culture and HR strategy",children:"Chief People Officer (CPO) \u2013 Builds company culture and HR strategy"}),(0,y.jsx)("option",{value:"Legal Counsel \u2013 Advises on contracts, IP, and compliance",children:"Legal Counsel \u2013 Advises on contracts, IP, and compliance"}),(0,y.jsx)("option",{value:"Advisory Board Member \u2013 Expert advisor guiding strategy, growth, and investor relations",children:"Advisory Board Member \u2013 Expert advisor guiding strategy, growth, and investor relations"}),(0,y.jsx)("option",{value:"Other",children:"Other"})]})]}),(0,y.jsxs)("div",{className:"col-md-12",children:[(0,y.jsxs)("label",{className:"label_fontWeight d-block mb-2",children:["Are you a founder of the company? ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("div",{className:"d-flex gap-3",children:[(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:`isFounder_${a}`,id:`isFounderYes_${a}`,value:"YES",checked:"YES"===e.isFounder,onChange:e=>Ye(a,e)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:`isFounderYes_${a}`,children:"Yes"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:`isFounder_${a}`,id:`isFounderNo_${a}`,value:"NO",checked:"NO"===e.isFounder,onChange:e=>Ye(a,e)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:`isFounderNo_${a}`,children:"No"})]})]})]}),"Other"===e.signature_role&&(0,y.jsxs)("div",{className:"col-md-12",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Please specify role"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{type:"text",name:"other_role",value:e.other_role,onChange:e=>Ye(a,e),placeholder:"Enter specific role",className:"form-control",required:!0})]}),(0,y.jsx)("div",{className:"col-md-12 d-flex justify-content-end",children:!e.isCurrentUser&&Pe.length>1&&(0,y.jsx)("button",{type:"button",className:"btn btn-danger",onClick:()=>(e=>{const a=Pe.filter(((a,n)=>n!==e));Le(a)})(a),children:"Remove Signatory"})})]})]},a)})),(0,y.jsx)("div",{className:"col-12",children:(0,y.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,y.jsx)("div",{className:"flex-shrink-0",children:(0,y.jsx)("button",{type:"button",className:"global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"3",onClick:()=>{W(!1),M(!0)},children:"Back"})}),(0,y.jsx)("div",{className:"flex-shrink-0",children:(0,y.jsx)("button",{type:"submit",className:"global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"4",children:"Next"})})]})})]})})}),(0,y.jsx)("div",{className:"col-12 m-0 p-0",children:I&&(0,y.jsx)(y.Fragment,{children:(0,y.jsxs)("form",{onSubmit:e=>{e.preventDefault(),R(!1),V(!0)},method:"post",action:"javascript:void(0)",children:[(0,y.jsxs)("div",{className:"row g-3",children:[(0,y.jsx)("div",{className:"col-md-12 mt-5",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"3/4"}),(0,y.jsx)("label",{htmlFor:"",children:(0,y.jsx)("h4",{children:"Company Mailing Address"})})]})}),(0,y.jsx)("div",{className:"col-md-6",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Street"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{value:G.company_street_address,onChange:la,name:"company_street_address",required:!0,id:"",className:"form-control",placeholder:"Enter here",type:"text"})]})}),(0,y.jsx)("div",{className:"col-md-6",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Country"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{required:!0,value:G.company_country,name:"company_country",onChange:e=>{const a=e.target.value;na([]);const n=e.target.options[e.target.selectedIndex].text;Ge("Aruba"!==n&&"American Samoa"!==n),Je(a),Be(n),Z((a=>({...a,company_country:e.target.value})));const i=m.Ay.getStatesOfCountry(a);De(i)},placeholder:"Select or type a country",className:"form-select",children:[(0,y.jsx)("option",{value:"",children:"Select or type a country"}),ia.map((e=>(0,y.jsx)("option",{value:e.value,children:e.label})))]})]})}),(0,y.jsx)("div",{className:"col-12",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsx)("label",{htmlFor:"unit_number",className:"label_fontWeight",children:"Unit # / Suite / Floor"}),(0,y.jsx)("input",{type:"text",id:"unit_number",name:"unit_number",className:"form-control",placeholder:"e.g. Unit 4B, Suite 200, Floor 3",value:G.unit_number||"",onChange:la})]})}),(0,y.jsx)("div",{className:"col-12",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["State / Province / Territory / District"," ",$e&&(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{className:"form-select",required:!!$e,name:"company_state",value:Xe,onChange:e=>{ea(e.target.value);const a=e.target.value,n=p.A.getCitiesOfState(G.company_country,a),i=Re.find((e=>e.isoCode===a));Ue(a);const t=i?i.name:"";Z((e=>({...e,company_state:t}))),0===n.length?Ge(!1):Ge(!0),na(n)},children:[(0,y.jsx)("option",{value:"",children:"-- Select State --"}),Re.map((e=>(0,y.jsx)("option",{value:e.isoCode,children:e.name},e.isoCode)))]})]})}),(0,y.jsx)("div",{className:"col-md-6",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["City"," ",$e&&(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{required:!!$e,name:"city_step2",value:G.city_step2,onChange:async e=>{const a=e.target.value,n=(G.company_state,G.company_country,G.company_country),i=p.A.getCitiesOfState(n,a);console.log(i),Z((e=>({...e,city_step2:a})))},placeholder:"Select or type a city",className:"form-select",children:[(0,y.jsx)("option",{value:"",children:"Select or type a city"}),aa.map((e=>(0,y.jsx)("option",{value:e.name,children:e.name},e.name)))]})]})}),(0,y.jsx)("div",{className:"col-md-6",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Postal code/Zip"," "]}),(0,y.jsx)("input",{onChange:la,type:"text",value:G.company_postal_code,className:"form-control",name:"company_postal_code",placeholder:"Enter postal code/zip"})]})})]}),(0,y.jsx)("div",{className:"col-12",children:(0,y.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,y.jsx)("div",{className:"flex-shrink-0",children:(0,y.jsx)("button",{type:"button",className:"global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"3",onClick:()=>{R(!1),W(!0)},children:"Back"})}),(0,y.jsx)("div",{className:"flex-shrink-0",children:(0,y.jsx)("button",{type:"submit",className:"global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"4",children:"Next"})})]})})]})})}),(0,y.jsx)("div",{className:"col-12 m-0 p-0",children:D&&(0,y.jsx)(y.Fragment,{children:(0,y.jsxs)("form",{onSubmit:async e=>{var a,i,t,l,s,r,o,c,d;if(e.preventDefault(),ae(!0),""!==G.company_website){if(!Fe(G.company_website))return w.current.scrollIntoView({behavior:"smooth",block:"center"}),M(!0),W(!1),R(!1),V(!1),void A(!0);A(!1)}let m=!1,p=-1;const h=qe.map(((e,a)=>{const n=Pe[a].signatory_email.trim(),i=Pe[a].signatory_confirm_email.trim();let t="";return n&&i&&n!==i&&(t="Emails do not match!"),t&&-1===p&&(p=a,m=!0),{...e,emailMatch:t}}));if(!m){const e=Pe.map((e=>e.signatory_email.trim())).filter(Boolean),a=e.filter(((a,n)=>e.indexOf(a)!==n));a.length>0&&(p=Pe.findIndex((e=>e.signatory_email.trim()&&a.includes(e.signatory_email.trim()))),m=!0,M(!1),W(!0),R(!1),V(!1),Pe.forEach(((e,n)=>{const i=e.signatory_email.trim();i&&a.includes(i)&&(h[n]={...h[n],emailMatch:"Email must be unique!"})})))}if(m){if(ze(h),-1!==p){const e=`signatory_email_${p}`,a=document.getElementById(e);a&&(a.scrollIntoView({behavior:"smooth",block:"center"}),a.focus())}return M(!1),W(!0),R(!1),void ae(!1)}let u={company_name:G.company_name,company_industory:G.company_industory,phone:G.phone,company_email:G.company_email,company_website:G.company_website,employee_number:G.employee_number,year_registration:G.year_registration,formally_legally:Me,unit_number:G.unit_number,company_street_address:G.company_street_address,company_country:Ve,company_state:G.company_state,country_code:He,city_code:"",state_code:Ke,city_step2:G.city_step2,company_postal_code:G.company_postal_code,descriptionStep4:G.descriptionStep4,problemStep4:G.problemStep4,solutionStep4:G.solutionStep4,signatories:Pe,user_id:n.id,strategic_priorities:JSON.stringify(ve.strategic_priorities),interested_in:JSON.stringify(ve.interested_in),seeking_partners:JSON.stringify(ve.seeking_partners),not_consider:JSON.stringify(ve.not_consider),competitor_1_name:(null===(a=ve.competitors[0])||void 0===a?void 0:a.name)||"",competitor_1_url:(null===(i=ve.competitors[0])||void 0===i?void 0:i.url)||"",competitor_1_reason:(null===(t=ve.competitors[0])||void 0===t?void 0:t.reason)||"",competitor_2_name:(null===(l=ve.competitors[1])||void 0===l?void 0:l.name)||"",competitor_2_url:(null===(s=ve.competitors[1])||void 0===s?void 0:s.url)||"",competitor_2_reason:(null===(r=ve.competitors[1])||void 0===r?void 0:r.reason)||"",competitor_3_name:(null===(o=ve.competitors[2])||void 0===o?void 0:o.name)||"",competitor_3_url:(null===(c=ve.competitors[2])||void 0===c?void 0:c.url)||"",competitor_3_reason:(null===(d=ve.competitors[2])||void 0===d?void 0:d.reason)||"",board_of_directors:ve.board_of_directors,isPubliclyTraded:ve.isPubliclyTraded,ongoing_disputes:ve.ongoing_disputes,regulatory_compliance:ve.regulatory_compliance,legal_representation:ve.legal_representation,law_firm_name:ve.law_firm_name,legal_referral:ve.legal_referral,legal_compliance_review:ve.legal_compliance_review,accounting_firm:ve.accounting_firm,accounting_firm_name:ve.accounting_firm_name,accounting_referral:ve.accounting_referral,audited_financials:ve.audited_financials,saas_model:ve.saas_model,holds_ip:ve.holds_ip,operating_geographies:JSON.stringify(ve.operating_geographies),customer_segments:JSON.stringify(ve.customer_segments),exclusivity_clauses:ve.exclusivity_clauses,dependence_risk:ve.dependence_risk,long_term_contracts:ve.long_term_contracts,readiness_reason:ve.readiness_reason,value_proposition:ve.value_proposition,live_summary:ve.live_summary,articles:G.articles,entity_name:G.entity_name,business_number:G.business_number,jurisdiction_country:G.jurisdiction_country,entity_type:G.entity_type,entity_structure:G.entity_structure,office_address:G.office_address,mailing_address:G.mailing_address};ye(u),fe(!0),ae(!1)},method:"post",action:"javascript:void(0)",children:[(0,y.jsxs)("div",{className:"row g-3",children:[(0,y.jsx)("div",{className:"col-md-12 mt-5",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"4/4"}),(0,y.jsx)("label",{htmlFor:"",children:(0,y.jsx)("h4",{children:"Legal Entity Information"})})]})}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"first_name",className:"label_fontWeight",children:["Upload Articles of Incorporation"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{type:"file",name:"articles",id:"articles",className:"form-control",accept:".pdf,.doc,.docx,.jpg,.png",onChange:e=>{const a=e.target.files[0];console.log(a),a&&(me(a.name),Z((e=>({...e,articles:a}))))},required:!de}),(0,y.jsx)("span",{children:de})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"entity_name",className:"label_fontWeight",children:["Legal Entity Name"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{defaultValue:G.entity_name,type:"text",onChange:la,name:"entity_name",placeholder:"Enter here",value:G.entity_name,id:"entity_name",className:"form-control",required:!0})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"entity_name",className:"label_fontWeight",children:["Business Number"," "]}),(0,y.jsx)("input",{onChange:la,defaultValue:G.business_number,type:"text",name:"business_number",value:G.business_number,id:"business_number",className:"form-control",placeholder:"Enter your business number"})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"jurisdiction",className:"label_fontWeight",children:["Jurisdiction of Incorporation"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{required:!0,value:G.jurisdiction_country,name:"jurisdiction_country",onChange:e=>{const a=e.target.value;console.log(a),re(a),ce(""),Z({...G,jurisdiction_country:a,entity_type:""})},placeholder:"Select or type a country",className:"form-select",children:[(0,y.jsx)("option",{value:"",children:"Select or type a country"}),ta.map((e=>(0,y.jsx)("option",{value:e.value,children:e.label})))]})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"entity_type",className:"label_fontWeight",children:["Type of Entity"," ",le[se]&&(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{id:"entity_type",name:"entity_type",className:"form-select",value:oe,onChange:e=>{const a=e.target.value;ce(a),Z({...G,entity_type:a})},disabled:!se,required:!!le[se],children:[(0,y.jsx)("option",{value:"",children:"Select entity type"}),se&&(null===(e=le[se])||void 0===e?void 0:e.map((e=>(0,y.jsx)("option",{value:e,children:e},e))))]})]}),(0,y.jsxs)("div",{className:"col-md-12",children:[(0,y.jsxs)("label",{className:"label_fontWeight d-block mb-2",children:["Is the company traded on a public exchange? ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("div",{className:"d-flex gap-3",children:[(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"isPubliclyTraded",id:"isPubliclyTradedYes",value:"YES",checked:"YES"===ve.isPubliclyTraded,onChange:e=>ke("isPubliclyTraded",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"isPubliclyTradedYes",children:"Yes"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"isPubliclyTraded",id:"isPubliclyTradedNo",value:"NO",checked:"NO"===ve.isPubliclyTraded,onChange:e=>ke("isPubliclyTraded",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"isPubliclyTradedNo",children:"No"})]})]})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"entity_structure",className:"label_fontWeight",children:["Entity Structure"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{required:!0,onChange:la,name:"entity_structure",id:"entity_structure",className:"form-select",defaultValue:G.entity_structure,children:[(0,y.jsx)("option",{value:"",children:"Select"}),(0,y.jsx)("option",{value:"private",children:"Private Corporation"}),(0,y.jsx)("option",{value:"public",children:"Public Corporation"}),(0,y.jsx)("option",{value:"nonprofit",children:"Non Profit"}),(0,y.jsx)("option",{value:"government",children:"Government Organization"})]})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"office_address",className:"label_fontWeight",children:["Registered Office Address"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("textarea",{onChange:la,required:!0,defaultValue:G.office_address,type:"date",name:"office_address",id:"office_address",className:"form-control",placeholder:"Enter office address"})]}),(0,y.jsxs)("div",{className:"col-12 mt-4",children:[(0,y.jsx)("div",{className:"card border-0 shadow-sm mb-4",children:(0,y.jsxs)("div",{className:"card-body p-4",children:[(0,y.jsx)("h4",{className:"fw-bold mb-3",children:"Strategic Intent for Joint Ventures (JV) and Mergers & Acquisitions (M&A)"}),(0,y.jsx)("p",{className:"text-muted mb-2",children:'Determining whether a company is truly "ready" for a joint venture (JV) or merger & acquisition (M&A) requires more than financial performance alone\u2014it reflects strategic alignment, operational maturity, and a clear value narrative. Readiness means the company has robust governance, transparent reporting, and a defined growth story that can withstand the scrutiny of sophisticated partners or acquirers. Engaging an experienced advisory firm with a proven track record, a deep network of qualified buyers and sellers, and an unwavering commitment to integrity is essential. The right advisor not only positions your company effectively but also guides you through complex negotiations with confidence and trust, ensuring every step maximizes long-term value creation.'}),(0,y.jsx)("p",{className:"text-muted mb-2",children:"Please complete the following section transparently to help assess your company's readiness for a JV or M&A transaction, and be sure to update it as your business evolves and pivots over time."}),(0,y.jsx)("p",{className:"mb-0",children:(0,y.jsx)("strong",{children:(0,y.jsx)("em",{children:"NOTE: These are NOT easy questions and will help you better define your strategic direction as you build your company."})})})]})}),(0,y.jsx)("div",{className:"card border-0 shadow-sm mb-4",children:(0,y.jsx)("div",{className:"card-body p-4",children:(0,y.jsx)("textarea",{className:"form-control",rows:"5",placeholder:"",value:ve.live_summary,onChange:e=>Ce("live_summary",e.target.value)})})}),(0,y.jsxs)("div",{className:"card border-0 shadow-sm mb-4",children:[(0,y.jsxs)("div",{className:"card-header bg-white border-bottom py-3 px-4",children:[(0,y.jsx)("h5",{className:"fw-bold mb-0",children:"Strategic Intent for JV's and M&A"}),(0,y.jsx)("small",{className:"text-muted fw-semibold",children:"SECTION 1 \u2014 Strategic Intent"})]}),(0,y.jsxs)("div",{className:"card-body p-4 d-flex flex-column gap-4",children:[(0,y.jsxs)("div",{children:[(0,y.jsx)("label",{className:"label_fontWeight d-block mb-2",children:"What are your top 3 strategic priorities for the next 24 months?"}),(0,y.jsx)("div",{className:"checklistgrid",children:[{value:"Market expansion (geographic or segment growth)",label:"Market expansion (geographic or segment growth)"},{value:"Technology acquisition/product capabilities",label:"Technology acquisition/product capabilities"},{value:"Vertical integration (upstream or downstream)",label:"Vertical integration (upstream or downstream)"},{value:"Cost efficiencies/scale synergies",label:"Cost efficiencies/scale synergies"},{value:"R&D and innovation",label:"R&D and innovation (including new product lines)"},{value:"Talent acquisition / acqui-hire",label:"Talent acquisition / acqui-hire and leadership depth"},{value:"Portfolio diversification",label:"Portfolio diversification/new revenue streams"},{value:"Customer access/distribution",label:"Customer access/distribution partnerships and channels"},{value:"Brand strengthening",label:"Brand strengthening and competitive positioning"},{value:"Risk mitigation",label:"Risk mitigation/supply-chain resilience/regulatory positioning"},{value:"Capital access/partial exit",label:"Capital access/balance-sheet optimization or partial exit for founders"},{value:"NO Intention",label:"NO Intention"}].map(((e,a)=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input intent-check",type:"checkbox",value:e.value,id:`check${a+1}`,checked:ve.strategic_priorities.includes(e.value),onChange:e=>Ne("strategic_priorities",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:`check${a+1}`,children:e.label})]},a)))})]}),(0,y.jsx)("hr",{className:"my-1"}),(0,y.jsxs)("div",{children:[(0,y.jsx)("label",{className:"label_fontWeight d-block mb-2",children:"Are you actively interested in:"}),(0,y.jsx)("div",{className:"checklistgrid",children:[{value:"JV partnerships",label:"JV partnerships"},{value:"Minority strategic investment",label:"Minority strategic investment"},{value:"Majority sale",label:"Majority sale"},{value:"Full exit",label:"Full exit"},{value:"Strategic acquisitions",label:"Strategic acquisitions"}].map(((e,a)=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input intent-check",type:"checkbox",value:e.value,id:`areopt${a+1}`,checked:ve.interested_in.includes(e.value),onChange:e=>Ne("interested_in",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label w-100",htmlFor:`areopt${a+1}`,children:e.label})]},a)))})]}),(0,y.jsx)("hr",{className:"my-1"}),(0,y.jsxs)("div",{children:[(0,y.jsx)("label",{className:"label_fontWeight d-block mb-2",children:"What types of partners are you seeking?"}),(0,y.jsx)("div",{className:"checklistgrid",children:[{value:"Distribution",label:"Distribution"},{value:"Technology",label:"Technology"},{value:"Manufacturing",label:"Manufacturing"},{value:"Co\u2011development",label:"Co\u2011development"},{value:"Capital",label:"Capital"},{value:"Data\u2011sharing",label:"Data\u2011sharing"},{value:"IP\u2011licensing",label:"IP\u2011licensing"},{value:"R&D",label:"R&D"},{value:"Business development",label:"Business development"}].map(((e,a)=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input intent-check",type:"checkbox",value:e.value,id:`opt${a+1}`,checked:ve.seeking_partners.includes(e.value),onChange:e=>Ne("seeking_partners",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label w-100",htmlFor:`opt${a+1}`,children:e.label})]},a)))})]}),(0,y.jsx)("hr",{className:"my-1"}),(0,y.jsxs)("div",{children:[(0,y.jsx)("label",{className:"label_fontWeight d-block mb-2",children:"What would you not consider under any circumstances?"}),(0,y.jsx)("div",{className:"checklistgrid",children:[{value:"Explore all options",label:"We will explore all options"},{value:"Sale of control",label:"Sale of control"},{value:"Exclusivity",label:"Exclusivity"},{value:"Licensing core IP",label:"Licensing core IP"}].map(((e,a)=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input intent-check",type:"checkbox",value:e.value,id:`optPath${a+1}`,checked:ve.not_consider.includes(e.value),onChange:e=>Ne("not_consider",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label w-100",htmlFor:`optPath${a+1}`,children:e.label})]},a)))})]})]})]}),(0,y.jsxs)("div",{className:"card border-0 shadow-sm mb-4",children:[(0,y.jsxs)("div",{className:"card-header bg-white border-bottom py-3 px-4",children:[(0,y.jsx)("h5",{className:"fw-bold mb-0",children:"Competition"}),(0,y.jsx)("small",{className:"text-muted fw-semibold",children:"SECTION 2 \u2014 Top Three Direct Competitors"})]}),(0,y.jsx)("div",{className:"card-body p-4",children:(0,y.jsx)("div",{id:"competitor-section",className:"d-flex flex-column gap-4",children:[0,1,2].map((e=>(0,y.jsxs)("div",{className:"p-3 border rounded bg-light",children:[(0,y.jsxs)("h6",{className:"fw-semibold mb-3 text-muted",children:["Competitor ",e+1]}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsx)("input",{type:"text",className:"form-control",placeholder:"Name of the company",value:ve.competitors[e].name,onChange:a=>_e(e,"name",a.target.value)}),(0,y.jsx)("input",{type:"url",className:"form-control",placeholder:"URL of the company",value:ve.competitors[e].url,onChange:a=>_e(e,"url",a.target.value)}),(0,y.jsx)("textarea",{className:"form-control",maxLength:"400",placeholder:"Why do you believe this is a competitor?",rows:"4",value:ve.competitors[e].reason,onChange:a=>_e(e,"reason",a.target.value)}),(0,y.jsx)("span",{className:"char-limit fs-6 fst-italic text-end text-muted",children:"max 400 characters"})]})]},e)))})})]}),(0,y.jsxs)("div",{className:"card border-0 shadow-sm mb-4",children:[(0,y.jsxs)("div",{className:"card-header bg-white border-bottom py-3 px-4",children:[(0,y.jsx)("h5",{className:"fw-bold mb-0",children:"Strategic Intent for JV's and M&A"}),(0,y.jsx)("small",{className:"text-muted fw-semibold",children:"SECTION 3 \u2014 Corporate Governance"})]}),(0,y.jsxs)("div",{className:"card-body p-4 d-flex flex-column gap-4",children:[[{label:"Do you have a formal Board of Directors or Advisory Board?",name:"board",idY:"boardYes",idN:"boardNo",field:"board_of_directors"},{label:"Are there any ongoing or threatened disputes, litigation, or regulatory investigations?",name:"disputes",idY:"disputeYes",idN:"disputeNo",field:"ongoing_disputes"},{label:"Are you compliant with key regulations in your sector?",name:"compliance",idY:"complianceYes",idN:"complianceNo",field:"regulatory_compliance"},{label:"Have you completed a formal legal/compliance review in the last 24 months?",name:"review",idY:"reviewYes",idN:"reviewNo",field:"legal_compliance_review"},{label:"Have your financials been audited by an independent party?",name:"audit",idY:"auditYes",idN:"auditNo",field:"audited_financials"},{label:"Do you consider your company to be a SaaS or recurring model business?",name:"saas_model",idY:"saasYes",idN:"saasNo",field:"saas_model"},{label:"Do you hold IP?",name:"ip_hold",idY:"ipHoldYes",idN:"ipHoldNo",field:"holds_ip"}].map((e=>{let{label:a,name:n,idY:i,idN:t,field:l}=e;return(0,y.jsxs)("div",{className:"question-block",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight d-block mb-2",children:a}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:n,id:i,value:"YES",checked:"YES"===ve[l],onChange:e=>ke(l,e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:i,children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:n,id:t,value:"NO",checked:"NO"===ve[l],onChange:e=>ke(l,e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:t,children:"NO"})]})]},n)})),(0,y.jsxs)("div",{className:"question-block",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight d-block mb-2",children:"Does your company have legal representation (do you work with a law firm)?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"legal_rep",id:"legalRepYes",value:"YES",checked:"YES"===ve.legal_representation,onChange:e=>ke("legal_representation",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"legalRepYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"legal_rep",id:"legalRepNo",value:"NO",checked:"NO"===ve.legal_representation,onChange:e=>ke("legal_representation",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"legalRepNo",children:"NO"})]}),"YES"===ve.legal_representation&&(0,y.jsxs)("div",{className:"ms-4 mt-2 p-3 border rounded bg-light",children:[(0,y.jsx)("label",{className:"small fw-bold label_fontWeight d-block mb-1",children:"Please indicate the name of your law firm:"}),(0,y.jsx)("input",{type:"text",className:"form-control form-control-sm",placeholder:"Law Firm Name",value:ve.law_firm_name,onChange:e=>Ce("law_firm_name",e.target.value)})]}),"NO"===ve.legal_representation&&(0,y.jsxs)("div",{className:"ms-4 mt-2 p-3 border rounded bg-light",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight d-block mb-2",children:"Would you like us to refer one to you?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"legal_referral",id:"legalRefYes",value:"YES",checked:"YES"===ve.legal_referral,onChange:e=>ke("legal_referral",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"legalRefYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"legal_referral",id:"legalRefNo",value:"NO",checked:"NO"===ve.legal_referral,onChange:e=>ke("legal_referral",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"legalRefNo",children:"NO"})]})]})]}),(0,y.jsxs)("div",{className:"question-block",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight d-block mb-2",children:"Does your company work with an accounting firm?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"accounting",id:"accYes",value:"YES",checked:"YES"===ve.accounting_firm,onChange:e=>ke("accounting_firm",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"accYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"accounting",id:"accNo",value:"NO",checked:"NO"===ve.accounting_firm,onChange:e=>ke("accounting_firm",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"accNo",children:"NO"})]}),"YES"===ve.accounting_firm&&(0,y.jsxs)("div",{className:"ms-4 mt-2 p-3 border rounded bg-light",children:[(0,y.jsx)("label",{className:"small fw-bold label_fontWeight d-block mb-1",children:"Please indicate the name of your accounting firm:"}),(0,y.jsx)("input",{type:"text",className:"form-control form-control-sm",placeholder:"Accounting Firm Name",value:ve.accounting_firm_name,onChange:e=>Ce("accounting_firm_name",e.target.value)})]}),"NO"===ve.accounting_firm&&(0,y.jsxs)("div",{className:"ms-4 mt-2 p-3 border rounded bg-light",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight d-block mb-2",children:"Would you like us to refer one to you?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"acc_referral",id:"accRefYes",value:"YES",checked:"YES"===ve.accounting_referral,onChange:e=>ke("accounting_referral",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"accRefYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"acc_referral",id:"accRefNo",value:"NO",checked:"NO"===ve.accounting_referral,onChange:e=>ke("accounting_referral",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"accRefNo",children:"NO"})]})]})]})]})]}),(0,y.jsxs)("div",{className:"card border-0 shadow-sm mb-4",children:[(0,y.jsxs)("div",{className:"card-header bg-white border-bottom py-3 px-4",children:[(0,y.jsx)("h5",{className:"fw-bold mb-0",children:"Strategic Intent for JV's and M&A"}),(0,y.jsx)("small",{className:"text-muted fw-semibold",children:"SECTION 4 \u2014 Market, Customers, and Contracts"})]}),(0,y.jsxs)("div",{className:"card-body p-4 d-flex flex-column gap-4",children:[(0,y.jsxs)("div",{children:[(0,y.jsx)("label",{className:"label_fontWeight d-block mb-2",children:"In which geographies do you currently operate?"}),(0,y.jsxs)("div",{className:"row",children:[(0,y.jsx)("div",{className:"col-md-6",children:[{id:"g1",label:"Local only (single city/metro area)"},{id:"g2",label:"National only (within one country)"},{id:"g3",label:"North America"},{id:"g4",label:"Latin America"},{id:"g5",label:"South America"},{id:"g6",label:"Western Europe"},{id:"g8",label:"Eastern Europe"},{id:"g9",label:"Middle East"}].map((e=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input",type:"checkbox",id:e.id,value:e.label,checked:ve.operating_geographies.includes(e.label),onChange:e=>Ne("operating_geographies",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:e.id,children:e.label})]},e.id)))}),(0,y.jsx)("div",{className:"col-md-6",children:[{id:"g10",label:"Africa"},{id:"g11",label:"Central Asia"},{id:"g12",label:"South Asia"},{id:"g13",label:"Southeast Asia"},{id:"g14",label:"East Asia (excluding China/Hong Kong)"},{id:"g15",label:"China / Hong Kong"},{id:"g16",label:"Oceania (Australia, NZ, Pacific Islands)"}].map((e=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input",type:"checkbox",id:e.id,value:e.label,checked:ve.operating_geographies.includes(e.label),onChange:e=>Ne("operating_geographies",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:e.id,children:e.label})]},e.id)))})]})]}),(0,y.jsx)("hr",{className:"my-1"}),(0,y.jsxs)("div",{children:[(0,y.jsx)("label",{className:"label_fontWeight d-block mb-2",children:"What are your primary customer segments?"}),(0,y.jsx)("div",{className:"d-flex flex-wrap gap-3",children:[{id:"c1",label:"Enterprise"},{id:"c2",label:"SMB"},{id:"c3",label:"Consumer"},{id:"c4",label:"Government"},{id:"c5",label:"Specific verticals"}].map((e=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input",type:"checkbox",id:e.id,value:e.label,checked:ve.customer_segments.includes(e.label),onChange:e=>Ne("customer_segments",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:e.id,children:e.label})]},e.id)))})]}),(0,y.jsx)("hr",{className:"my-1"}),(0,y.jsxs)("div",{className:"question-block",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight d-block mb-2",children:"Do you have any exclusivity, non-compete, or most-favored-nation (MFN) clauses with key customers, suppliers, or channel partners that could restrict a JV/M&A?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"exclusivity",id:"ex1",value:"YES",checked:"YES"===ve.exclusivity_clauses,onChange:e=>ke("exclusivity_clauses",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"ex1",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"exclusivity",id:"ex2",value:"NO",checked:"NO"===ve.exclusivity_clauses,onChange:e=>ke("exclusivity_clauses",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"ex2",children:"NO"})]})]}),(0,y.jsxs)("div",{className:"question-block",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight d-block mb-2",children:"Are there significant dependence risks (e.g., more than 30% of revenue from a single customer or supplier)?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"risk",id:"rk1",value:"YES",checked:"YES"===ve.dependence_risk,onChange:e=>ke("dependence_risk",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"rk1",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"risk",id:"rk2",value:"NO",checked:"NO"===ve.dependence_risk,onChange:e=>ke("dependence_risk",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"rk2",children:"NO"})]})]}),(0,y.jsxs)("div",{className:"question-block",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight d-block mb-2",children:"Do you have long-term contracts that would require consent or change-of-control approvals in a transaction?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"contract",id:"ct1",value:"YES",checked:"YES"===ve.long_term_contracts,onChange:e=>ke("long_term_contracts",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"ct1",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"contract",id:"ct2",value:"NO",checked:"NO"===ve.long_term_contracts,onChange:e=>ke("long_term_contracts",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"ct2",children:"NO"})]})]})]})]}),(0,y.jsxs)("div",{className:"card border-0 shadow-sm mb-4",children:[(0,y.jsx)("div",{className:"card-header bg-white border-bottom py-3 px-4",children:(0,y.jsx)("small",{className:"text-muted fw-semibold",children:"SECTION 5 \u2014 Readiness Assessment"})}),(0,y.jsxs)("div",{className:"card-body p-4 d-flex flex-column gap-4",children:[(0,y.jsxs)("div",{children:[(0,y.jsx)("label",{className:"label_fontWeight d-block mb-2",children:"Why do you think your company is ready to engage in a JV or an M&A transaction?"}),(0,y.jsx)("textarea",{className:"form-control",id:"readiness",rows:"3",placeholder:"Enter your response here...",value:ve.readiness_reason,onChange:e=>Ce("readiness_reason",e.target.value)})]}),(0,y.jsxs)("div",{children:[(0,y.jsx)("label",{className:"label_fontWeight d-block mb-2",children:"How clearly can you articulate your unique value proposition versus competitors in one or two sentences, and why would a buyer/partner choose you instead of building or buying elsewhere?"}),(0,y.jsx)("textarea",{className:"form-control",id:"value-prop",rows:"4",maxLength:"800",placeholder:"Enter your response (max 800 characters)...",value:ve.value_proposition,onChange:e=>Ce("value_proposition",e.target.value)}),(0,y.jsx)("div",{className:"form-text text-end fst-italic",children:"max 800 characters"})]})]})]})]})]}),(0,y.jsx)("div",{className:"col-12 mt-4",children:(0,y.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,y.jsx)("div",{className:"flex-shrink-0",children:(0,y.jsx)("button",{type:"button",className:"global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"3",onClick:()=>{V(!1),R(!1),W(!1),R(!0)},children:"Back"})}),(0,y.jsx)("div",{className:"flex-shrink-0",children:(0,y.jsxs)("button",{disabled:ee,style:{opacity:ee?.6:1},type:"submit",className:"global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2",children:["Save",ee&&(0,y.jsx)("div",{className:" spinner-white spinner-border spinneronetimepay m-0",role:"status",children:(0,y.jsx)("span",{className:"visually-hidden"})})]})})]})})]})})})]})})]})]})})]})]})})}),J&&(0,y.jsx)(j.A,{show:J,onClose:()=>{K(!1),$(!1)},onAccept:async()=>{try{const e={user_id:n.id,status:"Yes"},a=await r.A.post(g+"saveCompanyAcknowlegment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(a.data),("1"===a.data.status||a.data.success)&&(H([{acknowledged:!0}]),K(!1),k("Company registration agreement accepted successfully!"),setTimeout((()=>{U&&$(!1),k("")}),2500))}catch(e){console.error("Error saving acknowledgment:",e)}},companyName:""}),(0,y.jsx)(v,{show:xe,onClose:()=>{fe(!1),ye(null)},onAccept:async()=>{fe(!1),ae(!0);try{const e={...be,signatory_acknowledged:"Yes"},a=await r.A.post(`${g}companyaddWithSignatory`,e,{headers:{Accept:"application/json","Content-Type":"multipart/form-data"}});k(a.data.message),"2"===a.data.status?(N(!0),M(!0),W(!1),R(!1)):(N(!1),ge(),setTimeout((()=>{k(""),ne("/user/companylist")}),3e3))}catch(e){k("Error updating profile. Please try again."),N(!0),setTimeout((()=>{k("")}),3e3)}finally{ae(!1),ye(null)}},companyName:G.company_name}),(0,y.jsx)("style",{jsx:!0,children:"\n        .profile-card {\n          background: #fff;\n          border-radius: 16px;\n          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);\n          overflow: hidden;\n        }\n\n        .profile-header {\n          display: flex;\n          align-items: center;\n          padding: 24px 32px;\n          border-bottom: 1px solid #f1f3f4;\n          background: #efefef;\n        }\n\n        .profile-icon {\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          width: 48px;\n          height: 48px;\n          border-radius: 12px;\n          background: linear-gradient(\n            135deg,\n            var(--primary) 0%,\n            var(--primary-icon) 100%\n          );\n          color: white;\n          margin-right: 16px;\n        }\n\n        .profile-title h2 {\n          font-size: 24px;\n          font-weight: 600;\n          color: #0a0a0a;\n          margin: 0 0 4px 0;\n        }\n\n        .profile-title p {\n          color: #6b7280;\n          margin: 0;\n          font-size: 14px;\n        }\n\n        .profile-content {\n          padding: 32px;\n        }\n\n        .form-grid {\n          display: grid;\n          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n          gap: 24px;\n          margin-bottom: 32px;\n        }\n\n        .form-group {\n          display: flex;\n          flex-direction: column;\n        }\n\n        .form-label {\n          font-weight: 500;\n          color: #374151;\n          margin-bottom: 8px;\n          font-size: 14px;\n        }\n\n        .required {\n          color: #f63b3b;\n        }\n\n        .form-input {\n          padding: 12px 16px;\n          border: 1px solid #e5e7eb;\n          border-radius: 8px;\n          font-size: 16px;\n          transition: all 0.2s ease;\n          background: #fff;\n        }\n\n        .form-input:focus {\n          outline: none;\n          border-color: #f63b3b;\n          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);\n        }\n\n        .form-input:disabled {\n          background-color: #f9fafb;\n          color: #6b7280;\n          cursor: not-allowed;\n        }\n\n        .input-note {\n          font-size: 12px;\n          color: #6b7280;\n          margin-top: 4px;\n        }\n\n        .phone-input {\n          padding: 12px 16px;\n          border: 1px solid #e5e7eb;\n          border-radius: 8px;\n          font-size: 16px;\n          width: 100%;\n        }\n\n        .phone-input:focus {\n          outline: none;\n          border-color: #f63b3b;\n          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);\n        }\n\n        .input-with-icon {\n          position: relative;\n          display: flex;\n          align-items: center;\n        }\n\n        .input-icon {\n          position: absolute;\n          left: 12px;\n          color: #6b7280;\n          z-index: 1;\n        }\n\n        .input-with-icon .form-input {\n          padding-left: 40px;\n        }\n\n        .form-actions {\n          display: flex;\n          justify-content: flex-end;\n          border-top: 1px solid #f1f3f4;\n          padding-top: 24px;\n        }\n\n        .btn-primary {\n          display: inline-flex;\n          align-items: center;\n          gap: 8px;\n          background: linear-gradient(135deg, #f63b3b 0%, #e03535 100%);\n          color: white;\n          border: none;\n          border-radius: 8px;\n          padding: 12px 24px;\n          font-size: 16px;\n          font-weight: 500;\n          cursor: pointer;\n          transition: all 0.2s ease;\n        }\n\n        .btn-primary:hover:not(:disabled) {\n          transform: translateY(-2px);\n          box-shadow: 0 4px 12px rgba(246, 59, 59, 0.25);\n        }\n\n        .btn-primary:disabled {\n          opacity: 0.7;\n          cursor: not-allowed;\n          transform: none;\n        }\n\n        .spinner {\n          width: 16px;\n          height: 16px;\n          border: 2px solid rgba(255, 255, 255, 0.3);\n          border-radius: 50%;\n          border-top-color: white;\n          animation: spin 1s ease-in-out infinite;\n        }\n\n        @keyframes spin {\n          to {\n            transform: rotate(360deg);\n          }\n        }\n\n        .alert {\n          padding: 12px 16px;\n          border-radius: 8px;\n          margin-bottom: 24px;\n          font-weight: 500;\n        }\n\n        .alert-success {\n          background-color: #ecfdf5;\n          color: #065f46;\n          border: 1px solid #a7f3d0;\n        }\n\n        .alert-error {\n          background-color: #fef2f2;\n          color: #991b1b;\n          border: 1px solid #fecaca;\n        }\n\n        @media (max-width: 768px) {\n          .profile-header {\n            padding: 20px;\n          }\n\n          .profile-content {\n            padding: 20px;\n          }\n\n          .form-grid {\n            grid-template-columns: 1fr;\n            gap: 20px;\n          }\n\n          .form-actions {\n            justify-content: center;\n          }\n\n          .btn-primary {\n            width: 100%;\n            justify-content: center;\n          }\n        }\n      "})]})}},78384:(e,a,n)=>{n.d(a,{A:()=>i});const i=(0,n(77784).A)("shield-check",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]])},83656:()=>{}}]);
//# sourceMappingURL=772.5188d00b.chunk.js.map