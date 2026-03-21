/*! For license information please see 9632.ef99e7f2.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[9632],{41680:(e,a,n)=>{n.d(a,{A:()=>l});const l=(0,n(77784).A)("file-text",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]])},62837:(e,a,n)=>{n.d(a,{$K:()=>s,CB:()=>o,Cd:()=>b,I0:()=>d,Jq:()=>h,R3:()=>j,Zw:()=>p,dN:()=>g,hJ:()=>f,jh:()=>c,mO:()=>i,mg:()=>r,nj:()=>y,pd:()=>v,uM:()=>u,vE:()=>t,z6:()=>m});var l=n(5464);const i=l.default.div`
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
`,t=l.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,s=(l.default.div`
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
`,l.default.div`
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
`,l.default.div`
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
`,l.default.div`
  display: block;
  height: 100%;
`),r=l.default.div`
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
`,o=l.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=l.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=l.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,m=l.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,p=l.default.div`
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
`,h=(l.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,l.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,l.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,l.default.div`
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
`),u=(l.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,l.default.div`
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
`),x=(l.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,l.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,l.default.div`
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
`,l.default.button`
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
`,l.default.div`
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
`,l.default.video`
  background-color: black;
  border: none;
`,l.default.div`
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
`,l.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,l.default.button`
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
`),g=((0,l.default)(x)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,l.default)(x)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,l.default.sup`
  color: var(--primary);
`),f=l.default.div`
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
`,b=l.default.div`
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
`,y=l.default.button`
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
`,v=l.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,j=l.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},67921:(e,a,n)=>{n.r(a),n.d(a,{default:()=>N});var l=n(65043),i=n(77266),t=n(42552),s=(n(38421),n(53579)),r=(n(83656),n(86213)),o=n(73216),c=n(26632),d=(n(65016),n(62837)),m=n(24910),p=n(62585),h=(n(9191),n(25581)),u=n(57943),x=n(78384),g=n(76245),f=n(77819),b=n(82054),y=n(70579);function v(e){let{show:a,onClose:n,onAccept:i,companyName:t="Your Company"}=e;const[s,r]=(0,l.useState)(!1),[o,c]=(0,l.useState)("");return a?(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)("div",{className:"modal fade show",style:{display:"block",backgroundColor:"rgba(0, 0, 0, 0.6)",backdropFilter:"blur(4px)"},children:(0,y.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-xl",children:(0,y.jsxs)("div",{className:"modal-content",style:{borderRadius:"20px",border:"none",boxShadow:"0 25px 50px -12px rgba(0, 0, 0, 0.25)",overflow:"hidden"},children:[(0,y.jsx)("div",{style:{background:"linear-gradient(135deg, #FF3E41 0%, #FF3E41 100%)",padding:"24px 32px",borderBottom:"1px solid rgba(255, 62, 65, 0.25)"},children:(0,y.jsxs)("div",{className:"d-flex justify-content-between align-items-center",children:[(0,y.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[(0,y.jsx)("div",{style:{width:"48px",height:"48px",background:"rgba(255, 62, 65, 0.25)",borderRadius:"12px",display:"flex",alignItems:"center",justifyContent:"center"},children:(0,y.jsx)(x.A,{size:28,color:"#FF3E41"})}),(0,y.jsxs)("div",{children:[(0,y.jsx)("h4",{style:{margin:0,fontSize:"1.75rem",fontWeight:"700",color:"#fff",letterSpacing:"-0.5px"},children:"ACKNOWLEDGEMENT"}),(0,y.jsx)("p",{style:{color:"rgba(255,255,255,0.7)",margin:"4px 0 0 0",fontSize:"0.95rem"},children:"Signatory Designation"})]})]}),(0,y.jsx)("button",{onClick:n,style:{background:"rgba(255,255,255,0.1)",border:"none",cursor:"pointer",width:"40px",height:"40px",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s"},onMouseEnter:e=>e.target.style.background="rgba(255,255,255,0.2)",onMouseLeave:e=>e.target.style.background="rgba(255,255,255,0.1)",children:(0,y.jsx)(g.A,{size:20,color:"#fff"})})]})}),(0,y.jsxs)("div",{style:{padding:"32px"},children:[(0,y.jsxs)("div",{style:{background:"#f8f9fa",borderRadius:"12px",padding:"16px 20px",marginBottom:"24px",border:"1px solid #e9ecef",borderLeft:"4px solid #FF3E41",display:"flex",alignItems:"flex-start",gap:"12px"},children:[(0,y.jsx)(f.A,{size:20,color:"#FF3E41",style:{flexShrink:0,marginTop:"2px"}}),(0,y.jsxs)("p",{style:{margin:0,color:"#495057",fontSize:"0.95rem",lineHeight:"1.6"},children:[(0,y.jsx)("strong",{children:"Trigger:"})," During company setup when the Account Administrator assigns a user the Signatory role. Presented once per Signatory designated. Must be completed by the user being assigned the role before it takes effect."]})]}),(0,y.jsxs)("div",{style:{border:"1px solid #e9ecef",borderRadius:"16px",overflow:"hidden"},children:[(0,y.jsx)("div",{style:{background:"#f8f9fa",padding:"16px 24px",borderBottom:"1px solid #e9ecef",borderLeft:"4px solid #FF3E41"},children:(0,y.jsx)("h5",{style:{margin:0,fontWeight:"700",fontSize:"1.1rem",color:"#212529",textTransform:"uppercase",letterSpacing:"0.5px"},children:"COPY SIGNATORY"})}),(0,y.jsxs)("div",{style:{padding:"24px"},children:[(0,y.jsxs)("p",{style:{fontSize:"1rem",color:"#212529",marginBottom:"20px",lineHeight:"1.6"},children:["You are being designated as a ",(0,y.jsxs)("strong",{children:["Signatory for ",(0,y.jsx)("span",{style:{color:"#FF3E41"},children:t})]})," on the Capavate platform, operated by BluePrint Catalyst Limited."]}),(0,y.jsx)("p",{style:{fontWeight:"600",marginBottom:"16px",color:"#212529"},children:"As a Signatory, you acknowledge and agree that:"}),(0,y.jsx)("ul",{style:{paddingLeft:"20px",marginBottom:"24px"},children:[`You are authorised by <strong>${t}</strong> to act in this capacity, including managing fundraising rounds, inviting investors via the CRM, confirming investments, and updating the cap table.`,`All actions you take as a Signatory are legally binding on <strong>${t}</strong> and are your sole responsibility.`,"You will not use this role to transmit information that is false, misleading, defamatory, or in violation of applicable securities law.","Capavate and BluePrint Catalyst Limited act solely as a technology platform and bear no liability whatsoever for your actions or decisions as Signatory, including any errors, omissions, or disputes arising therefrom.","This designation is governed by the <strong>Capavate Platform Terms</strong> and the laws of Hong Kong SAR."].map(((e,a)=>(0,y.jsxs)("li",{style:{marginBottom:"12px",color:"#495057",lineHeight:"1.6",fontSize:"0.95rem",position:"relative",paddingLeft:"8px"},children:[(0,y.jsx)("span",{style:{color:"#FF3E41",fontWeight:"bold",marginRight:"8px"},children:"\u2022"}),(0,y.jsx)("span",{dangerouslySetInnerHTML:{__html:e}})]},a)))}),(0,y.jsxs)("div",{style:{background:"#f8f9fa",borderRadius:"12px",padding:"20px",border:o?"1px solid #FF3E41":"1px solid #e9ecef",boxShadow:o?"0 0 0 3px rgba(255, 62, 65, 0.1)":"none"},children:[(0,y.jsxs)("div",{className:"form-check",style:{paddingLeft:"32px"},children:[(0,y.jsx)("input",{type:"checkbox",className:"form-check-input",id:"signatoryConfirm",checked:s,onChange:e=>{r(e.target.checked),e.target.checked&&c("")},style:{width:"20px",height:"20px",marginLeft:"-32px",cursor:"pointer",accentColor:"#FF3E41"}}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"signatoryConfirm",style:{cursor:"pointer",fontSize:"0.95rem",color:"#212529",lineHeight:"1.5"},children:(0,y.jsxs)("strong",{children:["I confirm I am authorised to act as Signatory for ",(0,y.jsx)("span",{style:{color:"#FF3E41"},children:t})," and accept full responsibility for all actions taken under this role."]})})]}),o&&(0,y.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:"8px",marginTop:"12px",color:"#FF3E41",fontSize:"0.9rem"},children:[(0,y.jsx)(f.A,{size:16}),(0,y.jsx)("span",{children:o})]})]})]})]}),(0,y.jsxs)("div",{style:{display:"flex",gap:"16px",justifyContent:"flex-end",marginTop:"32px"},children:[(0,y.jsx)("button",{type:"button",onClick:n,style:{padding:"12px 28px",borderRadius:"10px",border:"1px solid #dee2e6",background:"#fff",color:"#495057",fontSize:"0.95rem",fontWeight:"500",cursor:"pointer",transition:"all 0.2s"},onMouseEnter:e=>{e.target.style.background="#f8f9fa",e.target.style.borderColor="#ced4da"},onMouseLeave:e=>{e.target.style.background="#fff",e.target.style.borderColor="#dee2e6"},children:"Cancel"}),(0,y.jsxs)("button",{type:"button",onClick:()=>{s?(c(""),i()):c("Please confirm that you are authorised to act as Signatory")},style:{padding:"12px 32px",borderRadius:"10px",border:"none",background:s?"linear-gradient(135deg, #FF3E41 0%, #E03537 100%)":"#FF3E41",color:"#fff",fontSize:"0.95rem",fontWeight:"600",cursor:s?"pointer":"not-allowed",opacity:s?1:.5,transition:"all 0.2s",display:"flex",alignItems:"center",gap:"8px",boxShadow:s?"0 4px 12px rgba(255, 62, 65, 0.3)":"none"},disabled:!s,onMouseEnter:e=>{s&&(e.target.style.background="linear-gradient(135deg, #E03537 0%, #C03032 100%)",e.target.style.transform="translateY(-1px)",e.target.style.boxShadow="0 6px 16px rgba(255, 62, 65, 0.4)")},onMouseLeave:e=>{s&&(e.target.style.background="linear-gradient(135deg, #FF3E41 0%, #E03537 100%)",e.target.style.transform="translateY(0)",e.target.style.boxShadow="0 4px 12px rgba(255, 62, 65, 0.3)")},children:[(0,y.jsx)(b.A,{size:18}),"Accept & Activate Signatory Role"]})]})]})]})})}),(0,y.jsx)("div",{className:"modal-backdrop fade show",onClick:n,style:{position:"fixed",top:0,left:0,width:"100%",height:"100%",backgroundColor:"rgba(0, 0, 0, 0.6)",zIndex:1040}})]}):null}var j=n(30007);function N(){const e=localStorage.getItem("OwnerLoginData"),a=JSON.parse(e),n=h.J+"api/user/",x=h.J+"api/user/company/";var g=h.J+"api/user/capitalround/";document.title="Add Company";const[f,b]=(0,l.useState)(!1),[N,_]=(0,l.useState)(""),[k,w]=(0,l.useState)(""),C=(0,l.useRef)(null),[S,E]=(0,l.useState)(!1),[O,F]=(0,l.useState)(0),[q,Y]=(0,l.useState)(0),[z,A]=(0,l.useState)(0),[M,W]=(0,l.useState)(!0),[I,R]=(0,l.useState)(!1),[T,P]=(0,l.useState)(!1),[L,D]=(0,l.useState)(""),[B,H]=(0,l.useState)(!1),[J,V]=(0,l.useState)(!1),[U,$]=(0,l.useState)({phone:"",city_step2:"",company_street_address:"",company_industory:"",company_name:"",year_registration:"",company_website:"",employee_number:"",company_linkedin:"",descriptionStep4:"",problemStep4:"",solutionStep4:"",company_state:"",company_postal_code:"",company_country:"",company_email:""}),[Z,K]=(0,l.useState)(""),[G,Q]=(0,l.useState)(!1),[X,ee]=((0,o.Zp)(),(0,l.useState)([]));(0,l.useEffect)((()=>{ae(),ne()}),[]);const ae=async()=>{let e={investor_id:""};try{const a=await r.A.post(g+"getIndustryExpertise",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});ee(a.data.results)}catch(a){}},ne=async()=>{let e={user_id:a.id};try{const a=await r.A.post(n+"getUserAcknowlegment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(a.data),0===a.data.results.length&&(H(!0),V(!0)),D(a.data.results)}catch(l){}};(0,l.useEffect)((()=>{ie()}),[]),(0,l.useEffect)((()=>{le()}),[]);const le=async()=>{const e={user_id:a.id};try{const a=await r.A.post(x+"getUserOwnerDetail",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});a.data.results.length>0&&K(a.data.results[0])}catch(n){console.error("Error generating summary",n)}},ie=async()=>{let e={user_id:a.id};try{const a=await r.A.post(n+"getcompanydetail",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});w(a.data.results[0])}catch(l){console.error("Error fetching company details:",l)}},[te,se]=(0,l.useState)(!1),[re,oe]=(0,l.useState)(null),[ce,de]=(0,l.useState)({strategic_priorities:[],interested_in:[],seeking_partners:[],not_consider:[],competitors:[{name:"",url:"",reason:""},{name:"",url:"",reason:""},{name:"",url:"",reason:""}],board_of_directors:"",ongoing_disputes:"",regulatory_compliance:"",legal_representation:"",law_firm_name:"",legal_referral:"",legal_compliance_review:"",accounting_firm:"",accounting_firm_name:"",accounting_referral:"",audited_financials:"",saas_model:"",holds_ip:"",operating_geographies:[],customer_segments:[],exclusivity_clauses:"",dependence_risk:"",long_term_contracts:"",readiness_reason:"",value_proposition:"",live_summary:""}),me=(e,a,n)=>{de((l=>({...l,[e]:n?[...l[e],a]:l[e].filter((e=>e!==a))})))},pe=(e,a,n)=>{const l=[...ce.competitors];l[e][a]=n,de((e=>({...e,competitors:l})))},he=(e,a)=>{de((n=>({...n,[e]:a})))},ue=(e,a)=>{de((n=>({...n,[e]:a})))},xe=e=>!!new RegExp("^(https?:\\/\\/)?((([a-zA-Z0-9\\-])+\\.)+[a-zA-Z]{2,})(\\:[0-9]{1,5})?(\\/.*)?$","i").test(e),[ge,fe]=(0,l.useState)("");(0,l.useEffect)((()=>{be()}),[]);const be=async()=>{try{const e=await r.A.post(n+"getallcountry",U,{headers:{Accept:"application/json","Content-Type":"application/json"}});Te(e.data.results)}catch(e){}},[ye,ve]=(0,l.useState)([{first_name:"",last_name:"",email:"",confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:""}]),[je,Ne]=(0,l.useState)(ye.map((()=>({emailMatch:""})))),_e=(e,a)=>{const{name:n,value:l}=a.target,i=[...ye];i[e][n]=l;const t=[...je];if(t[e]||(t[e]={}),"signatory_email"===n||"signatory_confirm_email"===n){const a=i[e].signatory_email,n=i[e].signatory_confirm_email;t[e].emailMatch=a&&n&&a!==n?"Emails do not match!":""}if("signatory_email"===n&&!i[e].isCurrentUser){const a=i.map(((e,a)=>({email:e.signatory_email,index:a}))),n=a.filter(((e,n)=>e.email&&a.findIndex((a=>a.email===e.email))!==n));n.length>0?t[e].emailMatch="Email must be unique!":i[e].signatory_email===i[e].signatory_confirm_email&&(t[e].emailMatch="")}"signature_role"===n&&"Other"!==l&&(i[e].other_role=""),ve(i),Ne(t)},[ke,we]=(0,l.useState)("");(0,l.useEffect)((()=>{if("Yes"===ke){if(!ye.some((e=>e.isCurrentUser))){const e={first_name:Z.first_name||"",last_name:Z.last_name||"",signatory_email:Z.email||"",signatory_confirm_email:Z.email||"",linked_in:"",phone:Z.phone_number||"",signature_role:"Founder and Chief Executive Officer (CEO) \u2013 Visionary and strategic leader",other_role:"",isCurrentUser:!0};ve([e]),Ne([{emailMatch:""}])}}else"No"===ke&&(ve([{first_name:"",last_name:"",signatory_email:"",signatory_confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:"",isCurrentUser:!1}]),Ne([{emailMatch:""}]))}),[ke,Z]);const[Ce,Se]=(0,l.useState)({emailMatch:""}),[Ee,Oe]=(0,l.useState)([]),[Fe,qe]=(0,l.useState)(null),[Ye,ze]=(0,l.useState)(""),[Ae,Me]=(0,l.useState)(""),[We,Ie]=(0,l.useState)(!0),[Re,Te]=(0,l.useState)([]),[Pe,Le]=(0,l.useState)(""),[De,Be]=(0,l.useState)([]),He=Re.map((e=>({value:e.code,label:e.name}))),Je=e=>{const{name:a,value:n}=e.target;$((e=>({...e,[a]:n}))),"email"!==a&&"confirm_email"!==a||("email"===a&&n!==U.confirm_email||"confirm_email"===a&&n!==U.email?Se((e=>({...e,emailMatch:"Emails do not match."}))):Se((e=>({...e,emailMatch:""}))))},[Ve,Ue]=(0,l.useState)(!1);return(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)(s.mO,{children:(0,y.jsx)("div",{className:"fullpage d-block",children:(0,y.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,y.jsx)(t.A,{isCollapsed:Ve,setIsCollapsed:Ue}),(0,y.jsxs)("div",{className:"global_view "+(Ve?"global_view_col":""),children:[(0,y.jsx)(i.A,{}),(0,y.jsx)(s.$K,{className:"d-block p-md-4 p-3",children:(0,y.jsxs)("div",{className:"container-fluid",children:[N&&(0,y.jsx)("div",{className:""+(f?" mt-3 error_pop":"success_pop mt-3"),children:N}),(0,y.jsxs)("div",{className:"profile-card",children:[M&&(0,y.jsx)("div",{className:"profile-header",children:(0,y.jsxs)("div",{className:"d-flex align-items-center justify-content-between gap-3 w-100",children:[(0,y.jsxs)("div",{className:"d-flex align-items-center justify-content-start gap-2",children:[(0,y.jsx)("div",{className:"profile-icon",children:(0,y.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,y.jsx)("path",{d:"M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"}),(0,y.jsx)("path",{d:"M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z"})]})}),(0,y.jsx)("div",{className:"profile-title",children:(0,y.jsx)("h2",{children:"Company Contact Info"})})]}),(0,y.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"1/3"})]})}),(0,y.jsx)("div",{className:"profile-content",children:(0,y.jsxs)("div",{className:"row g-3",children:[(0,y.jsx)("div",{className:"col-12 m-0 p-0",children:M&&(0,y.jsxs)("form",{onSubmit:()=>{if(""!==U.company_website){if(!xe(U.company_website))return C.current.scrollIntoView({behavior:"smooth",block:"center"}),void E(!0);E(!1)}R(!0),W(!1)},method:"post",action:"javascript:void(0)",children:[(0,y.jsxs)("div",{className:"row g-3",children:[(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"company_name",className:"label_fontWeight",children:["Name of Company"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{value:U.company_name,required:!0,type:"text",name:"company_name",id:"company_name",onChange:Je,className:"form-control",placeholder:"Enter company name"})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"company_name",className:"label_fontWeight",children:["Company Email"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{value:U.company_email,required:!0,type:"text",name:"company_email",id:"company_email",onChange:Je,className:"form-control",placeholder:"Enter company email"})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"Industry",className:"label_fontWeight",children:["Industry ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{id:"Industry",value:U.company_industory,className:"form-select",onChange:Je,name:"company_industory",required:!0,children:[(0,y.jsx)("option",{value:"",children:"Industry"}),X.map(((e,a)=>(0,y.jsx)("option",{value:e.value||e.name,children:e.name},a)))]})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"phone",className:"label_fontWeight",children:["Phone ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)(c.Ay,{required:!0,value:U.phone,name:"phone",defaultCountry:"CA",onChange:e=>{$({...U,phone:e}),e&&e.replace(/\D/g,"").length<10?fe("Phone number must be at least 10 digits"):fe("")},className:"phonregister form-control",placeholder:"Enter phone number"}),ge&&(0,y.jsx)("small",{style:{color:"red"},children:ge})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"company_website",className:"label_fontWeight",children:["Company Website / URL"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{ref:C,type:"text",required:!0,value:U.company_website,onChange:Je,name:"company_website",id:"company_website",className:"form-control",placeholder:"Enter your company url"}),S&&(0,y.jsx)("div",{style:{fontSize:"13px"},className:"text-danger fw-semibold",children:"Please enter valid website url (eg:www.domain.com)"})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{htmlFor:"employee_number",className:"label_fontWeight",children:["Number of Employees"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{required:!0,onChange:Je,defaultValue:U.employee_number,name:"employee_number",id:"employee_number",className:"form-select",children:[(0,y.jsx)("option",{value:"",children:"Select employee count range"}),(0,y.jsx)("option",{value:"1-10",children:"1-10 employees"}),(0,y.jsx)("option",{value:"11-50",children:"11-50 employees"}),(0,y.jsx)("option",{value:"51-200",children:"51-200 employees"}),(0,y.jsx)("option",{value:"201-500",children:"201-500 employees"}),(0,y.jsx)("option",{value:"501-1000",children:"501-1000 employees"}),(0,y.jsx)("option",{value:"1000+",children:"1000+ employees"})]})]}),(0,y.jsxs)("div",{className:"col-6",children:[(0,y.jsxs)("label",{style:{fontWeight:"600",fontSize:"1rem"},children:["Date of Incorporation/Registration"," ",(0,y.jsx)("span",{className:"required",children:"*"}),(0,y.jsx)("span",{className:"tooltip-icon","data-tooltip-id":"tt-cat-1","data-tooltip-html":'\n                                        <div class="d-flex flex-column gap-1 tip-content">\n                                          <ul style="margin:0; padding-left:15px;">\n                                            <li>Must match article of incorporation</li>\n                                          </ul>\n                                        </div>\n                                      ',children:(0,y.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip",style:{cursor:"pointer"}})}),(0,y.jsx)(u.m_,{id:"tt-cat-1",place:"top",effect:"solid",clickable:!0,delayShow:200,delayHide:100,className:"custom-tooltip"})]}),(0,y.jsx)("input",{type:"date",required:!0,value:U.year_registration?U.year_registration.split("T")[0]:"",name:"year_registration",id:"year_registration",className:"form-control",placeholder:"Enter here",onChange:e=>{const a=e.target.value,n=a?new Date(a).toISOString():"";$((e=>({...e,year_registration:n})))}})]}),(0,y.jsxs)("div",{className:"col-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["One-sentence headliner about the company"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("textarea",{required:!0,id:"description",name:"descriptionStep4",className:"form-control",maxLength:"400",value:U.descriptionStep4,onChange:e=>{const a=e.target.value,{name:n,value:l}=e.target;$((e=>({...e,[n]:l}))),F(a.length)},placeholder:"Max 400 characters..."}),(0,y.jsxs)("div",{className:"char-count",children:[O,"/400"]})]}),(0,y.jsxs)("div",{className:"col-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["What problem are you solving?"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("textarea",{required:!0,id:"problem",name:"problemStep4",className:"form-control",maxLength:"600",value:U.problemStep4,onChange:e=>{const a=e.target.value,{name:n,value:l}=e.target;$((e=>({...e,[n]:l}))),Y(a.length)},placeholder:"Max 600 characters..."}),(0,y.jsxs)("div",{className:"char-count",children:[q,"/600"]})]}),(0,y.jsxs)("div",{className:"col-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["What is Your Solution to the Problem?"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("textarea",{required:!0,id:"solution",name:"solutionStep4",className:"form-control",maxLength:"600",value:U.solutionStep4,onChange:e=>{const a=e.target.value,{name:n,value:l}=e.target;$((e=>({...e,[n]:l}))),A(a.length)},placeholder:"Max 600 characters..."}),(0,y.jsxs)("div",{className:"char-count",children:[z,"/600"]})]})]}),(0,y.jsx)("div",{className:"col-12",children:(0,y.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,y.jsx)("div",{className:"flex-shrink-0"}),(0,y.jsx)("div",{className:"d-flex flex-row flex-shrink-0 gap-2",children:(0,y.jsx)("button",{type:"submit",className:"global_btn px-4 py-2 fn_size_sm active d-flex align-items-center gap-2",children:"Next"})})]})})]})}),(0,y.jsx)("div",{className:"col-12 m-0 p-0",children:I&&(0,y.jsx)(y.Fragment,{children:(0,y.jsxs)("form",{onSubmit:e=>{e.preventDefault();const a=[...je];let n=!1;ye.forEach(((e,l)=>{a[l]||(a[l]={});const i=e.signatory_email,t=e.signatory_confirm_email;if(i&&t&&i!==t?(a[l].emailMatch="Emails do not match!",n=!0):a[l].emailMatch="",!e.isCurrentUser){const e=ye.map((e=>e.signatory_email)).filter((e=>e&&e===i));e.length>1&&(a[l].emailMatch="Email must be unique!",n=!0)}(e.phone||"").replace(/\D/g,"").length<10?(a[l].phone="Phone number must be at least 10 digits",n=!0):a[l].phone=""})),Ne(a),n||(R(!1),P(!0))},method:"post",action:"javascript:void(0)",children:[(0,y.jsx)("div",{className:"row g-3",children:(0,y.jsx)("div",{className:"d-flex flex-column gap-3 my-4",children:(0,y.jsxs)("div",{className:"d-flex justify-content-between gap-2 pt-3 align-items-start",children:[(0,y.jsxs)("div",{className:"flex-grow-1 d-flex flex-column gap-2",children:[(0,y.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"2/3"}),(0,y.jsx)("h4",{children:"Signatories for the Company"}),(0,y.jsx)("p",{className:"text-muted mb-0",style:{fontSize:"14px",lineHeight:"1.4"},children:"Signatories are the only users on the platform with the legal authority to bind the company to contracts and agreements. They have exclusive access to create, edit, delete, and confirm capital raise rounds, maintaining full control over the company's fundraising activities. These permissions are not available to any other users."})]}),(0,y.jsx)("button",{type:"button",onClick:()=>{if(ye.length>=3)return b(!0),_("You can only add up to three signatories total."),void setTimeout((()=>{_(""),b(!1)}),3e3);const e=ye.map((e=>e.signatory_email)).filter(Boolean),a=new Set(e);if(e.length!==a.size)return b(!0),_("Please make sure all existing emails are unique before adding a new signatory."),void setTimeout((()=>{_(""),b(!1)}),3e3);ve([...ye,{first_name:"",last_name:"",signatory_email:"",signatory_confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:"",isCurrentUser:!1}]),Ne([...je,{emailMatch:""}])},className:"global_btn w-fit",style:{flexShrink:0},children:"+ Add A New Signatory"})]})})}),(0,y.jsxs)("div",{className:"col-md-6 mb-4 ",children:[(0,y.jsxs)("label",{htmlFor:"formally_legally",className:"label_fontWeight pb-2",children:["Can you formally/legally initiate a new round of investment on behalf of this company? ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)(d.z6,{id:"companyStage",children:[(0,y.jsxs)(d.Zw,{children:[(0,y.jsx)("input",{type:"radio",name:"formally_legally",required:!0,value:"Yes",onChange:e=>we(e.target.value),id:"concept",checked:"Yes"===ke}),(0,y.jsx)("label",{htmlFor:"concept",children:"Yes"})]}),(0,y.jsxs)(d.Zw,{children:[(0,y.jsx)("input",{type:"radio",name:"formally_legally",value:"No",onChange:e=>we(e.target.value),id:"planning5",required:!0,checked:"No"===ke}),(0,y.jsx)("label",{htmlFor:"planning5",children:"No"})]})]}),"Yes"===ke&&(0,y.jsx)("div",{className:"alert alert-info mt-2",children:(0,y.jsx)("small",{children:(0,y.jsx)("strong",{children:"\u2713 You have been automatically added as the primary signatory."})})})]}),ye.map(((e,a)=>{var n,l;return(0,y.jsxs)("div",{className:"d-flex flex-column gap-4 mb-4",children:[e.isCurrentUser&&(0,y.jsxs)("div",{className:"alert alert-success",children:[(0,y.jsx)("strong",{children:"Primary Signatory (You)"})," ","- Auto-populated from your profile"]}),(0,y.jsxs)("div",{className:"row gy-3",style:{border:"1px solid #e5e7eb",borderRadius:"8px",padding:"20px",backgroundColor:e.isCurrentUser?"#f8f9fa":"#fff"},children:[(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["First Name"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{type:"text",name:"first_name",value:e.first_name,onChange:e=>_e(a,e),placeholder:"Enter first name",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Last Name"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{type:"text",name:"last_name",value:e.last_name,onChange:e=>_e(a,e),placeholder:"Enter last name",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Email"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{type:"email",name:"signatory_email",value:e.signatory_email,onChange:e=>_e(a,e),placeholder:"Enter email",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Confirm Email"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{type:"email",name:"signatory_confirm_email",value:e.signatory_confirm_email,onChange:e=>_e(a,e),placeholder:"Confirm email",className:"form-control",required:!0,disabled:e.isCurrentUser}),(null===(n=je[a])||void 0===n?void 0:n.emailMatch)&&(0,y.jsx)("div",{className:"text-danger text-start fw-semibold",style:{fontSize:"13px"},children:je[a].emailMatch})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsx)("label",{className:"label_fontWeight",children:"LinkedIn Profile"}),(0,y.jsx)("input",{type:"text",name:"linked_in",value:e.linked_in,onChange:e=>_e(a,e),placeholder:"Enter LinkedIn profile URL",className:"form-control"})]}),(0,y.jsxs)("div",{className:"col-md-6",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Phone Number"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)(c.Ay,{required:!0,name:"signatory_phone",defaultCountry:"CA",value:e.phone,onChange:e=>((e,a)=>{const n=[...ye];n[e].phone=a,ve(n);const l=[...je];(a?a.replace(/\D/g,"").length:0)<10?l[e]={...l[e],phone:"Phone number must be at least 10 digits"}:l[e]&&delete l[e].phone,Ne(l)})(a,e),className:"phonregister form-control",placeholder:"Enter phone number"}),(null===(l=je[a])||void 0===l?void 0:l.phone)&&(0,y.jsx)("div",{className:"text-danger text-start fw-semibold",style:{fontSize:"13px"},children:je[a].phone})]}),(0,y.jsxs)("div",{className:"col-md-12",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Role"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{name:"signature_role",value:e.signature_role,onChange:e=>_e(a,e),className:"form-select",required:!0,children:[(0,y.jsx)("option",{value:"",children:"Choose Role"}),(0,y.jsx)("option",{value:"Founder and Chief Executive Officer (CEO) \u2013 Visionary and strategic leader",children:"Founder and Chief Executive Officer (CEO) \u2013 Visionary and strategic leader"}),(0,y.jsx)("option",{value:"Chief Operating Officer (COO) \u2013 Oversees daily operations",children:"Chief Operating Officer (COO) \u2013 Oversees daily operations"}),(0,y.jsx)("option",{value:"Chief Financial Officer (CFO) \u2013 Manages finances and fundraising",children:"Chief Financial Officer (CFO) \u2013 Manages finances and fundraising"}),(0,y.jsx)("option",{value:"Chief Investment Officer (CIO) \u2013 Manages engagements with investors and shareholders",children:"Chief Investment Officer (CIO) \u2013 Manages engagements with investors and shareholders"}),(0,y.jsx)("option",{value:"Chief Technology Officer (CTO) \u2013 Leads product and tech development",children:"Chief Technology Officer (CTO) \u2013 Leads product and tech development"}),(0,y.jsx)("option",{value:"Chief Marketing Officer (CMO) \u2013 Drives brand and customer acquisition",children:"Chief Marketing Officer (CMO) \u2013 Drives brand and customer acquisition"}),(0,y.jsx)("option",{value:"Chief Product Officer (CPO) \u2013 Owns product strategy and roadmap",children:"Chief Product Officer (CPO) \u2013 Owns product strategy and roadmap"}),(0,y.jsx)("option",{value:"Chief Revenue Officer (CRO) \u2013 Focuses on sales and revenue growth",children:"Chief Revenue Officer (CRO) \u2013 Focuses on sales and revenue growth"}),(0,y.jsx)("option",{value:"Chief People Officer (CPO) \u2013 Builds company culture and HR strategy",children:"Chief People Officer (CPO) \u2013 Builds company culture and HR strategy"}),(0,y.jsx)("option",{value:"Legal Counsel \u2013 Advises on contracts, IP, and compliance",children:"Legal Counsel \u2013 Advises on contracts, IP, and compliance"}),(0,y.jsx)("option",{value:"Advisory Board Member \u2013 Expert advisor guiding strategy, growth, and investor relations",children:"Advisory Board Member \u2013 Expert advisor guiding strategy, growth, and investor relations"}),(0,y.jsx)("option",{value:"Other",children:"Other"})]})]}),"Other"===e.signature_role&&(0,y.jsxs)("div",{className:"col-md-12",children:[(0,y.jsxs)("label",{className:"label_fontWeight",children:["Please specify role"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{type:"text",name:"other_role",value:e.other_role,onChange:e=>_e(a,e),placeholder:"Enter specific role",className:"form-control",required:!0})]}),(0,y.jsx)("div",{className:"col-md-12 d-flex justify-content-end",children:!e.isCurrentUser&&ye.length>1&&(0,y.jsx)("button",{type:"button",className:"btn btn-danger",onClick:()=>(e=>{const a=ye.filter(((a,n)=>n!==e));ve(a)})(a),children:"Remove Signatory"})})]})]},a)})),(0,y.jsx)("div",{className:"col-12",children:(0,y.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,y.jsx)("div",{className:"flex-shrink-0",children:(0,y.jsx)("button",{type:"button",className:"global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"3",onClick:()=>{R(!1),W(!0)},children:"Back"})}),(0,y.jsx)("div",{className:"flex-shrink-0",children:(0,y.jsx)("button",{type:"submit",className:"global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"4",children:"Next"})})]})})]})})}),(0,y.jsx)("div",{className:"col-12 m-0 p-0",children:T&&(0,y.jsx)(y.Fragment,{children:(0,y.jsxs)("form",{onSubmit:async e=>{var n,l,i,t,s,r,o,c,d;if(e.preventDefault(),Q(!0),""!==U.company_website){if(!xe(U.company_website))return C.current.scrollIntoView({behavior:"smooth",block:"center"}),W(!0),R(!1),P(!1),void E(!0);E(!1)}let m=!1,p=-1;const h=je.map(((e,a)=>{const n=ye[a].signatory_email.trim(),l=ye[a].signatory_confirm_email.trim();let i="";return n&&l&&n!==l&&(i="Emails do not match!"),i&&-1===p&&(p=a,m=!0),{...e,emailMatch:i}}));if(!m){const e=ye.map((e=>e.signatory_email.trim())).filter(Boolean),a=e.filter(((a,n)=>e.indexOf(a)!==n));a.length>0&&(p=ye.findIndex((e=>e.signatory_email.trim()&&a.includes(e.signatory_email.trim()))),m=!0,W(!1),R(!0),P(!1),ye.forEach(((e,n)=>{const l=e.signatory_email.trim();l&&a.includes(l)&&(h[n]={...h[n],emailMatch:"Email must be unique!"})})))}if(m){if(Ne(h),-1!==p){const e=`signatory_email_${p}`,a=document.getElementById(e);a&&(a.scrollIntoView({behavior:"smooth",block:"center"}),a.focus())}return W(!1),R(!0),P(!1),void Q(!1)}let u={company_name:U.company_name,company_industory:U.company_industory,phone:U.phone,company_email:U.company_email,company_website:U.company_website,employee_number:U.employee_number,year_registration:U.year_registration,formally_legally:ke,company_street_address:U.company_street_address,company_country:Fe,company_state:U.company_state,country_code:Ye,city_code:"",state_code:Ae,city_step2:U.city_step2,company_postal_code:U.company_postal_code,descriptionStep4:U.descriptionStep4,problemStep4:U.problemStep4,solutionStep4:U.solutionStep4,signatories:ye,user_id:a.id,strategic_priorities:JSON.stringify(ce.strategic_priorities),interested_in:JSON.stringify(ce.interested_in),seeking_partners:JSON.stringify(ce.seeking_partners),not_consider:JSON.stringify(ce.not_consider),competitor_1_name:(null===(n=ce.competitors[0])||void 0===n?void 0:n.name)||"",competitor_1_url:(null===(l=ce.competitors[0])||void 0===l?void 0:l.url)||"",competitor_1_reason:(null===(i=ce.competitors[0])||void 0===i?void 0:i.reason)||"",competitor_2_name:(null===(t=ce.competitors[1])||void 0===t?void 0:t.name)||"",competitor_2_url:(null===(s=ce.competitors[1])||void 0===s?void 0:s.url)||"",competitor_2_reason:(null===(r=ce.competitors[1])||void 0===r?void 0:r.reason)||"",competitor_3_name:(null===(o=ce.competitors[2])||void 0===o?void 0:o.name)||"",competitor_3_url:(null===(c=ce.competitors[2])||void 0===c?void 0:c.url)||"",competitor_3_reason:(null===(d=ce.competitors[2])||void 0===d?void 0:d.reason)||"",board_of_directors:ce.board_of_directors,ongoing_disputes:ce.ongoing_disputes,regulatory_compliance:ce.regulatory_compliance,legal_representation:ce.legal_representation,law_firm_name:ce.law_firm_name,legal_referral:ce.legal_referral,legal_compliance_review:ce.legal_compliance_review,accounting_firm:ce.accounting_firm,accounting_firm_name:ce.accounting_firm_name,accounting_referral:ce.accounting_referral,audited_financials:ce.audited_financials,saas_model:ce.saas_model,holds_ip:ce.holds_ip,operating_geographies:JSON.stringify(ce.operating_geographies),customer_segments:JSON.stringify(ce.customer_segments),exclusivity_clauses:ce.exclusivity_clauses,dependence_risk:ce.dependence_risk,long_term_contracts:ce.long_term_contracts,readiness_reason:ce.readiness_reason,value_proposition:ce.value_proposition,live_summary:ce.live_summary};oe(u),se(!0),Q(!1)},method:"post",action:"javascript:void(0)",children:[(0,y.jsxs)("div",{className:"row g-3",children:[(0,y.jsx)("div",{className:"col-md-12 mt-5",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"3/3"}),(0,y.jsx)("label",{htmlFor:"",children:(0,y.jsx)("h4",{children:"Company Mailing Address"})})]})}),(0,y.jsx)("div",{className:"col-md-6",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Street"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{value:U.company_street_address,onChange:Je,name:"company_street_address",required:!0,id:"",className:"form-control",placeholder:"Enter here",type:"text"})]})}),(0,y.jsx)("div",{className:"col-md-6",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Country"," ",(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{required:!0,value:U.company_country,name:"company_country",onChange:e=>{const a=e.target.value;Be([]);const n=e.target.options[e.target.selectedIndex].text;Ie("Aruba"!==n&&"American Samoa"!==n),ze(a),qe(n),$((a=>({...a,company_country:e.target.value})));const l=m.Ay.getStatesOfCountry(a);Oe(l)},placeholder:"Select or type a country",className:"form-select",children:[(0,y.jsx)("option",{value:"",children:"Select or type a country"}),He.map((e=>(0,y.jsx)("option",{value:e.value,children:e.label})))]})]})}),(0,y.jsx)("div",{className:"col-12",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["State / Province / Territory / District"," ",We&&(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{className:"form-select",required:!!We,name:"company_state",value:Pe,onChange:e=>{Le(e.target.value);const a=e.target.value,n=p.A.getCitiesOfState(U.company_country,a),l=Ee.find((e=>e.isoCode===a));Me(a);const i=l?l.name:"";$((e=>({...e,company_state:i}))),0===n.length?Ie(!1):Ie(!0),Be(n)},children:[(0,y.jsx)("option",{value:"",children:"-- Select State --"}),Ee.map((e=>(0,y.jsx)("option",{value:e.isoCode,children:e.name},e.isoCode)))]})]})}),(0,y.jsx)("div",{className:"col-md-6",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["City"," ",We&&(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsxs)("select",{required:!!We,name:"city_step2",onChange:async e=>{const a=e.target.value,n=(U.company_state,U.company_country,U.company_country),l=p.A.getCitiesOfState(n,a);console.log(l),$((e=>({...e,city_step2:a})))},placeholder:"Select or type a city",className:"form-select",children:[(0,y.jsx)("option",{value:"",children:"Select or type a city"}),De.map((e=>(0,y.jsx)("option",{value:e.name,children:e.name},e.name)))]})]})}),(0,y.jsx)("div",{className:"col-md-6",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Postal code/Zip"," ",We&&(0,y.jsx)("span",{className:"required",children:"*"})]}),(0,y.jsx)("input",{onChange:Je,type:"text",value:U.company_postal_code,className:"form-control",required:!!We,name:"company_postal_code",placeholder:"Enter postal code/zip"})]})}),(0,y.jsxs)("div",{className:"col-12 mt-4",children:[(0,y.jsxs)("div",{className:"d-flex flex-column gap-4",children:[(0,y.jsxs)("div",{className:"d-flex flex-column gap-2 stratetext",children:[(0,y.jsx)("label",{htmlFor:"",children:(0,y.jsx)("h4",{children:"Strategic Intent for JV's and M&A"})}),(0,y.jsx)("p",{children:'Determining whether a company is truly "ready" for a joint venture or acquisition requires more than financial performance alone\u2014it reflects strategic alignment, operational maturity, and a clear value narrative. Readiness means the company has robust governance, transparent reporting, and a defined growth story that can withstand the scrutiny of sophisticated partners or acquirers. Engaging an experienced advisory firm with a proven track record, a deep network of qualified buyers and sellers, and an unwavering commitment to integrity is essential. The right advisor not only positions your company effectively but also guides you through complex negotiations with confidence and trust, ensuring every step maximizes long-term value creation.'}),(0,y.jsx)("p",{children:"Please complete the following section transparently to help assess your company's readiness for a joint venture or acquisition, and be sure to update it as your business evolves and pivots over time."}),(0,y.jsx)("p",{children:(0,y.jsx)("b",{children:(0,y.jsx)("i",{children:"NOTE: These are NOT easy questions and will help you better define your strategic direction as you build your company."})})})]}),(0,y.jsx)("textarea",{className:"form-control",rows:"5",placeholder:"We need a VERY well-designed section of the answers from the forms below. Updated live, as the company fills/adjusts the inputs.",value:ce.live_summary,onChange:e=>ue("live_summary",e.target.value)})]}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-4 mt-4",children:[(0,y.jsxs)("div",{className:"d-flex flex-column gap-2 stratetext",children:[(0,y.jsx)("h4",{className:"mb-2",children:(0,y.jsx)("b",{children:"Strategic Intent for JV's and M&A"})}),(0,y.jsx)("h6",{children:(0,y.jsx)("b",{children:"SECTION 1"})}),(0,y.jsx)("h6",{children:"Strategic Intent for JV's and M&A"}),(0,y.jsx)("label",{className:"label_fontWeight",children:"What are your top 3 strategic priorities for the next 24 months?"})]}),(0,y.jsx)("div",{className:"checklistgrid",children:[{value:"Market expansion (geographic or segment growth)",label:"Market expansion (geographic or segment growth)"},{value:"Technology acquisition/product capabilities",label:"Technology acquisition/product capabilities"},{value:"Vertical integration (upstream or downstream)",label:"Vertical integration (upstream or downstream)"},{value:"Cost efficiencies/scale synergies",label:"Cost efficiencies/scale synergies"},{value:"R&D and innovation",label:"R&D and innovation (including new product lines)"},{value:"Talent acquisition / acqui-hire",label:"Talent acquisition / acqui-hire and leadership depth"},{value:"Portfolio diversification",label:"Portfolio diversification/new revenue streams"},{value:"Customer access/distribution",label:"Customer access/distribution partnerships and channels"},{value:"Brand strengthening",label:"Brand strengthening and competitive positioning"},{value:"Risk mitigation",label:"Risk mitigation/supply-chain resilience/regulatory positioning"},{value:"Capital access/partial exit",label:"Capital access/balance-sheet optimization or partial exit for founders"}].map(((e,a)=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input intent-check",type:"checkbox",value:e.value,id:`check${a+1}`,checked:ce.strategic_priorities.includes(e.value),onChange:e=>me("strategic_priorities",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:`check${a+1}`,children:e.label})]},a)))}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-3",children:[(0,y.jsx)("label",{className:"label_fontWeight",children:"Are you actively interested in:"}),(0,y.jsx)("div",{className:"checklistgrid",children:[{value:"JV partnerships",label:"JV partnerships"},{value:"Minority strategic investment",label:"Minority strategic investment"},{value:"Majority sale",label:"Majority sale"},{value:"Full exit",label:"Full exit"},{value:"Strategic acquisitions",label:"Strategic acquisitions"}].map(((e,a)=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input intent-check",type:"checkbox",value:e.value,id:`areopt${a+1}`,checked:ce.interested_in.includes(e.value),onChange:e=>me("interested_in",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label w-100",htmlFor:`areopt${a+1}`,children:e.label})]},a)))})]}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-3",children:[(0,y.jsx)("label",{className:"label_fontWeight",children:"What types of partners are you seeking?"}),(0,y.jsx)("div",{className:"checklistgrid",children:[{value:"Distribution",label:"Distribution"},{value:"Technology",label:"Technology"},{value:"Manufacturing",label:"Manufacturing"},{value:"Co\u2011development",label:"Co\u2011development"},{value:"Capital",label:"Capital"},{value:"Data\u2011sharing",label:"Data\u2011sharing"},{value:"IP\u2011licensing",label:"IP\u2011licensing"},{value:"R&D",label:"R&D"},{value:"Business development",label:"Business development"}].map(((e,a)=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input intent-check",type:"checkbox",value:e.value,id:`opt${a+1}`,checked:ce.seeking_partners.includes(e.value),onChange:e=>me("seeking_partners",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label w-100",htmlFor:`opt${a+1}`,children:e.label})]},a)))})]}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-3",children:[(0,y.jsx)("label",{className:"label_fontWeight",children:"What would you not consider under any circumstances?"}),(0,y.jsx)("div",{className:"checklistgrid",children:[{value:"Explore all options",label:"We will explore all options"},{value:"Sale of control",label:"Sale of control"},{value:"Exclusivity",label:"Exclusivity"},{value:"Licensing core IP",label:"Licensing core IP"}].map(((e,a)=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input intent-check",type:"checkbox",value:e.value,id:`optPath${a+1}`,checked:ce.not_consider.includes(e.value),onChange:e=>me("not_consider",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label w-100",htmlFor:`optPath${a+1}`,children:e.label})]},a)))})]})]}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-4 mt-4",children:[(0,y.jsxs)("div",{className:"d-flex flex-column gap-2 stratetext",children:[(0,y.jsx)("h6",{children:(0,y.jsx)("b",{children:"SECTION 2"})}),(0,y.jsx)("label",{className:"label_fontWeight",children:"Competition. Provide information on your top three direct competitors."})]}),(0,y.jsx)("div",{id:"competitor-section",className:"d-flex flex-column gap-3",children:[0,1,2].map((e=>(0,y.jsxs)("div",{className:"competitor-card d-flex flex-column flex-sm-row gap-4",children:[(0,y.jsx)("div",{className:"flex-shrink-0",children:(0,y.jsxs)("h6",{className:"competitor-label",children:["Competitor ",e+1,":"]})}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-2 flex-grow-1",children:[(0,y.jsx)("input",{type:"text",className:"form-control",placeholder:"Name of the company",value:ce.competitors[e].name,onChange:a=>pe(e,"name",a.target.value)}),(0,y.jsx)("input",{type:"url",className:"form-control",placeholder:"URL of the company",value:ce.competitors[e].url,onChange:a=>pe(e,"url",a.target.value)}),(0,y.jsx)("textarea",{className:"form-control",maxLength:"400",placeholder:"Why do you believe this is a competitor?",rows:"4",value:ce.competitors[e].reason,onChange:a=>pe(e,"reason",a.target.value)}),(0,y.jsx)("span",{className:"char-limit fs-6 fst-italic text-end",children:"max 400 characters"})]})]},e)))})]}),(0,y.jsx)("div",{className:"d-flex flex-column gap-3 mt-4",children:(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsx)("h4",{className:"mb-2",children:(0,y.jsx)("b",{children:"Strategic Intent for JV's and M&A"})}),(0,y.jsx)("h6",{children:(0,y.jsx)("b",{children:"SECTION 3"})}),(0,y.jsx)("h6",{children:"Corporate governance:"}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsxs)("div",{className:"question-block d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight",children:"Do you have a formal Board of Directors or Advisory Board?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"board",id:"boardYes",value:"YES",checked:"YES"===ce.board_of_directors,onChange:e=>he("board_of_directors",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"boardYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"board",id:"boardNo",value:"NO",checked:"NO"===ce.board_of_directors,onChange:e=>he("board_of_directors",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"boardNo",children:"NO"})]})]}),(0,y.jsxs)("div",{className:"question-block d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight",children:"Are there any ongoing or threatened disputes, litigation, or regulatory investigations?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"disputes",id:"disputeYes",value:"YES",checked:"YES"===ce.ongoing_disputes,onChange:e=>he("ongoing_disputes",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"disputeYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"disputes",id:"disputeNo",value:"NO",checked:"NO"===ce.ongoing_disputes,onChange:e=>he("ongoing_disputes",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"disputeNo",children:"NO"})]})]}),(0,y.jsxs)("div",{className:"question-block d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight",children:"Are you compliant with key regulations in your sector?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"compliance",id:"complianceYes",value:"YES",checked:"YES"===ce.regulatory_compliance,onChange:e=>he("regulatory_compliance",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"complianceYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"compliance",id:"complianceNo",value:"NO",checked:"NO"===ce.regulatory_compliance,onChange:e=>he("regulatory_compliance",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"complianceNo",children:"NO"})]})]}),(0,y.jsxs)("div",{className:"question-block d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight",children:"Does your company have legal representation (do you work with a law firm)?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"legal_rep",id:"legalRepYes",value:"YES",checked:"YES"===ce.legal_representation,onChange:e=>he("legal_representation",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"legalRepYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"legal_rep",id:"legalRepNo",value:"NO",checked:"NO"===ce.legal_representation,onChange:e=>he("legal_representation",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"legalRepNo",children:"NO"})]})]}),"YES"===ce.legal_representation&&(0,y.jsxs)("div",{className:"ms-5",children:[(0,y.jsx)("label",{className:"small fw-bold label_fontWeight",children:"Please indicate the name of your law firm:"}),(0,y.jsx)("input",{type:"text",className:"form-control form-control-sm",placeholder:"Law Firm Name",value:ce.law_firm_name,onChange:e=>ue("law_firm_name",e.target.value)})]}),"NO"===ce.legal_representation&&(0,y.jsx)("div",{className:"ms-5",children:(0,y.jsxs)("div",{className:"question-block d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight",children:"would you like us to refer one to you?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"legal_referral",id:"legalRefYes",value:"YES",checked:"YES"===ce.legal_referral,onChange:e=>he("legal_referral",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"legalRefYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"legal_referral",id:"legalRefNo",value:"NO",checked:"NO"===ce.legal_referral,onChange:e=>he("legal_referral",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"legalRefNo",children:"NO"})]})]})}),(0,y.jsxs)("div",{className:"question-block d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight",children:"Have you completed a formal legal/compliance review in the last 24 months?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"review",id:"reviewYes",value:"YES",checked:"YES"===ce.legal_compliance_review,onChange:e=>he("legal_compliance_review",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"reviewYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"review",id:"reviewNo",value:"NO",checked:"NO"===ce.legal_compliance_review,onChange:e=>he("legal_compliance_review",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"reviewNo",children:"NO"})]})]}),(0,y.jsxs)("div",{className:"question-block d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight",children:"Does your company work with an accounting firm?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"accounting",id:"accYes",value:"YES",checked:"YES"===ce.accounting_firm,onChange:e=>he("accounting_firm",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"accYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"accounting",id:"accNo",value:"NO",checked:"NO"===ce.accounting_firm,onChange:e=>he("accounting_firm",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"accNo",children:"NO"})]})]}),"YES"===ce.accounting_firm&&(0,y.jsxs)("div",{className:"ms-5",children:[(0,y.jsx)("label",{className:"small fw-bold label_fontWeight",children:"please indicate the name of your accounting firm:"}),(0,y.jsx)("input",{type:"text",className:"form-control form-control-sm",placeholder:"Accounting Firm Name",value:ce.accounting_firm_name,onChange:e=>ue("accounting_firm_name",e.target.value)})]}),"NO"===ce.accounting_firm&&(0,y.jsx)("div",{className:"ms-5",children:(0,y.jsxs)("div",{className:"question-block d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight",children:"would you like us to refer one to you?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"acc_referral",id:"accRefYes",value:"YES",checked:"YES"===ce.accounting_referral,onChange:e=>he("accounting_referral",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"accRefYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"acc_referral",id:"accRefNo",value:"NO",checked:"NO"===ce.accounting_referral,onChange:e=>he("accounting_referral",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"accRefNo",children:"NO"})]})]})}),(0,y.jsxs)("div",{className:"question-block d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight",children:"Have your financials been audited by an independent party?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"audit",id:"auditYes",value:"YES",checked:"YES"===ce.audited_financials,onChange:e=>he("audited_financials",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"auditYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"audit",id:"auditNo",value:"NO",checked:"NO"===ce.audited_financials,onChange:e=>he("audited_financials",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"auditNo",children:"NO"})]})]}),(0,y.jsxs)("div",{className:"question-block d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight",children:"Do you consider your company to be a SaaS or recurring model business?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"saas_model",id:"saasYes",value:"YES",checked:"YES"===ce.saas_model,onChange:e=>he("saas_model",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"saasYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"saas_model",id:"saasNo",value:"NO",checked:"NO"===ce.saas_model,onChange:e=>he("saas_model",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"saasNo",children:"NO"})]})]}),(0,y.jsxs)("div",{className:"question-block d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"question-text label_fontWeight",children:"Do you hold IP?"}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"ip_hold",id:"ipHoldYes",value:"YES",checked:"YES"===ce.holds_ip,onChange:e=>he("holds_ip",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"ipHoldYes",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"ip_hold",id:"ipHoldNo",value:"NO",checked:"NO"===ce.holds_ip,onChange:e=>he("holds_ip",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"ipHoldNo",children:"NO"})]})]})]})]})}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-3 mt-4",children:[(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsx)("h4",{className:"mb-2",children:(0,y.jsx)("b",{children:"Strategic Intent for JV's and M&A"})}),(0,y.jsx)("h6",{children:(0,y.jsx)("b",{children:"SECTION 4"})}),(0,y.jsx)("h6",{children:"Market, customers, and contracts"})]}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-4 checklistgrid",children:[(0,y.jsx)("div",{className:"d-flex flex-column gap-2",children:(0,y.jsx)("label",{className:"label_fontWeight",children:"In which geographies do you currently operate?"})}),(0,y.jsxs)("div",{className:"row",children:[(0,y.jsx)("div",{className:"col-md-6",children:[{id:"g1",label:"Local only (single city/metro area)"},{id:"g2",label:"National only (within one country)"},{id:"g3",label:"North America"},{id:"g4",label:"Latin America"},{id:"g5",label:"South America"},{id:"g6",label:"Western Europe"},{id:"g7",label:"Eastern Europe"},{id:"g8",label:"Middle East"}].map((e=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input",type:"checkbox",id:e.id,value:e.label,checked:ce.operating_geographies.includes(e.label),onChange:e=>me("operating_geographies",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:e.id,children:e.label})]},e.id)))}),(0,y.jsx)("div",{className:"col-md-6",children:[{id:"g9",label:"Africa"},{id:"g10",label:"Central Asia"},{id:"g11",label:"South Asia"},{id:"g12",label:"Southeast Asia"},{id:"g13",label:"East Asia (excluding China/Hong Kong)"},{id:"g14",label:"China / Hong Kong"},{id:"g15",label:"Oceania (Australia, NZ, Pacific Islands)"}].map((e=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input",type:"checkbox",id:e.id,value:e.label,checked:ce.operating_geographies.includes(e.label),onChange:e=>me("operating_geographies",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:e.id,children:e.label})]},e.id)))})]}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"label_fontWeight",children:"What are your primary customer segments?"}),(0,y.jsx)("div",{className:"d-flex flex-wrap gap-3",children:[{id:"c1",label:"Enterprise"},{id:"c2",label:"SMB"},{id:"c3",label:"Consumer"},{id:"c4",label:"Government"},{id:"c5",label:"Specific verticals"}].map((e=>(0,y.jsxs)("div",{className:"form-check",children:[(0,y.jsx)("input",{className:"form-check-input",type:"checkbox",id:e.id,value:e.label,checked:ce.customer_segments.includes(e.label),onChange:e=>me("customer_segments",e.target.value,e.target.checked)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:e.id,children:e.label})]},e.id)))})]}),(0,y.jsxs)("div",{className:"d-block",children:[(0,y.jsx)("label",{className:"label_fontWeight",children:"Do you have any exclusivity, non-compete, or most-favored-nation (MFN) clauses with key customers, suppliers, or channel partners that could restrict a JV/M&A?"}),(0,y.jsxs)("div",{className:"mt-2",children:[(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"exclusivity",id:"ex1",value:"YES",checked:"YES"===ce.exclusivity_clauses,onChange:e=>he("exclusivity_clauses",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"ex1",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"exclusivity",id:"ex2",value:"NO",checked:"NO"===ce.exclusivity_clauses,onChange:e=>he("exclusivity_clauses",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"ex2",children:"NO"})]})]})]}),(0,y.jsxs)("div",{className:"d-block",children:[(0,y.jsx)("label",{className:"label_fontWeight",children:"Are there significant dependence risks (e.g., more than 30% of revenue from a single customer or supplier)?"}),(0,y.jsxs)("div",{className:"mt-2",children:[(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"risk",id:"rk1",value:"YES",checked:"YES"===ce.dependence_risk,onChange:e=>he("dependence_risk",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"rk1",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"risk",id:"rk2",value:"NO",checked:"NO"===ce.dependence_risk,onChange:e=>he("dependence_risk",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"rk2",children:"NO"})]})]})]}),(0,y.jsxs)("div",{className:"d-block",children:[(0,y.jsx)("label",{className:"label_fontWeight",children:"Do you have long-term contracts that would require consent or change-of-control approvals in a transaction?"}),(0,y.jsxs)("div",{className:"mt-2",children:[(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"contract",id:"ct1",value:"YES",checked:"YES"===ce.long_term_contracts,onChange:e=>he("long_term_contracts",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"ct1",children:"YES"})]}),(0,y.jsxs)("div",{className:"form-check form-check-inline",children:[(0,y.jsx)("input",{className:"form-check-input",type:"radio",name:"contract",id:"ct2",value:"NO",checked:"NO"===ce.long_term_contracts,onChange:e=>he("long_term_contracts",e.target.value)}),(0,y.jsx)("label",{className:"form-check-label",htmlFor:"ct2",children:"NO"})]})]})]})]})]}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-3 mt-4",children:[(0,y.jsx)("div",{className:"d-flex flex-column gap-2",children:(0,y.jsx)("h6",{children:(0,y.jsx)("b",{children:"SECTION 5"})})}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-4 checklistgrid",children:[(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"label_fontWeight",children:"Why do you think your company is ready to engage in a JV or an M&A transaction?"}),(0,y.jsx)("textarea",{className:"form-control",id:"readiness",rows:"3",placeholder:"Enter your response here...",value:ce.readiness_reason,onChange:e=>ue("readiness_reason",e.target.value)})]}),(0,y.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,y.jsx)("label",{className:"label_fontWeight",children:"How clearly can you articulate your unique value proposition versus competitors in one or two sentences, and why would a buyer/partner choose you instead of building or buying elsewhere?"}),(0,y.jsx)("textarea",{className:"form-control",id:"value-prop",rows:"4",maxLength:"800",placeholder:"Enter your response (max 800 characters)...",value:ce.value_proposition,onChange:e=>ue("value_proposition",e.target.value)}),(0,y.jsx)("div",{className:"form-text text-end fst-italic",children:"max 800 characters"})]})]})]})]})]}),(0,y.jsx)("div",{className:"col-12 mt-4",children:(0,y.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,y.jsx)("div",{className:"flex-shrink-0",children:(0,y.jsx)("button",{type:"button",className:"global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"3",onClick:()=>{P(!1),R(!0)},children:"Back"})}),(0,y.jsx)("div",{className:"flex-shrink-0",children:(0,y.jsxs)("button",{disabled:G,style:{opacity:G?.6:1},type:"submit",className:"global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2",children:["Save",G&&(0,y.jsx)("div",{className:" spinner-white spinner-border spinneronetimepay m-0",role:"status",children:(0,y.jsx)("span",{className:"visually-hidden"})})]})})]})})]})})})]})})]})]})})]})]})})}),B&&(0,y.jsx)(j.A,{show:B,onClose:()=>{H(!1),V(!1)},onAccept:async()=>{try{const e={user_id:a.id,status:"Yes"},l=await r.A.post(n+"saveCompanyAcknowlegment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(l.data),("1"===l.data.status||l.data.success)&&(D([{acknowledged:!0}]),H(!1),_("Company registration agreement accepted successfully!"),setTimeout((()=>{J&&V(!1),_("")}),2500))}catch(e){console.error("Error saving acknowledgment:",e)}},companyName:""}),(0,y.jsx)(v,{show:te,onClose:()=>{se(!1),oe(null)},onAccept:async()=>{se(!1),Q(!0);try{const e={...re,signatory_acknowledged:"Yes"},a=await r.A.post(`${n}companyaddWithSignatory`,e,{headers:{Accept:"application/json","Content-Type":"application/json"}});_(a.data.message),"2"===a.data.status?(b(!0),W(!0),R(!1),P(!1)):(b(!1),ie(),setTimeout((()=>{_("")}),3e3))}catch(e){_("Error updating profile. Please try again."),b(!0),setTimeout((()=>{_("")}),3e3)}finally{Q(!1),oe(null)}},companyName:U.company_name}),(0,y.jsx)("style",{jsx:!0,children:"\n        .profile-card {\n          background: #fff;\n          border-radius: 16px;\n          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);\n          overflow: hidden;\n        }\n\n        .profile-header {\n          display: flex;\n          align-items: center;\n          padding: 24px 32px;\n          border-bottom: 1px solid #f1f3f4;\n          background: #efefef;\n        }\n\n        .profile-icon {\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          width: 48px;\n          height: 48px;\n          border-radius: 12px;\n          background: linear-gradient(\n            135deg,\n            var(--primary) 0%,\n            var(--primary-icon) 100%\n          );\n          color: white;\n          margin-right: 16px;\n        }\n\n        .profile-title h2 {\n          font-size: 24px;\n          font-weight: 600;\n          color: #0a0a0a;\n          margin: 0 0 4px 0;\n        }\n\n        .profile-title p {\n          color: #6b7280;\n          margin: 0;\n          font-size: 14px;\n        }\n\n        .profile-content {\n          padding: 32px;\n        }\n\n        .form-grid {\n          display: grid;\n          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n          gap: 24px;\n          margin-bottom: 32px;\n        }\n\n        .form-group {\n          display: flex;\n          flex-direction: column;\n        }\n\n        .form-label {\n          font-weight: 500;\n          color: #374151;\n          margin-bottom: 8px;\n          font-size: 14px;\n        }\n\n        .required {\n          color: #f63b3b;\n        }\n\n        .form-input {\n          padding: 12px 16px;\n          border: 1px solid #e5e7eb;\n          border-radius: 8px;\n          font-size: 16px;\n          transition: all 0.2s ease;\n          background: #fff;\n        }\n\n        .form-input:focus {\n          outline: none;\n          border-color: #f63b3b;\n          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);\n        }\n\n        .form-input:disabled {\n          background-color: #f9fafb;\n          color: #6b7280;\n          cursor: not-allowed;\n        }\n\n        .input-note {\n          font-size: 12px;\n          color: #6b7280;\n          margin-top: 4px;\n        }\n\n        .phone-input {\n          padding: 12px 16px;\n          border: 1px solid #e5e7eb;\n          border-radius: 8px;\n          font-size: 16px;\n          width: 100%;\n        }\n\n        .phone-input:focus {\n          outline: none;\n          border-color: #f63b3b;\n          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);\n        }\n\n        .input-with-icon {\n          position: relative;\n          display: flex;\n          align-items: center;\n        }\n\n        .input-icon {\n          position: absolute;\n          left: 12px;\n          color: #6b7280;\n          z-index: 1;\n        }\n\n        .input-with-icon .form-input {\n          padding-left: 40px;\n        }\n\n        .form-actions {\n          display: flex;\n          justify-content: flex-end;\n          border-top: 1px solid #f1f3f4;\n          padding-top: 24px;\n        }\n\n        .btn-primary {\n          display: inline-flex;\n          align-items: center;\n          gap: 8px;\n          background: linear-gradient(135deg, #f63b3b 0%, #e03535 100%);\n          color: white;\n          border: none;\n          border-radius: 8px;\n          padding: 12px 24px;\n          font-size: 16px;\n          font-weight: 500;\n          cursor: pointer;\n          transition: all 0.2s ease;\n        }\n\n        .btn-primary:hover:not(:disabled) {\n          transform: translateY(-2px);\n          box-shadow: 0 4px 12px rgba(246, 59, 59, 0.25);\n        }\n\n        .btn-primary:disabled {\n          opacity: 0.7;\n          cursor: not-allowed;\n          transform: none;\n        }\n\n        .spinner {\n          width: 16px;\n          height: 16px;\n          border: 2px solid rgba(255, 255, 255, 0.3);\n          border-radius: 50%;\n          border-top-color: white;\n          animation: spin 1s ease-in-out infinite;\n        }\n\n        @keyframes spin {\n          to {\n            transform: rotate(360deg);\n          }\n        }\n\n        .alert {\n          padding: 12px 16px;\n          border-radius: 8px;\n          margin-bottom: 24px;\n          font-weight: 500;\n        }\n\n        .alert-success {\n          background-color: #ecfdf5;\n          color: #065f46;\n          border: 1px solid #a7f3d0;\n        }\n\n        .alert-error {\n          background-color: #fef2f2;\n          color: #991b1b;\n          border: 1px solid #fecaca;\n        }\n\n        @media (max-width: 768px) {\n          .profile-header {\n            padding: 20px;\n          }\n\n          .profile-content {\n            padding: 20px;\n          }\n\n          .form-grid {\n            grid-template-columns: 1fr;\n            gap: 20px;\n          }\n\n          .form-actions {\n            justify-content: center;\n          }\n\n          .btn-primary {\n            width: 100%;\n            justify-content: center;\n          }\n        }\n      "})]})}},78384:(e,a,n)=>{n.d(a,{A:()=>l});const l=(0,n(77784).A)("shield-check",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]])}}]);
//# sourceMappingURL=9632.ef99e7f2.chunk.js.map