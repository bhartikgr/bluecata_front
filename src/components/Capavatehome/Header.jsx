import React, { useEffect, useState } from "react";
import { BsArrowRight } from "react-icons/bs";
import { IoMdMenu } from "react-icons/io";
export default function Header() {
  const [sticky, setSticky] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) {
        // scroll ke 50px ke baad sticky
        setSticky(true);
      } else {
        setSticky(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div id="header" className={sticky ? "sticky cheader" : "cheader"}>
      <div className="main-nav d-block">
        <nav className="navbar navbar-expand-lg navbar-light">
          <div className="container-lg">
            <a className="navbar-brand fulw" href="index.html">
              <img src="/assets/images/logo.png" alt="logo" />
            </a>
            <button
              className="navbar-toggler rounded-0"
              type="button"
              data-bs-toggle="collapse"
              data-bs-target="#navbarSupportedContent"
              aria-controls="navbarSupportedContent"
              aria-expanded="false"
              aria-label="Toggle navigation"
            >
              <IoMdMenu />
            </button>
            <div
              className="collapse navbar-collapse"
              id="navbarSupportedContent"
            >
              <ul className="navbar-nav mx-auto mb-2 mb-lg-0">
                <li className="nav-item active">
                  <a className="nav-link" aria-current="page" href="#">
                    Home
                  </a>
                </li>
                <li className="nav-item">
                  <a className="nav-link" href="#">
                    About us
                  </a>
                </li>
                <li className="nav-item">
                  <a className="nav-link" href="#">
                    Services
                  </a>
                </li>
                <li className="nav-item">
                  <a className="nav-link" href="#">
                    How it work
                  </a>
                </li>
                <li className="nav-item">
                  <a className="nav-link" href="#">
                    Conatct
                  </a>
                </li>
              </ul>
              <div className="d-flex gap-3 align-items-center top-btns">
                <a href="/user/register" className="tlink">
                  Sign In
                </a>
                <a href="/user/register" className="tbtn">
                  <span>Get Started</span>
                  <BsArrowRight />
                </a>
              </div>
            </div>
          </div>
        </nav>
      </div>
    </div>
  );
}
