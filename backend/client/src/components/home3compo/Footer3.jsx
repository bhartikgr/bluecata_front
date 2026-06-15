import React, { useEffect, useRef, useState, useCallback } from "react";

const logoPath = "/assets/capavate-logo-dark.png";



export default function Footer3() {
  const [openFooterDropdown, setOpenFooterDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenFooterDropdown(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const handleSmoothScroll = (e, targetId) => {
    e.preventDefault();
    const element = document.querySelector(targetId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };
  return (
    <>
      {/* Wave E Fix E5 — explicit role="contentinfo" landmark for SR users. */}
      <footer className="footer" role="contentinfo">
        <div className="footer__inner">
          <div className="footer__top">
            <div className="footer__brand">
              <a href="#" className="nav__logo">
                <img
                  src={logoPath}
                  alt="Capavate"
                  className="nav__logo-img"
                  style={{ filter: "brightness(0) invert(1)" }}
                />
              </a>
              <p>
                Capavate shows companies who their investors know, shows
                investors what they actually own, and gives ecosystem partners
                visibility into the networks behind their clients.
              </p>
            </div>
            <div>
              <h4 className="footer__col-title">Platform</h4>
              <ul className="footer__links" role="list">
                <li>
                  <a
                    href="#how-it-works"
                    onClick={(e) => handleSmoothScroll(e, "#how-it-works")}
                  >
                    How It Works
                  </a>
                </li>
                <li>
                  <a
                    href="#audiences"
                    onClick={(e) => handleSmoothScroll(e, "#audiences")}
                  >
                    For Companies
                  </a>
                </li>
                <li>
                  <a
                    href="#ecosystem"
                    onClick={(e) => handleSmoothScroll(e, "#ecosystem")}
                  >
                    For Partners
                  </a>
                </li>
                <li>
                  <a
                    href="#platform"
                    onClick={(e) => handleSmoothScroll(e, "#platform")}
                  >
                    Features
                  </a>
                </li>
                <li>
                  <a
                    href="#pricing"
                    onClick={(e) => handleSmoothScroll(e, "#pricing")}
                  >
                    Pricing
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="footer__col-title">Learn</h4>
              <ul className="footer__links" role="list">
                <li>
                  <a href="https://capavate.com/education" target="_blank">
                    Knowledge Hub
                  </a>
                </li>
                <li>
                  <a
                    href="#learn"
                    onClick={(e) => handleSmoothScroll(e, "#learn")}
                  >
                    Entrepreneur Academy
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="footer__col-title">Account</h4>
              <ul className="footer__links" role="list">
                <li>
                  <div className="dropdown dropdown--footer" ref={dropdownRef}>
                    <button
                      className={`dropdown__trigger dropdown__trigger--footer ${openFooterDropdown ? "is-open" : ""}`}
                      onClick={() => setOpenFooterDropdown(!openFooterDropdown)}
                    >
                      Sign In
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M3 5l3 3 3-3" />
                      </svg>
                    </button>
                    {openFooterDropdown && (
                      <div className="dropdown__menu dropdown__menu--footer dropdown__menu--up">
                        <a
                          href="https://capavate.com/auth/login?portal=investor"
                          className="dropdown__item text-black"
                          data-testid="link-footer-investor-login"
                        >
                          <span className="dropdown__icon">📊</span>
                          <div>
                            <strong>Investors &amp; Shareholders</strong>
                          </div>
                        </a>
                        <a
                          href="https://capavate.com/auth/login?portal=founder"
                          className="dropdown__item text-black"
                          data-testid="link-footer-founder-login"
                        >
                          <span className="dropdown__icon">🏢</span>
                          <div>
                            <strong>Companies</strong>
                          </div>
                        </a>
                        <a
                          href="/partner/login"
                          className="dropdown__item text-black"
                          data-testid="link-footer-partner-login"
                        >
                          <span className="dropdown__icon">🤝</span>
                          <div>
                            <strong>Consortium Partners</strong>
                          </div>
                        </a>
                        <a
                          href="/admin/login"
                          className="dropdown__item text-black"
                          data-testid="link-footer-admin-login"
                        >
                          <span className="dropdown__icon">🛡️</span>
                          <div>
                            <strong>Admin</strong>
                          </div>
                        </a>
                      </div>
                    )}
                  </div>
                </li>
                <li>
                  <a href="https://capavate.com/onboarding">Register</a>
                </li>
                <li>
                  <a
                    href="/partner/login"
                    data-testid="link-footer-partner-signin"
                  >
                    Partner Sign In
                  </a>
                </li>
                <li>
                  <a
                    href="/apply/consortium"
                    data-testid="link-footer-partner-apply"
                  >
                    Apply to join (Partners)
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="footer__col-title">Legal</h4>
              <ul className="footer__links" role="list">
                <li>
                  <a href="https://capavate.com/privacy-policy">
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a href="https://capavate.com/privacy-policy">Terms</a>
                </li>
              </ul>
            </div>
          </div>
          <div className="footer__bottom">
            <span>
              © {new Date().getFullYear()} Capavate · Blueprint Catalyst Ltd. All rights reserved.
            </span>
            <span className="footer__disclaimer">
              The Capavate website and all related content, tools, products,
              services, and platforms (the “Capavate Platform”) are provided for
              general informational and educational purposes only.
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
