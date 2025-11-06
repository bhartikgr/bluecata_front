import React from "react";
import { useState } from "react";
// import "bootstrap/dist/css/bootstrap.min.css";
import { Link } from "react-router-dom";
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
} from "../Styles/MainHeadStyles";
import { Globe, Menu } from "lucide-react";

const menuItems = [
  {
    label: "Dashboard Overview",
    href: "/dashboard",
  },
  {
    label: "User Management",
    dropdown: [
      { label: "All Users", href: "/users/all" },
      { label: "Add New User", href: "/users/add" },
    ],
  },
  {
    label: "Reports & Analytics",
    href: "/reports",
  },
  {
    label: "Settings",
    dropdown: [
      {
        label: "Profile Settings",
        href: "/settings/profile",
      },
      {
        label: "System Preferences",
        href: "/settings/system",
      },
    ],
  },
  {
    label: "Notifications",
    href: "/notifications",
  },
  {
    label: "Support & Help",
    href: "/support",
  },
];

export default function ModuleSideNav({ isOpen }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };
  const [openDropdown, setOpenDropdown] = useState(null);

  const toggleDropdown = (index) => {
    setOpenDropdown(openDropdown === index ? null : index);
  };

  return (
    <>
      <MenuButtonWrapper>
        <button type="button" onClick={toggleMenu}>
          <Menu strokeWidth={2} />
        </button>
      </MenuButtonWrapper>

      <NavContainer isOpen={isOpen}>
        <NavList>
          {menuItems.map((item, index) => (
            <NavItem key={index}>
              {item.dropdown ? (
                <>
                  <DropdownToggle onClick={() => toggleDropdown(index)}>
                    <div className="d-flex gap-2 align-items-start">
                      <Arrow isOpen={openDropdown === index}>▾</Arrow>
                      {item.label}
                    </div>
                  </DropdownToggle>
                  {openDropdown === index && (
                    <DropdownMenu>
                      {item.dropdown.map((sub, subIndex) => (
                        <li key={subIndex}>
                          <Link href={sub.href}>{sub.label}</Link>
                        </li>
                      ))}
                    </DropdownMenu>
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
