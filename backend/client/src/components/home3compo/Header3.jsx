import React, { useEffect } from "react";


const logoPath = "/assets/home/capavate-logo-dark.png";

export default function Header3() {
  useEffect(() => {
    // 1. Dropdown Logic
    const handleDropdown = (e) => {
      const trigger = e.target.closest(".dropdown__trigger");


      if (trigger) {
        e.stopPropagation();
        const dd = trigger.closest(".dropdown");
        const wasOpen = dd.classList.contains("is-open");


        document.querySelectorAll(".dropdown.is-open").forEach((d) => {
          d.classList.remove("is-open");
          d.querySelector(".dropdown__trigger")?.setAttribute(
            "aria-expanded",
            "false",
          );
        });


        if (!wasOpen) {
          dd.classList.add("is-open");
          trigger.setAttribute("aria-expanded", "true");
        }
      } else {

        document.querySelectorAll(".dropdown.is-open").forEach((d) => {
          d.classList.remove("is-open");
          d.querySelector(".dropdown__trigger")?.setAttribute(
            "aria-expanded",
            "false",
          );
        });
      }
    };

    // Wave E Fix E8 — Esc-to-close on Sign-In dropdown + return focus.
    const handleEsc = (e) => {
      if (e.key !== "Escape") return;
      const openDd = document.querySelector(".dropdown.is-open");
      if (openDd) {
        openDd.classList.remove("is-open");
        const trig = openDd.querySelector(".dropdown__trigger");
        trig?.setAttribute("aria-expanded", "false");
        trig?.focus();
      }
    };

    // 2. Nav Scroll Shadow
    const nav = document.getElementById("nav");
    const handleScroll = () => {
      if (nav) {
        nav.classList.toggle("nav--scrolled", window.scrollY > 20);
      }
    };

    // 3. Mobile Menu Logic
    const mobileToggle = document.querySelector(".nav__mobile-toggle");
    const mobileMenu = document.getElementById("mobileMenu");
    const mobileClose = document.querySelector(".nav__mobile-close");

    const openMenu = () => mobileMenu?.classList.add("is-open");
    const closeMenu = () => mobileMenu?.classList.remove("is-open");

    // Events Attach
    document.addEventListener("click", handleDropdown);
    document.addEventListener("keydown", handleEsc);
    window.addEventListener("scroll", handleScroll, { passive: true });
    mobileToggle?.addEventListener("click", openMenu);
    mobileClose?.addEventListener("click", closeMenu);

    // Mobile menu links 
    mobileMenu?.querySelectorAll("a:not(.dropdown__trigger)").forEach((a) => {
      a.addEventListener("click", closeMenu);
    });

    // Cleanup (Important for React)
    return () => {
      document.removeEventListener("click", handleDropdown);
      document.removeEventListener("keydown", handleEsc);
      window.removeEventListener("scroll", handleScroll);
      mobileToggle?.removeEventListener("click", openMenu);
      mobileClose?.removeEventListener("click", closeMenu);
    };
  }, []);

  return (
    <>
      {/* Wave E Fix E6 — Skip to content link (a11y).
          Visible only on keyboard focus; jumps past the nav to <main id="main-content">. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-white focus:text-black focus:px-4 focus:py-2 focus:rounded focus:shadow-lg"
        data-testid="link-skip-to-content"
      >
        Skip to content
      </a>
      {/* Wave E Fix E5 — explicit role="banner" so screen readers identify
          the top navigation as the page banner landmark. */}
      <nav className="nav" id="nav" role="banner" aria-label="Primary">
        <div className="nav__inner">
          <a href="#" className="nav__logo" aria-label="Capavate Home">
            <img
              src={logoPath}
              alt="Capavate"
              className="nav-logo-img"
              id="nav-logo-img"
            />
          </a>

          <ul className="nav__links" role="list">
            <li>
              <a href="#audiences">Who It's For</a>
            </li>
            <li>
              <a href="#multiplier">Multiplier Effect</a>
            </li>
            <li>
              <a href="#platform">Platform</a>
            </li>
            <li>
              <a href="#pricing">Pricing</a>
            </li>
            <li>
              <a
                href="/education"
                target="_blank"
                rel="noreferrer"
              >
                Knowledge Hub
              </a>
            </li>
          </ul>

          <div className="nav__actions">
            {/* Sign In dropdown */}
            <div className="dropdown">
              <button
                className="dropdown__trigger btn btn--ghost btn--sm"
                aria-expanded="false"
                aria-haspopup="menu"
                aria-controls="header-signin-menu"
                type="button"
              >
                Sign In
                <svg
                  width={10}
                  height={10}
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M3 5l3 3 3-3" />
                </svg>
              </button>
              <div className="dropdown__menu" id="header-signin-menu" role="menu">
                <a
                  href="#/auth/login?portal=investor"
                  className="dropdown__item"
                  data-testid="link-header-investor-login"
                >
                  <span className="dropdown__icon">📊</span>
                  <div>
                    <strong>For Investors</strong>
                    <small>View your verified portfolio</small>
                  </div>
                </a>
                <a
                  href="#/auth/signup?portal=founder"
                  className="dropdown__item"
                  data-testid="link-header-founder-signup"
                >
                  <span className="dropdown__icon">🏢</span>
                  <div>
                    <strong>For Founders</strong>
                    <small>Manage your investor network</small>
                  </div>
                </a>
                <a
                  href="#/partner/login"
                  className="dropdown__item"
                  data-testid="link-header-partner-login"
                >
                  <span className="dropdown__icon">🤝</span>
                  <div>
                    <strong>Consortium Partners</strong>
                    <small>Manage your portfolio &amp; pipeline</small>
                  </div>
                </a>
              </div>
            </div>

            <a
              href="#/onboarding"
              className="btn btn--primary btn--sm text-white"
            >
              Register Your Company
            </a>
          </div>

          {/* Mobile toggle */}
          <button
            className="nav__mobile-toggle"
            aria-label="Open menu"
            type="button"
          >
            <svg
              width={24}
              height={24}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        <div className="nav__mobile-menu" id="mobileMenu">
          <button
            className="nav__mobile-close"
            aria-label="Close menu"
            type="button"
          >
            ×
          </button>
          <div className="d-flex flex-column text-center gap-2 ">
            <a href="#audiences">Who It's For</a>
            <a href="#multiplier">Multiplier Effect</a>
            <a href="#platform">Platform</a>
            <a href="#pricing">Pricing</a>
            <a
              href="/education"
              target="_blank"
              rel="noreferrer"
            >
              Knowledge Hub
            </a>
            <hr
              style={{
                width: 60,
                border: "none",
                borderTop: "1px solid var(--color-divider)",
                margin: "var(--space-2) 0",
              }}
            />
            <a href="#/auth/login?portal=investor" data-testid="link-mobile-investor-login">For Investors</a>
            <a href="#/auth/signup?portal=founder" data-testid="link-mobile-founder-signup">For Founders</a>
            <a href="#/partner/login" data-testid="link-mobile-partner-login">Consortium Partner Sign In</a>
            <a href="#/apply/consortium" data-testid="link-mobile-partner-apply">Apply: Consortium Partners</a>
            <a
              href="#/auth/signup?portal=founder"
              className="btn btn--primary text-white"
            >
              Register Your Company
            </a>
          </div>
        </div>
      </nav>
    </>
  );
}
