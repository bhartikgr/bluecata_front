/*! For license information please see 772.2dad3d55.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[772],{41680:(e,n,a)=>{a.d(n,{A:()=>t});const t=(0,a(77784).A)("file-text",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]])},62837:(e,n,a)=>{a.d(n,{$K:()=>r,CB:()=>l,Cd:()=>y,I0:()=>c,Jq:()=>h,R3:()=>j,Zw:()=>m,dN:()=>f,hJ:()=>g,jh:()=>d,mO:()=>i,mg:()=>s,nj:()=>b,pd:()=>v,uM:()=>u,vE:()=>o,z6:()=>p});var t=a(5464);const i=t.default.div`
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
`,o=t.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,r=(t.default.div`
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
`),s=t.default.div`
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
`,l=t.default.div`
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
`,h=(t.default.div`
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
`),u=(t.default.div`
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
`),x=(t.default.div`
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
`),f=((0,t.default)(x)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,t.default)(x)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,t.default.sup`
  color: var(--primary);
`),g=t.default.div`
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
`,y=t.default.div`
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
`,b=t.default.button`
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
`,v=t.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,j=t.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},65877:(e,n,a)=>{a.r(n),a.d(n,{default:()=>_});var t=a(65043),i=a(77266),o=a(42552),r=(a(38421),a(53579)),s=(a(83656),a(86213)),l=a(73216),d=a(26632),c=(a(65016),a(62837)),p=a(24910),m=a(62585),h=(a(9191),a(25581)),u=a(57943),x=a(78384),f=a(76245),g=a(77819),y=a(82054),b=a(70579);function v(e){let{show:n,onClose:a,onAccept:i,companyName:o="Your Company"}=e;const[r,s]=(0,t.useState)(!1),[l,d]=(0,t.useState)("");return n?(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)("div",{className:"modal fade show",style:{display:"block",backgroundColor:"rgba(0, 0, 0, 0.6)",backdropFilter:"blur(4px)"},children:(0,b.jsx)("div",{className:"modal-dialog modal-dialog-centered modal-xl",children:(0,b.jsxs)("div",{className:"modal-content",style:{borderRadius:"20px",border:"none",boxShadow:"0 25px 50px -12px rgba(0, 0, 0, 0.25)",overflow:"hidden"},children:[(0,b.jsx)("div",{style:{background:"linear-gradient(135deg, #FF3E41 0%, #FF3E41 100%)",padding:"24px 32px",borderBottom:"1px solid rgba(255, 62, 65, 0.25)"},children:(0,b.jsxs)("div",{className:"d-flex justify-content-between align-items-center",children:[(0,b.jsxs)("div",{className:"d-flex align-items-center gap-3",children:[(0,b.jsx)("div",{style:{width:"48px",height:"48px",background:"rgba(255, 62, 65, 0.25)",borderRadius:"12px",display:"flex",alignItems:"center",justifyContent:"center"},children:(0,b.jsx)(x.A,{size:28,color:"#FF3E41"})}),(0,b.jsxs)("div",{children:[(0,b.jsx)("h4",{style:{margin:0,fontSize:"1.75rem",fontWeight:"700",color:"#fff",letterSpacing:"-0.5px"},children:"ACKNOWLEDGEMENT"}),(0,b.jsx)("p",{style:{color:"rgba(255,255,255,0.7)",margin:"4px 0 0 0",fontSize:"0.95rem"},children:"Signatory Designation"})]})]}),(0,b.jsx)("button",{onClick:a,style:{background:"rgba(255,255,255,0.1)",border:"none",cursor:"pointer",width:"40px",height:"40px",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s"},onMouseEnter:e=>e.target.style.background="rgba(255,255,255,0.2)",onMouseLeave:e=>e.target.style.background="rgba(255,255,255,0.1)",children:(0,b.jsx)(f.A,{size:20,color:"#fff"})})]})}),(0,b.jsxs)("div",{style:{padding:"32px"},children:[(0,b.jsxs)("div",{style:{background:"#f8f9fa",borderRadius:"12px",padding:"16px 20px",marginBottom:"24px",border:"1px solid #e9ecef",borderLeft:"4px solid #FF3E41",display:"flex",alignItems:"flex-start",gap:"12px"},children:[(0,b.jsx)(g.A,{size:20,color:"#FF3E41",style:{flexShrink:0,marginTop:"2px"}}),(0,b.jsxs)("p",{style:{margin:0,color:"#495057",fontSize:"0.95rem",lineHeight:"1.6"},children:[(0,b.jsx)("strong",{children:"Trigger:"})," During company setup when the Account Administrator assigns a user the Signatory role. Presented once per Signatory designated. Must be completed by the user being assigned the role before it takes effect."]})]}),(0,b.jsxs)("div",{style:{border:"1px solid #e9ecef",borderRadius:"16px",overflow:"hidden"},children:[(0,b.jsx)("div",{style:{background:"#f8f9fa",padding:"16px 24px",borderBottom:"1px solid #e9ecef",borderLeft:"4px solid #FF3E41"},children:(0,b.jsx)("h5",{style:{margin:0,fontWeight:"700",fontSize:"1.1rem",color:"#212529",textTransform:"uppercase",letterSpacing:"0.5px"},children:"COPY SIGNATORY"})}),(0,b.jsxs)("div",{style:{padding:"24px"},children:[(0,b.jsxs)("p",{style:{fontSize:"1rem",color:"#212529",marginBottom:"20px",lineHeight:"1.6"},children:["You are being designated as a ",(0,b.jsxs)("strong",{children:["Signatory for ",(0,b.jsx)("span",{style:{color:"#FF3E41"},children:o})]})," on the Capavate platform, operated by BluePrint Catalyst Limited."]}),(0,b.jsx)("p",{style:{fontWeight:"600",marginBottom:"16px",color:"#212529"},children:"As a Signatory, you acknowledge and agree that:"}),(0,b.jsx)("ul",{style:{paddingLeft:"20px",marginBottom:"24px"},children:[`You are authorised by <strong>${o}</strong> to act in this capacity, including managing fundraising rounds, inviting investors via the CRM, confirming investments, and updating the cap table.`,`All actions you take as a Signatory are legally binding on <strong>${o}</strong> and are your sole responsibility.`,"You will not use this role to transmit information that is false, misleading, defamatory, or in violation of applicable securities law.","Capavate and BluePrint Catalyst Limited act solely as a technology platform and bear no liability whatsoever for your actions or decisions as Signatory, including any errors, omissions, or disputes arising therefrom.","This designation is governed by the <strong>Capavate Platform Terms</strong> and the laws of Hong Kong SAR."].map(((e,n)=>(0,b.jsxs)("li",{style:{marginBottom:"12px",color:"#495057",lineHeight:"1.6",fontSize:"0.95rem",position:"relative",paddingLeft:"8px"},children:[(0,b.jsx)("span",{style:{color:"#FF3E41",fontWeight:"bold",marginRight:"8px"},children:"\u2022"}),(0,b.jsx)("span",{dangerouslySetInnerHTML:{__html:e}})]},n)))}),(0,b.jsxs)("div",{style:{background:"#f8f9fa",borderRadius:"12px",padding:"20px",border:l?"1px solid #FF3E41":"1px solid #e9ecef",boxShadow:l?"0 0 0 3px rgba(255, 62, 65, 0.1)":"none"},children:[(0,b.jsxs)("div",{className:"form-check",style:{paddingLeft:"32px"},children:[(0,b.jsx)("input",{type:"checkbox",className:"form-check-input",id:"signatoryConfirm",checked:r,onChange:e=>{s(e.target.checked),e.target.checked&&d("")},style:{width:"20px",height:"20px",marginLeft:"-32px",cursor:"pointer",accentColor:"#FF3E41"}}),(0,b.jsx)("label",{className:"form-check-label",htmlFor:"signatoryConfirm",style:{cursor:"pointer",fontSize:"0.95rem",color:"#212529",lineHeight:"1.5"},children:(0,b.jsxs)("strong",{children:["I confirm I am authorised to act as Signatory for ",(0,b.jsx)("span",{style:{color:"#FF3E41"},children:o})," and accept full responsibility for all actions taken under this role."]})})]}),l&&(0,b.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:"8px",marginTop:"12px",color:"#FF3E41",fontSize:"0.9rem"},children:[(0,b.jsx)(g.A,{size:16}),(0,b.jsx)("span",{children:l})]})]})]})]}),(0,b.jsxs)("div",{style:{display:"flex",gap:"16px",justifyContent:"flex-end",marginTop:"32px"},children:[(0,b.jsx)("button",{type:"button",onClick:a,style:{padding:"12px 28px",borderRadius:"10px",border:"1px solid #dee2e6",background:"#fff",color:"#495057",fontSize:"0.95rem",fontWeight:"500",cursor:"pointer",transition:"all 0.2s"},onMouseEnter:e=>{e.target.style.background="#f8f9fa",e.target.style.borderColor="#ced4da"},onMouseLeave:e=>{e.target.style.background="#fff",e.target.style.borderColor="#dee2e6"},children:"Cancel"}),(0,b.jsxs)("button",{type:"button",onClick:()=>{r?(d(""),i()):d("Please confirm that you are authorised to act as Signatory")},style:{padding:"12px 32px",borderRadius:"10px",border:"none",background:r?"linear-gradient(135deg, #FF3E41 0%, #E03537 100%)":"#FF3E41",color:"#fff",fontSize:"0.95rem",fontWeight:"600",cursor:r?"pointer":"not-allowed",opacity:r?1:.5,transition:"all 0.2s",display:"flex",alignItems:"center",gap:"8px",boxShadow:r?"0 4px 12px rgba(255, 62, 65, 0.3)":"none"},disabled:!r,onMouseEnter:e=>{r&&(e.target.style.background="linear-gradient(135deg, #E03537 0%, #C03032 100%)",e.target.style.transform="translateY(-1px)",e.target.style.boxShadow="0 6px 16px rgba(255, 62, 65, 0.4)")},onMouseLeave:e=>{r&&(e.target.style.background="linear-gradient(135deg, #FF3E41 0%, #E03537 100%)",e.target.style.transform="translateY(0)",e.target.style.boxShadow="0 4px 12px rgba(255, 62, 65, 0.3)")},children:[(0,b.jsx)(y.A,{size:18}),"Accept & Activate Signatory Role"]})]})]})]})})}),(0,b.jsx)("div",{className:"modal-backdrop fade show",onClick:a,style:{position:"fixed",top:0,left:0,width:"100%",height:"100%",backgroundColor:"rgba(0, 0, 0, 0.6)",zIndex:1040}})]}):null}var j=a(30007);function _(){const e=localStorage.getItem("OwnerLoginData"),n=JSON.parse(e),a=h.J+"api/user/",x=h.J+"api/user/company/";var f=h.J+"api/user/capitalround/";document.title="Add Company";const[g,y]=(0,t.useState)(!1),[_,w]=(0,t.useState)(""),[N,k]=(0,t.useState)(""),C=(0,t.useRef)(null),[S,z]=(0,t.useState)(!1),[E,O]=(0,t.useState)(0),[F,A]=(0,t.useState)(0),[q,M]=(0,t.useState)(0),[I,W]=(0,t.useState)(!0),[R,T]=(0,t.useState)(!1),[P,L]=(0,t.useState)(!1),[Y,B]=(0,t.useState)(""),[U,D]=(0,t.useState)(!1),[H,V]=(0,t.useState)(!1),[Z,$]=(0,t.useState)({phone:"",city_step2:"",company_street_address:"",company_industory:"",company_name:"",year_registration:"",company_website:"",employee_number:"",company_linkedin:"",descriptionStep4:"",problemStep4:"",solutionStep4:"",company_state:"",company_postal_code:"",company_country:"",company_email:""}),[J,K]=(0,t.useState)(""),[G,Q]=(0,t.useState)(!1),X=(0,l.Zp)(),[ee,ne]=(0,t.useState)([]);(0,t.useEffect)((()=>{ae(),te()}),[]);const ae=async()=>{let e={investor_id:""};try{const n=await s.A.post(f+"getIndustryExpertise",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});ne(n.data.results)}catch(n){}},te=async()=>{let e={user_id:n.id};try{const n=await s.A.post(a+"getUserAcknowlegment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(n.data),0===n.data.results.length&&(D(!0),V(!0)),B(n.data.results)}catch(t){}};(0,t.useEffect)((()=>{oe()}),[]),(0,t.useEffect)((()=>{ie()}),[]);const ie=async()=>{const e={user_id:n.id};try{const n=await s.A.post(x+"getUserOwnerDetail",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});n.data.results.length>0&&K(n.data.results[0])}catch(a){console.error("Error generating summary",a)}},oe=async()=>{let e={user_id:n.id};try{const n=await s.A.post(a+"getcompanydetail",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});k(n.data.results[0])}catch(t){console.error("Error fetching company details:",t)}},[re,se]=(0,t.useState)(!1),[le,de]=(0,t.useState)(null),ce=e=>!!new RegExp("^(https?:\\/\\/)?((([a-zA-Z0-9\\-])+\\.)+[a-zA-Z]{2,})(\\:[0-9]{1,5})?(\\/.*)?$","i").test(e),[pe,me]=(0,t.useState)("");(0,t.useEffect)((()=>{he()}),[]);const he=async()=>{try{const e=await s.A.post(a+"getallcountry",Z,{headers:{Accept:"application/json","Content-Type":"application/json"}});Me(e.data.results)}catch(e){}},[ue,xe]=(0,t.useState)([{first_name:"",last_name:"",email:"",confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:""}]),[fe,ge]=(0,t.useState)(ue.map((()=>({emailMatch:""})))),ye=(e,n)=>{const{name:a,value:t}=n.target,i=[...ue];i[e][a]=t;const o=[...fe];if(o[e]||(o[e]={}),"signatory_email"===a||"signatory_confirm_email"===a){const n=i[e].signatory_email,a=i[e].signatory_confirm_email;o[e].emailMatch=n&&a&&n!==a?"Emails do not match!":""}if("signatory_email"===a&&!i[e].isCurrentUser){const n=i.map(((e,n)=>({email:e.signatory_email,index:n}))),a=n.filter(((e,a)=>e.email&&n.findIndex((n=>n.email===e.email))!==a));a.length>0?o[e].emailMatch="Email must be unique!":i[e].signatory_email===i[e].signatory_confirm_email&&(o[e].emailMatch="")}"signature_role"===a&&"Other"!==t&&(i[e].other_role=""),xe(i),ge(o)},[be,ve]=(0,t.useState)("");(0,t.useEffect)((()=>{if("Yes"===be){if(!ue.some((e=>e.isCurrentUser))){const e={first_name:J.first_name||"",last_name:J.last_name||"",signatory_email:J.email||"",signatory_confirm_email:J.email||"",linked_in:"",phone:J.phone_number||"",signature_role:"Founder and Chief Executive Officer (CEO) \u2013 Visionary and strategic leader",other_role:"",isCurrentUser:!0};xe([e]),ge([{emailMatch:""}])}}else"No"===be&&(xe([{first_name:"",last_name:"",signatory_email:"",signatory_confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:"",isCurrentUser:!1}]),ge([{emailMatch:""}]))}),[be,J]);const[je,_e]=(0,t.useState)({emailMatch:""}),[we,Ne]=(0,t.useState)([]),[ke,Ce]=(0,t.useState)(null),[Se,ze]=(0,t.useState)(""),[Ee,Oe]=(0,t.useState)(""),[Fe,Ae]=(0,t.useState)(!0),[qe,Me]=(0,t.useState)([]),[Ie,We]=(0,t.useState)(""),[Re,Te]=(0,t.useState)([]),Pe=qe.map((e=>({value:e.code,label:e.name}))),Le=e=>{const{name:n,value:a}=e.target;$((e=>({...e,[n]:a}))),"email"!==n&&"confirm_email"!==n||("email"===n&&a!==Z.confirm_email||"confirm_email"===n&&a!==Z.email?_e((e=>({...e,emailMatch:"Emails do not match."}))):_e((e=>({...e,emailMatch:""}))))},[Ye,Be]=(0,t.useState)(!1);return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)(r.mO,{children:(0,b.jsx)("div",{className:"fullpage d-block",children:(0,b.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,b.jsx)(o.A,{isCollapsed:Ye,setIsCollapsed:Be}),(0,b.jsxs)("div",{className:"global_view "+(Ye?"global_view_col":""),children:[(0,b.jsx)(i.A,{}),(0,b.jsx)(r.$K,{className:"d-block p-md-4 p-3",children:(0,b.jsxs)("div",{className:"container-fluid",children:[_&&(0,b.jsx)("div",{className:""+(g?" mt-3 error_pop":"success_pop mt-3"),children:_}),(0,b.jsxs)("div",{className:"profile-card",children:[I&&(0,b.jsx)("div",{className:"profile-header",children:(0,b.jsxs)("div",{className:"d-flex align-items-center justify-content-between gap-3 w-100",children:[(0,b.jsxs)("div",{className:"d-flex align-items-center justify-content-start gap-2",children:[(0,b.jsx)("div",{className:"profile-icon",children:(0,b.jsxs)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,b.jsx)("path",{d:"M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"}),(0,b.jsx)("path",{d:"M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z"})]})}),(0,b.jsx)("div",{className:"profile-title",children:(0,b.jsx)("h2",{children:"Company Contact Info"})})]}),(0,b.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"1/3"})]})}),(0,b.jsx)("div",{className:"profile-content",children:(0,b.jsxs)("div",{className:"row g-3",children:[(0,b.jsx)("div",{className:"col-12 m-0 p-0",children:I&&(0,b.jsxs)("form",{onSubmit:()=>{if(""!==Z.company_website){if(!ce(Z.company_website))return C.current.scrollIntoView({behavior:"smooth",block:"center"}),void z(!0);z(!1)}T(!0),W(!1)},method:"post",action:"javascript:void(0)",children:[(0,b.jsxs)("div",{className:"row g-3",children:[(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsxs)("label",{htmlFor:"company_name",className:"label_fontWeight",children:["Name of Company"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("input",{value:Z.company_name,required:!0,type:"text",name:"company_name",id:"company_name",onChange:Le,className:"form-control",placeholder:"Enter company name"})]}),(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsxs)("label",{htmlFor:"company_name",className:"label_fontWeight",children:["Company Email"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("input",{value:Z.company_email,required:!0,type:"text",name:"company_email",id:"company_email",onChange:Le,className:"form-control",placeholder:"Enter company email"})]}),(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsxs)("label",{htmlFor:"Industry",className:"label_fontWeight",children:["Industry ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsxs)("select",{id:"Industry",value:Z.company_industory,className:"form-select",onChange:Le,name:"company_industory",required:!0,children:[(0,b.jsx)("option",{value:"",children:"Industry"}),ee.map(((e,n)=>(0,b.jsx)("option",{value:e.value||e.name,children:e.name},n)))]})]}),(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsxs)("label",{htmlFor:"phone",className:"label_fontWeight",children:["Phone ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)(d.Ay,{required:!0,value:Z.phone,name:"phone",defaultCountry:"CA",onChange:e=>{$({...Z,phone:e}),e&&e.replace(/\D/g,"").length<10?me("Phone number must be at least 10 digits"):me("")},className:"phonregister form-control",placeholder:"Enter phone number"}),pe&&(0,b.jsx)("small",{style:{color:"red"},children:pe})]}),(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsxs)("label",{htmlFor:"company_website",className:"label_fontWeight",children:["Company Website / URL"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("input",{ref:C,type:"text",required:!0,value:Z.company_website,onChange:Le,name:"company_website",id:"company_website",className:"form-control",placeholder:"Enter your company url"}),S&&(0,b.jsx)("div",{style:{fontSize:"13px"},className:"text-danger fw-semibold",children:"Please enter valid website url (eg:www.domain.com)"})]}),(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsxs)("label",{htmlFor:"employee_number",className:"label_fontWeight",children:["Number of Employees"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsxs)("select",{required:!0,onChange:Le,defaultValue:Z.employee_number,name:"employee_number",id:"employee_number",className:"form-select",children:[(0,b.jsx)("option",{value:"",children:"Select employee count range"}),(0,b.jsx)("option",{value:"1-10",children:"1-10 employees"}),(0,b.jsx)("option",{value:"11-50",children:"11-50 employees"}),(0,b.jsx)("option",{value:"51-200",children:"51-200 employees"}),(0,b.jsx)("option",{value:"201-500",children:"201-500 employees"}),(0,b.jsx)("option",{value:"501-1000",children:"501-1000 employees"}),(0,b.jsx)("option",{value:"1000+",children:"1000+ employees"})]})]}),(0,b.jsxs)("div",{className:"col-6",children:[(0,b.jsxs)("label",{style:{fontWeight:"600",fontSize:"1rem"},children:["Date of Incorporation/Registration"," ",(0,b.jsx)("span",{className:"required",children:"*"}),(0,b.jsx)("span",{className:"tooltip-icon","data-tooltip-id":"tt-cat-1","data-tooltip-html":'\n                                        <div class="d-flex flex-column gap-1 tip-content">\n                                          <ul style="margin:0; padding-left:15px;">\n                                            <li>Must match article of incorporation</li>\n                                          </ul>\n                                        </div>\n                                      ',children:(0,b.jsx)("img",{className:"blackdark",width:"15",height:"15",src:"/assets/user/images/question.png",alt:"Tip",style:{cursor:"pointer"}})}),(0,b.jsx)(u.m_,{id:"tt-cat-1",place:"top",effect:"solid",clickable:!0,delayShow:200,delayHide:100,className:"custom-tooltip"})]}),(0,b.jsx)("input",{type:"date",required:!0,value:Z.year_registration?Z.year_registration.split("T")[0]:"",name:"year_registration",id:"year_registration",className:"form-control",placeholder:"Enter here",onChange:e=>{const n=e.target.value,a=n?new Date(n).toISOString():"";$((e=>({...e,year_registration:a})))}})]}),(0,b.jsxs)("div",{className:"col-6",children:[(0,b.jsxs)("label",{className:"label_fontWeight",children:["One-sentence headliner about the company"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("textarea",{required:!0,id:"description",name:"descriptionStep4",className:"form-control",maxLength:"400",value:Z.descriptionStep4,onChange:e=>{const n=e.target.value,{name:a,value:t}=e.target;$((e=>({...e,[a]:t}))),O(n.length)},placeholder:"Max 400 characters..."}),(0,b.jsxs)("div",{className:"char-count",children:[E,"/400"]})]}),(0,b.jsxs)("div",{className:"col-6",children:[(0,b.jsxs)("label",{className:"label_fontWeight",children:["What problem are you solving?"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("textarea",{required:!0,id:"problem",name:"problemStep4",className:"form-control",maxLength:"600",value:Z.problemStep4,onChange:e=>{const n=e.target.value,{name:a,value:t}=e.target;$((e=>({...e,[a]:t}))),A(n.length)},placeholder:"Max 600 characters..."}),(0,b.jsxs)("div",{className:"char-count",children:[F,"/600"]})]}),(0,b.jsxs)("div",{className:"col-6",children:[(0,b.jsxs)("label",{className:"label_fontWeight",children:["What is Your Solution to the Problem?"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("textarea",{required:!0,id:"solution",name:"solutionStep4",className:"form-control",maxLength:"600",value:Z.solutionStep4,onChange:e=>{const n=e.target.value,{name:a,value:t}=e.target;$((e=>({...e,[a]:t}))),M(n.length)},placeholder:"Max 600 characters..."}),(0,b.jsxs)("div",{className:"char-count",children:[q,"/600"]})]})]}),(0,b.jsx)("div",{className:"col-12",children:(0,b.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,b.jsx)("div",{className:"flex-shrink-0"}),(0,b.jsx)("div",{className:"d-flex flex-row flex-shrink-0 gap-2",children:(0,b.jsx)("button",{type:"submit",className:"global_btn px-4 py-2 fn_size_sm active d-flex align-items-center gap-2",children:"Next"})})]})})]})}),(0,b.jsx)("div",{className:"col-12 m-0 p-0",children:R&&(0,b.jsx)(b.Fragment,{children:(0,b.jsxs)("form",{onSubmit:e=>{e.preventDefault();const n=[...fe];let a=!1;ue.forEach(((e,t)=>{n[t]||(n[t]={});const i=e.signatory_email,o=e.signatory_confirm_email;if(i&&o&&i!==o?(n[t].emailMatch="Emails do not match!",a=!0):n[t].emailMatch="",!e.isCurrentUser){const e=ue.map((e=>e.signatory_email)).filter((e=>e&&e===i));e.length>1&&(n[t].emailMatch="Email must be unique!",a=!0)}(e.phone||"").replace(/\D/g,"").length<10?(n[t].phone="Phone number must be at least 10 digits",a=!0):n[t].phone=""})),ge(n),a||(T(!1),L(!0))},method:"post",action:"javascript:void(0)",children:[(0,b.jsx)("div",{className:"row g-3",children:(0,b.jsx)("div",{className:"d-flex flex-column gap-3 my-4",children:(0,b.jsxs)("div",{className:"d-flex justify-content-between gap-2 pt-3 align-items-start",children:[(0,b.jsxs)("div",{className:"flex-grow-1 d-flex flex-column gap-2",children:[(0,b.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"2/3"}),(0,b.jsx)("h4",{children:"Signatories for the Company"}),(0,b.jsx)("p",{className:"text-muted mb-0",style:{fontSize:"14px",lineHeight:"1.4"},children:"Signatories are the only users on the platform with the legal authority to bind the company to contracts and agreements. They have exclusive access to create, edit, delete, and confirm capital raise rounds, maintaining full control over the company's fundraising activities. These permissions are not available to any other users."})]}),(0,b.jsx)("button",{type:"button",onClick:()=>{if(ue.length>=3)return y(!0),w("You can only add up to three signatories total."),void setTimeout((()=>{w(""),y(!1)}),3e3);const e=ue.map((e=>e.signatory_email)).filter(Boolean),n=new Set(e);if(e.length!==n.size)return y(!0),w("Please make sure all existing emails are unique before adding a new signatory."),void setTimeout((()=>{w(""),y(!1)}),3e3);xe([...ue,{first_name:"",last_name:"",signatory_email:"",signatory_confirm_email:"",linked_in:"",phone:"",signature_role:"",other_role:"",isCurrentUser:!1}]),ge([...fe,{emailMatch:""}])},className:"global_btn w-fit",style:{flexShrink:0},children:"+ Add A New Signatory"})]})})}),(0,b.jsxs)("div",{className:"col-md-6 mb-4 ",children:[(0,b.jsxs)("label",{htmlFor:"formally_legally",className:"label_fontWeight pb-2",children:["Can you formally/legally initiate a new round of investment on behalf of this company? ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsxs)(c.z6,{id:"companyStage",children:[(0,b.jsxs)(c.Zw,{children:[(0,b.jsx)("input",{type:"radio",name:"formally_legally",required:!0,value:"Yes",onChange:e=>ve(e.target.value),id:"concept",checked:"Yes"===be}),(0,b.jsx)("label",{htmlFor:"concept",children:"Yes"})]}),(0,b.jsxs)(c.Zw,{children:[(0,b.jsx)("input",{type:"radio",name:"formally_legally",value:"No",onChange:e=>ve(e.target.value),id:"planning5",required:!0,checked:"No"===be}),(0,b.jsx)("label",{htmlFor:"planning5",children:"No"})]})]}),"Yes"===be&&(0,b.jsx)("div",{className:"alert alert-info mt-2",children:(0,b.jsx)("small",{children:(0,b.jsx)("strong",{children:"\u2713 You have been automatically added as the primary signatory."})})})]}),ue.map(((e,n)=>{var a,t;return(0,b.jsxs)("div",{className:"d-flex flex-column gap-4 mb-4",children:[e.isCurrentUser&&(0,b.jsxs)("div",{className:"alert alert-success",children:[(0,b.jsx)("strong",{children:"Primary Signatory (You)"})," ","- Auto-populated from your profile"]}),(0,b.jsxs)("div",{className:"row gy-3",style:{border:"1px solid #e5e7eb",borderRadius:"8px",padding:"20px",backgroundColor:e.isCurrentUser?"#f8f9fa":"#fff"},children:[(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsxs)("label",{className:"label_fontWeight",children:["First Name"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("input",{type:"text",name:"first_name",value:e.first_name,onChange:e=>ye(n,e),placeholder:"Enter first name",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsxs)("label",{className:"label_fontWeight",children:["Last Name"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("input",{type:"text",name:"last_name",value:e.last_name,onChange:e=>ye(n,e),placeholder:"Enter last name",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsxs)("label",{className:"label_fontWeight",children:["Email"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("input",{type:"email",name:"signatory_email",value:e.signatory_email,onChange:e=>ye(n,e),placeholder:"Enter email",className:"form-control",required:!0,disabled:e.isCurrentUser})]}),(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsxs)("label",{className:"label_fontWeight",children:["Confirm Email"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("input",{type:"email",name:"signatory_confirm_email",value:e.signatory_confirm_email,onChange:e=>ye(n,e),placeholder:"Confirm email",className:"form-control",required:!0,disabled:e.isCurrentUser}),(null===(a=fe[n])||void 0===a?void 0:a.emailMatch)&&(0,b.jsx)("div",{className:"text-danger text-start fw-semibold",style:{fontSize:"13px"},children:fe[n].emailMatch})]}),(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsx)("label",{className:"label_fontWeight",children:"LinkedIn Profile"}),(0,b.jsx)("input",{type:"text",name:"linked_in",value:e.linked_in,onChange:e=>ye(n,e),placeholder:"Enter LinkedIn profile URL",className:"form-control"})]}),(0,b.jsxs)("div",{className:"col-md-6",children:[(0,b.jsxs)("label",{className:"label_fontWeight",children:["Phone Number"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)(d.Ay,{required:!0,name:"signatory_phone",defaultCountry:"CA",value:e.phone,onChange:e=>((e,n)=>{const a=[...ue];a[e].phone=n,xe(a);const t=[...fe];(n?n.replace(/\D/g,"").length:0)<10?t[e]={...t[e],phone:"Phone number must be at least 10 digits"}:t[e]&&delete t[e].phone,ge(t)})(n,e),className:"phonregister form-control",placeholder:"Enter phone number"}),(null===(t=fe[n])||void 0===t?void 0:t.phone)&&(0,b.jsx)("div",{className:"text-danger text-start fw-semibold",style:{fontSize:"13px"},children:fe[n].phone})]}),(0,b.jsxs)("div",{className:"col-md-12",children:[(0,b.jsxs)("label",{className:"label_fontWeight",children:["Role"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsxs)("select",{name:"signature_role",value:e.signature_role,onChange:e=>ye(n,e),className:"form-select",required:!0,children:[(0,b.jsx)("option",{value:"",children:"Choose Role"}),(0,b.jsx)("option",{value:"Founder and Chief Executive Officer (CEO) \u2013 Visionary and strategic leader",children:"Founder and Chief Executive Officer (CEO) \u2013 Visionary and strategic leader"}),(0,b.jsx)("option",{value:"Chief Operating Officer (COO) \u2013 Oversees daily operations",children:"Chief Operating Officer (COO) \u2013 Oversees daily operations"}),(0,b.jsx)("option",{value:"Chief Financial Officer (CFO) \u2013 Manages finances and fundraising",children:"Chief Financial Officer (CFO) \u2013 Manages finances and fundraising"}),(0,b.jsx)("option",{value:"Chief Investment Officer (CIO) \u2013 Manages engagements with investors and shareholders",children:"Chief Investment Officer (CIO) \u2013 Manages engagements with investors and shareholders"}),(0,b.jsx)("option",{value:"Chief Technology Officer (CTO) \u2013 Leads product and tech development",children:"Chief Technology Officer (CTO) \u2013 Leads product and tech development"}),(0,b.jsx)("option",{value:"Chief Marketing Officer (CMO) \u2013 Drives brand and customer acquisition",children:"Chief Marketing Officer (CMO) \u2013 Drives brand and customer acquisition"}),(0,b.jsx)("option",{value:"Chief Product Officer (CPO) \u2013 Owns product strategy and roadmap",children:"Chief Product Officer (CPO) \u2013 Owns product strategy and roadmap"}),(0,b.jsx)("option",{value:"Chief Revenue Officer (CRO) \u2013 Focuses on sales and revenue growth",children:"Chief Revenue Officer (CRO) \u2013 Focuses on sales and revenue growth"}),(0,b.jsx)("option",{value:"Chief People Officer (CPO) \u2013 Builds company culture and HR strategy",children:"Chief People Officer (CPO) \u2013 Builds company culture and HR strategy"}),(0,b.jsx)("option",{value:"Legal Counsel \u2013 Advises on contracts, IP, and compliance",children:"Legal Counsel \u2013 Advises on contracts, IP, and compliance"}),(0,b.jsx)("option",{value:"Advisory Board Member \u2013 Expert advisor guiding strategy, growth, and investor relations",children:"Advisory Board Member \u2013 Expert advisor guiding strategy, growth, and investor relations"}),(0,b.jsx)("option",{value:"Other",children:"Other"})]})]}),"Other"===e.signature_role&&(0,b.jsxs)("div",{className:"col-md-12",children:[(0,b.jsxs)("label",{className:"label_fontWeight",children:["Please specify role"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("input",{type:"text",name:"other_role",value:e.other_role,onChange:e=>ye(n,e),placeholder:"Enter specific role",className:"form-control",required:!0})]}),(0,b.jsx)("div",{className:"col-md-12 d-flex justify-content-end",children:!e.isCurrentUser&&ue.length>1&&(0,b.jsx)("button",{type:"button",className:"btn btn-danger",onClick:()=>(e=>{const n=ue.filter(((n,a)=>a!==e));xe(n)})(n),children:"Remove Signatory"})})]})]},n)})),(0,b.jsx)("div",{className:"col-12",children:(0,b.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,b.jsx)("div",{className:"flex-shrink-0",children:(0,b.jsx)("button",{type:"button",className:"global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"3",onClick:()=>{T(!1),W(!0)},children:"Back"})}),(0,b.jsx)("div",{className:"flex-shrink-0",children:(0,b.jsx)("button",{type:"submit",className:"global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"4",children:"Next"})})]})})]})})}),(0,b.jsx)("div",{className:"col-12 m-0 p-0",children:P&&(0,b.jsx)(b.Fragment,{children:(0,b.jsxs)("form",{onSubmit:async e=>{if(e.preventDefault(),Q(!0),""!==Z.company_website){if(!ce(Z.company_website))return C.current.scrollIntoView({behavior:"smooth",block:"center"}),W(!0),T(!1),L(!1),void z(!0);z(!1)}let a=!1,t=-1;const i=fe.map(((e,n)=>{const i=ue[n].signatory_email.trim(),o=ue[n].signatory_confirm_email.trim();let r="";return i&&o&&i!==o&&(r="Emails do not match!"),r&&-1===t&&(t=n,a=!0),{...e,emailMatch:r}}));if(!a){const e=ue.map((e=>e.signatory_email.trim())).filter(Boolean),n=e.filter(((n,a)=>e.indexOf(n)!==a));n.length>0&&(t=ue.findIndex((e=>e.signatory_email.trim()&&n.includes(e.signatory_email.trim()))),a=!0,W(!1),T(!0),L(!1),ue.forEach(((e,a)=>{const t=e.signatory_email.trim();t&&n.includes(t)&&(i[a]={...i[a],emailMatch:"Email must be unique!"})})))}if(a){if(ge(i),-1!==t){const e=`signatory_email_${t}`,n=document.getElementById(e);n&&(n.scrollIntoView({behavior:"smooth",block:"center"}),n.focus())}return W(!1),T(!0),L(!1),void Q(!1)}let o={company_name:Z.company_name,company_industory:Z.company_industory,phone:Z.phone,company_email:Z.company_email,company_website:Z.company_website,employee_number:Z.employee_number,year_registration:Z.year_registration,formally_legally:be,company_street_address:Z.company_street_address,company_country:ke,company_state:Z.company_state,country_code:Se,city_code:"",state_code:Ee,city_step2:Z.city_step2,company_postal_code:Z.company_postal_code,descriptionStep4:Z.descriptionStep4,problemStep4:Z.problemStep4,solutionStep4:Z.solutionStep4,signatories:ue,user_id:n.id};de(o),se(!0),Q(!1)},method:"post",action:"javascript:void(0)",children:[(0,b.jsxs)("div",{className:"row g-3",children:[(0,b.jsx)("div",{className:"col-md-12 mt-5",children:(0,b.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,b.jsx)("p",{style:{background:"#ff3d41",color:"#fff",fontSize:"0.9rem",borderRadius:"8px"},className:"rounded-xl px-3 py-1 w-fit",children:"3/3"}),(0,b.jsx)("label",{htmlFor:"",children:(0,b.jsx)("h4",{children:"Company Mailing Address"})})]})}),(0,b.jsx)("div",{className:"col-md-6",children:(0,b.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,b.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Street"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("input",{value:Z.company_street_address,onChange:Le,name:"company_street_address",required:!0,id:"",className:"form-control",placeholder:"Enter here",type:"text"})]})}),(0,b.jsx)("div",{className:"col-md-6",children:(0,b.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,b.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Country"," ",(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsxs)("select",{required:!0,value:Z.company_country,name:"company_country",onChange:e=>{const n=e.target.value;Te([]);const a=e.target.options[e.target.selectedIndex].text;Ae("Aruba"!==a&&"American Samoa"!==a),ze(n),Ce(a),$((n=>({...n,company_country:e.target.value})));const t=p.Ay.getStatesOfCountry(n);Ne(t)},placeholder:"Select or type a country",className:"form-select",children:[(0,b.jsx)("option",{value:"",children:"Select or type a country"}),Pe.map((e=>(0,b.jsx)("option",{value:e.value,children:e.label})))]})]})}),(0,b.jsx)("div",{className:"col-12",children:(0,b.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,b.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["State / Province / Territory / District"," ",Fe&&(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsxs)("select",{className:"form-select",required:!!Fe,name:"company_state",value:Ie,onChange:e=>{We(e.target.value);const n=e.target.value,a=m.A.getCitiesOfState(Z.company_country,n),t=we.find((e=>e.isoCode===n));Oe(n);const i=t?t.name:"";$((e=>({...e,company_state:i}))),0===a.length?Ae(!1):Ae(!0),Te(a)},children:[(0,b.jsx)("option",{value:"",children:"-- Select State --"}),we.map((e=>(0,b.jsx)("option",{value:e.isoCode,children:e.name},e.isoCode)))]})]})}),(0,b.jsx)("div",{className:"col-md-6",children:(0,b.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,b.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["City"," ",Fe&&(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsxs)("select",{required:!!Fe,name:"city_step2",onChange:async e=>{const n=e.target.value,a=(Z.company_state,Z.company_country,Z.company_country),t=m.A.getCitiesOfState(a,n);console.log(t),$((e=>({...e,city_step2:n})))},placeholder:"Select or type a city",className:"form-select",children:[(0,b.jsx)("option",{value:"",children:"Select or type a city"}),Re.map((e=>(0,b.jsx)("option",{value:e.name,children:e.name},e.name)))]})]})}),(0,b.jsx)("div",{className:"col-md-6",children:(0,b.jsxs)("div",{className:"d-flex flex-column gap-2",children:[(0,b.jsxs)("label",{htmlFor:"",className:"label_fontWeight",children:["Postal code/Zip"," ",Fe&&(0,b.jsx)("span",{className:"required",children:"*"})]}),(0,b.jsx)("input",{onChange:Le,type:"text",value:Z.company_postal_code,className:"form-control",required:!!Fe,name:"company_postal_code",placeholder:"Enter postal code/zip"})]})})]}),(0,b.jsx)("div",{className:"col-12 mt-4",children:(0,b.jsxs)("div",{className:"d-flex justify-content-between mt-2",children:[(0,b.jsx)("div",{className:"flex-shrink-0",children:(0,b.jsx)("button",{type:"button",className:"global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2","data-step":"3",onClick:()=>{L(!1),T(!0)},children:"Back"})}),(0,b.jsx)("div",{className:"flex-shrink-0",children:(0,b.jsxs)("button",{disabled:G,style:{opacity:G?.6:1},type:"submit",className:"global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2",children:["Save",G&&(0,b.jsx)("div",{className:" spinner-white spinner-border spinneronetimepay m-0",role:"status",children:(0,b.jsx)("span",{className:"visually-hidden"})})]})})]})})]})})})]})})]})]})})]})]})})}),U&&(0,b.jsx)(j.A,{show:U,onClose:()=>{D(!1),V(!1)},onAccept:async()=>{try{const e={user_id:n.id,status:"Yes"},t=await s.A.post(a+"saveCompanyAcknowlegment",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(t.data),("1"===t.data.status||t.data.success)&&(B([{acknowledged:!0}]),D(!1),w("Company registration agreement accepted successfully!"),setTimeout((()=>{H&&V(!1),w("")}),2500))}catch(e){console.error("Error saving acknowledgment:",e)}},companyName:""}),(0,b.jsx)(v,{show:re,onClose:()=>{se(!1),de(null)},onAccept:async()=>{se(!1),Q(!0);try{const e={...le,signatory_acknowledged:"Yes"},n=await s.A.post(`${a}companyaddWithSignatory`,e,{headers:{Accept:"application/json","Content-Type":"application/json"}});w(n.data.message),"2"===n.data.status?(y(!0),W(!0),T(!1),L(!1)):(y(!1),oe(),setTimeout((()=>{w(""),X("/user/companylist")}),3e3))}catch(e){w("Error updating profile. Please try again."),y(!0),setTimeout((()=>{w("")}),3e3)}finally{Q(!1),de(null)}},companyName:Z.company_name}),(0,b.jsx)("style",{jsx:!0,children:"\n        .profile-card {\n          background: #fff;\n          border-radius: 16px;\n          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);\n          overflow: hidden;\n        }\n\n        .profile-header {\n          display: flex;\n          align-items: center;\n          padding: 24px 32px;\n          border-bottom: 1px solid #f1f3f4;\n          background: #efefef;\n        }\n\n        .profile-icon {\n          display: flex;\n          align-items: center;\n          justify-content: center;\n          width: 48px;\n          height: 48px;\n          border-radius: 12px;\n          background: linear-gradient(\n            135deg,\n            var(--primary) 0%,\n            var(--primary-icon) 100%\n          );\n          color: white;\n          margin-right: 16px;\n        }\n\n        .profile-title h2 {\n          font-size: 24px;\n          font-weight: 600;\n          color: #0a0a0a;\n          margin: 0 0 4px 0;\n        }\n\n        .profile-title p {\n          color: #6b7280;\n          margin: 0;\n          font-size: 14px;\n        }\n\n        .profile-content {\n          padding: 32px;\n        }\n\n        .form-grid {\n          display: grid;\n          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n          gap: 24px;\n          margin-bottom: 32px;\n        }\n\n        .form-group {\n          display: flex;\n          flex-direction: column;\n        }\n\n        .form-label {\n          font-weight: 500;\n          color: #374151;\n          margin-bottom: 8px;\n          font-size: 14px;\n        }\n\n        .required {\n          color: #f63b3b;\n        }\n\n        .form-input {\n          padding: 12px 16px;\n          border: 1px solid #e5e7eb;\n          border-radius: 8px;\n          font-size: 16px;\n          transition: all 0.2s ease;\n          background: #fff;\n        }\n\n        .form-input:focus {\n          outline: none;\n          border-color: #f63b3b;\n          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);\n        }\n\n        .form-input:disabled {\n          background-color: #f9fafb;\n          color: #6b7280;\n          cursor: not-allowed;\n        }\n\n        .input-note {\n          font-size: 12px;\n          color: #6b7280;\n          margin-top: 4px;\n        }\n\n        .phone-input {\n          padding: 12px 16px;\n          border: 1px solid #e5e7eb;\n          border-radius: 8px;\n          font-size: 16px;\n          width: 100%;\n        }\n\n        .phone-input:focus {\n          outline: none;\n          border-color: #f63b3b;\n          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);\n        }\n\n        .input-with-icon {\n          position: relative;\n          display: flex;\n          align-items: center;\n        }\n\n        .input-icon {\n          position: absolute;\n          left: 12px;\n          color: #6b7280;\n          z-index: 1;\n        }\n\n        .input-with-icon .form-input {\n          padding-left: 40px;\n        }\n\n        .form-actions {\n          display: flex;\n          justify-content: flex-end;\n          border-top: 1px solid #f1f3f4;\n          padding-top: 24px;\n        }\n\n        .btn-primary {\n          display: inline-flex;\n          align-items: center;\n          gap: 8px;\n          background: linear-gradient(135deg, #f63b3b 0%, #e03535 100%);\n          color: white;\n          border: none;\n          border-radius: 8px;\n          padding: 12px 24px;\n          font-size: 16px;\n          font-weight: 500;\n          cursor: pointer;\n          transition: all 0.2s ease;\n        }\n\n        .btn-primary:hover:not(:disabled) {\n          transform: translateY(-2px);\n          box-shadow: 0 4px 12px rgba(246, 59, 59, 0.25);\n        }\n\n        .btn-primary:disabled {\n          opacity: 0.7;\n          cursor: not-allowed;\n          transform: none;\n        }\n\n        .spinner {\n          width: 16px;\n          height: 16px;\n          border: 2px solid rgba(255, 255, 255, 0.3);\n          border-radius: 50%;\n          border-top-color: white;\n          animation: spin 1s ease-in-out infinite;\n        }\n\n        @keyframes spin {\n          to {\n            transform: rotate(360deg);\n          }\n        }\n\n        .alert {\n          padding: 12px 16px;\n          border-radius: 8px;\n          margin-bottom: 24px;\n          font-weight: 500;\n        }\n\n        .alert-success {\n          background-color: #ecfdf5;\n          color: #065f46;\n          border: 1px solid #a7f3d0;\n        }\n\n        .alert-error {\n          background-color: #fef2f2;\n          color: #991b1b;\n          border: 1px solid #fecaca;\n        }\n\n        @media (max-width: 768px) {\n          .profile-header {\n            padding: 20px;\n          }\n\n          .profile-content {\n            padding: 20px;\n          }\n\n          .form-grid {\n            grid-template-columns: 1fr;\n            gap: 20px;\n          }\n\n          .form-actions {\n            justify-content: center;\n          }\n\n          .btn-primary {\n            width: 100%;\n            justify-content: center;\n          }\n        }\n      "})]})}},78384:(e,n,a)=>{a.d(n,{A:()=>t});const t=(0,a(77784).A)("shield-check",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]])}}]);
//# sourceMappingURL=772.2dad3d55.chunk.js.map