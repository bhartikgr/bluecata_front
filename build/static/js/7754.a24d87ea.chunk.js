"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[7754],{6510:(e,s,t)=>{t.r(s),t.d(s,{default:()=>E});var i=t(65043),a=t(2661),r=(t(9463),t(38326),t(65266)),o=t(35475),n=t(42983),l=t(19473),c=t(70579);function d(){const[e,s]=(0,i.useState)(!1),[t,a]=(0,i.useState)(!1),r=localStorage.getItem("UserLoginData"),d=JSON.parse(r);return(0,i.useEffect)((()=>{const e=()=>{window.scrollY>0?a(!0):a(!1)};return window.addEventListener("scroll",e),()=>{window.removeEventListener("scroll",e)}}),[]),(0,c.jsx)(c.Fragment,{children:(0,c.jsx)("header",{className:"headerhome "+(t?"sticky-header":""),style:{position:t?"fixed":"relative"},children:(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsx)("nav",{className:"navbar navbar-expand-lg",children:(0,c.jsxs)("div",{className:"container-fluid",children:[(0,c.jsx)(o.N_,{className:"navbar-brand",to:"/",children:(0,c.jsx)("img",{src:"/logos/logo.png",alt:"logo"})}),(0,c.jsx)("button",{className:"navbar-toggler",type:"button",onClick:()=>s(!e),"aria-controls":"navbarNav","aria-expanded":e,"aria-label":"Toggle navigation",children:(0,c.jsx)(n.A,{})}),(0,c.jsx)("div",{className:"navbar-collapse "+(e?"show":"collapse"),id:"navbarNav",children:(0,c.jsxs)("ul",{className:"navbar-nav ms-auto",children:[(0,c.jsx)("li",{className:"nav-item",children:(0,c.jsx)(l.N_,{className:"nav-link",to:"angel",smooth:!0,offset:-100,duration:500,children:"Angel Investment Simulator"})}),(0,c.jsx)("li",{className:"nav-item",children:(0,c.jsx)(l.N_,{className:"nav-link",to:"dataroom",smooth:!0,offset:-100,duration:500,children:"Dataroom, Diligence & Reporting"})}),(0,c.jsx)("li",{className:"nav-item",children:(0,c.jsx)(l.N_,{className:"nav-link",to:"exclusive",smooth:!0,offset:-100,duration:500,children:"Exclusive Global Investor Alliance"})}),(0,c.jsxs)("li",{className:"nav-item",children:[null===d&&(0,c.jsx)(o.N_,{className:"nav-link",to:"/login",children:"Login"}),null!==d&&(0,c.jsx)(o.N_,{className:"nav-link",to:"/logout",children:"Logout"})]})]})})]})})})})})}var p=t(28814),h=t(5464);const x=h.default.div`
  background-color: #445473;
  padding: 60px 0 0px 0;
  .footer-logo {
    width: 200px;
    img {
      width: 100%;
    }
  }
  .footer-text {
    p {
      color: #fff;
      font-size: 16px;
    }
  }
  .ftcol {
    h4 {
      color: #fff;
      font-size: 18px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .ftlinks {
      a {
        color: #fff;
        font-size: 14px;
        &:hover {
          color: var(--secondary-color);
        }
      }
    }
  }
  .lastredlink {
    a {
      &:last-child {
        color: #fff;
        background: #cb1d1d;
        padding: 4px;
        width: fit-content;
        &:hover {
          background: var(--secondary-color);
          color: #fff;
        }
      }
    }
  }
  .bottom-links {
    a {
      position: relative;
      color: #fff;
      font-size: 14px;
      text-transform: capitalize;

      &:not(:last-child) {
        &:after {
          content: "";
          position: absolute;
          right: -10px;
          top: 50%;
          transform: translateY(-50%);
          width: 1px;
          height: 17px;
          background: #fff;
        }
      }
      &:hover {
        color: var(--secondary-color);
      }
    }
  }
  @media (max-width: 576px) {
    .bottom-links {
      a {
        &:after {
          display: none;
        }
      }
    }
  }
  .siconft {
    a {
      color: #fff;
      font-size: 14px;
      text-transform: capitalize;

      &:hover {
        color: var(--secondary-color);
      }
    }
  }
  .footer-bottom {
    background: #334261;
    padding: 10px 0;
    p {
      color: #fff;
      font-size: 12px;
      text-transform: capitalize;
    }
  }
`;function m(){return(0,c.jsx)(c.Fragment,{children:(0,c.jsxs)(x,{className:"home-footer",children:[(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsxs)("div",{className:"row gy-4",children:[(0,c.jsx)("div",{className:"col-md-3",children:(0,c.jsxs)("div",{className:"d-flex flex-column gap-3",children:[(0,c.jsx)("div",{className:"footer-logo",children:(0,c.jsx)("img",{src:"/logos/logo.png",alt:"image"})}),(0,c.jsx)("div",{className:"footer-text",children:(0,c.jsx)("p",{children:"We are a firm speecializing in assisting entrepreneurs with scalability strategies, fundraising, or company sales."})})]})}),(0,c.jsx)("div",{className:"col-md-3",children:(0,c.jsxs)("div",{className:"d-flex flex-column gap-3 ftcol",children:[(0,c.jsx)("h4",{children:"SERVICES"}),(0,c.jsxs)("div",{className:"d-flex flex-column gap-2 ftlinks",children:[(0,c.jsx)(l.N_,{to:"angel",smooth:!0,offset:-100,duration:500,children:"Angel Investment Simulator"}),(0,c.jsx)(l.N_,{className:"nav-link",to:"dataroom",smooth:!0,offset:-100,duration:500,children:"Dataroom, Diligence & Reporting"}),(0,c.jsx)(l.N_,{className:"nav-link",to:"exclusive",smooth:!0,offset:-100,duration:500,children:"Exclusive Global Investor Alliance"})]})]})}),(0,c.jsx)("div",{className:"col-md-3",children:(0,c.jsxs)("div",{className:"d-flex flex-column gap-3 ftcol",children:[(0,c.jsx)("h4",{children:"COMPANY"}),(0,c.jsxs)("div",{className:"d-flex flex-column gap-2 ftlinks lastredlink",children:[(0,c.jsx)("a",{href:"/",children:"Contact us"}),(0,c.jsx)("a",{href:"mailto:info@blueprintcatalyst.com",children:"info@blueprintcatalyst.com"})]})]})}),(0,c.jsx)("div",{className:"col-md-3",children:(0,c.jsxs)("div",{className:"d-flex flex-column gap-3 ftcol",children:[(0,c.jsx)("h4",{children:"Follow us"}),(0,c.jsx)("div",{className:"d-flex gap-3 align-items-center siconft",children:(0,c.jsx)("a",{href:"/",children:(0,c.jsx)(p.A,{className:"social-icon",size:20})})})]})}),(0,c.jsx)("div",{className:"col-12 mt-5",children:(0,c.jsx)("div",{className:"d-flex justify-content-md-center",children:(0,c.jsx)("div",{className:"d-flex flex-column flex-sm-row align-items-md-center gap-3 gap-md-4  bottom-links",children:(0,c.jsx)("a",{href:"/",target:"_blank",children:"Terms of use"})})})})]})}),(0,c.jsx)("div",{className:"footer-bottom text-center mt-5",children:(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsx)("p",{children:"\xa9 2025 Blueprint Catalyst. All rights reserved."})})})]})})}const g=h.default.div`
  background: rgba(0, 0, 0, 0.3);
  overflow: hidden;
  position: relative;
  // background: url("/assets/user/images/water.gif");
  // background-size: cover;
  // background-position: center;
  // background-repeat: no-repeat;
  padding-bottom: 40px;
  .videobox {
    position: absolute;
    inset: 0;
    z-index: -1;
    width: 100%;
    height: 100%;
    video {
      aspect-ratio: 16 / 9;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
  @media (max-width: 767px) {
    .video {
      aspect-ratio: 9 / 16;
    }
  }
  .container-lg {
    position: relative;
    z-index: 2;
  }
  .bannertext {
    padding-top: 5vw;

    h1 {
      font-size: 58px;
      color: #fff;
      font-weight: 600;
      text-transform: uppercase;
    }

    .qubox {
      aspect-ratio: 1 / 1;
      position: relative;
      width: 90px;

      img {
        width: 100%;
      }

      @media (max-width: 768px) {
        width: 30px;
      }
    }

    .topqu {
      float: left;
      margin-top: -30px;
    }

    .bottomqu {
      float: right;
      margin-top: -10px;

      @media (max-width: 768px) {
        margin-top: 0px;
      }
    }

    h6 {
      margin-top: 5vw;
      color: #fff;
      font-size: 22px;
      font-weight: 300;
      text-transform: capitalize;
    }

    @media (max-width: 768px) {
      h1 {
        font-size: 32px;
      }
    }
  }

  .news-title {
    margin-top: 6vw;
    font-size: 20px;
    color: #fff;
    text-transform: uppercase;
  }

  .newsview {
    background: var(--secondary-color);
    border-radius: 10px;
    padding: 10px;
    display: inline-block;
    .news-img {
      border: 1px solid #fff;
      border-radius: 6px;
      overflow: hidden;

      img {
        width: 100%;
      }
    }

    .news-text {
      p {
        font-size: 16px;
        color: #fff;
        font-weight: 300;

        line-height: 20px;
      }
    }

    &:hover {
      background-color: var(--black);
      text-decoration: none;
    }
  }
`,u=h.default.div`
  padding: 80px 0;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 1) 0%,
    rgba(255, 255, 255, 0.72) 50%,
    rgba(51, 87, 149, 0.44) 100%
  );

  .bigimg {
    position: relative;

    .yearexp {
      position: absolute;
      top: 0;
      left: 0;
      background: var(--primary-color);
      padding: 15px;
      color: #fff;
      text-align: center;
      border-radius: 6px;
      overflow: hidden;

      h4 {
        font-size: 60px;
        font-weight: bold;
      }
    @media (max-width: 768px) {
          h4 {
        font-size: 30px;
      }
    
    }
      h5 {
        font-size: 16px;
        font-weight: 400;
      }
    }

    img {
      width: 100%;
      overflow: hidden;
      border-radius: 6px;
    }

    .about-img {
      padding: 30px;
    }
  }

  .about-text {
    h2 {
      font-size: 20px;
      color: var(--primary-color);
      font-weight: 700;
    }

    h3 {
      font-size: 28px;
      color: #000;
      font-weight: 700;
    }

    p {
      font-size: 16px;
      color: rgb(108, 108, 108);
      font-weight: 300;
    }
    p b {
      font-weight: 700;
    }
  }

  .extext {
    h5 {
      font-size: 30px;
      color: var(--primary-color);
      font-weight: 700;
      font-style: italic;
    }

    h6 {
      font-size: 20px;
      color: #3c3c3c;
      font-weight: 400;
      text-transform: capitalize;
    }
  }
`,f=h.default.div`
  padding: 80px 0;
  background: #fefefe;

  .expandable-text-wrapper {
    overflow: hidden;
    transition: max-height 0.4s ease;
  }

  .icon-wrapper {
    display: inline-block;
    transition: transform 0.3s ease;
  }

  .service-title {
    font-size: 30px;
    color: var(--primary-color);
    font-weight: 700;
    text-transform: uppercase;
  }

  .service-card {
    background: #fff;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(197, 197, 197, 0.4);
    padding: 20px;
    position: relative;
    border-radius: 6px;
    overflow: hidden;
    min-height: 300px;
    h3 {
      font-size: 3vw;
      font-weight: 600;

      -webkit-text-fill-color: white;
      -webkit-text-stroke-width: 1px;
      -webkit-text-stroke-color: var(--primary-color);
    }

    @media (max-width: 768px) {
      h3 {
        font-size: 30px;
      }
    }
    h4 {
      font-size: 20px;
      color: var(--primary-color);
      font-weight: 600;
    }

    p {
      font-size: 16px;
      color: rgb(108, 108, 108);
      font-weight: 400;
    }

    .readlink {
      font-size: 14px;
      color: var(--secondary-color);
      font-weight: 600;
      text-decoration: none;
      text-transform: uppercase;

      &:hover {
        color: black;
        text-decoration: underline;
      }
    }

    & > * {
      z-index: 2;
      position: relative;
    }

    &:before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 0%;
      height: 100%;
      background: var(--primary-color);
      z-index: 1;
      transition: all 0.5s ease;
    }

    &:hover::before {
      width: 100%;
    }

    &:hover > * {
      color: #fff !important;
    }
    &:hover {
      .expandable-text-wrapper p {
        color: #fff !important;
      }
    }
  }
