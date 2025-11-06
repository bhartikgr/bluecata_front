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
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { Eye, EyeOff } from "lucide-react";
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
  Globe,
  User,
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
  const [allcountry, setallcountry] = useState([]);
  const [step1, setstep1] = useState(true);
  const [step2, setstep2] = useState(true);
  const [step3, setstep3] = useState(false);
  const [step4, setstep4] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errr, seterrr] = useState(false);
  const [dangerMessage, setdangerMessage] = useState("");
  const [userdataa, setuserdataa] = useState("");
  const location = useLocation();
  document.title = "Register Page";
  const queryParams = new URLSearchParams(location.search);
  const referralCode = queryParams.get("ref");
  var apiURL = "http://localhost:5000/api/user/";
  useEffect(() => {
    // Check if the username key exists in session storage
    const storedUsername = localStorage.getItem("OwnerLoginData");
    const userLogin = JSON.parse(storedUsername);
    setuserdataa(userLogin);
    if (userLogin !== null) {
      window.location.href = "/dashboard";
    }
  }, [userdataa]);
  useEffect(() => {
    if (referralCode) {
      checkreferralCode();
    }
  }, [referralCode]);
  const companyList = [
    { name: "Company A", color: "#ff040f" },
    { name: "Company B", color: "#008080" },
    { name: "Company C", color: "#00811f" },
  ];

  useEffect(() => {
    const savedColor = localStorage.getItem("primaryColor");
    if (savedColor) {
      document.documentElement.style.setProperty("--primary", savedColor);
      document.documentElement.style.setProperty(
        "--primary-icon",
        `${savedColor}90`
      );
    }
  }, []);

  const checkreferralCode = async () => {
    let formData = {
      referralCode: referralCode,
    };
    try {
      const res = await axios.post(apiURL + "checkreferralCode", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      const checkData = res.data.results;
      if (checkData.length === 0) {
        window.location.href = "/register";
      }
    } catch (err) { }
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.email !== "" && formData.confirm_email !== "") {
      if (formData.email !== formData.confirm_email) {
        setFormErrors((prev) => ({
          ...prev,
          emailMatch: "Emails do not match.",
        }));
        return;
      }
    }
    if (
      !formData.first_name ||
      !formData.password ||
      !formData.email ||
      !formData.confirm_email ||
      !formData.phone
    ) {
      return;
    }
    const password = formData.password;
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;

    if (!passwordRegex.test(password)) {
      setFormErrors((prev) => ({
        ...prev,
        password:
          "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.",
      }));
      return;
    } else {
      setFormErrors((prev) => ({
        ...prev,
        password: "",
      }));
    }
    try {
      const payload = {
        ...formData,
        referralCode: referralCode, // 👈 include the referral code here
      };
      const res = await axios.post(apiURL + "checkUserEmail", payload, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      if (res.data.status === "2") {
        seterrr(true);
      } else {
        seterrr(false);
        setFormData({
          first_name: "",
          last_name: "",
          email: "",
          password: "",
          confirm_email: "",
          phone: "",
        });
      }

      setdangerMessage(res.data.message);
      setTimeout(() => {
        seterrr(false);
        setdangerMessage("");
      }, 5500);
    } catch (err) { }
  };
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm_email: "",
    phone: "",
  });
  useEffect(() => {
    getallcountry();
  }, []);
  const getallcountry = async () => {
    try {
      const res = await axios.post(apiURL + "getallcountry", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setallcountry(res.data.results);
    } catch (err) { }
  };
  const [formErrors, setFormErrors] = useState({
    emailMatch: "",
    password: "",
  });
  const [formData_Step2, setFormData_Step2] = useState({
    city_step2: "",
    company_street_address: "",
    company_industory: "",
    company_name: "",
    year_registration: "",
    company_website: "",
    employee_number: "",
    company_linkedin: "",
    company_state: "",
    company_postal_code: "",
    company_country: "",
  });
  const [formData_Step3, setFormData_Step3] = useState({});
  const handlePhoneChange = (value) => {
    setFormData((prev) => ({
      ...prev,
      phone: value,
    }));
  };
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    // Validate email matching on the fly
    if (name === "email" || name === "confirm_email") {
      if (
        (name === "email" && value !== formData.confirm_email) ||
        (name === "confirm_email" && value !== formData.email)
      ) {
        if (formData.confirm_email !== "" && formData.email !== "") {
          setFormErrors((prev) => ({
            ...prev,
            emailMatch: "Emails do not match.",
          }));
        }
      } else {
        setFormErrors((prev) => ({ ...prev, emailMatch: "" }));
      }
    }
  };

  //Step 2

  //Step 3

  // Remove a signatory

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
                      className={`flex items-center justify-between gap-3 shadow-lg ${errr ? "error_pop" : "success_pop"
                        }`}
                    >
                      <div className="d-flex align-items-center gap-2">
                        {errr ? (
                          <FaTimesCircle className="text-white text-xl" />
                        ) : (
                          <FaCheckCircle className="text-white text-xl" />
                        )}
                        <span className="d-block">{dangerMessage}</span>
                      </div>

                      <button
                        type="button"
                        className="close_btnCros"
                        onClick={() => setdangerMessage("")}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
                <SectionWrapper className="d-flex m-auto  scroll_nonw overflow-auto ">
                  <div className="container-fluid">
                    <div className="row justify-content-center">
                      <div className="col-12 m-0 p-0">
                        <form
                          action="javascript:void(0)"
                          method="post"
                          onSubmit={handleSubmit}
                        >
                          <Stepblock id="step2">
                            <div className="d-flex flex-column gap-4">
                              <div className="d-flex flex-column gap-1 justify-content-start align-items-start">
                                <Titletext1>Create Account</Titletext1>
                              </div>
                              <div className="row gy-3">
                                <div className="col-md-6">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      First Name{" "}
                                      <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <Building />
                                      <input
                                        value={formData.first_name}
                                        onChange={handleChange}
                                        type="text"
                                        placeholder=""
                                        name="first_name"
                                        required
                                      />
                                    </Iconblock>
                                  </div>
                                </div>
                                <div className="col-md-6">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      Last Name{" "}
                                      <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <Building />
                                      <input
                                        value={formData.last_name}
                                        onChange={handleChange}
                                        type="text"
                                        placeholder=""
                                        name="last_name"
                                        required
                                      />
                                    </Iconblock>
                                  </div>
                                </div>
                                <div className="col-md-6">
                                  <div className="d-flex flex-column gap-2">
                                    <label className="mainp" htmlFor="">
                                      Email <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <Mail />
                                      <input
                                        value={formData.email}
                                        onChange={handleChange}
                                        type="email"
                                        required
                                        name="email"
                                        placeholder=""
                                      />
                                    </Iconblock>
                                  </div>
                                </div>
                                <div className="col-md-6">
                                  <div className="d-flex flex-column gap-2">
                                    <label className="mainp" htmlFor="">
                                      Confirm Email{" "}
                                      <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <Mail />
                                      <input
                                        value={formData.confirm_email}
                                        onChange={handleChange}
                                        type="email"
                                        required
                                        name="confirm_email"
                                        placeholder=""
                                      />
                                      {formErrors.emailMatch && (
                                        <div
                                          style={{ fontSize: "13px" }}
                                          className="text-danger text-start fw-semibold"
                                        >
                                          {formErrors.emailMatch}
                                        </div>
                                      )}
                                    </Iconblock>
                                  </div>
                                </div>
                                <div className="col-md-6">
                                  <div className="d-flex flex-column gap-2">
                                    <label className="mainp" htmlFor="">
                                      Password{" "}
                                      <Sup className="labelsize">*</Sup>
                                    </label>
                                    <div className="iconblock position-relative">
                                      <Iconblock>
                                        <Lock className="lock-icon" />
                                        <input
                                          value={formData.password}
                                          onChange={handleChange}
                                          type={
                                            showPassword ? "text" : "password"
                                          }
                                          required
                                          name="password"
                                          placeholder=""
                                        />
                                      </Iconblock>
                                      <span
                                        className="eye_icon_btn"
                                        onClick={() =>
                                          setShowPassword(!showPassword)
                                        }
                                      >
                                        {showPassword ? (
                                          <EyeOff size={20} />
                                        ) : (
                                          <Eye size={20} />
                                        )}
                                      </span>
                                    </div>
                                    {formErrors.password && (
                                      <div
                                        style={{ fontSize: "13px" }}
                                        className="text-danger text-start fw-semibold"
                                      >
                                        {formErrors.password}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="col-md-6">
                                  <div className="d-flex flex-column gap-2">
                                    <label className="mainp">
                                      Phone Number{" "}
                                      <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <PhoneInput
                                        required
                                        name="phone"
                                        defaultCountry="CA"
                                        className="phonregister"
                                        value={formData.phone}
                                        onChange={handlePhoneChange}
                                        placeholder="Enter phone number"
                                      />
                                    </Iconblock>
                                  </div>
                                </div>
                                <div className="col-12">
                                  <div className="d-flex justify-content-between mt-2">
                                    <div className="flex-shrink-0"></div>
                                    <div className="d-flex flex-row flex-shrink-0 gap-2">
                                      <button
                                        type="submit"
                                        className="global_btn w-fit"
                                        data-step="2"
                                      >
                                        Submit
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </Stepblock>
                        </form>
                      </div>
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
