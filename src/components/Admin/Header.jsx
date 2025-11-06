import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FaHome, FaVideo, FaBuilding } from "react-icons/fa";
import { MdOutlineZoomIn, MdViewModule, MdLogout } from "react-icons/md";

import "bootstrap/dist/css/bootstrap.min.css";
import { useNavigate } from "react-router-dom";
function Header({ isOpen }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [userdataa, setuserdataa] = useState("");
  useEffect(() => {
    // Check if the username key exists in session storage
    const storedUsername = localStorage.getItem("adminLogin");
    const userLogin = JSON.parse(storedUsername);
    setuserdataa(userLogin);
    if (userLogin === null) {
      localStorage.removeItem("adminLogin");

      navigate("/admin/login");
    }
  }, [userdataa]);

  return (
    <>
      <div className="sidebar" data-background-color="dark">
        <div className="sidebar-logo">
          <div className="logo-header" data-background-color="dark">
            <a href="index.html" className="logo">
              <img
                src="/assets/adminnew/img/sauro.jpg"
                alt="navbar brand"
                className="navbar-brand"
                height="50"
              />
            </a>
            <div className="nav-toggle">
              <button className="btn btn-toggle toggle-sidebar">
                <i className="gg-menu-right"></i>
              </button>
              <button className="btn btn-toggle sidenav-toggler">
                <i className="gg-menu-left"></i>
              </button>
            </div>
            <button className="topbar-toggler more">
              <i className="gg-more-vertical-alt"></i>
            </button>
          </div>
        </div>
        <div className="sidebar-wrapper scrollbar scrollbar-inner">
          <div className="sidebar-content">
            <ul className="nav nav-secondary">
              <li
                className={`nav-item ${
                  location.pathname.startsWith("/admin/dashboard")
                    ? "active"
                    : ""
                }`}
              >
                <Link to="/admin/dashboard" className="nav-link gap-4">
                  <FaHome className="svgicon" />

                  <p>Dashboard</p>
                </Link>
              </li>
              <li
                className={`nav-item ${
                  location.pathname.startsWith("/admin/company") ? "active" : ""
                }`}
              >
                <Link to="/admin/company" className="nav-link gap-4">
                  <FaBuilding className="svgicon" />

                  <p>Company</p>
                </Link>
              </li>
              <li
                className={`nav-item ${
                  location.pathname.startsWith("/admin/video/list") ||
                  location.pathname.startsWith("/admin/video/add")
                    ? "active"
                    : ""
                }`}
              >
                <Link to="/admin/video/list" className="nav-link gap-4">
                  <FaVideo className="svgicon" />
                  <p>Video Management</p>
                </Link>
              </li>
              <li
                className={`nav-item ${
                  location.pathname.startsWith("/admin/module/list") ||
                  location.pathname.startsWith("/admin/module/add")
                    ? "active"
                    : ""
                }`}
              >
                <Link to="/admin/module/list" className="nav-link gap-4">
                  <MdViewModule className="svgicon" />
                  <p>Modules</p>
                </Link>
              </li>
              <li
                className={`nav-item ${
                  location.pathname.startsWith("/admin/userzoomdetail") ||
                  location.pathname.startsWith("/admin/userzoometting")
                    ? "active"
                    : ""
                }`}
              >
                <Link to="/admin/userzoomdetail" className="nav-link gap-4">
                  <MdOutlineZoomIn className="svgicon" />

                  <p>Zoom Metting</p>
                </Link>
              </li>
              <li className="nav-item">
                <Link to="/admin/logout" className="nav-link gap-4">
                  <MdLogout className="svgicon" />
                  <p>Logout</p>
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

export default Header;