`,v=(h.default.div`
  padding: 80px 0;
  background: url("/assets/user/images/image2.jpg");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;

  .teamtitle {
    h2 {
      font-size: 30px;
      color: var(--primary-color);
      font-weight: 700;
      text-transform: uppercase;
    }

    h3 {
      font-size: 20px;
      color: #000;
      font-weight: 400;
    }
  }

  .clientbox {
    background: #fff;
    text-align: center;
    border-radius: 6px;
    overflow: hidden;
    h4 {
      font-size: 16px;
      color: var(--primary-color);
      font-weight: 700;
      margin-top: 5px;
      line-height: 20px;
    }

    h5 {
      font-size: 14px;
      color: #000;
      font-weight: 400;

      margin-bottom: 14px;
    }
  }

  .teamperson {
    position: relative;

    .teamimg {
      width: 100%;
      aspect-ratio: 1;
      overflow: hidden;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;

        -webkit-transition: all 1s ease;
        -moz-transition: all 1s ease;
        -o-transition: all 1s ease;
        -ms-transition: all 1s ease;
        transition: all 1s ease;
      }
    }
    &:hover {
      .teamimg {
        img {
          transform: scale(1.1);
          -webkit-transition: all 1s ease;
          -moz-transition: all 1s ease;
          -o-transition: all 1s ease;
          -ms-transition: all 1s ease;
          transition: all 1s ease;
        }
      }
    }

    .sicons {
      position: absolute;
      bottom: 110px;
      right: 10px;
      background: var(--primary-color);
      padding: 10px;
      color: #fff;
      width: 50px;
      height: 50px;
      cursor: pointer;
      transition: all 0.5s ease;
      display: grid;
      place-items: center;
      border-radius: 6px;
      svg {
        fill: #fff;
      }
      .innerhover {
        border-radius: 6px 6px 0 0;
        background: var(--primary-color);
        width: 50px;
        text-align: center;
        opacity: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        position: absolute;
        bottom: 0;
        left: 0;
        padding: 8px 6px;
        transition: all 0.5s ease;

        svg {
          fill: #fff;
          stroke: var(--primary-color);
        }
      }

      &:hover .innerhover {
        opacity: 1;
        bottom: 40px;
      }
    }
  }
  .slick-arrow {
    &:before {
      display: none;
    }
    background: var(--primary-color);
    border: 1px solid var(--primary-color);
    width: 40px;
    height: 40px;
    display: grid !important;
    place-items: center !important;
    cursor: pointer;
    border-radius: 6px;
    svg {
      stroke: #fff;
    }
  }
