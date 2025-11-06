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
    label: "Report",
    href: "/investor/documentview",
  },
  {
    label: "Company",
    href: "/investor/allcompany",
  },
  {
    label: "Profile",
    href: "/investor/profile",
  },
];

export default function ModuleSideNav({ isOpen }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userdataa, setuserdataa] = useState("");
  const [openDropdown, setOpenDropdown] = useState(null);
  const [getdatamodule, setgetdatamodule] = useState([]);
  const apiURL = "http://localhost:5000/api/user/";

  useEffect(() => {
    // Check if the username key exists in session storage
    const storedUsername = localStorage.getItem("InvestorData");
    const userLogin = JSON.parse(storedUsername);
    setuserdataa(userLogin);
    if (userLogin === null) {
      localStorage.removeItem("InvestorData");
      window.location.href = "/investor/login";
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

  const shouldBeActive = location.pathname === "/advicevideos";

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
                    <DropdownToggle
                      title={item.label}
                      onClick={() => toggleDropdown(index)}
                    >
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
                                  title={sub.label}
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
                      </DropdownMenu>
                    )}
                  </>
                ) : (
                  <Link
                    to={item.href}
                    title={item.label}
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
