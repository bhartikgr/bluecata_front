import styled from "styled-components";

export const SectionBox = styled.div`
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
    z-index: 0;
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
`;

export const Aboutbox = styled.div`
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
      background: var(--primary);
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
      color: var(--primary);
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
      color: var(--primary);
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
`;

export const ServiceBox = styled.div`
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
    color: var(--primary);
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
      -webkit-text-stroke-color: var(--primary);
    }

    @media (max-width: 768px) {
      h3 {
        font-size: 30px;
      }
    }
    h4 {
      font-size: 20px;
      color: var(--primary);
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
      background: var(--primary);
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
`;

export const TeamBox = styled.div`
  padding: 80px 0;
  background: url("/assets/user/images/image2.jpg");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;

  .teamtitle {
    h2 {
      font-size: 30px;
      color: var(--primary);
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
      color: var(--primary);
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
      background: var(--primary);
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
        background: var(--primary);
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
          stroke: var(--primary);
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
    background: var(--primary);
    border: 1px solid var(--primary);
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
`;

export const VideoBox = styled.div`
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
`;

export const PortfolioBox = styled.div`
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
      color: var(--primary);
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
    background: var(--primary);
    border: 1px solid var(--primary);
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
        color: var(--primary);
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
            color: var(--primary);
          }
        }
      }
    }
  }
`;
export const Faq = styled.div`
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
      color: var(--primary);
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
`;
export const TestimonialBox = styled.div`
  padding: 80px 0;
  background: #fff;
  .teamtitle {
    h2 {
      font-size: 30px;
      color: var(--primary);
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
        color: var(--primary);
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
    color: var(--primary);
    opacity: 0.5;
  }
`;

export const ContactBox = styled.div`
  padding: 80px 0;
  background: rgba(51, 87, 149, 0.15);
  .teamtitle {
    h2 {
      font-size: 30px;
      color: var(--primary);
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
      color: var(--primary);
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
          color: var(--primary);
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
      color: var(--primary);
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
        background: var(--primary);
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
`;
export const BrandBox = styled.div`
  padding: 60px 0;
  background: #fff;
  .brandtitle {
    h2 {
      font-size: 30px;
      color: var(--primary);
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
`;
export const InvestmentSection = styled.section`
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
      color: var(--primary);
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
`;
export const Dataroom = styled.section`
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
      color: var(--primary);
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
`;
export const Exclusive = styled.section`
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
      color: var(--primary);
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
`;
export const PrimaryButton = styled.a`
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
`;
