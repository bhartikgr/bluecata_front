import React, { useEffect, useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import { Link } from "react-router-dom";
import {
  Tophead,
  Slan,
  CenterNav,
  MenuButtonWrapper,
  NavItem,
  NavList,
} from "../../components/Styles/MainHeadStyles";
import { useNavigate } from "react-router-dom";
import { Globe, Menu } from "lucide-react";
import axios from "axios";
export default function IndependentHeader() {
  const [userdataa, setuserdataa] = useState("");
  const navigate = useNavigate();
  const [getdatamodule, setgetdatamodule] = useState([]);
  var apiURL = "http://localhost:5000/api/user/";

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
    } catch (err) {}
  };
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };
  return (
    <>
      <Tophead>
        <div className="container-fluid">
          <div className="d-flex gap-4 position-relative">
            <Link href="/" className="logo">
              <img src="/logos/logo.png" alt="logo" />
            </Link>
            <MenuButtonWrapper>
              <button type="button" onClick={toggleMenu}>
                <Menu strokeWidth={2} />
              </button>
            </MenuButtonWrapper>

            <Slan>
              <Globe strokeWidth={1.5} />
              <select name="" id="" className="form-control">
                <option value="">Select Language</option>
                <option value="">Mandarin</option>
                <option value="">English</option>
              </select>
              {userLogin !== null && (
                <Link to="/logout" className="btn bg-dark py-2 hoverbge">
                  Logout
                </Link>
              )}
            </Slan>
          </div>
        </div>
      </Tophead>
    </>
  );
}
