import styled from "styled-components";

export const FooterHome = styled.div`
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
`;
