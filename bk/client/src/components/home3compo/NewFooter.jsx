import React, { useState } from "react";
import ContactUsPopup from "./ContactUsPopup";
export default function NewFooter() {
  const [showContactPopup, setShowContactPopup] = useState(false);
  return (
    <>
      <footer className="site-footer" role="contentinfo">
        <div className="container">
          <div className="footer-inner">
            <div className="footer-brand">
              <div style={{ marginBottom: "var(--space-4)" }}>
                <img
                  src="/assets/capavate-logo-dark.png"
                  alt="Capavate"
                  className="footer-logo-img"
                  height="32"
                  id="footer-logo-img"
                />
              </div>
              <p className="footer-brand-desc">
                The world's first Equity Social Network. Cap table management,
                angel investor community, M&A intelligence, and education — for
                the founders and investors building tomorrow's companies.
              </p>
            </div>

            <div>
              <div className="footer-col-title">Platform</div>
              <ul className="footer-links">
                <li>
                  <a href="http://localhost:5000">Home</a>
                </li>
                <li>
                  <a href="http://localhost:5000/#community">Social Network</a>
                </li>
                <li>
                  <a href="http://localhost:5000/#for-founders">For Founders</a>
                </li>
                <li>
                  <a href="http://localhost:5000/#for-investors">For Investors & Shareholders</a>
                </li>
                <li>
                  <a href="http://localhost:5000/#pricing">Pricing</a>
                </li>
              </ul>
            </div>

            <div>
              <div className="footer-col-title">Network</div>
              <ul className="footer-links">
                <li>
                  <a href="http://localhost:5000/#angel-network">Angel Network</a>
                </li>
                <li>
                  <a href="http://localhost:5000/#angel-network">Entrepreneur Academy</a>
                </li>
                <li>
                  <a href="http://localhost:5000/#ma&jv">M&amp;A Intelligence</a>
                </li>
                <li>
                  <a href="http://localhost:5000/education">Knowledge Hub</a>
                </li>

              </ul>
            </div>

            <div>
              <div className="footer-col-title">Company</div>
              <ul className="footer-links">
                <li className="footer-dropdown">
                  <a
                    href="#"
                    className="footer-dropdown-toggle"
                    onClick={(e) => {
                      e.preventDefault();
                      const dropdown = e.currentTarget.closest('.footer-dropdown');
                      dropdown.classList.toggle('active');

                      // Close other footer dropdowns if any
                      document.querySelectorAll('.footer-dropdown.active').forEach(d => {
                        if (d !== dropdown) d.classList.remove('active');
                      });
                    }}
                  >
                    Login
                  </a>
                  <ul className="footer-dropdown-menu">
                    <li>
                      <a
                        href="http://localhost:5000/investor/login"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Investors & Shareholders
                      </a>
                    </li>
                    <li>
                      <a
                        href="http://localhost:5000/user/login"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Companies
                      </a>
                    </li>
                  </ul>
                </li>
                <li>
                  <a
                    href="http://localhost:5000/user/register"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Register Your Company
                  </a>
                </li>
                <li>
                  <a href="javascript:void(0)" onClick={(e) => {
                    e.preventDefault();
                    setShowContactPopup(true);
                  }}>Contact Us</a>
                </li>
                <li>
                  <a href="/privacy-policy">LEGAL & Terms of Use</a>
                </li>
              </ul>
            </div>
          </div>

          <div className="footer-bottom">
            <div className="footer-copyright">
              &copy; {new Date().getFullYear()} Capavate · Blueprint Catalyst
              Ltd. All rights reserved. This platform is intended for accredited
              investors only.
            </div>
          </div>
        </div>
      </footer>

      <ContactUsPopup
        PopupShow={showContactPopup}
        setPopupShow={setShowContactPopup}
      />
    </>
  );
}
