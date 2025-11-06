import React, { useState, useEffect } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import { useNavigate } from "react-router-dom";
import { FiLogOut } from "react-icons/fi";
import { ChevronLeft } from "lucide-react";
import {
  Tophead,
  Slan,
  CenterNav,
  MenuButtonWrapper,
  NavItem,
  NavList,
  NavContainer,
  DropdownToggle,
  DropdownMenu,
  Arrow,
} from "../../components/Styles/MainHeadStyles";
import { Link, useLocation } from "react-router-dom";
import { IoIosArrowDown } from "react-icons/io";
import { Building2, User, Menu } from "lucide-react";
import axios from "axios";
import { matchPath } from "react-router-dom";

// Import React Icons
import {
  RiDashboardLine,
  RiFolderChartLine,
  RiVideoLine,
} from "react-icons/ri";

const menuItems = [
  {
    label: "Dashboard",
    href: "/investor/dashboard",
    icon: <RiDashboardLine size={18} />,
  },
  {
    label: "Company",
    href: "/investor/company-list",
    icon: <Building2 size={18} />,
  },
  {
    label: "Profile",
    href: "/investor/investor-profile",
    icon: <User size={18} />,
  },
];

function SideBar({
  isCollapsed: propIsCollapsed,
  setIsCollapsed: propSetIsCollapsed,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userdataa, setuserdataa] = useState("");
  const navigate = useNavigate();
  const [openDropdown, setOpenDropdown] = useState(null);
  const [getdatamodule, setgetdatamodule] = useState([]);

  // Use internal state if no props are provided
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(false);

  useEffect(() => {
    const checkScreen = () => {
      if (window.innerWidth < 786) {
        setInternalIsCollapsed(true); // ✅ collapse by default
        setIsCollapsed && setIsCollapsed(true); // agar parent se state aa rhi ho
      } else {
        setInternalIsCollapsed(false);
        setIsCollapsed && setIsCollapsed(false);
      }
    };

    checkScreen(); // mount pe run
    window.addEventListener("resize", checkScreen);

    return () => window.removeEventListener("resize", checkScreen);
  }, [internalIsCollapsed]);

  const [isHovered, setIsHovered] = useState(false);
  const apiURL = "http://localhost:5000/api/user/";

  // Determine which state to use (props or internal)
  const isCollapsed =
    propIsCollapsed !== undefined ? propIsCollapsed : internalIsCollapsed;
  const setIsCollapsed = propSetIsCollapsed || setInternalIsCollapsed;

  useEffect(() => {
    const storedData = JSON.parse(localStorage.getItem("InvestorData"));

    if (storedData && storedData.access_token) {
      const now = new Date().getTime();

      if (storedData.expiry && now < storedData.expiry) {
        // Token valid → set user data in state
        setuserdataa(storedData);
      } else {
        // Token expired → remove data and redirect
        localStorage.removeItem("InvestorData");
        navigate("/investor/login");
      }
    } else {
      // No token → redirect to login
      localStorage.removeItem("InvestorData");
      navigate("/investor/login");
    }
  }, []);

  useEffect(() => {
    const selectedDropdown = localStorage.getItem("selectedDropdown");
    if (selectedDropdown) {
      setOpenDropdown(Number(selectedDropdown));
    }

    // Check if sidebar state is saved in localStorage
    const savedSidebarState = localStorage.getItem("sidebarCollapsed");
    if (savedSidebarState !== null) {
      const savedState = JSON.parse(savedSidebarState);
      if (propSetIsCollapsed) {
        propSetIsCollapsed(savedState);
      } else {
        setInternalIsCollapsed(savedState);
      }
    }
  }, []);

  const toggleDropdown = (index) => {
    const newIndex = openDropdown === index ? null : index;
    if (isCollapsed) {
      const newState = !isCollapsed;
      setIsCollapsed(newState);
    }
    setOpenDropdown(newIndex);
    localStorage.setItem("selectedDropdown", newIndex !== null ? newIndex : "");
  };

  const toggleSidebar = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem("sidebarCollapsed", JSON.stringify(newState));
  };

  const location = useLocation();

  const isSidebarExpanded = !isCollapsed || isHovered;

  const handleLogout = () => {
    localStorage.removeItem("InvestorData");
    window.location.href = "/investor/login";
  };
  return (
    <>
      <div
        className={`main_sidenav scroll_nonw d-flex flex-column gap-5  ${isCollapsed ? "collapsed p-3" : "p-4"
          }`}
      // onMouseEnter={handleMouseEnter}
      // onMouseLeave={handleMouseLeave}
      >
        <div
          className={`d-flex align-items-center  gap-3 ${isCollapsed ? "justify-content-center" : "justify-content-between"
            }`}
        >
          {!isCollapsed && (
            <a href="/" className="logo">
              <img
                className="w-100 h-100 object-fit-contain"
                src="/logos/capavate.png"
                alt="logo"
              />
            </a>
          )}

          <MenuButtonWrapper className="d-flex justify-content-end">
            <button type="button" onClick={toggleSidebar}>
              {isCollapsed && <Menu strokeWidth={2} />}
              {!isCollapsed && <ChevronLeft strokeWidth={2} />}
            </button>
          </MenuButtonWrapper>
        </div>
        <NavContainer isOpen={isSidebarExpanded}>
          <NavList>
            {menuItems.map((item, index) => {
              // Determine if menu item is active
              let isActive = false;

              if (item.href === "/investor/company-list") {
                // Activate "Company" menu for all subpaths
                isActive =
                  location.pathname === item.href ||
                  location.pathname.startsWith("/investor/company");
              } else {
                // Other menus: exact match or matchPaths
                isActive =
                  item.matchPaths?.some((path) =>
                    matchPath({ path, end: false }, location.pathname)
                  ) || location.pathname === item.href;
              }

              return (
                <NavItem key={index}>
                  {item.dropdown || item.dynamicDropdownKey ? (
                    <>
                      {/* Dropdown Toggle */}
                      <DropdownToggle
                        title={item.label}
                        onClick={() => toggleDropdown(index)}
                        className={
                          isCollapsed && !isHovered
                            ? "justify-content-center px-0"
                            : ""
                        }
                      >
                        <div
                          className={`d-flex gap-2 align-items-center w-100 ${isCollapsed
                            ? "justify-content-center"
                            : "justify-content-between"
                            }`}
                        >
                          <div
                            className={`d-flex gap-2 align-items-start ${isCollapsed && !isHovered
                              ? "justify-content-center"
                              : ""
                              }`}
                          >
                            {item.icon}
                            {isSidebarExpanded && item.label}
                          </div>
                          {isSidebarExpanded && (
                            <Arrow isOpen={openDropdown === index}>
                              <IoIosArrowDown />
                            </Arrow>
                          )}
                        </div>
                      </DropdownToggle>

                      {openDropdown === index && isSidebarExpanded && (
                        <DropdownMenu>
                          <hr className="my-2" />

                          {/* Static dropdown items */}
                          {item.dropdown?.map((sub, subIndex) => {
                            const isSubActive = location.pathname === sub.href;
                            return (
                              <li className="list-none" key={subIndex}>
                                <a
                                  href={sub.href} // 🔹 Use <a> to force reload
                                  title={sub.label}
                                  className={`sidebar d-flex align-items-start gap-2 ${isSubActive ? "active" : ""
                                    }`}
                                >
                                  {sub.icon}
                                  {sub.label}
                                </a>
                              </li>
                            );
                          })}

                          {/* Dynamic dropdown items */}
                          {item.dynamicDropdownKey === "modules" && (
                            <>
                              {getdatamodule.map((modItem, modIndex) => {
                                const isDataRoom =
                                  modItem.name === "DATAROOM AND DUE DILIGENCE";
                                const path = isDataRoom
                                  ? "/dataroom-Duediligence"
                                  : `/moduleone/${modItem.id}`;
                                const isModActive = location.pathname === path;

                                return (
                                  <li className="list-none" key={modIndex}>
                                    <a
                                      href={path} // 🔹 <a> reload
                                      title={modItem.name}
                                      className={`sidebar d-flex align-items-start gap-2 ${isModActive ? "active" : ""
                                        }`}
                                    >
                                      <RiFolderChartLine size={16} />
                                      {modItem.name}
                                    </a>
                                  </li>
                                );
                              })}

                              <li className="list-none">
                                <a
                                  href="/advicevideos" // 🔹 reload
                                  title="VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"
                                  className={`sidebar d-flex align-items-start gap-2 ${location.pathname === "/advicevideos"
                                    ? "active"
                                    : ""
                                    }`}
                                >
                                  <RiVideoLine size={16} />
                                  VIDEO CONTENT: Investor Presentation Structure
                                  - Expert Advice Video
                                </a>
                              </li>
                            </>
                          )}
                        </DropdownMenu>
                      )}
                    </>
                  ) : (
                    // 🔹 Normal menu item with reload
                    <a
                      href={item.href}
                      title={item.label}
                      className={`sidebar d-flex align-items-start gap-2 ${isActive ? "active" : ""
                        } ${isCollapsed && !isHovered
                          ? "justify-content-center"
                          : ""
                        }`}
                    >
                      {item.icon}
                      {isSidebarExpanded && item.label}
                    </a>
                  )}
                </NavItem>
              );
            })}
          </NavList>
        </NavContainer>
        <div
          className={`d-flex  align-items-end gap-2 h-100 ${isCollapsed ? "justify-content-center" : "justify-content-end"
            }`}
        >
          <Link
            title="Logout"
            to="javascript:void(0)"
            onClick={handleLogout}
            className="logout_investor_global "
          >
            <FiLogOut width={14} />
          </Link>
        </div>
      </div>

      <style jsx>{`
        .main_sidenav {
          transition: width 0.3s ease;
        }

        .main_sidenav.collapsed {
          width: 80px;
        }

        .main_sidenav.collapsed .logo {
          display: flex;
          justify-content: center;
        }
      `}</style>
    </>
  );
}

export default SideBar;