`,h.default.div`
  background: url("/assets/user/images/about-video-bg.jpg");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  .overlaybox {
    aspect-ratio: 24/9;
    background: linear-gradient(
      to bottom,
      rgba(255, 255, 255, 0) 0%,
      rgba(51, 87, 149, 1) 100%
    );
    padding: 80px 0;
    .videotext {
      h2 {
        font-size: 30px;
        color: #fff;
        text-transform: uppercase;
        font-weight: 500;
      }
      @media (max-width: 768px) {
        h2 {
          font-size: 20px;
        }
      }
      .playbtn {
        font-size: 16px;
        color: #fff;
        background: none;
        border: none;

        font-weight: 600;
        svg {
          fill: #fff;
          background: var(--primary);
          border-radius: 50%;
          padding: 10px;
          width: 60px;
          height: 60px;
          padding: 15px;
        }

        .iconbox {
          width: 54px;
          img {
            width: 100%;
          }
        }
      }
      .videotags {
        border-top: 1px solid #fff;
        padding-top: 20px;
        svg {
          color: #fff;
        }
        p {
          font-size: 16px;
          color: #fff;
        }
      }
    }
  }
`,h.default.div`
  padding: 80px 0;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 1) 0%,
    rgba(255, 255, 255, 0.72) 50%,
    rgba(51, 87, 149, 0.44) 100%
  );
  .protfoliotitle {
    h2 {
      font-size: 30px;
      color: var(--primary-color);
      font-weight: 700;
      text-transform: uppercase;
    }
    h3 {
      font-size: 20px;
      color: #000;
      font-weight: 400;
    }
  }
  .slick-arrow {
    &:before {
      display: none;
    }
    background: var(--primary-color);
    border: 1px solid var(--primary-color);
    width: 40px;
    height: 40px;
    border-radius: 6px;
    display: grid !important;
    place-items: center !important;
    cursor: pointer;
    svg {
      stroke: #fff;
    }
  }
  .photobox {
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 10px;
    .photoimg {
      width: 100%;
      overflow: hidden;
      aspect-ratio: 1;
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }
    .phototext {
      -webkit-transition: all 0.5s ease;
      -moz-transition: all 0.5s ease;
      -o-transition: all 0.5s ease;
      -ms-transition: all 0.5s ease;
      transition: all 0.5s ease;
      position: absolute;
      bottom: 0;
      margin-bottom: 0px;
      left: 0;
      width: 100%;
      background: rgba(255, 255, 255, 0.5);
      backdrop-filter: blur(10px);
      padding: 15px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      h4 {
        font-size: 18px;
        color: var(--primary-color);
        font-weight: 700;
      }
      h5 {
        font-size: 16px;
        color: #000;
        font-weight: 400;
      }
      .readbtn {
        a {
          font-size: 14px;
          color: var(--secondary-color);
          font-weight: 600;
          text-transform: uppercase;

          &:hover {
            color: var(--primary-color);
          }
        }
      }
    }
  }
`,h.default.div`
  padding: 80px 0;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 1) 0%,
    rgba(255, 255, 255, 0.72) 50%,
    rgba(51, 87, 149, 0.44) 100%
  );
  .faqtitle {
    h2 {
      font-size: 30px;
      color: var(--primary-color);
      font-weight: 700;
      text-transform: uppercase;
    }
    h3 {
      font-size: 20px;
      color: #000;
      font-weight: 400;
    }
  }
  .accordion {
    border-radius: 6px;
    border: none;
    .accordion-item {
      border-radius: 6px !important;
      margin-bottom: 10px;
      border: none;
      box-shadow: 1px 2px 10px rgba(0, 0, 0, 0.1);
      .accordion-button.collapsed {
        background: #fff;
        color: $black;
      }
      .accordion-button {
        border-radius: 6px;
        background: rgb(235, 235, 235);
        color: $white;
        font-size: 16px;
        padding: 24px;
        font-weight: 700;
        text-transform: capitalize;

        // &:after {
        //   filter: invert(100%);
        // }
        &:focus {
          border: none;
          box-shadow: none;
        }
      }
    }
    .accordion-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
      border-radius: 6px;
      p {
        font-size: 16px;
        font-weight: 400;
        color: $black;
      }
    }
  }
`),j=h.default.div`
  padding: 80px 0;
  background: #fff;
  .teamtitle {
    h2 {
      font-size: 30px;
      color: var(--primary-color);
      font-weight: 700;
      text-transform: uppercase;
    }
    h3 {
      font-size: 20px;
      color: #000;
      font-weight: 400;
    }
  }
  .clientbox {
    p {
      font-size: 18px;
      color: #000;
      font-weight: 400;
      font-style: italic;
    }
    .clientinfo {
      .clientimg {
        width: 70px;
        height: 70px;
        border-radius: 50%;
        overflow: hidden;
        img {
          width: 100%;
        }
      }
      h5 {
        color: var(--primary-color);
        font-size: 16px;
        font-weight: 600;
      }
      h6 {
        color: #000;
        font-size: 14px;
        font-weight: 400;
      }
    }
  }
  .quotesicon {
    position: absolute;
    bottom: 0;
    right: 0;
    color: var(--primary-color);
    opacity: 0.5;
  }
`,b=h.default.div`
  padding: 80px 0;
  background: rgba(51, 87, 149, 0.15);
  .teamtitle {
    h2 {
      font-size: 30px;
      color: var(--primary-color);
      font-weight: 700;
      text-transform: uppercase;
    }
    h3 {
      font-size: 20px;
      color: #000;
      font-weight: 400;
    }
  }
  .contactinfo {
    font-size: 25px;
    color: black;
    font-weight: 600;
    margin-top: 20px;
  }
  .contacttext {
    h4 {
      font-size: 16px;
      color: var(--primary-color);
      font-weight: 700;
      text-transform: uppercase;
    }
    h5 {
      font-size: 18px;
      color: #000;
      a {
        font-size: 18px;
        color: #000;

        text-decoration: none;
        &:hover {
          color: var(--primary-color);
        }
      }
    }
  }
  .contactbox {
    background: #fff;
    padding: 25px;
    border-radius: 6px;
    h4 {
      font-size: 20px;
      color: var(--primary-color);
      font-weight: 700;
      text-transform: uppercase;
      text-align: center;
    }

    form {
      input[type="text"],
      input[type="email"] {
        border: none;
        padding: 10px;
        width: 100%;
        border-radius: 6px;
        font-size: 16px;

        background: rgb(51, 87, 149, 0.2);
      }
      textarea {
        border: none;
        border-radius: 6px;
        padding: 10px;
        width: 100%;
        font-size: 16px;

        background: rgb(51, 87, 149, 0.2);
      }
      .submitbtn {
        background: var(--primary-color);
        color: #fff;
        font-weight: 600;
        font-size: 16px;
        padding: 10px;
        border-radius: 6px;
        border: none;
        width: 100%;
        text-transform: uppercase;

        &:hover {
          background: var(--secondary-color);
        }
      }
    }
  }
