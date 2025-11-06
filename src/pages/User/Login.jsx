import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Slider from "react-slick";
import "bootstrap/dist/css/bootstrap.min.css";
import "react-datepicker/dist/react-datepicker.css";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import { FaCheckCircle, FaTimesCircle } from "react-icons/fa";
import { Eye, EyeOff } from "lucide-react";
import "react-phone-number-input/style.css";
import { IoCloseCircleOutline } from "react-icons/io5";
import {
  Stepblock,
  Titletext,
  Subtext,
  Iconblock,
  Sup,
} from "../../components/Styles/RegisterStyles";
import { Link } from "react-router-dom";

import { User, Lock } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();

  var settings = {
    dots: false,
    infinite: true,
    arrows: false,
    speed: 500,
    slidesToShow: 1,
    slidesToScroll: 1,
    autoplay: true,
    autoplaySpeed: 5000,
    fade: true,
    waitForAnimate: false,
    adaptiveHeight: true,
  };

  const [allcountry, setallcountry] = useState([]);
  const [errr, seterrr] = useState(false);
  document.title = "Login Page";
  const [dangerMessage, setdangerMessage] = useState("");
  const [userdataa, setuserdataa] = useState("");
  const [spinners, setspinners] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resendLink, setresendLink] = useState(false);

  useEffect(() => {
    const storedData = localStorage.getItem("OwnerLoginData");
    if (storedData) {
      const userLogin = JSON.parse(storedData);
      const currentTime = new Date().getTime();

      if (userLogin.expiry && currentTime < userLogin.expiry) {
        setuserdataa(userLogin);
        navigate("/user/dashboard");
      } else {
        localStorage.removeItem("OwnerLoginData");
      }
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setspinners(true);
    let SaveFormData = {
      email: formData.email,
      password: formData.password,
    };
    console.log(SaveFormData);
    try {
      const res = await axios.post(apiURL + "userLogin", SaveFormData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      const checkData = res.data;

      if (checkData.status === "2") {
        setspinners(false);
        setFormErrors((prev) => ({
          ...prev,
          emailMatch: checkData.message,
        }));
        seterrr(true);
        setdangerMessage(checkData.message);
        setTimeout(() => {
          setdangerMessage("");
          setFormErrors((prev) => ({
            ...prev,
            emailMatch: "",
          }));
        }, 2500);
      } else {
        setspinners(false);
        setFormErrors((prev) => ({
          ...prev,
          emailMatch: "",
        }));
        const expiryTime = new Date().getTime() + 60 * 60 * 1000; // 1 hour
        const userData = {
          id: checkData.id,
          email: checkData.email,
          name: checkData.name,
          access_token: checkData.access_token,
          expiry: expiryTime,
        };
        localStorage.setItem("OwnerLoginData", JSON.stringify(userData));
        navigate("/user/dashboard");
      }
    } catch (err) {
      if (err.response && err.response.data && err.response.data.message) {
      } else {
      }
    }
  };
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    role: "",
    email: "",
    confirm_email: "",
    linked_in: "",
    maimai: "",
    wechat: "",
    boss_zhipin: "",
    phone: "",
    area: "",
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
  });
  const [formData_Step2, setFormData_Step2] = useState({
    city_step2: "",
    country: "",
    company_name: "",
    year_registration: "",
    company_website: "",
    employee_number: "",
    company_linkedin: "",
    company_maimai: "",
    company_wechat: "",
    company_zhipin: "",
    company_mail_address: "",
    company_state: "",
    company_city: "",
    company_postal_code: "",
    company_country: "",
  });
  const [formData_Step3, setFormData_Step3] = useState({});
  const [formData_Step4, setFormData_Step4] = useState({});
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    setFormData_Step2((prev) => ({
      ...prev,
      [name]: value,
    }));
    setFormData_Step3((prevData) => ({
      ...prevData,
      [name]: value,
    }));
    // Validate email matching on the fly
    if (name === "email" || name === "confirm_email") {
      if (
        (name === "email" && value !== formData.confirm_email) ||
        (name === "confirm_email" && value !== formData.email)
      ) {
        setFormErrors((prev) => ({
          ...prev,
          emailMatch: "Emails do not match.",
        }));
      } else {
        setFormErrors((prev) => ({ ...prev, emailMatch: "" }));
      }
    }
  };

  var apiURL = "http://localhost:5000/api/user/";

  const countryOptionsFormatted = allcountry.map((country) => ({
    value: country.code,
    label: country.name,
  }));
  const [dangerMessageReset, setdangerMessageReset] = useState("");
  const [resetpassword, setresetpassword] = useState(false);
  const [resetpasswordspinners, setresetpasswordspinners] = useState(false);
  const [resendspinners, setresendspinners] = useState(false);
  const handlemodelresetpassword = () => {
    setresetpassword(true);
  };
  const handleClose = () => {
    setresetpassword(false);
    setresendLink(false);
  };
  const handleResetpassword = async (e) => {
    e.preventDefault();
    setresetpasswordspinners(true);
    let formData = {
      email: e.target.email.value,
    };
    try {
      const res = await axios.post(apiURL + "resetPassword", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      const checkData = res.data;
      setresetpasswordspinners(false);
      if (checkData.status === 1) {
        e.target.reset();
        seterrr(false);
        setresetpasswordspinners(false);
        setdangerMessageReset(checkData.message);
        setTimeout(() => {
          setdangerMessageReset("");
        }, 3000);
      }
      if (checkData.status === 2) {
        seterrr(true);
        setdangerMessageReset(checkData.message);
        setresetpasswordspinners(false);
        setTimeout(() => {
          setdangerMessageReset("");
        }, 3000);
      }
    } catch (err) {
      setresetpasswordspinners(false);
    }
  };
  const handlemodelresendActivation = () => {
    setresendLink(true);
  };
  const handleResendLink = async (e) => {
    e.preventDefault();
    setresendspinners(true);
    let formData = {
      email: e.target.email.value,
    };
    try {
      const res = await axios.post(apiURL + "resendLink", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      const checkData = res.data;

      setresendspinners(false);
      if (checkData.status === 1) {
        e.target.reset();

        seterrr(false);
        setresendspinners(false);
        setdangerMessageReset(checkData.message);
        setTimeout(() => {
          setdangerMessageReset("");
        }, 3000);
      }
      if (checkData.status === 2) {
        console.log(checkData.status);
        seterrr(true);
        setdangerMessageReset(checkData.message);
        setresendspinners(false);
        setTimeout(() => {
          setdangerMessageReset("");
        }, 3000);
      }
    } catch (err) {
      setresendspinners(false);
    }
  };
  return (
    <>
      <div className="login_main_gradient h100vh">
        <div className="row h-100">
          <div className="col-md-6">
            <div className="container-fluid h-100 ">
              <div className="row h-100 justify-content-center align-items-center">
                <div className="col-md-9 mx-auto">
                  <div className="d-flex flex-column gap-5 p-md-5 px-3 py-5 h-100 m-auto justify-content-center ">
                    <div className="d-flex flex-column gap-1">
                      <div className="d-flex justify-content-center align-items-center">
                        <a href="/" className="logo">
                          <img
                            className="w-100 h-100 object-fit-contain"
                            src="/logos/capavate.png"
                            alt="logo"
                          />
                        </a>
                      </div>

                      {dangerMessageReset && (
                        <div
                          className={`flex items-center justify-between gap-3 shadow-lg ${errr ? "error_pop" : "success_pop"
                            }`}
                        >
                          <div className="d-flex align-items-start gap-2">
                            {errr ? (
                              <FaTimesCircle className="text-white text-xl flex-shrink-0 mt-1" />
                            ) : (
                              <FaCheckCircle className="text-white text-xl flex-shrink-0 mt-1" />
                            )}
                            <span className="d-block">
                              {dangerMessageReset}
                            </span>
                          </div>

                          <button
                            type="button"
                            className="close_btnCros"
                            onClick={() => setdangerMessageReset("")}
                          >
                            ×
                          </button>
                        </div>
                      )}
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
                    <form
                      action="javascript:void(0)"
                      method="post"
                      onSubmit={handleSubmit}
                    >
                      <Stepblock id="step1">
                        <div className="d-flex flex-column gap-4">
                          <div className="d-flex flex-column gap-1 justify-content-start align-items-start">
                            <Titletext>Welcome Back </Titletext>
                            <Subtext>Please Enter your login detail</Subtext>
                          </div>
                          <div className="row gy-3">
                            <div className="col-md-12">
                              <div className="d-flex flex-column gap-2">
                                <label style={{ fontSize: "14px" }} htmlFor="">
                                  Email <Sup>*</Sup>
                                </label>
                                <Iconblock>
                                  <User />
                                  <input
                                    value={formData.email}
                                    onChange={handleChange}
                                    type="email"
                                    name="email"
                                    required
                                    placeholder="Enter email"
                                  />
                                </Iconblock>
                              </div>
                            </div>
                            <div className="col-md-12">
                              <div className="d-flex flex-column gap-2">
                                <label htmlFor="password">
                                  Password <Sup>*</Sup>
                                </label>
                                <div className="iconblock position-relative">
                                  <Iconblock>
                                    <Lock className="lock-icon" />
                                    <input
                                      id="password"
                                      className="passworduser"
                                      value={formData.password}
                                      onChange={handleChange}
                                      type={showPassword ? "text" : "password"}
                                      name="password"
                                      required
                                      placeholder="Enter password"
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
                                  {/* Toggle button */}
                                </div>
                              </div>
                            </div>

                            <div className="col-12 mt-0">
                              <div className="d-flex align-items-center w-100 gap-2 justify-content-between mt-4 mb-2 g-3">
                                <div>
                                  <button
                                    type="button"
                                    onClick={handlemodelresendActivation}
                                    className="mainp border-0"
                                  >
                                    Resend Activation Link
                                  </button>
                                </div>
                                <div>
                                  <button
                                    type="button"
                                    onClick={handlemodelresetpassword}
                                    className="mainp border-0"
                                  >
                                    Forgot Password?
                                  </button>
                                </div>
                              </div>

                              <div className="d-flex justify-content-end  position-relative spinner_btn">
                                <button
                                  disabled={spinners}
                                  type="submit"
                                  className="sbtn nextbtn"
                                  data-step="1"
                                >
                                  {!spinners && "Login"}
                                  {spinners && (
                                    <div
                                      className="spinner-border text-white spinneronetimepay mt-1"
                                      role="status"
                                    >
                                      <span className="visually-hidden"></span>
                                    </div>
                                  )}
                                </button>
                              </div>
                              <div className="dont_have mt-4">
                                <p>
                                  Don't have any account?{" "}
                                  <Link to="/user/register">Sign Up</Link>{" "}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Stepblock>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="col-md-6 d-md-block d-none h-100">
            <Slider {...settings}>
              <div className="login_right">
                <img
                  className="inverted w-100 h-100 object-center  object-fit-cover"
                  src={require("../../assets/images/login.jpg")}
                  alt="login_page"
                />
              </div>
              {/* <div className="login_right">
                <img
                  className="inverted w-100 h-100 object-center   object-fit-cover"
                  src={require("../../assets/images/login2.jpg")}
                  alt="login_page"
                />
              </div>
              <div className="login_right">
                <img
                  className="inverted w-100 h-100 object-center   object-fit-cover"
                  src={require("../../assets/images/login3.jpg")}
                  alt="login_page"
                />
              </div> */}
            </Slider>
          </div>
        </div>
      </div>

      {resetpassword && (
        <div
          className="modal  fade show d-block"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          tabIndex="-1"
          role="dialog"
          aria-labelledby="resetPasswordModalLabel"
          aria-hidden="false"
        >
          <div
            className="modal-dialog modal-dialog-centered modal-lg"
            style={{ maxWidth: "500px" }}
          >
            <div className="modal-content rounded-4 shadow-lg p-4 position-relative">
              <div className="d-flex align-items-center gap-3 mb-3 justify-content-between">
                <h5 className="modal-title " id="resetPasswordModalLabel">
                  Reset Your Password
                </h5>
                <button
                  type="button"
                  className="close_btn_global"
                  onClick={handleClose}
                  aria-label="Close"
                >
                  <IoCloseCircleOutline size={24} />
                </button>
              </div>
              {/* {dangerMessageReset && (
                <p className={errr ? " mt-3 error_pop" : "success_pop mt-3"}>
                  {dangerMessageReset}
                </p>
              )} */}
              <form
                method="post"
                action="javascript:void(0)"
                onSubmit={handleResetpassword}
              >
                <div className="mb-3">
                  <label className="pb-1" htmlFor="">
                    Email <Sup style={{ color: "var(--primary)" }}>*</Sup>
                  </label>
                  <Iconblock>
                    <User />

                    <input
                      className="passworduser"
                      type="email"
                      name="email"
                      required
                      placeholder=""
                    />
                  </Iconblock>
                </div>
                <div className="d-flex justify-content-end mt-4 ">
                  <div className="flex-shrink-0 gap-4">
                    <div className="d-flex justify-content-end  position-relative spinner_btn">
                      <button
                        disabled={spinners}
                        type="submit"
                        className="global_btn"
                        data-step="1"
                      >
                        {!resetpasswordspinners && " Reset Password"}
                        {resetpasswordspinners && (
                          <div
                            className="spinner-border text-white spinneronetimepay m-0 mt-1"
                            role="status"
                          >
                            <span className="visually-hidden"></span>
                          </div>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {resendLink && (
        <div
          className="modal  fade show d-block"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          tabIndex="-1"
          role="dialog"
          aria-labelledby="resetPasswordModalLabel"
          aria-hidden="false"
        >
          <div
            className="modal-dialog modal-dialog-centered modal-lg"
            style={{ maxWidth: "500px" }}
          >
            <div className="modal-content rounded-4 shadow-lg p-4 position-relative">
              <div className="d-flex align-items-center gap-3 mb-3 justify-content-between">
                <h5 className="modal-title " id="resetPasswordModalLabel">
                  Resend Activation Link
                </h5>
                <button
                  type="button"
                  className="close_btn_global"
                  onClick={handleClose}
                  aria-label="Close"
                >
                  <IoCloseCircleOutline size={24} />
                </button>
              </div>
              {/* {dangerMessageReset && (
                <p className={errr ? " mt-3 error_pop" : "success_pop mt-3"}>
                  {dangerMessageReset}
                </p>
              )} */}
              <form
                method="post"
                action="javascript:void(0)"
                onSubmit={handleResendLink}
              >
                <div className="mb-3">
                  <label className="pb-1" htmlFor="">
                    Email <Sup style={{ color: "var(--primary)" }}>*</Sup>
                  </label>
                  <Iconblock>
                    <User />

                    <input
                      className="passworduser"
                      type="email"
                      name="email"
                      required
                      placeholder=""
                    />
                  </Iconblock>
                </div>
                <div className="d-flex justify-content-end mt-4 ">
                  <div className="flex-shrink-0 gap-4">
                    <div className="d-flex justify-content-end  position-relative spinner_btn">
                      <button
                        disabled={spinners}
                        type="submit"
                        className="global_btn"
                        data-step="1"
                      >
                        {!resendspinners && " Resend Link"}
                        {resendspinners && (
                          <div
                            className="spinner-border text-white spinneronetimepay m-0 mt-1"
                            role="status"
                          >
                            <span className="visually-hidden"></span>
                          </div>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
