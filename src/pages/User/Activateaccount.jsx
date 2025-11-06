import React, { useState, useRef, useEffect } from "react";
import DatePicker from "react-datepicker";
import { Navigate, useNavigate } from "react-router-dom";
import axios from "axios";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import { FaCheckCircle, FaTimesCircle } from "react-icons/fa";
import { Link } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "react-datepicker/dist/react-datepicker.css";
import { useLocation } from "react-router-dom";
import "react-tooltip/dist/react-tooltip.css";
import {
  Stepblock,
  Titletext1,
  Subtext,
  Iconblock,
  Sup,
  SectionWrapper,
} from "../../components/Styles/RegisterStyles";

import {
  Lock,
  Mail,
  Linkedin,
  MapPin,
  Building,
  Building2,
  Clipboard,
  Users,
  OctagonAlert,
} from "lucide-react";

export default function Register() {
  const navigate = useNavigate();
  const [errr, seterrr] = useState(false);
  const [dangerMessage, setdangerMessage] = useState("");
  const [userdataa, setuserdataa] = useState("");
  const location = useLocation();
  document.title = "Activate Account ";
  const queryParams = new URLSearchParams(location.search);
  const code = queryParams.get("code");
  const email = queryParams.get("email");
  var apiURL = "http://localhost:5000/api/user/";
  useEffect(() => {
    // Check if the username key exists in session storage
    const storedUsername = localStorage.getItem("CompanyLoginData");
    const userLogin = JSON.parse(storedUsername);
    setuserdataa(userLogin);
    if (userLogin !== null) {
      window.location.href = "/dashboard";
    }
  }, [userdataa]);
  useEffect(() => {
    if (code && email) {
      activateaccountcheck();
    }
  }, []);

  const activateaccountcheck = async () => {
    let formData = { code, email };
    try {
      const res = await axios.post(apiURL + "activateaccountcheck", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      const respData = res.data;
      if (res.data.status === "1") {
        seterrr(false);
        setdangerMessage(respData.message);
        setTimeout(() => {
          navigate("/user/login");
        }, 5500);
      } else {
        seterrr(true);
        setdangerMessage(
          respData.message + " Activation failed. Please contact support."
        );
      }
    } catch (err) { }
  };

  return (
    <>
      <div className="login_main_gradient">
        <div className="row h-100">
          <div className="col-md-7 mx-auto h-100 ">
            <div className="container-fluid h-100">
              <div className="d-flex flex-column gap-5 p-md-5 px-3 py-5 h-100">
                <div className="d-flex flex-column gap-1">
                  <div className="d-flex flex-column  align-items-center gap-4 justify-content-center">
                    <Link to="/" className="logo">
                      <img
                        className="w-100 h-100 object-fit-contain"
                        src="/logos/capavate.png"
                        alt="logo"
                      />
                    </Link>
                    <p className="mainp">
                      Already have an account?
                      <Link
                        style={{ color: "var(--primary)" }}
                        to="/user/login"
                      >
                        {" "}
                        Sign In
                      </Link>
                    </p>
                  </div>
                  {dangerMessage && (
                    <div
                      className={`flex items-center justify-between gap-3 shadow-lg ${errr
                        ? "error_pop_activateaccount"
                        : "success_pop_activateaccount"
                        }`}
                    >
                      <div className="d-flex align-items-center gap-2">
                        <span className="d-block">{dangerMessage}</span>
                      </div>
                    </div>
                  )}
                </div>
                <SectionWrapper className="d-flex m-auto  scroll_nonw overflow-auto ">
                  <div className="container-fluid">
                    <div className="row justify-content-center">
                      <div className="col-12 m-0 p-0"></div>
                    </div>
                  </div>
                </SectionWrapper>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
