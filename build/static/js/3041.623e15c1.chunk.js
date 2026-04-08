/*! For license information please see 3041.623e15c1.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[3041],{53639:(e,t,o)=>{o.d(t,{A:()=>r});const r=(0,o(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},62837:(e,t,o)=>{o.d(t,{$K:()=>a,CB:()=>l,Cd:()=>m,I0:()=>p,Jq:()=>x,R3:()=>w,dN:()=>h,hJ:()=>u,jh:()=>d,mO:()=>n,mg:()=>s,nj:()=>b,pd:()=>y,uM:()=>f,vE:()=>i,z6:()=>c});var r=o(5464);const n=r.default.div`
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
`,i=r.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,a=(r.default.div`
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
`),s=r.default.div`
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
`,l=r.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=r.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,p=r.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,c=r.default.div`
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
`),f=(r.default.div`
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
`),g=(r.default.div`
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
`),h=((0,r.default)(g)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,r.default)(g)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,r.default.sup`
  color: var(--primary);
`),u=r.default.div`
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
`,m=r.default.div`
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
`,b=r.default.button`
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
`,y=r.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,w=r.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},87011:(e,t,o)=>{o.r(t),o.d(t,{default:()=>h});var r=o(65043),n=o(62837),i=o(86213),a=o(58786),s=o(60184),l=o(40614),d=o(73216),p=o(87511),c=o(81906),x=o(27836),f=(o(49535),o(25581)),g=o(70579);const h=function(){const[e,t]=(0,r.useState)(null),{id:o}=(0,d.g)();(0,d.Zp)(),document.title="DataRoom Management Doc- Investor";const[h,u]=(0,r.useState)(!1),[m,b]=(0,r.useState)(null);var y=f.J+"api/user/dataroom/";const w=localStorage.getItem("InvestorData"),v=JSON.parse(w),[k,j]=(0,r.useState)(""),[C,z]=(0,r.useState)(!1),[S,N]=(0,r.useState)([]);(0,r.useEffect)((()=>{_()}),[]);const _=async()=>{let e={investor_id:v.id,company_id:Number(o)};try{const t=await i.A.post(y+"getInvestorDataRoomList",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});N(t.data.results)}catch(t){console.error("Error fetching data:",t)}};function R(e){const t=new Date(e);if(isNaN(t))return"";const o=t.getDate(),r=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][t.getMonth()],n=t.getFullYear();let i=t.getHours();t.getMinutes().toString().padStart(2,"0"),t.getSeconds().toString().padStart(2,"0");return i%=12,i=i||12,`${r} ${o}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(o)}, ${n}`}const I=S&&S.length>0?S.filter((e=>{const t=k.toLowerCase();return`\n      ${e.company_name||""}\n      ${e.report_type||""}\n      ${e.doc_name||""}\n      ${e.access_status||""}\n      ${e.sent_date?new Date(e.sent_date).toLocaleDateString():""}\n    `.toLowerCase().includes(t)})):[];(0,r.useEffect)((()=>{const o=()=>{null!==e&&t(null)};return document.addEventListener("click",o),()=>{document.removeEventListener("click",o)}}),[e]);const M=async e=>{let r={investor_id:v.id,company_id:Number(o),sharereport_id:e.id};try{await i.A.post(y+"getreportstatusUpdate",r,{headers:{Accept:"application/json","Content-Type":"application/json"}});_(),e.downloadUrl?window.open(e.downloadUrl,"_blank"):(console.error("No download URL available"),alert("Download URL not available")),t(null)}catch(n){console.error("Error fetching data:",n)}};return(0,g.jsxs)("main",{children:[(0,g.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,g.jsx)(p.A,{}),(0,g.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,g.jsx)(c.A,{}),(0,g.jsx)(n.$K,{className:"d-block p-md-4 p-3",children:(0,g.jsx)("div",{className:"container-fluid",children:(0,g.jsxs)(x.zP,{className:"d-flex flex-column gap-3",children:[(0,g.jsx)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:(0,g.jsx)("h4",{className:"mainh1",children:"Company List"})}),(0,g.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,g.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:k,onChange:e=>j(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,g.jsxs)("div",{className:"d-flex  flex-column justify-content-between align-items-start tb-box",children:[(0,g.jsx)("style",{children:"\n                        .datatb-report {\n                          overflow: visible !important;\n                        }\n                      "}),(0,g.jsx)(a.Ay,{customStyles:{table:{style:{minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px",overflow:"visible"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap",overflow:"visible"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important",overflow:"visible"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500",position:"relative","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"Company Name",selector:e=>e.company_name,sortable:!0,cell:e=>(0,g.jsxs)("div",{className:"d-flex align-items-center",children:[(0,g.jsx)("div",{className:"bg-primary bg-opacity-10 p-2 rounded-circle me-3",children:(0,g.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-primary",viewBox:"0 0 16 16",children:(0,g.jsx)("path",{d:"M14.763.075A.5.5 0 0 1 15 .5v15a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5V14h-1v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V10H.5a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5H2V.5a.5.5 0 0 1 .5-.5h12a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H14v8.5a.5.5 0 0 1 .5.5h2a.5.5 0 0 1 .5-.5V.575a.5.5 0 0 1-.237.5zM3 1.5v13h8V1.5H3zm10.5 0v13h1V1.5h-1z"})})}),(0,g.jsx)("span",{children:e.company_name})," "]})},{name:"Doc type",selector:e=>e.report_type,sortable:!0,cell:e=>(0,g.jsxs)("div",{className:"d-flex align-items-center",children:[(0,g.jsx)("div",{className:"bg-info bg-opacity-10 p-2 rounded me-2",children:(0,g.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-info",viewBox:"0 0 16 16",children:(0,g.jsx)("path",{d:"M3.654 1.328a.678.678 0 0 1 .736-.128l2.261.904c.329.131.445.507.249.777L5.08 4.58a.678.678 0 0 1-.746.225l-1.01-.303a11.72 11.72 0 0 0 5.516 5.516l.303-1.01a.678.678 0 0 1 .225-.746l1.195-1.195c.27-.196.646-.08.777.249l.904 2.261a.678.678 0 0 1-.128.736l-2.307 2.307c-.329.329-.888.329-1.217 0l-1.927-1.927a13.134 13.134 0 0 1-6.29-6.29L1.328 2.545c-.329-.329-.329-.888 0-1.217L3.654 1.328z"})})}),(0,g.jsx)("span",{children:e.report_type})]})},{name:"Sent Date",selector:e=>e.sent_date,sortable:!0,cell:e=>(0,g.jsxs)("div",{className:"d-flex align-items-center",children:[(0,g.jsx)("div",{className:"bg-success bg-opacity-10 p-2 rounded me-2",children:(0,g.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-success",viewBox:"0 0 16 16",children:(0,g.jsx)("path",{d:"M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM4.882 1.731a.482.482 0 0 0 .14.291.487.487 0 0 0 .292.14.49.49 0 0 0 .356 0 .487.487 0 0 0 .292-.14.482.482 0 0 0 .14-.291.484.484 0 0 0-.14-.292.483.483 0 0 0-.292-.14.484.484 0 0 0-.356 0 .483.483 0 0 0-.292.14.484.484 0 0 0-.14.292zM7.5 11.5V12h-4v-1h1v-1h1v-1h1v-1h-1V8h1V7h1V6h1V5h-1V4h1V3h1V2h1v9h-1z"})})}),(0,g.jsxs)("span",{children:[" ",R(e.sent_date)]})," "]})},{name:"Access Status",selector:e=>e.access_status,sortable:!0,cell:e=>{let t="",o="";return"Download"===e.access_status?(t="#065f46",o="#d1fae5"):"Only View"===e.access_status?(t="#1e40af",o="#dbeafe"):(t="#b91c1c",o="#fee2e2"),(0,g.jsx)("span",{style:{padding:"4px 12px",borderRadius:"12px",fontWeight:600,color:t,backgroundColor:o,fontSize:"12px",display:"inline-block"},children:"Download"===e.access_status?"\ud83d\udce5 Download":"Only View"===e.access_status?"\ud83d\udc41\ufe0f View Only":"\u23f3 Not Viewed"})}},{name:"Actions",cell:o=>(0,g.jsxs)("div",{className:"position-relative",style:{position:"relative",zIndex:9999},children:[(0,g.jsx)("button",{className:"btn btn-light btn-sm",onClick:r=>((o,r)=>{r.stopPropagation(),t(e===o?null:o)})(o.id,r),style:{border:"1px solid #ddd",borderRadius:"6px",padding:"4px 8px",cursor:"pointer"},children:(0,g.jsx)(s.H_v,{})}),e===o.id&&(0,g.jsxs)("div",{className:"dropdown-menu show",style:{position:"absolute",top:"100%",right:0,left:"auto",minWidth:"220px",zIndex:99999,borderRadius:"8px",background:"#fff",boxShadow:"0 4px 12px rgba(0,0,0,0.15)",display:"block",marginTop:"4px"},children:[(0,g.jsxs)("button",{className:"dropdown-item",style:{display:"flex",alignItems:"center",gap:"8px",padding:"8px 16px",color:"#333",textDecoration:"none",width:"100%",background:"none",border:"none",cursor:"pointer"},onClick:()=>(e=>{b(e),u(!0),t(null)})(o),children:[(0,g.jsx)(s.Ny1,{})," View Report"]}),(0,g.jsxs)(g.Fragment,{children:[(0,g.jsx)("div",{className:"dropdown-divider",style:{margin:"4px 0"}}),(0,g.jsxs)("button",{className:"dropdown-item",style:{display:"flex",alignItems:"center",gap:"8px",padding:"8px 16px",color:"#333",textDecoration:"none",width:"100%",background:"none",border:"none",cursor:"pointer"},onClick:()=>M(o),children:[(0,g.jsx)(s.WCW,{})," Download Report"]})]})]})]}),ignoreRowClick:!0,allowOverflow:!0,button:!0,width:"120px"}],className:"datatb-report",data:I,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})]})]})})})]})]}),h&&m&&(0,g.jsxs)("div",{style:{position:"fixed",top:0,left:0,right:0,bottom:0,backgroundColor:"rgba(0, 0, 0, 0.75)",zIndex:999999,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)",animation:"fadeIn 0.3s ease-out"},onClick:()=>u(!1),children:[(0,g.jsx)("style",{children:"\n        @keyframes fadeIn {\n          from {\n            opacity: 0;\n            backdrop-filter: blur(0px);\n          }\n          to {\n            opacity: 1;\n            backdrop-filter: blur(8px);\n          }\n        }\n        \n        @keyframes slideUp {\n          from {\n            transform: translateY(30px);\n            opacity: 0;\n          }\n          to {\n            transform: translateY(0);\n            opacity: 1;\n          }\n        }\n        \n        @keyframes pulse {\n          0% {\n            box-shadow: 0 0 0 0 rgba(204, 0, 0, 0.4);\n          }\n          70% {\n            box-shadow: 0 0 0 10px rgba(204, 0, 0, 0);\n          }\n          100% {\n            box-shadow: 0 0 0 0 rgba(204, 0, 0, 0);\n          }\n        }\n      "}),(0,g.jsxs)("div",{style:{backgroundColor:"#fff",borderRadius:"24px",maxWidth:"650px",width:"90%",maxHeight:"85vh",overflowY:"auto",boxShadow:"0 25px 50px -12px rgba(0, 0, 0, 0.25)",animation:"slideUp 0.3s ease-out",fontFamily:"'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"},onClick:e=>e.stopPropagation(),children:[(0,g.jsxs)("div",{style:{padding:"24px 28px",background:"linear-gradient(135deg, #CC0000 0%, #8B0000 100%)",display:"flex",justifyContent:"space-between",alignItems:"center",borderRadius:"24px 24px 0 0",position:"relative"},children:[(0,g.jsxs)("div",{children:[(0,g.jsxs)("h5",{style:{margin:0,fontWeight:700,fontSize:"1.25rem",color:"#fff",letterSpacing:"-0.3px"},children:[(0,g.jsx)(s.Ny1,{style:{marginRight:"10px",fontSize:"1.1rem",verticalAlign:"middle"}}),"Report Details"]}),(0,g.jsx)("p",{style:{margin:"4px 0 0",fontSize:"0.75rem",color:"rgba(255,255,255,0.8)"},children:"View complete report information"})]}),(0,g.jsx)("button",{onClick:()=>u(!1),style:{background:"rgba(255,255,255,0.2)",border:"none",cursor:"pointer",padding:"8px",borderRadius:"12px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s ease",color:"#fff"},onMouseEnter:e=>{e.currentTarget.style.background="rgba(255,255,255,0.3)",e.currentTarget.style.transform="scale(1.05)"},onMouseLeave:e=>{e.currentTarget.style.background="rgba(255,255,255,0.2)",e.currentTarget.style.transform="scale(1)"},children:(0,g.jsx)(l.A,{size:20})})]}),(0,g.jsxs)("div",{style:{padding:"28px"},children:[(0,g.jsxs)("div",{style:{background:"linear-gradient(135deg, #fff5f5 0%, #fff0f0 100%)",borderRadius:"16px",padding:"20px",marginBottom:"24px",border:"1px solid rgba(204, 0, 0, 0.1)"},children:[(0,g.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:"12px",marginBottom:"16px"},children:[(0,g.jsx)("div",{style:{width:"40px",height:"40px",background:"linear-gradient(135deg, #CC0000 0%, #8B0000 100%)",borderRadius:"12px",display:"flex",alignItems:"center",justifyContent:"center"},children:(0,g.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,g.jsx)("path",{d:"M19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21Z",stroke:"white",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,g.jsx)("path",{d:"M12 11C13.1046 11 14 10.1046 14 9C14 7.89543 13.1046 7 12 7C10.8954 7 10 7.89543 10 9C10 10.1046 10.8954 11 12 11Z",stroke:"white",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,g.jsx)("path",{d:"M7 17V16C7 14.9391 7.42143 13.9217 8.17157 13.1716C8.92172 12.4214 9.93913 12 11 12H13C14.0609 12 15.0783 12.4214 15.8284 13.1716C16.5786 13.9217 17 14.9391 17 16V17",stroke:"white",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,g.jsxs)("div",{children:[(0,g.jsx)("h6",{style:{margin:0,fontSize:"0.85rem",fontWeight:600,color:"#CC0000",textTransform:"uppercase",letterSpacing:"0.5px"},children:"Company Information"}),(0,g.jsx)("p",{style:{margin:"4px 0 0",fontSize:"0.7rem",color:"#6c757d"},children:"Basic company details"})]})]}),(0,g.jsxs)("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"},children:[(0,g.jsxs)("div",{children:[(0,g.jsx)("div",{style:{fontSize:"0.7rem",color:"#6c757d",marginBottom:"4px"},children:"Company Name"}),(0,g.jsx)("div",{style:{fontSize:"0.9rem",fontWeight:600,color:"#1e293b"},children:m.company_name||"N/A"})]}),(0,g.jsxs)("div",{children:[(0,g.jsx)("div",{style:{fontSize:"0.7rem",color:"#6c757d",marginBottom:"4px"},children:"Report Type"}),(0,g.jsx)("div",{style:{fontSize:"0.9rem",fontWeight:600,color:"#1e293b"},children:m.report_type||"N/A"})]})]})]}),(0,g.jsxs)("div",{style:{background:"#fff",borderRadius:"16px",padding:"20px",marginBottom:"24px",border:"1px solid #e9ecef",boxShadow:"0 1px 3px rgba(0,0,0,0.05)"},children:[(0,g.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:"12px",marginBottom:"16px",borderBottom:"2px solid #f1f5f9",paddingBottom:"12px"},children:[(0,g.jsx)("div",{style:{width:"36px",height:"36px",background:"#fff0f0",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center"},children:(0,g.jsx)("svg",{width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:(0,g.jsx)("path",{d:"M12 8V12L15 15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z",stroke:"#CC0000",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})})}),(0,g.jsxs)("div",{children:[(0,g.jsx)("h6",{style:{margin:0,fontSize:"0.85rem",fontWeight:600,color:"#CC0000",textTransform:"uppercase",letterSpacing:"0.5px"},children:"Report Details"}),(0,g.jsx)("p",{style:{margin:"4px 0 0",fontSize:"0.7rem",color:"#6c757d"},children:"Document information"})]})]}),(0,g.jsxs)("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px"},children:[(0,g.jsxs)("div",{children:[(0,g.jsxs)("div",{style:{fontSize:"0.7rem",color:"#6c757d",marginBottom:"6px",display:"flex",alignItems:"center",gap:"4px"},children:[(0,g.jsx)("span",{children:"\ud83d\udcc5"})," Sent Date"]}),(0,g.jsx)("div",{style:{fontSize:"0.9rem",fontWeight:500,color:"#1e293b"},children:R(m.sent_date)})]}),(0,g.jsxs)("div",{children:[(0,g.jsxs)("div",{style:{fontSize:"0.7rem",color:"#6c757d",marginBottom:"6px",display:"flex",alignItems:"center",gap:"4px"},children:[(0,g.jsx)("span",{children:"\ud83d\udd12"})," Access Status"]}),(0,g.jsx)("div",{children:(0,g.jsx)("span",{style:{padding:"4px 12px",borderRadius:"20px",fontSize:"0.75rem",fontWeight:600,color:"Download"===m.access_status?"#065f46":"Not View"===m.access_status?"#b91c1c":"#CC0000",backgroundColor:"Download"===m.access_status?"#d1fae5":"Not View"===m.access_status?"#fee2e2":"#fff0f0",display:"inline-block"},children:"Download"===m.access_status?"\ud83d\udce5 Downloadable":"Only View"===m.access_status?"\ud83d\udc41\ufe0f Only View":"Not View"===m.access_status?"\ud83d\udeab Not View":"\ud83d\udc41\ufe0f View Only"})})]})]})]}),m.viewUrl&&(0,g.jsx)("div",{style:{background:"linear-gradient(135deg, #fff5f5 0%, #fee2e2 100%)",borderRadius:"16px",padding:"20px",marginBottom:"24px",border:"1px solid #fecaca"},children:(0,g.jsxs)("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"16px"},children:[(0,g.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:"12px"},children:[(0,g.jsx)("div",{style:{width:"48px",height:"48px",background:"#fff",borderRadius:"12px",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 8px rgba(0,0,0,0.1)",animation:"pulse 2s infinite"},children:(0,g.jsx)("span",{style:{fontSize:"24px"},children:"\ud83d\udcc4"})}),(0,g.jsxs)("div",{children:[(0,g.jsx)("h6",{style:{margin:0,fontSize:"0.9rem",fontWeight:700,color:"#CC0000"},children:"Document Ready"}),(0,g.jsxs)("p",{style:{margin:"4px 0 0",fontSize:"0.75rem",color:"#8B0000"},children:[m.report_type||"Document"," is ready to view"]})]})]}),(0,g.jsxs)("button",{onClick:()=>window.open(m.viewUrl,"_blank"),style:{background:"#CC0000",color:"#fff",border:"none",padding:"10px 24px",borderRadius:"12px",fontSize:"0.85rem",fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:"8px",transition:"all 0.2s ease",boxShadow:"0 4px 12px rgba(204, 0, 0, 0.3)"},onMouseEnter:e=>{e.currentTarget.style.background="#8B0000",e.currentTarget.style.transform="translateY(-2px)",e.currentTarget.style.boxShadow="0 6px 16px rgba(204, 0, 0, 0.4)"},onMouseLeave:e=>{e.currentTarget.style.background="#CC0000",e.currentTarget.style.transform="translateY(0)",e.currentTarget.style.boxShadow="0 4px 12px rgba(204, 0, 0, 0.3)"},children:[(0,g.jsx)(s.Ny1,{})," Open Document"]})]})}),(0,g.jsxs)("div",{style:{background:"#f8fafc",borderRadius:"16px",padding:"20px",border:"1px solid #e2e8f0"},children:[(0,g.jsxs)("div",{style:{display:"flex",alignItems:"center",gap:"12px",marginBottom:"16px"},children:[(0,g.jsx)("div",{style:{width:"36px",height:"36px",background:"#fff0f0",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center"},children:(0,g.jsxs)("svg",{width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",children:[(0,g.jsx)("path",{d:"M20 21V19C20 16.8 18.2 15 16 15H8C5.8 15 4 16.8 4 19V21",stroke:"#CC0000",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"}),(0,g.jsx)("path",{d:"M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z",stroke:"#CC0000",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})]})}),(0,g.jsxs)("div",{children:[(0,g.jsx)("h6",{style:{margin:0,fontSize:"0.85rem",fontWeight:600,color:"#CC0000",textTransform:"uppercase",letterSpacing:"0.5px"},children:"Investor Information"}),(0,g.jsx)("p",{style:{margin:"4px 0 0",fontSize:"0.7rem",color:"#6c757d"},children:"Recipient details"})]})]}),(0,g.jsx)("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"},children:(0,g.jsxs)("div",{children:[(0,g.jsx)("div",{style:{fontSize:"0.7rem",color:"#6c757d",marginBottom:"4px"},children:"Investor Email"}),(0,g.jsx)("div",{style:{fontSize:"0.85rem",fontWeight:500,color:"#1e293b",wordBreak:"break-all"},children:m.investor_email||"N/A"})]})})]})]}),(0,g.jsxs)("div",{style:{padding:"20px 28px",borderTop:"1px solid #e9ecef",display:"flex",justifyContent:"flex-end",gap:"12px",background:"#fafbfc",borderRadius:"0 0 24px 24px"},children:[(0,g.jsx)("button",{onClick:()=>u(!1),style:{padding:"10px 24px",backgroundColor:"#fff",color:"#475569",border:"1px solid #e2e8f0",borderRadius:"12px",fontSize:"0.85rem",fontWeight:500,cursor:"pointer",transition:"all 0.2s ease"},onMouseEnter:e=>{e.currentTarget.style.backgroundColor="#f8fafc",e.currentTarget.style.borderColor="#cbd5e1"},onMouseLeave:e=>{e.currentTarget.style.backgroundColor="#fff",e.currentTarget.style.borderColor="#e2e8f0"},children:"Close"}),"Download"===m.access_status&&m.downloadUrl&&(0,g.jsxs)("button",{onClick:()=>M(m),style:{padding:"10px 24px",backgroundColor:"#CC0000",color:"#fff",border:"none",borderRadius:"12px",fontSize:"0.85rem",fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:"8px",transition:"all 0.2s ease",boxShadow:"0 2px 6px rgba(204, 0, 0, 0.3)"},onMouseEnter:e=>{e.currentTarget.style.backgroundColor="#8B0000",e.currentTarget.style.transform="translateY(-1px)",e.currentTarget.style.boxShadow="0 4px 12px rgba(204, 0, 0, 0.4)"},onMouseLeave:e=>{e.currentTarget.style.backgroundColor="#CC0000",e.currentTarget.style.transform="translateY(0)",e.currentTarget.style.boxShadow="0 2px 6px rgba(204, 0, 0, 0.3)"},children:[(0,g.jsx)(s.WCW,{})," Download Report"]})]})]})]})]})}}}]);
//# sourceMappingURL=3041.623e15c1.chunk.js.map