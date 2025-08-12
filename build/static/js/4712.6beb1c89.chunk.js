"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[4712],{18622:(e,t,o)=>{o.d(t,{A:()=>n});var i=o(65043),a=o(70579);const n=function(e){let{message:t,onClose:o}=e;const[n,r]=(0,i.useState)("show");return(0,i.useEffect)((()=>{const e=setTimeout((()=>{r("")}),2500),t=setTimeout((()=>{o()}),3e3);return()=>{clearTimeout(e),clearTimeout(t)}}),[o]),(0,a.jsxs)("div",{className:`alert alert-success alert-dismissible fade ${n}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:9999,minWidth:"300px",maxWidth:"90%"},children:[(0,a.jsx)("strong",{children:"Success!"})," ",t,(0,a.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:o})]})}},34939:(e,t,o)=>{o.d(t,{A:()=>n});var i=o(65043),a=o(70579);const n=function(e){let{message:t,onClose:o}=e;const[n,r]=(0,i.useState)("show");return(0,i.useEffect)((()=>{const e=setTimeout((()=>{r("")}),3500),t=setTimeout((()=>{o()}),3e3);return()=>{clearTimeout(e),clearTimeout(t)}}),[o]),(0,a.jsxs)("div",{className:`alert alert-danger alert-dismissible fade ${n}`,role:"alert",style:{position:"fixed",top:"20px",right:"20px",zIndex:999999,minWidth:"300px",maxWidth:"90%"},children:[(0,a.jsx)("strong",{children:"Error!"})," ",t,(0,a.jsx)("button",{type:"button",className:"btn-close","aria-label":"Close",onClick:o})]})}},62837:(e,t,o)=>{o.d(t,{$K:()=>d,CB:()=>p,Cd:()=>b,FC:()=>l,Jq:()=>x,R3:()=>y,SD:()=>r,Zw:()=>u,dN:()=>m,hJ:()=>g,mO:()=>a,mg:()=>s,nj:()=>v,pd:()=>w,uM:()=>f,vE:()=>n,z6:()=>c});var i=o(5464);const a=i.default.div`
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
`,n=i.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,r=(i.default.div`
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
  background: var(--primary-color);
  border-bottom: 10px solid var(--secondary-color);
  .logo {
    display: inline-block;
    width: 140px;
    img {
      width: 100%;
    }
  }
`),l=i.default.div`
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
`,d=i.default.div`
  display: block;
  padding: 3rem 0; /* py-5 is 3rem top & bottom */
  background-color: #f3f5f7;
  min-height: 100vh;
`,s=i.default.div`
  // display: none;
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;

  &.active {
    display: block;
  }

  label {
    font-size: 16px;
    font-weight: 600;
    text-transform: capitalize;
  }

  input[type="text"],
  input[type="number"],
  input[type="email"],
  input[type="tel"],
  select {
    padding: 6px 8px 6px 35px;
    font-size: 16px;
    height: 37px;
    border-bottom: 2px solid #ccc;
    border-top: none;
    border-left: none;
    border-right: none;
    border-radius: 0px;
    width: 100%;
    background: #fff;
  }

  textarea {
    padding: 6px 8px 6px 35px;
    font-size: 16px;
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
    border-radius: 4px;
    display: inline-block;
    padding: 6px 20px;
    text-transform: capitalize;
    font-size: 16px;
  }

  .nextbtn {
    background: var(--primary-color);
    color: #fff;

    &:hover {
      background: var(--primary-color);
    }
  }

  .backbtn {
    background: #111;
    color: #fff;

    &:hover {
      background: #2b2b2b;
    }
  }