`,w=h.default.div`
  padding: 60px 0;
  background: #fff;
  .brandtitle {
    h2 {
      font-size: 30px;
      color: var(--primary-color);
      font-weight: 700;
      text-transform: uppercase;
    }
    h3 {
      font-size: 20px;
      color: #000;
      font-weight: 400;
    }
  }
  .logoimg {
    height: 100px;
    width: 100%;
    overflow: hidden;
    img {
      height: 100%;
    }
  }
`,y=h.default.section`
  background: url("/assets/user/images/image2.jpg");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  .overlay {
    padding: 130px 0;
    background: rgba(255, 255, 255, 0.7);
  }
  .teamtitle {
    h2 {
      font-size: 30px;
      color: var(--primary-color);
      font-weight: 700;
      text-transform: uppercase;
    }

    h3 {
      font-size: 20px;
      color: #000;
      font-weight: 400;
    }
  }

  .contentbox p {
    font-size: 16px;
    line-height: 1.7;
  }

  ul {
    list-style-type: disc;

    li {
      font-size: 16px;
      margin-bottom: 12px;

      strong {
        display: inline-block;
        margin-bottom: 4px;
      }
    }
  }
`,N=h.default.section`
  background: url("/assets/user/images/image3.jpg");
  background-size: contain;
  background-position: left;
  background-repeat: no-repeat;
  .overlay {
    padding: 130px 0;
    background: rgba(255, 255, 255, 0.7);
  }
  .teamtitle {
    h2 {
      font-size: 30px;
      color: var(--primary-color);
      font-weight: 700;
      text-transform: uppercase;
    }

    h3 {
      font-size: 20px;
      color: #000;
      font-weight: 400;
    }
  }

  .contentbox p {
    font-size: 16px;
    line-height: 1.7;
  }
`,k=h.default.section`
  background: url("/assets/user/images/image4.jpg");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  .overlay {
    padding: 130px 0;
    background: rgba(255, 255, 255, 0.5);
  }
  .teamtitle {
    h2 {
      font-size: 30px;
      color: var(--primary-color);
      font-weight: 700;
      text-transform: uppercase;
    }

    h3 {
      font-size: 20px;
      color: #000;
      font-weight: 400;
    }
  }

  .contentbox p {
    font-size: 16px;
    line-height: 1.7;
  }
`,z=h.default.a`
  background-color: var(--secondary-color); 
  color: white;
  padding: 12px 20px;
  border-radius: 8px;
  text-decoration: none;
  font-weight: 600;
  transition: all 0.3s ease;

  img {
    width: 25px;
    height: 25px;
    margin-right: 5px;
  }

  &:hover {
    background-color: var(--black);
    text-decoration: none;
  }

  b {
    margin-right: 5px;
  }
