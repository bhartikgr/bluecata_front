/*! For license information please see 1526.92485c3e.chunk.js.LICENSE.txt */
"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[1526],{53639:(e,t,a)=>{a.d(t,{A:()=>o});const o=(0,a(77784).A)("building-2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]])},62837:(e,t,a)=>{a.d(t,{$K:()=>r,CB:()=>d,Cd:()=>m,I0:()=>p,Jq:()=>x,R3:()=>w,dN:()=>g,hJ:()=>u,jh:()=>s,mO:()=>i,mg:()=>l,nj:()=>b,pd:()=>v,uM:()=>h,vE:()=>n,z6:()=>c});var o=a(5464);const i=o.default.div`
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
`,n=o.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,r=(o.default.div`
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
`,o.default.div`
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
`,o.default.div`
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
`,o.default.div`
  display: block;
  height: 100%;
`),l=o.default.div`
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
`,d=o.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,s=o.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,p=o.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,c=o.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,x=(o.default.div`
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
`,o.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,o.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,o.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,o.default.div`
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
`),h=(o.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,o.default.div`
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
`),f=(o.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,o.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,o.default.div`
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
`,o.default.button`
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
`,o.default.div`
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
`,o.default.video`
  background-color: black;
  border: none;
`,o.default.div`
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
`,o.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,o.default.button`
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
`),g=((0,o.default)(f)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,o.default)(f)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,o.default.sup`
  color: var(--primary);
`),u=o.default.div`
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
`,m=o.default.div`
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
`,b=o.default.button`
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
`,v=o.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,w=o.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},71090:(e,t,a)=>{a.r(t),a.d(t,{default:()=>h});var o=a(65043),i=a(62837),n=a(86213),r=a(58786),l=a(35475),d=a(60184),s=a(87511),p=a(81906),c=a(27836),x=a(70579);const h=function(){const[e,t]=(0,o.useState)(!1),a=localStorage.getItem("InvestorData"),h=JSON.parse(a),[f,g]=(0,o.useState)(""),[u,m]=(0,o.useState)(!1);document.title="Company List - Investor",(0,o.useEffect)((()=>{b()}),[]);const b=async()=>{let e={investor_id:h.id};try{const t=await n.A.post("https://capavate.com/api/user/investor/getInvestorCompany",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});w(t.data.results)}catch(t){}},[v,w]=(0,o.useState)([]),y=v.filter((e=>{const t=f.toLowerCase();return`\n    ${e.company_name||""}\n    ${e.update_date||""}\n    ${e.version||""}\n    ${e.document_name||""}\n    ${e.company_city||""}\n    ${e.phone||""}\n    ${e.company_country||""}\n  `.toLowerCase().includes(t)}));return(0,x.jsx)("main",{children:(0,x.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,x.jsx)(s.A,{}),(0,x.jsxs)("div",{className:"d-flex flex-grow-1 flex-column gap-0",children:[(0,x.jsx)(p.A,{}),(0,x.jsx)(i.$K,{className:"d-block p-md-4 p-3",children:(0,x.jsx)("div",{className:"container-fluid",children:(0,x.jsxs)(c.zP,{className:"d-flex flex-column gap-3",children:[(0,x.jsx)("div",{className:"titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3",children:(0,x.jsx)("h4",{className:"mainh1",children:"Company List"})}),(0,x.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,x.jsx)("input",{type:"search",placeholder:"Search Here...",className:"textarea_input",value:f,onChange:e=>g(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,x.jsxs)("div",{className:"d-flex  flex-column justify-content-between align-items-start tb-box",children:[(0,x.jsx)("style",{children:"\n                        .datatb-report {\n                          overflow: visible !important;\n                        }\n                      "}),(0,x.jsx)(r.Ay,{customStyles:{table:{style:{overflow:"visible !important",minWidth:"100%",boxShadow:"0px 3px 12px rgb(0 0 0 / 16%)",borderRadius:"12px"}},headCells:{style:{backgroundColor:"#efefef !important",fontWeight:"600",fontSize:"0.9rem",color:"#000 !important",whiteSpace:"nowrap"}},cells:{style:{whiteSpace:"nowrap",textOverflow:"ellipsis",backgroundColor:"#fff !important"}},rows:{style:{fontSize:"0.8rem",fontWeight:"500","&:hover":{backgroundColor:"#e8f0fe"}},stripedStyle:{backgroundColor:"#f4f6f8"}},pagination:{style:{backgroundColor:"#fafafa",padding:"12px 16px"}}},columns:[{name:"Company Name",selector:e=>e.company_name,sortable:!0,cell:e=>(0,x.jsxs)("div",{className:"d-flex align-items-center",children:[(0,x.jsx)("div",{className:"bg-primary bg-opacity-10 p-2 rounded-circle me-3",children:(0,x.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-primary",viewBox:"0 0 16 16",children:(0,x.jsx)("path",{d:"M14.763.075A.5.5 0 0 1 15 .5v15a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5V14h-1v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V10H.5a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5H2V.5a.5.5 0 0 1 .5-.5h12a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H14v8.5a.5.5 0 0 1 .5.5h2a.5.5 0 0 1 .5-.5V.575a.5.5 0 0 1-.237.5zM3 1.5v13h8V1.5H3zm10.5 0v13h1V1.5h-1z"})})}),(0,x.jsx)("span",{children:e.company_name})," "]})},{name:"Company Contact",selector:e=>e.phone,sortable:!0,cell:e=>(0,x.jsxs)("div",{className:"d-flex align-items-center",children:[(0,x.jsx)("div",{className:"bg-info bg-opacity-10 p-2 rounded me-2",children:(0,x.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-info",viewBox:"0 0 16 16",children:(0,x.jsx)("path",{d:"M3.654 1.328a.678.678 0 0 1 .736-.128l2.261.904c.329.131.445.507.249.777L5.08 4.58a.678.678 0 0 1-.746.225l-1.01-.303a11.72 11.72 0 0 0 5.516 5.516l.303-1.01a.678.678 0 0 1 .225-.746l1.195-1.195c.27-.196.646-.08.777.249l.904 2.261a.678.678 0 0 1-.128.736l-2.307 2.307c-.329.329-.888.329-1.217 0l-1.927-1.927a13.134 13.134 0 0 1-6.29-6.29L1.328 2.545c-.329-.329-.329-.888 0-1.217L3.654 1.328z"})})}),(0,x.jsx)("span",{children:e.phone})]})},{name:"Country",selector:e=>e.company_country,sortable:!0,cell:e=>(0,x.jsxs)("div",{className:"d-flex align-items-center",children:[(0,x.jsx)("div",{className:"bg-success bg-opacity-10 p-2 rounded me-2",children:(0,x.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-success",viewBox:"0 0 16 16",children:(0,x.jsx)("path",{d:"M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM4.882 1.731a.482.482 0 0 0 .14.291.487.487 0 0 0 .292.14.49.49 0 0 0 .356 0 .487.487 0 0 0 .292-.14.482.482 0 0 0 .14-.291.484.484 0 0 0-.14-.292.483.483 0 0 0-.292-.14.484.484 0 0 0-.356 0 .483.483 0 0 0-.292.14.484.484 0 0 0-.14.292zM7.5 11.5V12h-4v-1h1v-1h1v-1h1v-1h-1V8h1V7h1V6h1V5h-1V4h1V3h1V2h1v9h-1z"})})}),(0,x.jsx)("span",{children:e.company_country})," "]})},{name:"City",selector:e=>e.company_city,sortable:!0,cell:e=>(0,x.jsxs)("div",{className:"d-flex align-items-center",children:[(0,x.jsx)("div",{className:"bg-warning bg-opacity-10 p-2 rounded me-2",children:(0,x.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-warning",viewBox:"0 0 16 16",children:(0,x.jsx)("path",{d:"M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"})})}),(0,x.jsx)("span",{children:e.company_city})," "]})},{name:"Country",selector:e=>e.company_country,sortable:!0,cell:e=>(0,x.jsxs)("div",{className:"d-flex align-items-center",children:[(0,x.jsx)("div",{className:"bg-info bg-opacity-10 p-2 rounded me-2",children:(0,x.jsx)("svg",{xmlns:"http://www.w3.org/2000/svg",width:"14",height:"14",fill:"currentColor",className:"text-info",viewBox:"0 0 16 16",children:(0,x.jsx)("path",{d:"M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM1.5 8a6.5 6.5 0 0 1 11.75-3.969.75.75 0 0 1-.375 1.094 5.026 5.026 0 0 0-2.11 1.625.75.75 0 0 1-.906.187 4.5 4.5 0 0 0-3.578-.094.75.75 0 0 1-.75-.093.75.75 0 0 1-.282-.75 3.996 3.996 0 0 1 1.235-2.2A6.484 6.484 0 0 1 8 1.5c1.84 0 3.5.77 4.688 2H12.5a.75.75 0 0 1 0 1.5h-.782c.081.25.15.507.2.77a.75.75 0 0 1-.474.852.75.75 0 0 1-.914-.372 5.5 5.5 0 0 0-.118-.22.75.75 0 0 1 .093-.98l.031-.03A4.983 4.983 0 0 0 8 3c-.95 0-1.846.266-2.61.726a.75.75 0 0 1-.78-1.28A6.456 6.456 0 0 1 8 1.5zM3.1 4.2a.75.75 0 0 1 .364.975 5.474 5.474 0 0 0-.464 2.075.75.75 0 0 1-1.5.05A6.974 6.974 0 0 1 2.2 4.9a.75.75 0 0 1 .9-.7zm.9 7.6a.75.75 0 0 1-.675-.45 6.97 6.97 0 0 1-.625-3.125.75.75 0 0 1 1.5 0c0 1.036.24 2.015.667 2.875a.75.75 0 0 1-.367.975.75.75 0 0 1-.5.075zm9.4-1.5a.75.75 0 0 1-.375-.975 4.474 4.474 0 0 0 .375-1.925.75.75 0 0 1 1.5 0c0 .825-.184 1.607-.514 2.325a.75.75 0 0 1-.986.375zM12 8.75a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5a.75.75 0 0 1 .75.75zM8.75 6a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0V6z"})})}),(0,x.jsx)("span",{children:e.company_country})]})},{name:"Actions",cell:a=>(0,x.jsxs)("div",{className:"position-relative",children:[(0,x.jsx)("button",{className:"btn btn-light btn-sm",onClick:()=>t(e===a.id?null:a.id),style:{border:"1px solid #ddd",borderRadius:"6px",padding:"4px 8px"},children:(0,x.jsx)(d.H_v,{})}),e===a.id&&(0,x.jsx)("div",{className:"dropdown-menu show",style:{position:"absolute",top:"100%",right:0,minWidth:"220px",zIndex:9999,borderRadius:"8px",boxShadow:"0 2px 6px rgba(0,0,0,0.15)"},children:(0,x.jsxs)(l.N_,{to:`/investor/company/capital-round-list/${a.id}`,className:"dropdown-item",children:[(0,x.jsx)(d.Ny1,{className:"me-2",style:{fontSize:"14px"}})," ","Capital Round Documents"]})})]}),ignoreRowClick:!0,allowOverflow:!0,button:!0}],className:"datatb-report",data:y,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0,paginationRowsPerPageOptions:[10,25,50,100],paginationComponentOptions:{rowsPerPageText:"Rows per page:",rangeSeparatorText:"of",noRowsPerPage:!1,selectAllRowsItem:!1}})]})]})})})]})]})})}}}]);
//# sourceMappingURL=1526.92485c3e.chunk.js.map