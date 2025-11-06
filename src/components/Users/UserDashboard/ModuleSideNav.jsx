import React, { useState, useEffect } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import { useNavigate } from "react-router-dom";
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
} from "../../../components/Styles/MainHeadStyles";
import { Link, useLocation } from "react-router-dom";
import { IoIosArrowDown } from "react-icons/io";
import { Globe, Menu } from "lucide-react";
import { ChevronLeft } from "lucide-react";
import axios from "axios";
import { matchPath } from "react-router-dom";

// Import React Icons
import {
  RiDashboardLine,
  RiFolderChartLine,
  RiSettingsLine,
  RiUserLine,
  RiBuilding2Line,
  RiVipCrownLine,
  RiVideoLine,
} from "react-icons/ri";

const menuItems = [
  {
    label: "Dashboard",
    href: "/user/dashboard",
    icon: <RiDashboardLine size={18} />,
  },
  {
    label: "Add New Company",
    href: "/user/addcompany",
    icon: <RiBuilding2Line size={18} />,
  },
  {
    label: "My Companies",
    href: "/user/companylist",
    icon: <RiBuilding2Line size={18} />,
  },

  {
    label: "Manage Signatory",
    icon: <RiUserLine size={18} />,
    dropdown: [
      {
        label: "Add New Signatory",
        href: "/user/add-new-signatory",
        icon: <RiUserLine size={16} />,
      },
      {
        label: "Signatory List",
        href: "/user/signatorylist",
        icon: <RiVipCrownLine size={16} />,
      },
      {
        label: "Approve Signatories",
        href: "/user/approval/signature",
        icon: <RiUserLine size={16} />,
      },
    ],
  },
  // ✅ New Investor CRM Section

  {
    label: "Settings",
    icon: <RiSettingsLine size={18} />,
    dropdown: [
      {
        label: "Profile Settings",
        href: "/user/settings/profile",
        icon: <RiUserLine size={16} />,
      },

      // {
      //   label: "Subscriptions",
      //   href: "/user/subscription-page",
      //   icon: <RiVipCrownLine size={16} />,
      // },
      // {
      //   label: "Package Subscription",
      //   href: "/user/package-subscription",
      //   icon: <RiVipCrownLine size={16} />,
      // },
    ],
  },
];
const customActiveMap = [
  { path: "/crm/addnew-investor", menuHref: "/crm/investor-directory" },
  { path: "/crm/edit-investor/:id", menuHref: "/crm/investor-directory" },
  {
    path: "/crm/investor-report-detail-record-round/:id",
    menuHref: "/crm/investorreport",
  },
  {
    path: "/user/signatory/activity/:id/:signatory_id",
    menuHref: "/user/signatorylist",
  },
  {
    path: "/crm/investor-report-detail/:id",

    menuHref: "/crm/investorreport",
  },
  {
    path: "/crm/investor-report-detail-due-diligence/:id",

    menuHref: "/crm/investorreport",
  },
  {
    path: "/crm/investor-record-round-reports-confirm/:id",

    menuHref: "/crm/investorreport",
  },
  {
    path: "/edit-record-round/:id",

    menuHref: "/record-round-list",
  },
  {
    path: "/createrecord",

    menuHref: "/record-round-list",
  },
  // add more custom routes here
];
const getMappedMenuHref = (pathname) => {
  const matched = customActiveMap.find((route) =>
    matchPath({ path: route.path, end: true }, pathname)
  );
  return matched ? matched.menuHref : pathname;
};
export default function ModuleSideNav({
  isCollapsed: propIsCollapsed,
  setIsCollapsed: propSetIsCollapsed,
}) {
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
  const storedUsername = localStorage.getItem("OwnerLoginData");
  const userLogin = JSON.parse(storedUsername);
  useEffect(() => {
    const storedData = localStorage.getItem("OwnerLoginData");

    if (storedData) {
      const userLogin = JSON.parse(storedData);
      setuserdataa(userLogin);

      const currentTime = new Date().getTime();

      if (userLogin.expiry && currentTime > userLogin.expiry) {
        // ⏰ Token expired → clear and redirect to login
        localStorage.removeItem("OwnerLoginData");
        navigate("/user/login");
      } else {
        // ✅ Token valid → auto logout when it expires
        const timeLeft = userLogin.expiry - currentTime;

        const logoutTimer = setTimeout(() => {
          localStorage.removeItem("OwnerLoginData");
          navigate("/user/login");
        }, timeLeft);

        // Cleanup on component unmount
        return () => clearTimeout(logoutTimer);
      }
    } else {
      // ❌ No login data at all → redirect to login
      navigate("/user/login");
    }
  }, [navigate]);

  useEffect(() => {
    checkUserLogin();
  }, []);
  const checkUserLogin = async () => {
    let formData = {
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(apiURL + "checkUserLogin", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      if (res.data.results.length === 0) {
        localStorage.removeItem("OwnerLoginData");
        navigate("/user/login");
      }
    } catch (err) {
      console.error("Error fetching modules:", err);
    }
  };
  useEffect(() => {
    getModules();
    // Check if there's a previously selected dropdown in storage
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

  const getModules = async () => {
    let formData = {
      id: "",
    };
    try {
      const res = await axios.post(apiURL + "getModules", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setgetdatamodule(res.data.results);
    } catch (err) {
      console.error("Error fetching modules:", err);
    }
  };

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

  const shouldBeActive = location.pathname === "/advicevideos";

  // Determine if sidebar should appear expanded (either not collapsed or hovered while collapsed)
  const isSidebarExpanded = !isCollapsed || isHovered;
  const activePathNew = getMappedMenuHref(location.pathname);
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
              // Determine if parent dropdown should be open
              const isDropdownOpen =
                openDropdown === index ||
                (item.dropdown &&
                  item.dropdown.some((sub) => {
                    const mappedPath = getMappedMenuHref(location.pathname);
                    return (
                      mappedPath === sub.href || mappedPath.startsWith(sub.href)
                    );
                  })) ||
                (item.dynamicDropdownKey === "modules" &&
                  getdatamodule.some((modItem) => {
                    const path =
                      modItem.name === "DATAROOM AND DUE DILIGENCE"
                        ? "/dataroom-Duediligence"
                        : `/moduleone/${modItem.id}`;
                    return location.pathname === path;
                  }));

              const isActive =
                item.matchPaths?.some((path) =>
                  matchPath({ path, end: false }, location.pathname)
                ) ||
                location.pathname === item.href ||
                (item.dropdown &&
                  item.dropdown.some(
                    (sub) =>
                      (customActiveMap[location.pathname] ||
                        location.pathname) === sub.href ||
                      (
                        customActiveMap[location.pathname] || location.pathname
                      ).startsWith(sub.href)
                  )) ||
                (item.dynamicDropdownKey === "modules" &&
                  getdatamodule.some((modItem) => {
                    const path =
                      modItem.name === "DATAROOM AND DUE DILIGENCE"
                        ? "/dataroom-Duediligence"
                        : `/moduleone/${modItem.id}`;
                    return location.pathname === path;
                  }));

              return (
                <NavItem key={index}>
                  {item.dropdown || item.dynamicDropdownKey ? (
                    <>
                      <DropdownToggle
                        title={item.label}
                        onClick={() => toggleDropdown(index)}
                      >
                        <div className="d-flex gap-2 align-items-center justify-content-between w-100">
                          <div className="d-flex gap-2 align-items-start">
                            {item.icon}
                            {isSidebarExpanded && item.label}
                          </div>
                          {isSidebarExpanded && (
                            <Arrow isOpen={isDropdownOpen}>
                              <IoIosArrowDown />
                            </Arrow>
                          )}
                        </div>
                      </DropdownToggle>

                      {isDropdownOpen && (
                        <DropdownMenu
                          title={item.label}
                          className={`${isSidebarExpanded ? "" : "p-0"}`}
                        >
                          {/* Static dropdown items */}
                          <hr className="my-2" />
                          {item.dropdown &&
                            item.dropdown.map((sub, subIndex) => {
                              const activePath =
                                customActiveMap[location.pathname] ||
                                location.pathname;
                              const isSubActive =
                                activePathNew === sub.href ||
                                activePathNew.startsWith(sub.href);

                              return (
                                <li className="list-none" key={subIndex}>
                                  <Link
                                    to={sub.href}
                                    className={`sidebar d-flex align-items-start gap-2 ${isSidebarExpanded ? "" : "w-fit"
                                      } ${isSubActive ? "active" : ""}`}
                                  >
                                    {sub.icon}
                                    {isSidebarExpanded && sub.label}
                                  </Link>
                                </li>
                              );
                            })}

                          {/* Dynamic dropdown items */}
                          {item.dynamicDropdownKey === "modules" && (
                            <>
                              {getdatamodule.map((modItem, modIndex) => {
                                const path =
                                  modItem.name === "DATAROOM AND DUE DILIGENCE"
                                    ? "/dataroom-Duediligence"
                                    : `/moduleone/${modItem.id}`;

                                const isModActive = location.pathname === path;

                                return (
                                  <li className="list-none" key={modIndex}>
                                    <Link
                                      to={path}
                                      title={modItem.name}
                                      className={`sidebar d-flex align-items-start gap-2 ${isSidebarExpanded ? "" : "w-fit"
                                        } ${isModActive ? "active" : ""}`}
                                    >
                                      <RiFolderChartLine size={16} />
                                      {isSidebarExpanded && modItem.name}
                                    </Link>
                                  </li>
                                );
                              })}

                              {/* Static advice videos */}
                              <li className="list-none">
                                <Link
                                  title="VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"
                                  to="/advicevideos"
                                  className={`sidebar d-flex align-items-start gap-2 ${isSidebarExpanded ? "" : "w-fit"
                                    } ${location.pathname === "/advicevideos"
                                      ? "active"
                                      : ""
                                    }`}
                                >
                                  <RiVideoLine size={16} />
                                  {isSidebarExpanded &&
                                    "VIDEO CONTENT: Investor Presentation Structure - Expert Advice Video"}
                                </Link>
                              </li>
                            </>
                          )}
                        </DropdownMenu>
                      )}
                    </>
                  ) : (
                    <Link
                      to={item.href}
                      title={item.label}
                      className={`sidebar d-flex align-items-start gap-2 ${isSidebarExpanded ? "" : "w-fit"
                        } ${isActive ? "active" : ""}`}
                    >
                      {item.icon}
                      {isSidebarExpanded && item.label}
                    </Link>
                  )}
                </NavItem>
              );
            })}
          </NavList>
        </NavContainer>
      </div>

      <style jsx>{`
        .main_sidenav {
          transition: width 0.3s ease;
        }

        .main_sidenav.collapsed {
          width: 71px;
        }

        .main_sidenav.collapsed .logo {
          display: flex;
          justify-content: center;
        }
      `}</style>
    </>
  );
}
