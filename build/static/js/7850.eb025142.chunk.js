"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[7850],{37850:(e,t,i)=>{i.r(t),i.d(t,{default:()=>x});var a=i(65043),o=i(94060),r=i(44710),n=i(20751),d=(i(38421),i(62837)),l=i(86213),s=i(92823),p=i.n(s),c=(i(25884),i(25581)),u=i(70579);function x(){const[e,t]=(0,a.useState)(!1);document.title="Authorized Signature";const[i,s]=(0,a.useState)(""),[x,g]=(0,a.useState)(null),[f,h]=(0,a.useState)(""),[b,m]=(0,a.useState)(""),[v,w]=(0,a.useState)(!1),[y,k]=(0,a.useState)(null),[j,z]=(0,a.useState)(""),S=(0,a.useRef)(null),N=localStorage.getItem("SignatoryLoginData"),_=JSON.parse(N),C=c.J+"api/user/";(0,a.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),t=await e.json();z(t.ip)}catch(e){console.error("Failed to fetch IP",e)}})()}),[]),(0,a.useEffect)((()=>{A()}),[]);const A=async()=>{let e={company_id:_.companies[0].id,user_id:_.id};try{const t=(await l.A.post(C+"getAuthorizedSignature",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data.results;t.length>0&&k(t[0])}catch(t){}};return(0,u.jsx)(d.mO,{children:(0,u.jsx)("div",{className:"fullpage d-block",children:(0,u.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,u.jsx)(r.A,{isCollapsed:e,setIsCollapsed:t}),(0,u.jsxs)("div",{className:"global_view "+(e?"global_view_col":""),children:[(0,u.jsx)(o.A,{}),(0,u.jsx)(d.$K,{className:"d-block p-md-4 p-3",children:(0,u.jsxs)("div",{className:"container-fluid",children:[(0,u.jsx)("div",{className:"subscription-header",children:(0,u.jsxs)("div",{className:"subscription-title",children:[(0,u.jsx)("h1",{children:"Authorized Signature"}),(0,u.jsx)("p",{children:"Select one method to submit your signature"})]})}),b&&(0,u.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+(v?"error_pop":"success_pop"),children:[(0,u.jsx)("div",{className:"d-flex align-items-center gap-2",children:(0,u.jsx)("span",{className:"d-block",children:b})}),(0,u.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>m(""),children:"\xd7"})]}),(0,u.jsx)("div",{className:"row gy-3 py-3",children:y?(0,u.jsxs)("div",{className:"col-md-12",children:[(0,u.jsx)("h5",{children:"Saved Signature:"}),(0,u.jsxs)("p",{children:["Status:"," ",(0,u.jsx)("strong",{style:{color:"Yes"===y.approve?"green":"red"},children:"Yes"===y.approve?"Approved":"Not Approved"})]}),"upload"===y.type&&(0,u.jsx)("img",{src:`${c.J}api/upload/docs/doc_${y.company_id}/signatory/${y.signature}`,alt:"Uploaded Signature",style:{maxWidth:"300px"}}),"manual"===y.type&&(0,u.jsx)("div",{dangerouslySetInnerHTML:{__html:y.signature},style:{border:"1px solid #ced4da",padding:"10px",minHeight:"120px"}}),"pad"===y.type&&(0,u.jsx)("img",{src:y.signature,alt:"Signature Pad",style:{maxWidth:"300px"}})]}):(0,u.jsxs)(u.Fragment,{children:[["manual","pad"].map((e=>(0,u.jsx)("div",{className:"col-md-4",children:(0,u.jsx)("button",{onClick:()=>(e=>{s(e),"upload"!==e&&g(null),"manual"!==e&&h(""),"pad"!==e&&S.current&&S.current.clear()})(e),style:{width:"100%",backgroundColor:i===e?"#F63C3F":"transparent",borderColor:"#F63C3F",color:i===e?"#fff":"#F63C3F",padding:"10px",borderRadius:"5px",borderWidth:"1px",borderStyle:"solid",cursor:"pointer"},children:"manual"===e?"Manual Signature":"Signature Pad"})},e))),"manual"===i&&(0,u.jsx)("div",{className:"col-md-12 mt-3",children:(0,u.jsx)(p(),{theme:"snow",value:f,onChange:h,placeholder:"Type your signature here",modules:{toolbar:[["bold","italic","underline"],[{size:[]}],[{color:[]},{background:[]}],["clean"]]},formats:["bold","italic","underline","size","color","background"],style:{minHeight:"120px"}})}),"pad"===i&&(0,u.jsxs)("div",{className:"col-md-12 mt-3",children:[(0,u.jsx)(n.A,{ref:S,canvasProps:{width:500,height:200,className:"border"}}),(0,u.jsx)("button",{className:"btn btn-warning mt-2 text-white",onClick:()=>S.current&&S.current.clear(),children:"Clear Signature"})]}),(0,u.jsx)("div",{className:"col-md-12 mt-4",children:(0,u.jsx)("button",{className:"global_btn w-fit px-4 py-2 fn_size_sm active d-flex align-items-center gap-2",onClick:async()=>{var e;if(!i)return w(!0),void m("Please select a signature method!");if("upload"===i&&!x||"manual"===i&&!f||"pad"===i&&null!==(e=S.current)&&void 0!==e&&e.isEmpty())return w(!0),void m("Please provide your signature for the selected method!");const t=new FormData;if(t.append("method",i),t.append("company_id",_.companies[0].id),t.append("signatory_id",_.id),t.append("email",_.email),t.append("ip_address",j),"upload"===i)t.append("file",x);else if("manual"===i)t.append("manual",f);else if("pad"===i){const e=S.current.toDataURL();t.append("signature_pad",e)}try{await l.A.post(`${C}authorizedSignature`,t,{headers:{"Content-Type":"multipart/form-data"}});w(!1),m("Signature submitted successfully and awaiting company owner approval"),setTimeout((()=>{A(),w(!1),m("")}),3e3)}catch(a){console.error("Error submitting signature:",a),alert("Error submitting signature. Please try again.")}},children:"Submit Signature"})})]})})]})})]})]})})})}},62837:(e,t,i)=>{i.d(t,{$K:()=>n,CB:()=>l,Cd:()=>m,I0:()=>p,Jq:()=>x,R3:()=>y,Zw:()=>u,dN:()=>h,hJ:()=>b,jh:()=>s,mO:()=>o,mg:()=>d,nj:()=>v,pd:()=>w,uM:()=>g,vE:()=>r,z6:()=>c});var a=i(5464);const o=a.default.div`
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
`,n=(a.default.div`
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
`),d=a.default.div`
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
`,s=a.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,p=a.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,c=a.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,u=a.default.div`
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
`),g=(a.default.div`
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
`),f=(a.default.div`
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
`),h=((0,a.default)(f)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(f)`
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
  display: ${e=>{let{show:t}=e;return t?"flex":"none"}};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`,m=a.default.div`
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
`,w=a.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,y=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`}}]);
//# sourceMappingURL=7850.eb025142.chunk.js.map