`,p=i.default.div`
  color: var(--primary-color);
  font-size: 30px;
  text-align: center;
  text-transform: uppercase;
  font-weight: 600;
  text-decoration: underline;
  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=i.default.div`
  display: flex;
  flex-direction: column;
  gap: 10px 0;
`,u=i.default.div`
  label {
    font-weight: 400;
    cursor: pointer;
    margin-left: 10px;
  }
`,x=(i.default.div`
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
    left: 6px;
    width: 16px; /* smaller width */
    height: 16px; /* smaller height */
    stroke: #9c9c9c;
    stroke-width: 1.2;
  }
`),f=(i.default.div`
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
    color: var(--primary-color);
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
`),h=(i.default.div`
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
  border-radius: 50%;
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
`),m=((0,i.default)(h)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,i.default)(h)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,i.default.sup`
  color: var(--primary-color);
`),g=i.default.div`
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
`,v=i.default.button`
  position: absolute;
  top: -8px;
  right: -8px;
  border: none;
  background: #111;
  color: #fff;
  padding: 0px;
  border-radius: 100%;
  cursor: pointer;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  height: 26px;
`,w=i.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 16px;
`,y=i.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},95716:(e,t,o)=>{o.r(t),o.d(t,{default:()=>h});var i=o(65043),a=o(14404),n=(o(25015),o(65136)),r=(o(34939),o(18622),o(38421),o(62837)),l=o(73216),d=o(86178),s=o.n(d),p=o(87268),c=(o(83656),o(71173)),u=o(44710),x=o(86213),f=o(70579);function h(){(0,l.Zp)();const[e,t]=(0,i.useState)(!1),[o,d]=(0,i.useState)({name:"",email:""}),[h,m]=((0,p.ye)(s()),(0,i.useState)([])),[g,b]=(0,i.useState)(""),[v,w]=(0,i.useState)(""),[y,k]=(0,i.useState)(""),[j,z]=(0,i.useState)(""),[S,N]=(0,i.useState)(null),[C,T]=(0,i.useState)(""),[E,I]=(0,i.useState)(!0),[A,Z]=(0,i.useState)(""),[F,O]=(0,i.useState)(""),[_,D]=(0,i.useState)(""),{id:$}=(0,l.g)(),[M,V]=(0,i.useState)(""),W="https://blueprintcatalyst.com/api/user/",q=e=>{d({...o,[e.target.name]:e.target.value})};(0,i.useEffect)((()=>{if(Intl.supportedValuesOf){const e=Intl.supportedValuesOf("timeZone");P(e)}}),[]),(0,i.useEffect)((()=>{(async()=>{let e={id:$};try{const t=await x.A.post(W+"selectModule",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});t.data.results.length>0&&O(t.data.results[0])}catch(t){}})()}),[$]),(0,i.useEffect)((()=>{document.title="Module Page"}),[]);(0,i.useEffect)((()=>{(async()=>{try{const e=await fetch("https://api.ipify.org?format=json"),t=await e.json();b(t.ip)}catch(e){console.error("Failed to fetch IP",e)}})()}),[]);const[J,P]=(0,i.useState)([]),[R,Y]=(0,i.useState)(Intl.DateTimeFormat().resolvedOptions().timeZone);(0,i.useEffect)((()=>{if(Intl.supportedValuesOf){const e=Intl.supportedValuesOf("timeZone");P(e)}}),[]),(0,i.useEffect)((()=>{const e=()=>{const e=new Intl.DateTimeFormat("en-US",{hour:"2-digit",minute:"2-digit",hour12:!0,timeZone:R}).format(new Date);Z(e)};e();const t=setInterval(e,6e4);return()=>clearInterval(t)}),[R]);const B=new Date;B.setHours(0,0,0,0);return(0,f.jsx)(f.Fragment,{children:(0,f.jsxs)(r.mO,{children:[(0,f.jsxs)("div",{className:"fullpage d-block",children:[(0,f.jsx)(n.A,{}),(0,f.jsx)(r.$K,{className:"d-block py-5",children:(0,f.jsx)("div",{className:"container-lg",children:(0,f.jsxs)("div",{className:"row justify-content-center",children:[(0,f.jsx)("div",{className:"col-md-3",children:(0,f.jsx)(u.A,{})}),(0,f.jsx)("div",{className:"col-md-9",children:(0,f.jsx)("form",{action:"",children:(0,f.jsx)(r.mg,{id:"step5",children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-5",children:[(0,f.jsx)(r.CB,{children:" Meetings"}),(0,f.jsx)("div",{className:"row gy-3",children:(0,f.jsx)("div",{className:"col-md-12 text-center"})})]})})})})]})})})]}),(0,f.jsx)(r.hJ,{show:e,children:(0,f.jsxs)(r.Cd,{children:[(0,f.jsx)(r.nj,{onClick:()=>t(!1),children:"\xd7"}),(0,f.jsx)("form",{onSubmit:async e=>{e.preventDefault();let o={name:e.target.name.value,email:e.target.email.value,timeset:C,module_id:$,ip_address:g,selectedZone:R,selectedSlots:h,description:M};D(!0);try{const e=await x.A.post(W+"registerforZoom",o,{headers:{Accept:"application/json","Content-Type":"application/json"}});D(!1);var i=e.data;if("2"===i.status)return z(""),void k(i.message);if("1"===i.status)return k(""),z(i.message),t(!1),void setTimeout((()=>{window.location.reload()}),3e3)}catch(a){}console.log("Form submitted",o)},children:(0,f.jsxs)("div",{className:"d-flex flex-column gap-3",children:[(0,f.jsx)("h3",{className:"text-center",children:"Register"}),(0,f.jsx)("div",{className:"d-block",children:(0,f.jsx)(r.pd,{type:"text",name:"name",placeholder:"Your Name *",value:o.name,onChange:q,required:!0})}),(0,f.jsx)("div",{className:"d-block",children:(0,f.jsx)(r.pd,{type:"email",name:"email",placeholder:"Your Email *",value:o.email,onChange:q,required:!0})}),(0,f.jsx)("div",{className:"d-block",children:(0,f.jsx)(a.Ay,{name:"time",selected:S,onChange:e=>{const t=(0,c.L_)(e,R),o=(0,c.GP)(e,"hh:mm a");T(o),N(t)},showTimeSelect:!0,showTimeSelectOnly:!0,timeIntervals:15,dateFormat:"h:mm aa",placeholderText:"Select Time *"})}),(0,f.jsxs)("div",{className:"d-flex align-items-center justify-content-end gap-2",children:[_&&(0,f.jsx)("div",{className:"spinner-border text-danger",role:"status",style:{width:"1.5rem",height:"1.5rem"},children:(0,f.jsx)("span",{className:"visually-hidden",children:"Loading..."})}),(0,f.jsx)(r.R3,{type:"submit",style:{width:"100%",opacity:_?.5:1,pointerEvents:_?"none":"auto"},children:"Submit For Zoom"})]})]})})]})})]})})}}}]);
//# sourceMappingURL=4712.6beb1c89.chunk.js.map