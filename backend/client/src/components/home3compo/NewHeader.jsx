import React, { useState, useEffect } from "react";
import "../../pages/home/newstyle.css";

export default function NewHeader() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const logoPath = "/assets/capavate-logo-dark.png";

  // 2. Scroll event listen karein
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Function to toggle menu
  const toggleMenu = () => setIsOpen(!isOpen);

  return (
    <>
      <nav
        className={`site-nav ${isScrolled ? "site-nav-fixed" : ""}`}
        style={{
          boxShadow: isScrolled ? "rgba(0, 0, 0, 0.35) 0px 4px 24px" : "none",
          transition: "box-shadow 0.3s ease",
        }}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="container">
          <div className="nav-inner">
            <a href="/" className="nav-logo" aria-label="Capavate home">
              <img
                src={logoPath}
                alt="Capavate"
                className="nav-logo-img"
                id="nav-logo-img"
              />
            </a>

            <ul className="nav-links">
              <li>
                <a href="http://localhost:5000/#platform">Home</a>
              </li>
              <li>
                <a href="http://localhost:5000/#for-founders">Founders</a>
              </li>
              <li>
                <a href="http://localhost:5000/#for-investors">
                  Investors & Shareholders
                </a>
              </li>
              <li>
                <a href="http://localhost:5000/education">Knowledge Hub</a>
              </li>
              <li>
                <a href="http://localhost:5000/#angel-network">Angel Network</a>
              </li>
              <li>
                <a href="http://localhost:5000/#pricing">Pricing</a>
              </li>
            </ul>
            <div className="d-flex align-items-center gap-3">
              <div className="nav-actions">
                <div className="custom-dropdown">
                  <button
                    className="custom-dropdown-toggle btn btn-ghost"
                    onClick={(e) => {
                      e.currentTarget.parentElement.classList.toggle("active");
                    }}
                  >
                    Sign In
                  </button>
                  <div className="custom-dropdown-menu">
                    <a
                      href="http://localhost:5000/investor/login"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="custom-dropdown-item"
                    >
                      Investors & Shareholders
                    </a>
                    <a
                      href="http://localhost:5000/user/login"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="custom-dropdown-item"
                    >
                      Companies
                    </a>
                  </div>
                </div>
                <a
                  href="http://localhost:5000/user/register"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                >
                  Join Capavate
                </a>
              </div>

              <button
                className={`hamburger ${isOpen ? "active" : ""}`}
                onClick={toggleMenu}
                aria-label="Open menu"
                id="hamburger"
              >
                <span></span>
                <span></span>
                <span></span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div
        className="mobile-menu"
        style={{
          display: isOpen ? "flex" : "none",
        }}
        id="mobile-menu"
        aria-hidden="true"
      >
        <a href="#platform">Platform</a>
        <a href="#for-founders">For Founders</a>
        <a href="#for-investors">For Investors</a>
        <a href="#angel-network">Angel Network</a>
        <a href="#pricing">Pricing</a>
        <a
          href="http://localhost:5000/user/login"
          target="_blank"
          rel="noopener noreferrer"
        //   style={{ color: "rgba(255,255,255,0.5)" }}
        >
          Sign In →
        </a>
      </div>
    </>
  );
}