`;var I=t(92382),A=(t(4430),t(69078),t(40614));const S=e=>{let{isOpen:s,onClose:t,videoId:a}=e;return(0,i.useEffect)((()=>(document.body.style.overflow=s?"hidden":"unset",()=>{document.body.style.overflow="unset"})),[s]),s?(0,c.jsx)("div",{className:"video-popup-overlay",onClick:t,children:(0,c.jsxs)("div",{className:"video-popup-content",onClick:e=>e.stopPropagation(),children:[(0,c.jsx)("button",{className:"close-button",onClick:t,children:(0,c.jsx)(A.A,{size:24})}),(0,c.jsx)("div",{className:"video-container",children:(0,c.jsx)("iframe",{width:"100% ",height:"auto",src:"/assets/user/video/BluePrint Catalyst Overview.mp4?autoplay=1",title:"YouTube video player",frameBorder:"0",allow:"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",allowFullScreen:!0})})]})}):null},T=h.default.div`
  .video-popup-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(10px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .video-popup-content {
    position: relative;
    width: 90%;
    max-width: 1024px;
    aspect-ratio: 16/9;
    background: #000;
  }

  .video-container {
    width: 100%;
    height: 100%;
    iframe {
      aspect-ratio: 16/9;
      height: auto;
      width: 100%;
    }
  }

  .close-button {
    position: absolute;
    top: -40px;
    right: 0;
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    padding: 8px;
    z-index: 1001;

    &:hover {
      opacity: 0.8;
    }
  }
`;var q=t(86213);const C=[{id:"One",title:"Who should apply to the Angel Investment Simulator?",content:["The program is ideal for early-stage startup founders preparing for or navigating seed to Series B funding rounds. It is a real-time, investor-led North American perspective on positioning your company to close rounds. If you want to sharpen your fundraising skills, understand how investors think, and gain practical tools to scale your venture, this Academy was designed for you."]},{id:"Two",title:"What can participants expect to gain from the Angel Investment Simulator?",content:["Founders will walk away with investor-backed insights on term sheets, due diligence, valuations, and deal structuring\u2014plus direct access to active investors and experienced entrepreneurs. You\u2019ll not only learn the playbook, but you\u2019ll also build the relationships to help you play it right."]},{id:"Three",title:"What is the BluePrint Catalyst Data Room and Due Diligence Platform?",content:["It's a powerful platform explicitly designed for early-stage startups to build a structured, investor-ready data room and create an effective starter due diligence document. It helps founders streamline the investment process by organizing key financial, legal, and operational information."]},{id:"Four",title:"How does the platform improve my chances of getting investment?",content:["By simplifying and standardizing due diligence, you\u2019re able to present your business with confidence, clarity, and credibility. This makes it easier for investors to evaluate your opportunity and accelerates meaningful funding conversations."]},{id:"Five",title:"What is the BluePrint Catalyst Quarterly Investor Update Platform?",content:["It\u2019s a structured investor communication tool designed specifically to help founders deliver polished, consistent, and impactful updates. By consolidating key performance metrics, milestones, and challenges into one clear format, founders can build trust while saving time."]},{id:"Six",title:"Why does consistent investor communication matter?",content:["Transparent updates show you're in control, focused, and aware of your progress. This builds investor confidence, strengthens relationships, and keeps your business top-of-mind for future funding opportunities."]}],D=[{text:"Their team didn\u2019t just invest in us\u2014they rolled up their sleeves and drove real traction in sales and market reach.",name:"John Doe",title:"CEO, Company Name",img:"/assets/user/images/person.jpg"},{text:"This partnership accelerated our journey, giving us not only capital but critical introductions that turned into key customers.",name:"Jane Smith",title:"Co-Founder, StartupX",img:"/assets/user/images/person.jpg"},{text:"From pitch to product-market fit, they provided strategic support that helped us scale smarter and faster.",name:"Alex Carter",title:"CTO, TechGrowth",img:"/assets/user/images/person.jpg"},{text:"They understand early-stage needs and turned belief into action, guiding us through growth with hands-on expertise.",name:"Emily Zhao",title:"Founder, InnovateLab",img:"/assets/user/images/person.jpg"},{text:"I\u2019ve discovered exceptional co-investors through this firm, each bringing global insight and unique value to the table.",name:"Michael Lee",title:"Investor, GlobalFund",img:"/assets/user/images/person.jpg"},{text:"Their network made it easy to find and collaborate with investors whose vision and conviction matched mine.",name:"Nina Patel",title:"Angel Investor",img:"/assets/user/images/person.jpg"},{text:"This community brings together global capital with local intelligence\u2014it\u2019s where great deals meet great minds.",name:"Omar Khanna",title:"Partner, VentureBridge",img:"/assets/user/images/person.jpg"},{text:"Working with fellow investors across continents has expanded my portfolio and perspective in ways I hadn\u2019t expected.",name:"Lina Gomez",title:"Investor, Horizon Capital",img:"/assets/user/images/person.jpg"}];function E(){const[e,s]=(0,i.useState)(""),[t,o]=(0,i.useState)(!1);document.title="BLUEPRINT CATALYST.LTD";const[n,l]=(0,i.useState)(null),[p,h]=(0,i.useState)(!1),[x,A]=(0,i.useState)(null),E=[(0,i.useRef)(null),(0,i.useRef)(null),(0,i.useRef)(null),(0,i.useRef)(null)],[R,P]=(0,i.useState)(["0px","0px","0px","0px"]),O=e=>{const s=x===e?null:e;A(s);const t=[...R];t.forEach(((e,i)=>{t[i]=i===s&&E[i].current?`${E[i].current.scrollHeight}px`:"0px"})),P(t)};return(0,c.jsxs)(c.Fragment,{children:[(0,c.jsx)(d,{}),(0,c.jsxs)(g,{className:"home-banner d-flex flex-column gap-5",children:[(0,c.jsx)("div",{className:"videobox",children:(0,c.jsxs)("video",{autoPlay:!0,muted:!0,playsinline:!0,poster:"/assets/user/images/home.jpg",children:[(0,c.jsx)("source",{src:"/assets/user/images/home.mp4",type:"video/mp4"}),(0,c.jsx)("source",{src:"/assets/user/images/home.mov",type:"video/mov"}),"Your browser does not support the video tag."]})}),(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsx)("div",{className:"row justify-content-center",children:(0,c.jsx)("div",{className:"col-12 col-md-10",children:(0,c.jsxs)(I.A,{dots:!1,infinite:!0,speed:200,slidesToShow:1,slidesToScroll:1,arrows:!1,autoplay:!0,autoplaySpeed:5e3,children:[(0,c.jsxs)("div",{className:"bannertext text-center",children:[(0,c.jsx)("span",{className:"qubox topqu",children:(0,c.jsx)("img",{src:"/assets/user/images/qu1.png",alt:"image"})}),(0,c.jsx)("h1",{children:"In investing, what is comfortable is rarely profitable."}),(0,c.jsx)("span",{className:"qubox bottomqu",children:(0,c.jsx)("img",{src:"/assets/user/images/qu2.png",alt:"image"})}),(0,c.jsx)("div",{className:"d-flex justify-content-end",children:(0,c.jsx)("h6",{children:"- Robert Arnott"})})]}),(0,c.jsxs)("div",{className:"bannertext text-center",children:[(0,c.jsx)("span",{className:"qubox topqu",children:(0,c.jsx)("img",{src:"/assets/user/images/qu1.png",alt:"image"})}),(0,c.jsx)("h1",{children:"Risk comes from not knowing what you\u2019re doing."}),(0,c.jsx)("span",{className:"qubox bottomqu",children:(0,c.jsx)("img",{src:"/assets/user/images/qu2.png",alt:"image"})}),(0,c.jsx)("div",{className:"d-flex justify-content-end",children:(0,c.jsx)("h6",{children:"- Warren Buffett"})})]}),(0,c.jsxs)("div",{className:"bannertext text-center",children:[(0,c.jsx)("span",{className:"qubox topqu",children:(0,c.jsx)("img",{src:"/assets/user/images/qu1.png",alt:"image"})}),(0,c.jsx)("h1",{children:"An investment in knowledge pays the best interest."}),(0,c.jsx)("span",{className:"qubox bottomqu",children:(0,c.jsx)("img",{src:"/assets/user/images/qu2.png",alt:"image"})}),(0,c.jsx)("div",{className:"d-flex justify-content-end",children:(0,c.jsx)("h6",{children:"- Benjamin Franklin"})})]}),(0,c.jsxs)("div",{className:"bannertext text-center",children:[(0,c.jsx)("span",{className:"qubox topqu",children:(0,c.jsx)("img",{src:"/assets/user/images/qu1.png",alt:"image"})}),(0,c.jsx)("h1",{children:"Your network is your net worth."}),(0,c.jsx)("span",{className:"qubox bottomqu",children:(0,c.jsx)("img",{src:"/assets/user/images/qu2.png",alt:"image"})}),(0,c.jsx)("div",{className:"d-flex justify-content-end",children:(0,c.jsx)("h6",{children:"- Porter Gale "})})]}),(0,c.jsxs)("div",{className:"bannertext text-center",children:[(0,c.jsx)("span",{className:"qubox topqu",children:(0,c.jsx)("img",{src:"/assets/user/images/qu1.png",alt:"image"})}),(0,c.jsx)("h1",{children:"If you want to go fast, go alone. If you want to go far, go with others."}),(0,c.jsx)("span",{className:"qubox bottomqu",children:(0,c.jsx)("img",{src:"/assets/user/images/qu2.png",alt:"image"})}),(0,c.jsx)("div",{className:"d-flex justify-content-end",children:(0,c.jsx)("h6",{children:"- African Proverb"})})]})]})})})}),(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsxs)("div",{className:"row gy-3",children:[(0,c.jsx)("div",{className:"col-md-4",children:(0,c.jsx)("a",{href:"/",className:"newsview d-flex flex-column gap-2  ",children:(0,c.jsx)("div",{className:"news-text text-center",children:(0,c.jsxs)("p",{children:[(0,c.jsx)("b",{children:"For Entrepreneurs: "}),"Apply for Angel Investment Simulator"]})})})}),(0,c.jsx)("div",{className:"col-md-4",children:(0,c.jsx)("a",{href:"/",className:"newsview d-flex flex-column gap-2",children:(0,c.jsx)("div",{className:"news-text text-center",children:(0,c.jsxs)("p",{children:[(0,c.jsx)("b",{children:"For Entrepreneurs: "}),"Access Dataroom, Diligence & Investor Reporting Tools"]})})})}),(0,c.jsx)("div",{className:"col-md-4",children:(0,c.jsx)("a",{href:"/",className:"newsview d-flex flex-column gap-2",children:(0,c.jsx)("div",{className:"news-text text-center",children:(0,c.jsxs)("p",{children:[(0,c.jsx)("b",{children:"For Investors: "}),"Review Your Investments & Join our Exclusive International eco-system"]})})})})]})})]}),(0,c.jsx)(u,{className:"d-block",children:(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsxs)("div",{className:"row gy-4 gx-md-5",children:[(0,c.jsx)("div",{className:"col-md-6",children:(0,c.jsxs)("div",{className:"bigimg d-block position-relative",children:[(0,c.jsxs)("div",{className:"yearexp",children:[(0,c.jsx)("h4",{children:"150+"}),(0,c.jsx)("h5",{children:"Industry Partners"})]}),(0,c.jsx)("div",{className:"about-img",children:(0,c.jsx)("img",{src:"/assets/user/images/image1.jpg",alt:"image"})})]})}),(0,c.jsx)("div",{className:"col-md-6",children:(0,c.jsxs)("div",{className:"about-text d-flex flex-column gap-3",children:[(0,c.jsx)("h2",{children:"About Us"}),(0,c.jsx)("h3",{children:"Original Thinking + Global Vision = Smart Capital"}),(0,c.jsxs)("p",{children:[(0,c.jsx)("b",{children:"BluePrint Catalyst Limited "})," is a global capital advisory firm specializing in early-stage and growth investments across Asia, Europe, and North America. With a strong track record of identifying high-potential ventures, we don\u2019t just invest\u2014we unlock value."]}),(0,c.jsxs)("p",{children:[(0,c.jsx)("b",{children:"For Entrepreneurs:"})," ",(0,c.jsx)("br",{}),"We offer more than funding. Our platform empowers founders with hands-on guidance, rigorous due diligence, investor-ready reporting, and access to a powerful network. The result? Smart growth and long-term success."]}),(0,c.jsxs)("p",{children:[(0,c.jsx)("b",{children:"For Investors:"})," ",(0,c.jsx)("br",{}),"Through our global network and deep cross-border expertise, we provide our exclusive investor partner community with a reliable strategic gateway to high-growth, innovation-driven opportunities."]}),(0,c.jsxs)("div",{className:"row gy-4 gx-md-5",children:[(0,c.jsx)("div",{className:"col-md-6",children:(0,c.jsxs)("div",{className:"d-flex flex-column gap-2 extext",children:[(0,c.jsxs)("h5",{children:[(0,c.jsx)("sup",{children:"est."})," 2025"]}),(0,c.jsx)("h6",{children:"With decades of expertise"})]})}),(0,c.jsx)("div",{className:"col-md-6",children:(0,c.jsxs)("div",{className:"d-flex flex-column gap-2 extext",children:[(0,c.jsx)("h5",{children:"250 +"}),(0,c.jsx)("h6",{children:"Investment track record"})]})})]})]})})]})})}),(0,c.jsx)(f,{className:"d-block",children:(0,c.jsxs)("div",{className:"container-lg",children:[(0,c.jsx)("div",{className:"text-center mb-5",children:(0,c.jsx)("h2",{className:"service-title",children:"Our Services"})}),(0,c.jsxs)("div",{className:"row g-4",children:[(0,c.jsx)("div",{className:"col-md-6 col-lg-3",children:(0,c.jsxs)("div",{className:"service-card p-4 d-flex flex-column gap-3 position-relative",children:[(0,c.jsx)("h3",{children:"01"}),(0,c.jsx)("h4",{children:"Data room & Diligence"}),(0,c.jsx)("p",{children:"Accelerate funding with structured, investor-ready clarity."}),(0,c.jsx)("div",{ref:E[0],className:"expandable-text-wrapper",style:{maxHeight:R[0],overflow:"hidden",transition:"max-height 0.4s ease"},children:(0,c.jsxs)("p",{className:"m-0",children:["The ",(0,c.jsx)("b",{children:"Data Room and Due Diligence Platform"}),"by BluePrint Catalyst equips early-stage companies with the tools to build a structured,"," ",(0,c.jsx)("b",{children:"investor-ready data room "})," and craft a"," ",(0,c.jsx)("b",{children:"strong starter due diligence document"}),". Designed to streamline the investment process, this platform helps founders organize key financial, legal, and operational information, ensuring transparency and credibility when engaging investors. By simplifying due diligence, startups can confidently present their business, accelerate funding discussions, and increase their chances of securing investment."]})}),(0,c.jsxs)("a",{href:"#",onClick:e=>{e.preventDefault(),O(0)},className:"readlink d-inline-flex align-items-center gap-1",children:[0===x?"Read Less":"Read More",(0,c.jsx)("span",{style:{display:"inline-block",transition:"transform 0.3s ease",transform:0===x?"rotate(-90deg)":"rotate(0deg)"},children:(0,c.jsx)(r.A,{})})]})]})}),(0,c.jsx)("div",{className:"col-md-6 col-lg-3",children:(0,c.jsxs)("div",{className:"service-card p-4 d-flex flex-column gap-3 position-relative",children:[(0,c.jsx)("h3",{children:"02"}),(0,c.jsx)("h4",{children:"Angel Investment Simulator"}),(0,c.jsx)("p",{children:"Investor-driven insights to empower founder positioning."}),(0,c.jsx)("div",{ref:E[1],className:"expandable-text-wrapper",style:{maxHeight:R[1],overflow:"hidden",transition:"max-height 0.4s ease"},children:(0,c.jsxs)("p",{className:"m-0",children:["The ",(0,c.jsx)("b",{children:"International Entrepreneur Academy"}),", powered by BluePrint Catalyst Limited, gives early-stage founders direct access to ",(0,c.jsx)("b",{children:"active investors"})," and seasoned entrepreneurs closing seed, series A and B rounds. Through real-world insights, participants learn how investors assess startups, structure deals, and determine valuations. The program covers critical topics like term sheets, due diligence, and strategic positioning, arming founders with the ",(0,c.jsx)("b",{children:"knowledge, tools, and investor connections"})," needed to scale and secure funding effectively."]})}),(0,c.jsxs)("a",{href:"#",onClick:e=>{e.preventDefault(),O(1)},className:"readlink d-inline-flex align-items-center gap-1",children:[1===x?"Read Less":"Read More",(0,c.jsx)("span",{style:{display:"inline-block",transition:"transform 0.3s ease",transform:1===x?"rotate(-90deg)":"rotate(0deg)"},children:(0,c.jsx)(r.A,{})})]})]})}),(0,c.jsx)("div",{className:"col-md-6 col-lg-3",children:(0,c.jsxs)("div",{className:"service-card p-4 d-flex flex-column gap-3 position-relative",children:[(0,c.jsx)("h3",{children:"03"}),(0,c.jsx)("h4",{children:"Investor Docs & Reporting"}),(0,c.jsx)("p",{children:"Effortless updates that strengthen trust and funding."}),(0,c.jsx)("div",{ref:E[2],className:"expandable-text-wrapper",style:{maxHeight:R[2],overflow:"hidden",transition:"max-height 0.4s ease"},children:(0,c.jsxs)("p",{className:"m-0",children:["Consistent communication ",(0,c.jsx)("b",{children:"builds investor confidence"}),". BluePrint Catalyst makes it effortless. Our structured"," ",(0,c.jsx)("b",{children:"investment document repository"})," and"," ",(0,c.jsx)("b",{children:"quarterly update platform"})," transform scattered updates into polished, investor-ready reports. Founders save time, deliver clarity, and demonstrate traction with standardized reporting that tracks performance, milestones, and challenges. The result? Stronger relationships, sharper accountability, and a smoother path to future funding. Let your updates speak volumes\u2014without saying a word too many."]})}),(0,c.jsxs)("a",{href:"#",onClick:e=>{e.preventDefault(),O(2)},className:"readlink d-inline-flex align-items-center gap-1",children:[2===x?"Read Less":"Read More",(0,c.jsx)("span",{style:{display:"inline-block",transition:"transform 0.3s ease",transform:2===x?"rotate(-90deg)":"rotate(0deg)"},children:(0,c.jsx)(r.A,{})})]})]})}),(0,c.jsx)("div",{className:"col-md-6 col-lg-3",children:(0,c.jsxs)("div",{className:"service-card p-4 d-flex flex-column gap-3 position-relative",children:[(0,c.jsx)("h3",{children:"04"}),(0,c.jsx)("h4",{children:"Closed Network of Investors"}),(0,c.jsx)("p",{children:"Syndicated deal flow shared among vetted investors."}),(0,c.jsx)("div",{ref:E[3],className:"expandable-text-wrapper",style:{maxHeight:R[3],overflow:"hidden",transition:"max-height 0.4s ease"},children:(0,c.jsxs)("p",{className:"m-0",children:["We spotlight startups ",(0,c.jsx)("b",{children:"ready to scale"}),", not just meet investors. Our platform of vetting through our Academy and consolidation of diligence documents helps to connect high-potential companies with an"," ",(0,c.jsx)("b",{children:"exclusive global investor network"}),", backed by seasoned partners who help sharpen strategy and accelerate growth. We prepare founders to lead and succeed from positioning to investment to exit. Success isn\u2019t luck\u2014it\u2019s readiness, refined."]})}),(0,c.jsxs)("a",{href:"#",onClick:e=>{e.preventDefault(),O(3)},className:"readlink d-inline-flex align-items-center gap-1",children:[3===x?"Read Less":"Read More",(0,c.jsx)("span",{style:{display:"inline-block",transition:"transform 0.3s ease",transform:3===x?"rotate(-90deg)":"rotate(0deg)"},children:(0,c.jsx)(r.A,{})})]})]})})]})]})}),(0,c.jsx)(y,{className:"d-block scroll-mt-[300px]",id:"angel",children:(0,c.jsx)("div",{className:"overlay d-block",children:(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsxs)("div",{className:"row gy-4",children:[(0,c.jsx)("div",{className:"col-12 mb-4",children:(0,c.jsxs)("div",{className:"teamtitle d-flex flex-column gap-2 text-center",children:[(0,c.jsx)("h2",{children:"Angel Investment Simulator"}),(0,c.jsx)("h3",{children:"Investor-driven insights to empower founder positioning."})]})}),(0,c.jsx)("div",{className:"col-12",children:(0,c.jsxs)("div",{className:"contentbox mx-auto",style:{maxWidth:"900px"},children:[(0,c.jsxs)("p",{children:["The ",(0,c.jsx)("b",{children:" Angel Investment Simulator"})," gives early-stage founders direct access to ",(0,c.jsx)("b",{children:"active investors"})," and seasoned entrepreneurs closing their seed, series A and B rounds. Through real-world insights, participants learn how investors assess startups, structure deals, and determine valuations. You will be a part of our real-life investor process. Modules include:"]}),(0,c.jsxs)("ul",{className:"mt-3 ps-3",style:{listStyle:"none",paddingLeft:"0"},children:[(0,c.jsxs)("li",{children:[(0,c.jsx)("strong",{children:"1. BE THE INVESTOR:"})," Learn directly from real companies, presenting to our real investors."]}),(0,c.jsxs)("li",{children:[(0,c.jsx)("strong",{children:"2. GET INVESTMENT READY:"})," Align your valuation, investment structure, and term sheet for investors."]}),(0,c.jsxs)("li",{children:[(0,c.jsx)("strong",{children:"3. POSITION YOUR PITCH:"})," Learn directly from our investors on how to position your investor deck."]}),(0,c.jsxs)("li",{children:[(0,c.jsx)("strong",{children:"4. PORTFOLIO DAY (TOP 20 COMPANIES):"})," ","Present to active investors at our exclusive quarterly \u2018Portfolio Day\u2019."]})]})]})}),(0,c.jsx)("div",{className:"col-12",children:(0,c.jsx)("div",{className:"d-flex justify-content-center",children:(0,c.jsxs)("div",{className:"d-flex gap-4 flex-column flex-md-row",children:[(0,c.jsxs)(z,{target:"_blank",rel:"noopener noreferrer",href:"/assets/user/images/Angel%20Investment%20Simulator%20Overview%20-%202025.pdf",children:[(0,c.jsx)("img",{src:"/assets/user/images/pdfwhite.png",alt:"PDF"}),(0,c.jsx)("b",{children:"Download"}),"our Simulator Overview"]}),(0,c.jsxs)(z,{href:"/apply-link",children:[(0,c.jsx)("b",{children:"APPLY"}),"for Angel Investment Simulator"]})]})})})]})})})}),(0,c.jsx)(N,{className:"d-block scroll-mt-[300px]",id:"dataroom",children:(0,c.jsx)("div",{className:"overlay d-block",children:(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsxs)("div",{className:"row gy-4",children:[(0,c.jsx)("div",{className:"col-12 mb-4",children:(0,c.jsxs)("div",{className:"teamtitle d-flex flex-column gap-2 text-center",children:[(0,c.jsx)("h2",{children:"Data room, Due Diligence, Investment Docs & Investor Reporting"}),(0,c.jsx)("h3",{children:"Accelerate funding with structured, investor-ready clarity."})]})}),(0,c.jsx)("div",{className:"col-12",children:(0,c.jsxs)("div",{className:"contentbox mx-auto text-center",style:{maxWidth:"900px"},children:[(0,c.jsx)("p",{children:"BluePrint Catalyst\u2019s Data Room and Due Diligence Platform helps early-stage startups create an organized, investor-ready data room and streamline reporting. With tools to centralize financial, legal, and operational info, founders can simplify due diligence, boost transparency, and accelerate funding."}),(0,c.jsx)("p",{className:"mt-3",children:"The platform\u2019s structured updates and reporting system turn scattered progress into clear, consistent investor communications\u2014building trust, saving time, and paving the way for future growth."})]})}),(0,c.jsx)("div",{className:"col-12",children:(0,c.jsx)("div",{className:"d-flex justify-content-center",children:(0,c.jsx)("div",{className:"d-flex gap-4 flex-column flex-md-row",children:(0,c.jsxs)(z,{href:"/apply-link",children:[(0,c.jsx)("b",{children:"ACCESS"}),"Dataroom, Diligence & Investor Reporting Tools"]})})})})]})})})}),(0,c.jsx)(k,{className:"d-block scroll-mt-[300px]",id:"exclusive",children:(0,c.jsx)("div",{className:"overlay d-block",children:(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsxs)("div",{className:"row gy-4",children:[(0,c.jsx)("div",{className:"col-12 mb-4",children:(0,c.jsxs)("div",{className:"teamtitle d-flex flex-column gap-2 text-center",children:[(0,c.jsx)("h2",{children:"Exclusive Global Investor Alliance"}),(0,c.jsx)("h3",{children:"Syndicated deal flow shared among vetted investors"})]})}),(0,c.jsx)("div",{className:"col-12",children:(0,c.jsxs)("div",{className:"contentbox mx-auto text-center",style:{maxWidth:"900px"},children:[(0,c.jsxs)("p",{children:["Our global network of investors doesn\u2019t just fund growth\u2014"," ",(0,c.jsx)("b",{children:"they engineer it"}),". Through collaborative vetting, shared diligence, and active syndication, this inclusive yet exclusive group curates top-tier startups and propels them toward scale."]}),(0,c.jsx)("p",{className:"mt-3",children:"Backed by our Angel Investment Simulator\u2019s structured readiness programs, founders gain strategic clarity while investors align on deals built for traction and exit. We bring the right companies to the right tables\u2014because scale starts with smart capital."})]})}),(0,c.jsx)("div",{className:"col-12",children:(0,c.jsx)("div",{className:"d-flex justify-content-center",children:(0,c.jsx)("div",{className:"d-flex gap-4 flex-column flex-md-row",children:(0,c.jsxs)(z,{href:"/apply-link",children:[(0,c.jsx)("b",{children:"ACCESS"}),"Your Investments & Join our Exclusive International eco-system"]})})})})]})})})}),(0,c.jsx)(v,{className:"d-block",children:(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsxs)("div",{className:"row gy-4",children:[(0,c.jsx)("div",{className:"col-12 mb-5",children:(0,c.jsxs)("div",{className:"faqtitle d-flex flex-column gap-2 text-center",children:[(0,c.jsx)("h2",{children:"Frequently Asked Questions"}),(0,c.jsx)("h3",{children:"Get answers to common questions"})]})}),(0,c.jsx)("div",{className:"col-12",children:(0,c.jsx)("div",{className:"accordion",id:"accordionExample",children:C.map((e=>(0,c.jsxs)("div",{className:"accordion-item rounded-0",children:[(0,c.jsx)("h2",{className:"accordion-header",id:`heading${e.id}`,children:(0,c.jsx)("button",{className:"accordion-button "+(n===e.id?"":"collapsed"),type:"button",onClick:()=>{return s=e.id,void l((e=>e===s?null:s));var s},children:e.title})}),(0,c.jsx)("div",{id:`collapse${e.id}`,className:"accordion-collapse collapse "+(n===e.id?"show":""),children:(0,c.jsx)("div",{className:"accordion-body",children:e.content.map(((e,s)=>(0,c.jsx)("p",{children:e},s)))})})]},e.id)))})})]})})}),(0,c.jsx)(j,{className:"d-block",children:(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsxs)("div",{className:"row gy-4",children:[(0,c.jsx)("div",{className:"col-12 mb-5",children:(0,c.jsxs)("div",{className:"teamtitle d-flex flex-column gap-2 text-center",children:[(0,c.jsx)("h2",{children:"Testimonials"}),(0,c.jsx)("h3",{children:"What our network is saying about us"})]})}),(0,c.jsxs)("div",{className:"col-md-8 offset-md-2 position-relative",children:[(0,c.jsx)(I.A,{dots:!0,infinite:!0,speed:200,slidesToShow:1,slidesToScroll:1,arrows:!1,autoplay:!0,autoplaySpeed:5e3,children:D.map(((e,s)=>(0,c.jsx)("div",{className:"clientbox mb-4",children:(0,c.jsxs)("div",{className:"d-flex flex-column gap-3",children:[(0,c.jsx)("p",{children:e.text}),(0,c.jsxs)("div",{className:"d-flex gap-2 align-items-center clientinfo",children:[(0,c.jsx)("div",{className:"flex-shrink-0",children:(0,c.jsx)("div",{className:"clientimg",children:(0,c.jsx)("img",{src:e.img,alt:e.name})})}),(0,c.jsxs)("div",{className:"flex-grow-1",children:[(0,c.jsx)("h5",{children:e.name}),(0,c.jsx)("h6",{children:e.title})]})]})]})},s)))}),(0,c.jsx)(a.EpZ,{size:100,className:"quotesicon"})]})]})})}),(0,c.jsx)(b,{className:"d-block",children:(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsxs)("div",{className:"row gy-4",children:[(0,c.jsx)("div",{className:"col-12 mb-5",children:(0,c.jsxs)("div",{className:"teamtitle d-flex flex-column gap-2 text-center",children:[(0,c.jsx)("h2",{children:"Contact Us"}),(0,c.jsx)("h3",{children:"Get in touch with us"})]})}),(0,c.jsx)("div",{className:"col-md-6 mx-auto",children:(0,c.jsxs)("div",{className:"d-flex flex-column gap-4 contactbox",children:[(0,c.jsx)("h4",{children:"Please fill out the form"}),(0,c.jsx)("form",{action:"javascript:void(0)",onSubmit:async e=>{e.preventDefault();var t=e.target;let i={first_name:t.first_name.value,last_name:t.first_name.value,phone:t.phone.value,email:t.email.value,message:t.message.value};try{const e=await q.A.post("https://blueprintcatalyst.com/api/user/sendcontactInfo",i,{headers:{Accept:"application/json","Content-Type":"application/json"}});!0===e.data.success?(o(!0),t.reset()):o(!1),s(e.data.message),setTimeout((()=>{s("")}),1800)}catch(a){}},method:"post",children:(0,c.jsxs)("div",{className:"row gy-4",children:[(0,c.jsx)("div",{className:"col-md-6",children:(0,c.jsx)("input",{type:"text",placeholder:"First Name *",name:"first_name",required:!0})}),(0,c.jsx)("div",{className:"col-md-6",children:(0,c.jsx)("input",{type:"text",placeholder:"Last Name *",name:"last_name",required:!0})}),(0,c.jsx)("div",{className:"col-md-6",children:(0,c.jsx)("input",{type:"tel",className:"tell",required:!0,placeholder:"Phone Number *",name:"phone"})}),(0,c.jsx)("div",{className:"col-md-6",children:(0,c.jsx)("input",{type:"email",placeholder:"Email *",name:"email",required:!0})}),(0,c.jsx)("div",{className:"col-12",children:(0,c.jsx)("textarea",{name:"message",id:"",cols:"30",rows:"5",required:!0,placeholder:"Write a message *"})}),(0,c.jsx)("span",{className:t?"text-success":"text-danger",children:e}),(0,c.jsx)("div",{className:"col-12",children:(0,c.jsx)("button",{type:"submit",className:"submitbtn",children:"Send Message"})})]})})]})})]})})}),(0,c.jsx)(w,{className:"d-block",children:(0,c.jsx)("div",{className:"container-lg",children:(0,c.jsxs)("div",{className:"row gy-5",children:[(0,c.jsx)("div",{className:"col-12",children:(0,c.jsxs)("div",{className:"brandtitle d-flex flex-column gap-2 text-center",children:[(0,c.jsx)("h2",{children:"OUR GLOBAL INDUSTRY PARTNERS"}),(0,c.jsx)("h3",{children:"Trusted by the World's Most Innovative Companies"})]})}),(0,c.jsx)("div",{className:"col-12",children:(0,c.jsxs)("div",{className:"d-flex flex-column flex-md-row justify-content-center align-items-center gap-2",children:[(0,c.jsx)("div",{className:"",children:(0,c.jsx)("div",{className:"logoimg",children:(0,c.jsx)("img",{src:"/assets/user/images/pimg1.png",alt:"image"})})}),(0,c.jsx)("div",{className:"",children:(0,c.jsx)("div",{className:"logoimg",children:(0,c.jsx)("img",{src:"/assets/user/images/pimg2.png",alt:"image"})})}),(0,c.jsx)("div",{className:"",children:(0,c.jsx)("div",{className:"logoimg",children:(0,c.jsx)("img",{src:"/assets/user/images/pimg3.png",alt:"image"})})})]})})]})})}),(0,c.jsx)(T,{children:(0,c.jsx)(S,{isOpen:p,onClose:()=>h(!1),videoId:"YOUR_YOUTUBE_VIDEO_ID"})}),(0,c.jsx)(m,{})]})}}}]);
//# sourceMappingURL=7754.a24d87ea.chunk.js.map