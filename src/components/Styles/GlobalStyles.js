import { createGlobalStyle } from "styled-components";
import styled from "styled-components";

export const GlobalStyles = createGlobalStyle`
@import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap');
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


  // @font-face {
  //   font-family: 'Blair ITC';
  //   src: url('/assets/fonts/BlairITC-Medium.eot');
  //   src: url('/assets/fonts/BlairITC-Medium.eot?#iefix') format('embedded-opentype'),
  //        url('/assets/fonts/BlairITC-Medium.woff2') format('woff2'),
  //        url('/assets/fonts/BlairITC-Medium.woff') format('woff'),
  //        url('/assets/fonts/BlairITC-Medium.ttf') format('truetype'),
  //        url('/assets/fonts/BlairITC-Medium.svg#BlairITC-Medium') format('svg');
  //   font-weight: 500;
  //   font-style: normal;
  //   font-display: swap;
  // }

  // @font-face {
  //   font-family: 'Blair ITC Std';
  //   src: url('/assets/fonts/BlairITCStd-Light.eot');
  //   src: url('/assets/fonts/BlairITCStd-Light.eot?#iefix') format('embedded-opentype'),
  //        url('/assets/fonts/BlairITCStd-Light.woff2') format('woff2'),
  //        url('/assets/fonts/BlairITCStd-Light.woff') format('woff'),
  //        url('/assets/fonts/BlairITCStd-Light.ttf') format('truetype'),
  //        url('/assets/fonts/BlairITCStd-Light.svg#BlairITCStd-Light') format('svg');
  //   font-weight: 300;
  //   font-style: normal;
  //   font-display: swap;
  // }

  // @font-face {
  //   font-family: 'Mercury Display';
  //   src: url('/assets/fonts/MercuryDisplay-Roman.eot');
  //   src: url('/assets/fonts/MercuryDisplay-Roman.eot?#iefix') format('embedded-opentype'),
  //        url('/assets/fonts/MercuryDisplay-Roman.woff2') format('woff2'),
  //        url('/assets/fonts/MercuryDisplay-Roman.woff') format('woff'),
  //        url('/assets/fonts/MercuryDisplay-Roman.ttf') format('truetype'),
  //        url('/assets/fonts/MercuryDisplay-Roman.svg#MercuryDisplay-Roman') format('svg');
  //   font-weight: normal;
  //   font-style: normal;
  //   font-display: swap;
  // }


  :root {
    --secondary-color: #EFEFEF;
    --black:#0A0A0A;
  }


  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: "Montserrat", sans-serif;;
    margin: 0;
    padding: 0;
    overflow-x: hidden;
      scroll-padding-top: 400px;
  }


  header {
    background-color: var(--primary);
    padding: 4px 0;
    border-bottom: 10px solid var(--secondary-color);
  }

 .headerhome.sticky-header {
   top: 0;
   left: 0;
   right: 0;
   z-index: 997;
   transition: all 0.3s ease-in-out;
 }
.navbar-toggler{
background-color: #fff;
padding: 0px;
width: 40px;
height: 40px;
span{
width: 10px;
height: 10px;
}
}

  .navbar-brand {
    width: 200px;
  }

  .navbar-brand img {
    width: 100%;
  }

  @media (max-width: 768px) {
    .navbar-brand {
      width: 100px;
    }
  }


  .navbar ul {
    display: flex;
    gap: 20px;
    list-style: none;
    padding: 0;
  }
  @media (max-width: 991px) {
    .navbar ul {
      gap: 0px;
    }
  }
      .navbar ul li:not(:last-child) a{
      &:after{
        content: "";
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        right: -15px;
        width: 10px;
        height: 2px;
        background-color: #fff;
      }
}
  .navbar ul li a {
  position: relative;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    transition: color 0.3s ease;
  }

  .navbar ul li a:hover,  .navbar ul li a:focus {
    color: var(--secondary-color);
  }


  .topsearchbox form {
    width: 200px;
    background-color: #7fa1dd;
    border-radius: 6px;
    overflow: hidden;
    display: flex;
   
  }
  @media (max-width: 768px) {
    .topsearchbox form {
    width: 100%;
  }
  }
  .topsearchbox form input {
    border: none;
    width: 100%;
    font-size: 14px;
    padding: 4px 10px;
    background-color: #7fa1dd;
    color: #fff;
    &::-moz-placeholder {

      color: #fff !important;

      opacity: 1;

    }

    &::-webkit-input-placeholder { /* Chrome/Opera/Safari */

      color: #fff !important;

    }

    &:-ms-input-placeholder { /* IE 10+ */

      color: #fff !important;

    }

    &:-moz-placeholder { /* Firefox 18- */

      color: #fff !important;

    }
  }

  .topsearchbox form button {
    background-color: #7fa1dd;
    border: none;
    color: #fff;
    border-radius: 5px;
    padding: 4px;
  }
`;

export const BackButton = styled.button`
  background-color: #212529;
  color: #fff;
  border: none;
  padding: 10px 30px;
  font-weight: 400;
  font-size: 12px;
  border-radius: 4px;
  text-transform: capitalize;
`;
