import React from "react";
import { Instagram, Linkedin } from "lucide-react";
import { FooterHome } from "../Styles/HomeFooterStyle";
import { FaXTwitter } from "react-icons/fa6";
import { Link as ScrollLink } from "react-scroll";

export default function HomeFooter() {
  return (
    <>
      <FooterHome className="home-footer">
        <div className="container-fluid">
          <div className="row gy-4">
            <div className="col-md-3">
              <div className="d-flex flex-column gap-3">
                <div className="footer-logo">
                  <img src="/logos/logo.png" alt="image" />
                </div>
                <div className="footer-text">
                  <p>
                    BluePrint Catalyst Limited is a global capital advisory firm
                    driving early-stage and growth investments across Asia,
                    Europe, and North America. Our proven track record speaks to
                    our ability to identify high-potential ventures and
                    accelerate value creation.”
                  </p>
                </div>
              </div>
            </div>
            <div className="col-md-3">
              {/* <div className="d-flex flex-column gap-3 ftcol">
                <h4>SERVICES</h4>
                <div className="d-flex flex-column gap-2 ftlinks">
                  <ScrollLink
                    to="angel"
                    smooth={true}
                    offset={-100}
                    duration={500}
                  >
                    Angel Investment Simulator
                  </ScrollLink>
                  <ScrollLink
                    className="nav-link"
                    to="dataroom"
                    smooth={true}
                    offset={-100}
                    duration={500}
                  >
                    Dataroom, Diligence & Reporting
                  </ScrollLink>
                  <ScrollLink
                    className="nav-link"
                    to="exclusive"
                    smooth={true}
                    offset={-100}
                    duration={500}
                  >
                    Exclusive Global Investor Alliance
                  </ScrollLink>
                </div>
              </div> */}
            </div>
            <div className="col-md-3">
              <div className="d-flex flex-column gap-3 ftcol">
                <h4>COMPANY</h4>
                <div className="d-flex flex-column gap-2 ftlinks lastredlink">
                  {/* <a href="/">Our team</a>
                  <a href="/">Company data</a> */}
                  <a href="/">Contact us</a>
                  <a href="mailto:info@blueprintcatalyst.com">
                    info@blueprintcatalyst.com
                  </a>
                </div>
              </div>
            </div>

            <div className="col-md-3">
              <div className="d-flex flex-column gap-3 ftcol">
                <h4>Follow us</h4>
                <div className="d-flex gap-3 align-items-center siconft">
                  {/* <a href="/">
                    <FaXTwitter className="social-icon" size={20} />
                  </a>
                  <a href="/">
                    <Instagram className="social-icon" size={20} />
                  </a> */}
                  <a
                    target="_blank"
                    href="https://www.linkedin.com/in/ozanisinak/
"
                  >
                    <Linkedin className="social-icon" size={20} />
                  </a>
                </div>
              </div>
            </div>

            {/* <div className="col-12 mt-5">
              <div className="d-flex justify-content-md-center">
                <div className="d-flex flex-column flex-sm-row align-items-md-center gap-3 gap-md-4  bottom-links">
                  <a href="/">Company policy</a>
                  <a href="/" target="_blank">
                    Terms of use
                  </a>
                  <a href="/">Accessibility</a>
                </div>
              </div>
            </div> */}
          </div>
        </div>
        <div className="footer-bottom text-center mt-5">
          <div className="container-fluid">
            <p>&copy; 2025 Blueprint Catalyst. All rights reserved.</p>
          </div>
        </div>
      </FooterHome>
    </>
  );
}
