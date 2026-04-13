"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[4499],{62837:(e,t,a)=>{a.d(t,{$K:()=>n,CB:()=>l,Cd:()=>f,I0:()=>c,Jq:()=>h,R3:()=>j,dN:()=>g,hJ:()=>m,jh:()=>d,mO:()=>o,mg:()=>s,nj:()=>b,pd:()=>y,uM:()=>x,vE:()=>i,z6:()=>p});var r=a(5464);const o=r.default.div`
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
`,n=(r.default.div`
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
`,c=r.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=r.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,h=(r.default.div`
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
`),x=(r.default.div`
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
`),u=(r.default.div`
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
`),g=((0,r.default)(u)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,r.default)(u)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,r.default.sup`
  color: var(--primary);
`),m=r.default.div`
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
`,f=r.default.div`
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
`,j=r.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},94499:(e,t,a)=>{a.r(t),a.d(t,{default:()=>y});var r=a(65043),o=(a(25015),a(77266)),i=(a(38421),a(62837)),n=a(42552),s=a(14459),l=a(65727),d=a(94651),c=a(35087),p=a(76361),h=a(86213),x=a(26907),u=a(21072),g=a(40876),m=a(85e3),f=a(73216),b=a(70579);function y(){(0,f.Zp)();const e="http://localhost:5000/api/user/company/",t="http://localhost:5000/api/user/dashboard/",a=localStorage.getItem("OwnerLoginData"),p=JSON.parse(a),[y,j]=(0,r.useState)([]),[w,v]=(0,r.useState)([]),[k,_]=(0,r.useState)([]),[N,S]=(0,r.useState)(""),[z,A]=(0,r.useState)(""),[C,D]=(0,r.useState)(""),[E,T]=(0,r.useState)({}),[$,I]=(0,r.useState)(!1),[P,J]=(0,r.useState)("");(0,r.useEffect)((()=>{document.title="Dashboard Page"}),[]),(0,r.useEffect)((()=>{O()}),[]),(0,r.useEffect)((()=>{L()}),[]);const L=async()=>{const t={user_id:p.id};try{const a=await h.A.post(e+"getUserOwnerDetail",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});a.data.results.length>0&&D(a.data.results[0])}catch(a){console.error("Error generating summary",a)}},O=async()=>{const t={user_id:p.id};try{const a=await h.A.post(e+"getUserCompany",t,{headers:{Accept:"application/json","Content-Type":"application/json"}});console.log(a.data.results),a.data.results.length>0&&(S(a.data.results[0].id),A(a.data.results[0].company_name)),j(a.data.results)}catch(a){console.error("Error generating summary",a)}};(0,r.useEffect)((()=>{N&&R()}),[N]);const R=async()=>{const e={company_id:N};try{const t=await h.A.post("http://localhost:5000/api/user/accesslogs/getCompanyLogs",e,{headers:{Accept:"application/json","Content-Type":"application/json"}});v(t.data.results)}catch(t){console.error("Error generating summary",t)}};function M(e){const t=new Date(e);if(isNaN(t))return"";const a=t.getDate(),r=["January","February","March","April","May","June","July","August","September","October","November","December"][t.getMonth()],o=t.getFullYear();let i=t.getHours();const n=t.getMinutes().toString().padStart(2,"0"),s=(t.getSeconds().toString().padStart(2,"0"),i>=12?"PM":"AM");return i%=12,i=i||12,`${r} ${a}${(e=>{if(e>=11&&e<=13)return"th";switch(e%10){case 1:return"st";case 2:return"nd";case 3:return"rd";default:return"th"}})(a)}, ${o} ${i}:${n} ${s}`}const[F,q]=(0,r.useState)(!1),[W,B]=(0,r.useState)(!1),[H,K]=(0,r.useState)({email:"",password:""}),[U,Y]=(0,r.useState)(null),[Z,G]=(0,r.useState)(""),Q=e=>{const{name:t,value:a}=e.target;K((e=>({...e,[t]:a})))},[V,X]=(0,r.useState)(!1);return(0,b.jsxs)(b.Fragment,{children:[(0,b.jsx)(i.mO,{children:(0,b.jsx)("div",{className:"fullpage d-block",children:(0,b.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,b.jsx)(n.A,{isCollapsed:V,setIsCollapsed:X}),(0,b.jsxs)("div",{className:"global_view "+(V?"global_view_col":""),children:[(0,b.jsx)(o.A,{}),P&&(0,b.jsxs)("div",{className:"flex items-center justify-between gap-3 shadow-lg "+($?"error_pop":"success_pop"),children:[(0,b.jsx)("div",{className:"d-flex align-items-center gap-2",children:(0,b.jsx)("span",{className:"d-block",children:P})}),(0,b.jsx)("button",{type:"button",className:"close_btnCros",onClick:()=>J(""),children:"\xd7"})]}),(0,b.jsx)(i.$K,{className:"d-block p-md-4 p-3",children:(0,b.jsx)("div",{className:"container-fluid",children:(0,b.jsx)(i.mg,{id:"step5",children:(0,b.jsxs)("div",{className:"row",children:[(0,b.jsxs)("div",{className:"col-md-12",children:[(0,b.jsx)("div",{className:"pb-3 bar_design",children:(0,b.jsxs)("h4",{className:"h5 mb-0",children:["Welcome,"," ",C.first_name||C.last_name?(0,b.jsxs)(b.Fragment,{children:[C.first_name," ",C.last_name]}):(0,b.jsx)("span",{className:"text-muted",children:"Name not available"})]})}),(0,b.jsx)("div",{class:"row gap-0 dashboard-top p-0 border-0 bg-transparent",children:(0,b.jsx)("div",{className:"row gy-3 ",children:null===y||void 0===y?void 0:y.map(((e,a)=>(0,b.jsx)("button",{type:"button",className:"col-md-4 border-0 bg-transparent",children:(0,b.jsxs)("div",{className:"card_deisgn_register",style:{borderColor:e.company_color_code||"#ccc",backgroundColor:`${e.company_color_code}50`||"#ffffff80"},children:[(0,b.jsxs)("h5",{className:"text-center d-flex align-items-center gap-2",style:{backgroundColor:e.company_color_code||"#000",color:"#fff",padding:"10px 20px",borderRadius:"8px",fontSize:"0.9rem"},children:[(0,b.jsx)("input",{className:"checkbox_global",name:"company",checked:e.id===N,onChange:()=>(async(e,t)=>{A(t),S(e)})(e.id,e.company_name),type:"radio"}),(0,b.jsx)("span",{className:"d-block text-start",children:e.company_name})]}),(0,b.jsxs)("p",{onClick:()=>(async e=>{const a={company_id:e,user_id:p.id};try{const e=(await h.A.post(t+"getCompanyAccess",a,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;if(J(e.message),"1"===e.status){localStorage.removeItem("SignatoryLoginData");const t={...e.user,access_token:e.token,expiry:(new Date).getTime()+36e5};localStorage.setItem("SignatoryLoginData",JSON.stringify(t)),setTimeout((()=>{const e=document.createElement("a");e.href="/dashboard",e.target="_blank",e.rel="noopener noreferrer",document.body.appendChild(e),e.click(),document.body.removeChild(e),q(!1)}),1500)}else I(!0);setTimeout((()=>{I(!1),J("")}),3500),console.log("Response Data:",e)}catch(r){console.error("Login Error:",r),J("Something went wrong. Please try again."),I(!0),setTimeout((()=>{I(!1),J("")}),3500)}})(e.id,e.company_name),className:"py-3 text-center mb-0",style:{fontSize:"0.9rem",fontWeight:"600",position:"relative",cursor:"pointer"},children:["Access this account.",E[e.id]&&(0,b.jsx)("div",{className:"spinner-border spinneronetimepay",role:"status",style:{position:"absolute",top:"60%",left:"42%",width:"1rem",height:"1rem"},children:(0,b.jsx)("span",{className:"visually-hidden"})})]})]})},a)))})})]}),(0,b.jsx)("div",{className:"col-12 my-4",children:(0,b.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,b.jsx)("div",{class:"card-header",children:(0,b.jsx)("h3",{class:"card-title",children:"Recent Activity Investor (Round)"})}),(0,b.jsxs)("div",{class:"access-logs",children:[(0,b.jsxs)("h4",{class:"section-title",children:["Company (",z,")"]}),(0,b.jsxs)("table",{class:"log-table",children:[(0,b.jsx)("thead",{children:(0,b.jsxs)("tr",{children:[(0,b.jsx)("th",{children:"Name"}),(0,b.jsx)("th",{children:"Action"}),(0,b.jsx)("th",{children:"Status"}),(0,b.jsx)("th",{children:"Time"})]})}),(0,b.jsx)("tbody",{children:y.length>0&&k.length>0?k.map(((e,t)=>"active"===e.access_status&&(0,b.jsxs)("tr",{children:[(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:"Test investor"})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:" Seed A"})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:" Download"})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:"September 11th, 2025"})})]}))):(0,b.jsx)("tr",{children:(0,b.jsx)("td",{colSpan:"3",style:{textAlign:"center"},children:"No result found"})})})]})]})]})}),(0,b.jsx)("div",{className:"col-12 my-4",children:(0,b.jsxs)("div",{class:"dashboard_card  modern-chart",children:[(0,b.jsx)("div",{class:"card-header",children:(0,b.jsx)("h3",{class:"card-title",children:"Recent Activity Signatory"})}),(0,b.jsxs)("div",{class:"access-logs",children:[(0,b.jsxs)("h4",{class:"section-title",children:["Company (",z,")"]}),(0,b.jsxs)("table",{className:"log-table",children:[(0,b.jsx)("thead",{children:(0,b.jsxs)("tr",{children:[(0,b.jsx)("th",{children:"Signatory Name"}),(0,b.jsx)("th",{children:"Module"}),(0,b.jsx)("th",{children:"Action"}),(0,b.jsx)("th",{children:"Entity Name / Details"}),(0,b.jsx)("th",{children:"IP Address"}),(0,b.jsx)("th",{children:"Date"})]})}),(0,b.jsx)("tbody",{children:w.length>0?w.map(((e,t)=>{let a=e.details;if("string"===typeof a)try{a=JSON.parse(a)}catch(r){a={}}return(0,b.jsxs)("tr",{children:[(0,b.jsx)("td",{children:(0,b.jsxs)("small",{children:[e.signatory_first_name," ",e.signatory_last_name]})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:e.module})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:e.action})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:e.entity_type})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:e.ip_address})}),(0,b.jsx)("td",{children:(0,b.jsx)("small",{children:M(e.created_at)})})]},t)})):(0,b.jsx)("tr",{children:(0,b.jsx)("td",{colSpan:"5",style:{textAlign:"center"},children:"No result found"})})})]})]})]})})]})})})})]})]})})}),(0,b.jsxs)(x.A,{open:F,onCancel:()=>q(!1),footer:null,centered:!0,width:400,children:[(0,b.jsxs)("h2",{className:"text-xl font-semibold mb-1",children:["Welcome ",Z?`to ${Z}`:""]}),(0,b.jsx)("p",{className:"text-gray-500 mb-4",children:"Please enter your login details"}),(0,b.jsxs)(u.A,{layout:"vertical",onFinish:async()=>{const e={...H,company_id:U};try{const a=(await h.A.post(t+"getCompanyAccess",e,{headers:{Accept:"application/json","Content-Type":"application/json"}})).data;if(J(a.message),"1"===a.status){localStorage.removeItem("SignatoryLoginData");const e={...a.user,access_token:a.token,expiry:(new Date).getTime()+36e5};localStorage.setItem("SignatoryLoginData",JSON.stringify(e)),setTimeout((()=>{window.open("/dashboard","_blank"),q(!1)}),1500)}else I(!0);setTimeout((()=>{I(!1),J("")}),3500),console.log("Response Data:",a)}catch(a){console.error("Login Error:",a),J("Something went wrong. Please try again."),I(!0),setTimeout((()=>{I(!1),J("")}),3500)}},action:"javascript:void(0)",method:"post",children:[(0,b.jsx)(u.A.Item,{label:"Email",name:"email",rules:[{required:!0,message:"Please enter your email!"}],children:(0,b.jsx)(g.A,{prefix:(0,b.jsx)(s.A,{size:16,style:{marginRight:4}}),type:"email",placeholder:"Enter email",name:"email",value:H.email,onChange:Q})}),(0,b.jsx)(u.A.Item,{label:"Password",name:"password",rules:[{required:!0,message:"Please enter your password!"}],children:(0,b.jsx)(g.A,{prefix:(0,b.jsx)(l.A,{size:16,style:{marginRight:4}}),type:W?"text":"password",placeholder:"Enter password",name:"password",value:H.password,onChange:Q,suffix:(0,b.jsx)("span",{onClick:()=>B(!W),style:{cursor:"pointer",color:"#555"},children:W?(0,b.jsx)(d.A,{size:16}):(0,b.jsx)(c.A,{size:16})})})}),(0,b.jsx)(u.A.Item,{children:(0,b.jsx)(m.Ay,{type:"primary",htmlType:"submit",className:"global_btn px-4 py-2 fn_size_sm active d-flex align-items-center gap-2",block:!0,children:"Login"})})]})]})]})}p.t1.register(p.PP,p.kc,p.E8,p.No,p.FN,p.Bs,p.hE,p.m_,p.s$)}}]);
//# sourceMappingURL=4499.9d1b1d52.chunk.js.map