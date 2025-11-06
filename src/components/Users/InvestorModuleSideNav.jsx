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
import { Globe, Menu } from "lucide-react";
import axios from "axios";

const menuItems = [
  {
    label: "Dataroom Management & Diligence",
    href: "/dataroom-Duediligence",
  },
  {
    label: "Investor Reporting",
    href: "/investorlist",
    matchPaths: ["/investorlist", "/add-new-investor"],
  },
  {
    label: "Investor Documents & SHARING",
    dropdown: [
      {
        label: "Latest Version",
        href: "/investordocsharing",
      },
      {
        label: "Previous Version",
        href: "/investordocsharing/previous",
      },
      {
        label: "Sharing with Investors",
        href: "/investordocs/view",
      },
    ],
  },
  {
    label: "International Entrepreneur Academy Program",
    dynamicDropdownKey: "modules",
  },
  {
    label: "Investor Presentation Structure - Expert Advice Video",
    href: "/advicevideos",
  },
  {
    label: "Settings",
    dropdown: [
      {
        label: "Profile Settings",
        href: "/settings/profile",
      },
      {
        label: "Subscriptions",
        href: "/subscription",
      },
    ],
  },
];

export default function InvestorModuleSideNav({ isOpen }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userdataa, setuserdataa] = useState("");
  const navigate = useNavigate();
  const [openDropdown, setOpenDropdown] = useState(null);
  const [getdatamodule, setgetdatamodule] = useState([]);
  const apiURL = "http://localhost:5000/api/user/";

  useEffect(() => {
    // Check if the username key exists in session storage
    const storedUsername = localStorage.getItem("CompanyLoginData");
    const userLogin = JSON.parse(storedUsername);
    setuserdataa(userLogin);

    if (userLogin === null) {
      localStorage.removeItem("CompanyLoginData");
      navigate("/user/login");
    }
  }, []);

  useEffect(() => {
    getModules();
    // Check if there's a previously selected dropdown in storage
    const selectedDropdown = localStorage.getItem("selectedDropdown");
    if (selectedDropdown) {
      setOpenDropdown(Number(selectedDropdown)); // Use Number to parse as integer
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
    setOpenDropdown(newIndex);

    // Store the selected dropdown in localStorage to keep it after page refresh
    localStorage.setItem("selectedDropdown", newIndex !== null ? newIndex : "");
  };
  const location = useLocation();

  return (
    <>
      <MenuButtonWrapper>
        <button type="button" onClick={() => setMenuOpen(!menuOpen)}>
          <Menu strokeWidth={2} />
        </button>
      </MenuButtonWrapper>

      <NavContainer isOpen={isOpen}>
        <NavList>
          {menuItems.map((item, index) => {
            const isActive =
              (item.matchPaths &&
                item.matchPaths.some((path) =>
                  location.pathname.startsWith(path)
                )) ||
              location.pathname === item.href;

            return (
              <NavItem key={index}>
                {item.dropdown || item.dynamicDropdownKey ? (
                  <>
                    <DropdownToggle onClick={() => toggleDropdown(index)}>
                      <div className="d-flex gap-2 align-items-start">
                        <Arrow isOpen={openDropdown === index}>▾</Arrow>
                        {item.label}
                      </div>
                    </DropdownToggle>

                    {openDropdown === index && (
                      <DropdownMenu>
                        {/* Static dropdown items */}
                        {item.dropdown &&
                          item.dropdown.map((sub, subIndex) => {
                            const isSubActive = location.pathname === sub.href;
                            return (
                              <li key={subIndex}>
                                <Link
                                  to={sub.href}
                                  className={`sidebar ${isSubActive ? "active" : ""
                                    }`}
                                >
                                  {sub.label}
                                </Link>
                              </li>
                            );
                          })}

                        {/* Dynamic dropdown items */}
                        {item.dynamicDropdownKey === "modules" &&
                          getdatamodule.map((modItem, modIndex) => {
                            const isDataRoom =
                              modItem.name === "DATAROOM AND DUE DILIGENCE";
                            const path = isDataRoom
                              ? "/dataroom-Duediligence"
                              : `/moduleone/${modItem.id}`;

                            const isModActive = location.pathname === path;

                            return (
                              <li key={modIndex}>
                                <Link
                                  to={path}
                                  className={`sidebar ${isModActive ? "active" : ""
                                    }`}
                                >
                                  {modItem.name}
                                </Link>
                              </li>
                            );
                          })}
                      </DropdownMenu>
                    )}
                  </>
                ) : (
                  <Link
                    to={item.href}
                    className={`sidebar ${isActive ? "active" : ""}`}
                  >
                    {item.label}
                  </Link>
                )}
              </NavItem>
            );
          })}
        </NavList>
      </NavContainer>
    </>
  );
}
