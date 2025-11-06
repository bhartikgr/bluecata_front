import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Menu } from "lucide-react";

import { Link as ScrollLink } from "react-scroll";

export default function HomeHeader() {
  const [isOpen, setIsOpen] = useState(false);
  const [isSticky, setIsSticky] = useState(false);
  const storedUsername = localStorage.getItem("OwnerLoginData");
  const userLogin = JSON.parse(storedUsername);
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 0) {
        setIsSticky(true);
      } else {
        setIsSticky(false);
      }
    };

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <>
      <header
        className={`headerhome ${isSticky ? "sticky-header" : ""}`}
        style={{
          position: isSticky ? "fixed" : "relative",
        }}
      >
        <div className="container-fluid">
          <nav className="navbar navbar-expand-lg">
            <div className="container-fluid">
              <Link className="navbar-brand" to="/">
                <img src="/logos/logo.png" alt="logo" />
              </Link>

              <button
                className="navbar-toggler"
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                aria-controls="navbarNav"
                aria-expanded={isOpen}
                aria-label="Toggle navigation"
              >
                <Menu />
              </button>
              <div
                className={`navbar-collapse ${isOpen ? "show" : "collapse"}`}
                id="navbarNav"
              >
                <ul className="navbar-nav ms-auto">
                  <li className="nav-item">
                    <Link
                      className="nav-link"
                      to="/capavate/home" // no #
                      smooth={true}
                      offset={-100}
                      duration={500}
                    >
                      Angel Investment Simulator
                    </Link>
                  </li>
                  <li className="nav-item">
                    <Link
                      className="nav-link"
                      to="/capavate/home"
                      smooth={true}
                      offset={-100}
                      duration={500}
                    >
                      Dataroom, Diligence & Reporting
                    </Link>
                  </li>
                  <li className="nav-item">
                    <Link
                      className="nav-link"
                      to="/capavate/home"
                      smooth={true}
                      offset={-100}
                      duration={500}
                    >
                      Exclusive Global Investor Alliance
                    </Link>
                  </li>
                  <li className="nav-item">
                    {userLogin === null && (
                      <Link className="nav-link" to="/user/login">
                        Login
                      </Link>
                    )}
                  </li>
                </ul>
                {/* <div className="topsearchbox ms-lg-5 mt-4 mt-lg-0">
                  <form action="">
                    <input type="text" placeholder="Search" />
                    <button type="submit">
                      <Search />
                    </button>
                  </form>
                </div> */}
              </div>
            </div>
          </nav>
        </div>
      </header>
    </>
  );
}
