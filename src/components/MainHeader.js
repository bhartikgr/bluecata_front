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
} from "../components/Styles/MainHeadStyles.js";

import { Globe, Menu } from "lucide-react";

export default function MainHeader() {
  return (
    <>
      <Tophead>
        <div className="container-fluid">
          <div className="d-flex gap-4">
            <Link href="/" className="logo">
              <img src="/logos/logo.png" alt="logo" />
            </Link>

            <Slan>
              <Globe strokeWidth={1.5} />
              <select name="" id="" className="form-control">
                <option value="">Select Language</option>
                <option value="">Mandarin</option>
                <option value="">English</option>
              </select>
            </Slan>
            <Link to="/logout">Logout</Link>
          </div>
        </div>
      </Tophead>
    </>
  );
}
