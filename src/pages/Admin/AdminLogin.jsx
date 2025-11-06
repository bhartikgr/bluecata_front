import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Stepblock,
  Titletext,
  Subtext,
  Iconblock,
  Sup,
} from "../../components/Styles/RegisterStyles";
import { User, Lock } from "lucide-react";
import { Eye, EyeOff } from "lucide-react";
function AdminLogin() {
  var apiURL = "http://localhost:5000/api/admin/";
  const navigate = useNavigate();
  const [spinners, setspinners] = useState(false);
  const [dangerMessage, setdangerMessage] = useState("");
  const [userdataa, setuserdataa] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dangerMessageReset, setdangerMessageReset] = useState("");
  const [errr, seterrr] = useState(false);
  useEffect(() => {
    const storedUsername = localStorage.getItem("adminLogin");
    const userLogin = JSON.parse(storedUsername);

    if (userLogin !== null) {
      navigate("/admin/dashboard");
    }
  }, [userdataa]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const email = event.target.email.value;
    const password = event.target.password.value;

    // ✅ Simple validation before sending
    if (!email || !password) {
      setdangerMessage("Email and password are required");
      seterrr(true);
      return;
    }

    try {
      const res = await axios.post(
        apiURL,
        { email, password }, // ✅ send JSON body
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (res.data.status === "1") {
        const userResp = res.data.user;
        const expiryTime = new Date().getTime() + 60 * 60 * 1000; // 1 hour

        const userData = {
          ...userResp,
          adminexpiry: expiryTime, // add expiry
        };

        localStorage.setItem("adminLogin", JSON.stringify(userData));
        navigate("/admin/dashboard");
      } else {
        setdangerMessage(res.data.message);
        seterrr(true);
      }
    } catch (err) {
      console.error(err);
      seterrr(true);
      if (err.response && err.response.data && err.response.data.message) {
        setdangerMessage(err.response.data.message);
      } else {
        setdangerMessage("Login failed. Please try again.");
      }
    }
  };

  return (
    <>
      <div className="login_main_gradient h100vh">
        <div className="row h-100">
          <div className="col-12">
            <div className="container-fluid h-100">
              <div className="row h-100 justify-content-center align-items-center">
                <div className="col-md-6 col-lg-5 col-xl-4 mx-auto border border-2 rounded-3">
                  <div className="d-flex flex-column gap-5 p-md-5 px-3 py-5 h-100 m-auto justify-content-center">
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
                            <Titletext
                              className="text-center"
                              style={{ textAlign: "center !important" }}
                            >
                              Admin Portal{" "}
                            </Titletext>
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
                                </div>
                              </div>
                            </div>

                            <div className="col-12 mt-0">
                              <div className="d-flex align-items-center w-100 gap-2 justify-content-end mt-4 mb-2 g-3">
                                {/* <button
                               type="button"
                               onClick={handlemodelresetpassword}
                               className="mainp border-0"
                             >
                               Forgot Password?
                             </button> */}
                              </div>

                              <div className="d-flex justify-content-end position-relative spinner_btn">
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
        </div>
      </div>
    </>
  );
}

export default AdminLogin;
