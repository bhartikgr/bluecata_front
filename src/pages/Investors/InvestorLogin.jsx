import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";
import "react-datepicker/dist/react-datepicker.css";
import "react-phone-number-input/style.css";
import {
  Tophead,
  Slan,
  Stepblock,
  Titletext,
  Iconblock,
  Sup,
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/RegisterStyles";
import { Link } from "react-router-dom";
import { Globe, User, Lock, Eye, EyeOff } from "lucide-react";
import "../../components/Styles/InvestorLogin.css"; // We'll create this CSS file

export default function InvestorLogin() {
  const navigate = useNavigate();

  const [allcountry, setallcountry] = useState([]);
  const [errr, seterrr] = useState(false);
  const companyWebsiteRef = useRef(null);
  document.title = "Investor Login Page";
  const [dangerMessage, setdangerMessage] = useState("");
  const [userdataa, setuserdataa] = useState("");
  const [spinners, setspinners] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  var apiURL = "http://localhost:5000/api/user/investorreport/";
  //localStorage.removeItem("InvestorData");
  useEffect(() => {
    const storedData = JSON.parse(localStorage.getItem("InvestorData"));

    if (storedData && storedData.access_token) {
      const now = new Date().getTime();

      if (storedData.expiry && now < storedData.expiry) {
        // Token is still valid → redirect to dashboard
        window.location.href = "/investor/dashboard";
      } else {
        // Token expired → remove stored data
        localStorage.removeItem("InvestorData");
      }
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setspinners(true);

    let SaveFormData = { email: formData.email, password: formData.password };

    try {
      const res = await axios.post(apiURL + "investorlogin", SaveFormData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      const checkData = res.data;

      if (checkData.status === "2") {
        setspinners(false);
        setFormErrors((prev) => ({ ...prev, emailMatch: checkData.message }));
        seterrr(true);
        setdangerMessage(checkData.message);
        setTimeout(() => {
          setdangerMessage("");
          setFormErrors((prev) => ({ ...prev, emailMatch: "" }));
        }, 2500);
        return;
      }

      // ✅ User data + token + expiry timestamp
      const userData = {
        id: checkData.id,
        email: checkData.email,
        first_name: checkData.first_name,
        last_name: checkData.last_name,
        access_token: checkData.access_token,
        expiry: new Date().getTime() + 60 * 60 * 1000, // 1 hour
      };

      localStorage.setItem("InvestorData", JSON.stringify(userData));
      setspinners(false);
      navigate("/investor/dashboard");
    } catch (err) {
      console.error(err);
      setspinners(false);
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
    password: "",
  });

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

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const countryOptionsFormatted = allcountry.map((country) => ({
    value: country.code,
    label: country.name,
  }));

  const [dangerMessageReset, setdangerMessageReset] = useState("");
  const [resetpassword, setresetpassword] = useState(false);

  const handlemodelresetpassword = () => {
    setresetpassword(true);
  };

  const handleClose = () => {
    setresetpassword(false);
  };

  const handleResetpassword = async (e) => {
    e.preventDefault();
    let formData = {
      email: e.target.email.value,
    };
    try {
      const res = await axios.post(apiURL + "resetPasswordinvestor", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      const checkData = res.data;
      if (checkData.status === 1) {
        e.target.reset();
        seterrr(false);
        setdangerMessageReset(
          "Password reset successfully, Please check your email"
        );
      }
      if (checkData.status === 2) {
        seterrr(true);
        setdangerMessageReset("Email not found!");
      }
      setTimeout(() => {
        setdangerMessageReset("");
      }, 2500);
    } catch (err) { }
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  return (
    <>
      <Wrapper className="investor-login-wrapper w-full d-block">
        <div className="fullpage d-block w-full">
          {dangerMessage && (
            <p className={errr ? " mt-3 error_pop" : "success_pop mt-3"}>
              {dangerMessage}
            </p>
          )}

          <SectionWrapper className="d-block login-main-section py-5">
            <div className="container-fluid">
              <div className="row justify-content-center">
                <div className="col-xl-5 col-lg-6 col-md-8">
                  <div className="card login-card shadow-lg border-0 rounded-4">
                    <div className="card-body p-5">
                      <div className="text-center mb-5">
                        <img
                          src="/logos/capavate.png"
                          alt="Capavate Logo"
                          className="login-logo img-fluid mb-4"
                          style={{ maxHeight: "40px" }}
                        />

                        <h2 className="mainh1 mb-2"> Investor Login</h2>
                        <p className="mainp">Access your investor dashboard</p>
                      </div>
                      <form onSubmit={handleSubmit}>
                        <Stepblock id="step1" className="pb-4">
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
                          </div>
                        </Stepblock>
                        {/* <div className="mb-4">
                          <label
                            htmlFor="email"
                            className="form-label fw-semibold"
                          >
                            Email Address <Sup style={{color:"var(--primary)"}}>*</Sup>
                          </label>
                          <div className="input-group">
                            <span className="input-group-text bg-light border-end-0">
                              <User size={18} className="text-muted" />
                            </span>
                            <input
                              id="email"
                              value={formData.email}
                              onChange={handleChange}
                              type="email"
                              name="email"
                              className="form-control border-start-0 ps-2"
                              required
                              placeholder="name@company.com"
                            />
                          </div>
                        </div>

                        <div className="mb-4">
                          <label
                            htmlFor="password"
                            className="form-label fw-semibold"
                          >
                            Password <Sup style={{color:"var(--primary)"}}>*</Sup>
                          </label>
                          <div className="input-group">
                            <span className="input-group-text bg-light border-end-0">
                              <Lock size={18} className="text-muted" />
                            </span>
                            <input
                              id="password"
                              className="form-control border-start-0 border-end-0 ps-2"
                              value={formData.password}
                              onChange={handleChange}
                              type={showPassword ? "text" : "password"}
                              name="password"
                              required
                              placeholder="Enter your password"
                            />
                            <button
                              type="button"
                              className="input-group-text bg-light border-start-0"
                              onClick={togglePasswordVisibility}
                            >
                              {showPassword ? (
                                <EyeOff size={18} className="text-muted" />
                              ) : (
                                <Eye size={18} className="text-muted" />
                              )}
                            </button>
                          </div>
                        </div> */}

                        <div className="d-flex justify-content-between gap-3 align-items-center mb-4">
                          <button
                            type="button"
                            style={{ fontSize: "0.9rem" }}
                            className="btn btn-link p-0 text-decoration-none text-primary fw-medium small"
                            onClick={handlemodelresetpassword}
                          >
                            Forgot Password?
                          </button>

                          <button
                            disabled={spinners}
                            type="submit"
                            className="global_btn w-fit"
                          >
                            {spinners ? (
                              <>
                                <span
                                  className="spinner-border spinner-border-sm me-2 mt-1"
                                  role="status"
                                  aria-hidden="true"
                                ></span>
                                Logging in...
                              </>
                            ) : (
                              "Login"
                            )}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SectionWrapper>
        </div>
      </Wrapper>

      {/* Reset Password Modal */}
      {resetpassword && (
        <div
          className="modal fade show d-block"
          tabIndex="-1"
          role="dialog"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content rounded-4 shadow-lg p-4">
              <div className="modal-header border-0 pb-0">
                <h5 className="modal-title fw-bold">Reset Your Password</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={handleClose}
                  aria-label="Close"
                ></button>
              </div>

              <div className="modal-body pt-0">
                {dangerMessageReset && (
                  <div
                    className={`alert ${errr ? "alert-danger" : "alert-success"
                      } alert-dismissible fade show mb-3`}
                    role="alert"
                  >
                    {dangerMessageReset}
                    <button
                      type="button"
                      className="btn-close"
                      onClick={() => setdangerMessageReset("")}
                      aria-label="Close"
                    ></button>
                  </div>
                )}

                <p className="text-muted mb-4">
                  Enter your email address and we'll send you instructions to
                  reset your password.
                </p>

                <form onSubmit={handleResetpassword}>
                  <div className="mb-4">
                    <label
                      htmlFor="resetEmail"
                      className="form-label fw-semibold"
                    >
                      Email Address{" "}
                      <Sup style={{ color: "var(--primary)" }}>*</Sup>
                    </label>
                    <div className="input-group">
                      <span className="input-group-text bg-light border-end-0">
                        <User size={18} className="text-muted" />
                      </span>
                      <input
                        id="resetEmail"
                        className="form-control border-start-0 ps-2"
                        type="email"
                        name="email"
                        required
                        placeholder="Enter your email"
                      />
                    </div>
                  </div>

                  <div className="d-grid gap-2">
                    <button
                      type="submit"
                      className="btn btn-primary py-2 fw-semibold"
                    >
                      Send Reset Instructions
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary py-2"
                      onClick={handleClose}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
