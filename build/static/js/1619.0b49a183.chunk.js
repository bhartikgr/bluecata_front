"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[1619],{21619:(e,t,o)=>{o.r(t),o.d(t,{default:()=>m});var a=o(65043),r=(o(25015),o(65136)),i=(o(38421),o(62837)),n=o(60184),l=(o(83656),o(44710)),s=o(86213),d=o(27836),c=o(26022),p=(o(98030),o(58786)),x=(o(53162),o(23590),o(70579));const u=e=>{let{onClose:t,returnrefresh:o}=e;const r=localStorage.getItem("UserLoginData"),i=JSON.parse(r),[n,l]=(0,a.useState)([""]),[c,p]=(0,a.useState)(!1),[u,f]=(0,a.useState)(!1),[m,h]=(0,a.useState)("");return(0,x.jsx)(d.hJ,{children:(0,x.jsx)(d.Bs,{style:{maxWidth:"900px",maxHeight:"550px"},children:(0,x.jsxs)("form",{onSubmit:async e=>{e.preventDefault();const t=Array.from(new Set([...n.filter((e=>""!==e.trim()))]));let a={shared_by:"Company",discount_code:e.target.code.value,emails:t,user_id:i.id};if(0===t.length)return h("Please provide at least one email."),f(!0),void setTimeout((()=>{f(!1),h("")}),2e3);p(!0);try{const t=await s.A.post("https://blueprintcatalyst.com/api/user/checkReferralUser",a,{headers:{Accept:"application/json","Content-Type":"application/json"}});p(!1),h(t.data.message),"2"===t.data.status&&f(!0),"1"===t.data.status&&(l([""]),f(!1),setTimeout((()=>{}),2e3),o(),e.target.code.value=""),setTimeout((()=>{h("")}),2e3)}catch(r){console.error("Submit error:",r)}},method:"post",action:"javascript:void(0)",style:{height:"100%",display:"flex",flexDirection:"column"},children:[(0,x.jsx)(d.Jn,{onClick:t,children:"\xd7"}),m&&(0,x.jsx)("p",{className:u?" mt-3 error_pop":"success_pop mt-3",children:m}),(0,x.jsxs)("div",{className:"formmodalShared",children:[(0,x.jsx)(d.wt,{className:"aititle",children:"Share Referral Code"}),(0,x.jsxs)("label",{children:["Code ",(0,x.jsx)("span",{className:"text-danger",children:"*"})]}),(0,x.jsx)("div",{className:"form-group  d-flex gap-2 mb-4",children:(0,x.jsx)("input",{type:"text",required:!0,name:"code",className:"form-control",placeholder:"Enter Code..."})}),(0,x.jsxs)("label",{className:"mb-2",children:["Email ",(0,x.jsx)("span",{className:"text-danger",children:"*"})]}),n.map(((e,t)=>(0,x.jsxs)("div",{className:"form-group mb-2 d-flex gap-2",children:[(0,x.jsx)("input",{type:"email",required:!0,className:"form-control",placeholder:"Enter email...",value:e,onChange:e=>((e,t)=>{const o=[...n];o[e]=t,l(o)})(t,e.target.value)}),t>0&&(0,x.jsx)("button",{type:"button",className:"btn btn-sm btn-danger",onClick:()=>(e=>{const t=n.filter(((t,o)=>o!==e));l(t)})(t),children:"Remove"})]},t)))]}),(0,x.jsx)("div",{className:"form-group ",children:(0,x.jsxs)("div",{className:"d-flex justify-content-between align-items-center flex-wrap",children:[(0,x.jsx)("button",{type:"button",className:"btn btn-outline-dark active addbtn",onClick:()=>{l([...n,""])},children:"+ Add More Email"}),(0,x.jsx)(d.e2,{className:"d-flex gap-2",children:(0,x.jsxs)(d.IY,{disabled:c,variant:"upload",type:"submit",style:{opacity:c?.6:1},className:"submit d-flex align-items-center gap-2",children:["Submit",c&&(0,x.jsx)("div",{className:"white-spinner spinner-border spinneronetimepay m-0",role:"status",children:(0,x.jsx)("span",{className:"visually-hidden"})})]})})]})})]})})})};var f=o(35475);function m(){document.title="Share Referral Code",(0,a.useEffect)((()=>{w()}),[]);const e=localStorage.getItem("UserLoginData"),t=JSON.parse(e),[o,m]=(0,a.useState)([]),[h,b]=(0,a.useState)(""),[g,v]=(0,a.useState)(!1),w=async()=>{let e={user_id:t.id};try{var o=(await s.A.post("https://blueprintcatalyst.com/api/user/getallsharedCodeByCompany",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;m(o.results)}catch(a){a.response||(a.request?console.error("Request data:",a.request):console.error("Error message:",a.message))}},y=o.filter((e=>`${e.company_name||""} - ${e.update_date||""} - ${e.version||""}`.toLowerCase().includes(h.toLowerCase())||(e.update_date||"").toLowerCase().includes(h.toLowerCase())||(e.download||"").toLowerCase().includes(h.toLowerCase()))),k=[{name:"Shared Email",selector:e=>e.email,sortable:!0},{name:"Code",selector:e=>e.discount_code,sortable:!0},{name:"Discount",selector:e=>e.percentage+"%",sortable:!0},{name:"Action",cell:e=>(0,x.jsx)("div",{className:"d-flex gap-2",children:(0,x.jsx)(f.N_,{to:`/share/referralcodetracking/${e.id}/${e.discount_code}`,rel:"noopener noreferrer",className:"btn btn-sm btn-outline-primary",title:"View Usage Code",children:(0,x.jsx)(n.Ny1,{})})}),ignoreRowClick:!0,allowOverflow:!0,button:!0}];return(0,x.jsxs)(x.Fragment,{children:[(0,x.jsx)(i.mO,{children:(0,x.jsxs)("div",{className:"fullpage d-block",children:[(0,x.jsx)(r.A,{}),(0,x.jsx)(i.$K,{className:"d-block py-5",children:(0,x.jsx)("div",{className:"container-lg",children:(0,x.jsxs)("div",{className:"row",children:[(0,x.jsx)("div",{className:"col-md-3",children:(0,x.jsx)(l.A,{})}),(0,x.jsx)("div",{className:"col-md-9",children:(0,x.jsxs)(d.zP,{className:"d-flex flex-column gap-2",children:[(0,x.jsxs)("div",{className:"titleroom d-flex justify-content-between align-items-center border-bottom pb-3",children:[(0,x.jsx)("h4",{children:"Share Referral Code List"}),(0,x.jsxs)(c.$n,{onClick:()=>{v(!0)},type:"button",className:"btn btn-outline-dark active",children:["Share ",(0,x.jsx)(n.eb3,{})," "]})]}),(0,x.jsx)("div",{className:"d-flex justify-content-end p-0",children:(0,x.jsx)("input",{type:"search",placeholder:"Search Here...",className:"form-control",value:h,onChange:e=>b(e.target.value),style:{padding:"10px",width:"100%",maxWidth:"200px",fontSize:"14px"}})}),(0,x.jsx)("div",{className:"d-flex flex-column justify-content-between align-items-start tb-box",children:(0,x.jsx)(p.Ay,{customStyles:{rows:{style:{minHeight:"60px",overflow:" visible"}},headCells:{style:{fontSize:"14px",fontWeight:"bold",overflow:"visible","& div":{overflow:"visible"}}}},columns:k,className:"datatb-report",data:y,pagination:!0,highlightOnHover:!0,striped:!0,responsive:!0})})]})})]})})})]})}),g&&(0,x.jsx)(u,{onClose:()=>v(!1),returnrefresh:()=>{}})]})}},23590:(e,t,o)=>{o.d(t,{A:()=>r});o(65043);var a=o(70579);const r=function(e){let{message:t,onClose:o}=e;return(0,a.jsx)(a.Fragment,{children:(0,a.jsxs)("div",{className:"alert alert-danger alert-dismissible fade show mt-3",role:"alert",children:[(0,a.jsx)("strong",{children:"Error!"})," ",t,(0,a.jsx)("button",{type:"button",className:"btn-close","data-bs-dismiss":"alert","aria-label":"Close",onClick:o})]})})}},25015:()=>{},53162:(e,t,o)=>{o.d(t,{A:()=>r});o(65043);var a=o(70579);const r=function(e){let{message:t,onClose:o}=e;return(0,a.jsx)(a.Fragment,{children:(0,a.jsxs)("div",{className:"alert alert-success alert-dismissible fade show",role:"alert",children:[(0,a.jsx)("strong",{children:"Success!"})," ",t,(0,a.jsx)("button",{type:"button",className:"btn-close","data-bs-dismiss":"alert","aria-label":"Close",onClick:o})]})})}},62837:(e,t,o)=>{o.d(t,{$K:()=>s,CB:()=>c,Cd:()=>g,FC:()=>l,Jq:()=>u,R3:()=>y,SD:()=>n,Zw:()=>x,dN:()=>h,hJ:()=>b,mO:()=>r,mg:()=>d,nj:()=>v,pd:()=>w,uM:()=>f,vE:()=>i,z6:()=>p});var a=o(5464);const r=a.default.div`
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
`,i=a.default.span`
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
  background: var(--primary-color);
  border-bottom: 10px solid var(--secondary-color);
  .logo {
    display: inline-block;
    width: 140px;
    img {
      width: 100%;
    }
  }
`),l=a.default.div`
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
`,s=a.default.div`
  display: block;
  padding: 3rem 0; /* py-5 is 3rem top & bottom */
  background-color: #f3f5f7;
  min-height: 100vh;
`,d=a.default.div`
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
`,c=a.default.div`
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
`,p=a.default.div`
  display: flex;
  flex-direction: column;
  gap: 10px 0;
`,x=a.default.div`
  label {
    font-weight: 400;
    cursor: pointer;
    margin-left: 10px;
  }
`,u=(a.default.div`
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
    left: 6px;
    width: 16px; /* smaller width */
    height: 16px; /* smaller height */
    stroke: #9c9c9c;
    stroke-width: 1.2;
  }
`),f=(a.default.div`
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
`),h=((0,a.default)(m)`
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
  color: var(--primary-color);
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
`,g=a.default.div`
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
  border-radius: 100%;
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
  font-size: 16px;
`,y=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},83656:()=>{}}]);
//# sourceMappingURL=1619.0b49a183.chunk.js.map