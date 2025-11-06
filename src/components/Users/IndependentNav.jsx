import React, { useState, useEffect } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router-dom";

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
import { Globe, Menu } from "lucide-react";
import axios from "axios";

const menuItems = [
  {
    label: "Module",
    href: "",
  },
  {
    label: "Modules",
    dynamicDropdownKey: "modules",
  },
];

export default function IndependentNav({ isOpen }) {
  const location = useLocation();
  const currentPath = location.pathname; // e.g., "/moduleone/9"
  const currentId = currentPath.split("/").pop(); // "9"
  const [menuOpen, setMenuOpen] = useState(false);
  const [userdataa, setuserdataa] = useState("");
  const navigate = useNavigate();
  const [openDropdown, setOpenDropdown] = useState(null);
  const [getdatamodule, setgetdatamodule] = useState([]);
  const apiURL = "http://localhost:5000/api/user/";
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);
  useEffect(() => {
    // Check if the username key exists in session storage
    const storedUsername = localStorage.getItem("CompanyLoginData");
    const userLogin = JSON.parse(storedUsername);
    setuserdataa(userLogin);

    //  if (userLogin === null) {
    //    localStorage.removeItem("CompanyLoginData");
    //    navigate("/home");
    //  }
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
  console.log(currentId);
  return (
    <>
      <MenuButtonWrapper>
        <button type="button" onClick={() => setMenuOpen(!menuOpen)}>
          <Menu strokeWidth={2} />
        </button>
      </MenuButtonWrapper>

      <NavContainer isOpen={isOpen}>
        <NavList>
          {menuItems.map((item, index) => (
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
                      {item.dropdown &&
                        item.dropdown.map((sub, subIndex) => (
                          <li key={subIndex}>
                            <Link href={sub.href}>{sub.label}</Link>
                          </li>
                        ))}

                      {/* Handle dynamic dropdown like "Modules" */}
                      {item.dynamicDropdownKey === "modules" &&
                        getdatamodule.map((modItem, modIndex) => (
                          <li key={modIndex}>
                            <Link
                              className={
                                currentId === String(modItem.id)
                                  ? "leftside active"
                                  : "leftside"
                              }
                              to={`/moduleone/${modItem.id}`}
                            >
                              {modItem.name}
                            </Link>
                          </li>
                        ))}
                    </DropdownMenu>
                  )}
                  {userLogin !== null && (
                    <Link to="/dataroom-Duediligence">
                      DataRoom And Due Diligence
                    </Link>
                  )}
                  {userLogin !== null && (
                    <Link to="/advicevideos">
                      Investor Presentation Structure - Expert Advice Video
                    </Link>
                  )}
                </>
              ) : (
                <Link href={item.href}>{item.label}</Link>
              )}
            </NavItem>
          ))}
        </NavList>
      </NavContainer>
    </>
  );
}
