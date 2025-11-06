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
} from "../../components/Styles/MainHeadStyles";
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
  RiPieChartLine,
  RiMoneyDollarCircleLine,
  RiCouponLine,
  RiUserSettingsLine,
  RiSettingsLine,
  RiUserAddLine,
  RiShareForwardLine,
  RiUserVoiceLine,
  RiBarChartBoxLine,
  RiUserLine,
  RiVipCrownLine,
  RiShareLine,
  RiVideoLine,
} from "react-icons/ri";

const menuItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: <RiDashboardLine size={18} />,
  },

  {
    label: "Company Profile",
    href: "/company-profile",
    icon: <RiDashboardLine size={18} />,
  },
  {
    label: "Dataroom Management & Executive Summary",
    href: "/dataroom-Duediligence",
    matchPaths: ["/approvalpage/:code"],
    icon: <RiFolderChartLine size={18} />,
  },
  {
    label: "Investor Reporting",
    href: "/investorlist",
    matchPaths: ["/investorlist", "/add-new-investor"],
    icon: <RiPieChartLine size={18} />,
  },
  {
    label: "Round Management",
    icon: <RiMoneyDollarCircleLine size={18} />,
    dropdown: [
      {
        label: "Capital In Motion:Record a Round",
        href: "/record-round-list",

        icon: <RiMoneyDollarCircleLine size={16} />,
      },
      {
        label: "Sharing with Investors",
        href: "/share-with-investorreport",
        icon: <RiShareForwardLine size={16} />,
      },
    ],
  },
  // {
  //   label: "International Entrepreneur Academy Program",
  //   dynamicDropdownKey: "modules",
  //   icon: <RiGraduationCapLine size={18} />,
  // },
  // ✅ New Investor CRM Section
  {
    label: "Investor Information CRM",
    icon: <RiUserSettingsLine size={18} />,
    dropdown: [
      {
        label: "Investor Entry / Directory",
        href: "/crm/investor-directory",
        matchPaths: ["/crm/investor/investor-info/:id"],
        icon: <RiUserAddLine size={16} />,
      },
      {
        label: "Investment Confirm",
        href: "/crm/investment",
        icon: <RiShareForwardLine size={16} />,
      },
      {
        label: "Investor Reports",
        href: "/crm/investorreport",
        icon: <RiShareForwardLine size={16} />,
      },
      {
        label: "Investor Portal Interaction",
        href: "/crm/investorportal",
        icon: <RiUserVoiceLine size={16} />,
      },
      // {
      //   label: "Dashboard / Analytics",
      //   href: "/crm/investor-report-dashboard-hostory",
      //   icon: <RiBarChartBoxLine size={16} />,
      // },
    ],
  },
  {
    label: "Settings",
    icon: <RiSettingsLine size={18} />,
    dropdown: [
      {
        label: "Activity Logs",
        href: "/activity-logs",
        icon: <RiUserLine size={16} />,
      },
      {
        label: "Subscriptions",
        href: "/subscription",
        icon: <RiVipCrownLine size={16} />,
      },
      {
        label: "Package Subscription",
        href: "/package-subscription",
        icon: <RiVipCrownLine size={16} />,
      },
      {
        label: "Authorized Signature",
        href: "/authorized-signature",
        matchPaths: [
          "/share/referralcode",
          "/share/referralcodetracking/*",
          "/authorized-signature",
        ],
        icon: <RiUserLine size={16} />,
      },
      {
        label: "Discount Coupon",
        href: "/discount-coupon",
        icon: <RiCouponLine size={16} />,
      },
    ],
  },
];
const customActiveMap = [
  { path: "/crm/addnew-investor", menuHref: "/crm/investor-directory" },

  {
    path: "/crm/investor/investor-info/:id",
    menuHref: "/crm/investor-directory",
  },

  {
    path: "/crm/investor-report-detail-record-round/:id",
    menuHref: "/crm/investorreport",
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
    path: "/record-round-cap-table/:id",

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
  useEffect(() => {
    const storedData = localStorage.getItem("SignatoryLoginData");

    if (!storedData) {
      navigate("/signatory/login", { replace: true });
      return;
    }

    try {
      const userLogin = JSON.parse(storedData);

      if (!userLogin || typeof userLogin !== "object") {
        localStorage.removeItem("SignatoryLoginData");
        navigate("/signatory/login", { replace: true });
        return;
      }

      const currentTime = new Date().getTime();

      if (!userLogin.expiry || currentTime > userLogin.expiry) {
        localStorage.removeItem("SignatoryLoginData");
        navigate("/signatory/login", { replace: true });
        return;
      }

      setuserdataa(userLogin);
    } catch (error) {
      console.error("Error parsing user data:", error);
      localStorage.removeItem("SignatoryLoginData");
      navigate("/signatory/login", { replace: true });
    }
  }, [navigate]);
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  // Use internal state if no props are provided
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(false);
  const filteredMenuItems = menuItems.map((item) => {
    if (item.label === "Settings") {
      return {
        ...item,
        dropdown: item.dropdown.filter(
          (subItem) =>
            !(
              subItem.label === "Authorized Signature" &&
              userLogin.role === "owner"
            )
        ),
      };
    }
    return item;
  });
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
    const storedData = localStorage.getItem("SignatoryLoginData");

    if (!storedData) {
      // ❌ No user data → redirect to login immediately
      navigate("/signatory/login");
      return;
    }

    try {
      const userLogin = JSON.parse(storedData);

      // ✅ Check if required properties exist
      if (!userLogin || typeof userLogin !== "object") {
        localStorage.removeItem("SignatoryLoginData");
        navigate("/signatory/login");
        return;
      }

      const currentTime = new Date().getTime();

      // ✅ Check if token exists and is still valid
      if (!userLogin.expiry || currentTime > userLogin.expiry) {
        // ❌ Token missing or expired → remove storage & redirect
        localStorage.removeItem("SignatoryLoginData");
        navigate("/signatory/login");
        return;
      }

      // ✅ Token is valid → set user data
      setuserdataa(userLogin);
    } catch (error) {
      // ❌ JSON parsing error → clear storage and redirect
      console.error("Error parsing user data:", error);
      localStorage.removeItem("SignatoryLoginData");
      navigate("/signatory/login");
    }
  }, [navigate]);

  useEffect(() => {
    //checkSignatoryLogin();
  }, []);

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
  const locationPath = location.pathname;

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
            {filteredMenuItems.map((item, index) => {
              // Determine if parent dropdown should be open
              const isDropdownOpen =
                openDropdown === index ||
                (item.dropdown &&
                  item.dropdown.some((sub) => {
                    const mappedPath = getMappedMenuHref(locationPath);
                    return (
                      mappedPath === sub.href ||
                      matchPath({ path: sub.href, end: false }, locationPath)
                    );
                  })) ||
                (item.dynamicDropdownKey === "modules" &&
                  getdatamodule?.some((modItem) => {
                    const path =
                      modItem.name === "DATAROOM AND DUE DILIGENCE"
                        ? "/dataroom-Duediligence"
                        : `/moduleone/${modItem.id}`;
                    return locationPath === path;
                  }));

              // Determine if item itself is active
              const isActive =
                (item.matchPaths?.some((path) =>
                  matchPath({ path, end: false }, locationPath)
                ) ??
                  false) ||
                locationPath === item.href ||
                (item.dropdown &&
                  item.dropdown.some((sub) => {
                    const activePath = getMappedMenuHref(locationPath);
                    return (
                      activePath === sub.href ||
                      matchPath({ path: sub.href, end: false }, locationPath)
                    );
                  })) ||
                (item.dynamicDropdownKey === "modules" &&
                  getdatamodule?.some((modItem) => {
                    const path =
                      modItem.name === "DATAROOM AND DUE DILIGENCE"
                        ? "/dataroom-Duediligence"
                        : `/moduleone/${modItem.id}`;
                    return locationPath === path;
                  }));

              return (
                <NavItem key={index}>
                  {item.dropdown || item.dynamicDropdownKey ? (
                    <>
                      {/* Parent Dropdown Toggle */}
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

                      {/* Dropdown Menu */}
                      {isDropdownOpen && (
                        <DropdownMenu
                          title={item.label}
                          className={isSidebarExpanded ? "" : "p-0"}
                        >
                          <hr className="my-2" />

                          {/* Static dropdown items */}
                          {item.dropdown?.map((sub, subIndex) => {
                            const activePath = getMappedMenuHref(locationPath);
                            const isSubActive =
                              activePath === sub.href ||
                              matchPath(
                                { path: sub.href, end: false },
                                locationPath
                              );

                            return (
                              <li key={subIndex} className="list-none">
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
                          {item.dynamicDropdownKey === "modules" &&
                            getdatamodule?.map((modItem, modIndex) => {
                              const path =
                                modItem.name === "DATAROOM AND DUE DILIGENCE"
                                  ? "/dataroom-Duediligence"
                                  : `/moduleone/${modItem.id}`;
                              const isModActive = locationPath === path;

                              return (
                                <li key={modIndex} className="list-none">
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
