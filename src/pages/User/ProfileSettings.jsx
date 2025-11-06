import React, { useState, useEffect } from "react";
import TopBar from "../../components/Users/TopBar";
import ModuleSideNav from "../../components/Users/ModuleSideNav";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/MainHeadStyles.js";
import "react-big-calendar/lib/css/react-big-calendar.css";
import axios from "axios";
import { loadStripe } from "@stripe/stripe-js";
import { useNavigate } from "react-router-dom";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { NumericFormat } from "react-number-format";
const stripePromise = loadStripe(
  "pk_test_51RUJzWAx6rm2q3pys9SgKUPRxNxPZ4P1X6EazNQvnPuHKOOfzGsbylaTLUktId9ANHULkwBk67jnp5aqZ9Dlm6PR00jKdDwvSq"
);

export default function ProfileSettings() {
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);
  const apiURL = "http://localhost:5000/api/user/";
  document.title = "Profile";
  const [errr, seterrr] = useState(false);
  const [dangerMessage, setdangerMessage] = useState("");
  const [companydata, setcompanydata] = useState("");
  const [formData, setFormData] = useState({
    phone: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getcompanydetail();
  }, []);

  const getcompanydetail = async () => {
    let formdata = {
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(apiURL + "getcompanydetail", formdata, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setcompanydata(res.data.results[0]);
      setFormData(res.data.results[0]);
    } catch (err) {
      console.error("Error fetching company details:", err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    let formData = {
      first_name: e.target.first_name.value,
      last_name: e.target.last_name.value,
      phone: e.target.phone.value,
      company_linkedin: e.target.company_linkedin.value,
      company_shares: e.target.company_shares.value,
      id: companydata.id,
    };

    try {
      const respo = await axios.post(`${apiURL}companydataUpdate`, formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setdangerMessage("Profile updated successfully!");
      seterrr(false);
      getcompanydetail();
      setTimeout(() => {
        setdangerMessage("");
      }, 3000);
    } catch (err) {
      setdangerMessage("Error updating profile. Please try again.");
      seterrr(true);
      setTimeout(() => {
        setdangerMessage("");
      }, 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePhoneChange = (phone) => {
    setFormData((prev) => ({ ...prev, phone }));
  };
  const [isCollapsed, setIsCollapsed] = useState(false);
  return (
    <>
      <Wrapper>
        <div className="fullpage d-block">
          <div className="d-flex align-items-start gap-0">
            <ModuleSideNav
              isCollapsed={isCollapsed}
              setIsCollapsed={setIsCollapsed}
            />
            <div
              className={`global_view ${isCollapsed ? "global_view_col" : ""}`}
            >
              <TopBar />
              <SectionWrapper className="d-block p-md-4 p-3">
                <div className="container-fluid">
                  {dangerMessage && (
                    <div
                      className={`${errr ? " mt-3 error_pop" : "success_pop mt-3"
                        }`}
                    >
                      {dangerMessage}
                    </div>
                  )}

                  <div className="profile-card">
                    <div className="profile-header">
                      <div className="profile-icon">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"></path>
                          <path d="M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z"></path>
                        </svg>
                      </div>
                      <div className="profile-title">
                        <h2>Profile Settings</h2>
                        <p>Manage your company profile information</p>
                      </div>
                    </div>

                    <div className="profile-content">
                      <form onSubmit={handleSubmit}>
                        <div className="form-grid">
                          {/* First Name */}
                          <div className="form-group">
                            <label htmlFor="first_name" className="form-label">
                              First Name <span className="required">*</span>
                            </label>
                            <input
                              required
                              defaultValue={companydata.first_name}
                              type="text"
                              name="first_name"
                              id="first_name"
                              className="form-input"
                              placeholder="Enter first name"
                            />
                          </div>

                          {/* Last Name */}
                          <div className="form-group">
                            <label htmlFor="last_name" className="form-label">
                              Last Name <span className="required">*</span>
                            </label>
                            <input
                              required
                              defaultValue={companydata.last_name}
                              type="text"
                              name="last_name"
                              id="last_name"
                              className="form-input"
                              placeholder="Enter last name"
                            />
                          </div>

                          {/* Email */}
                          <div className="form-group">
                            <label htmlFor="email" className="form-label">
                              Email <span className="required">*</span>
                            </label>
                            <input
                              disabled
                              defaultValue={companydata.email}
                              type="email"
                              name="email"
                              id="email"
                              className="form-input"
                              placeholder="Enter your email"
                            />
                            <div className="input-note">
                              Email cannot be changed
                            </div>
                          </div>

                          {/* Phone */}
                          <div className="form-group">
                            <label htmlFor="phone" className="form-label">
                              Phone <span className="required">*</span>
                            </label>
                            <PhoneInput
                              required
                              name="phone"
                              defaultCountry="CA"
                              onChange={handlePhoneChange}
                              value={formData.phone}
                              className="phone-input"
                              placeholder="Enter phone number"
                            />
                          </div>

                          {/* LinkedIn Profile */}
                          <div className="form-group">
                            <label
                              htmlFor="company_linkedin"
                              className="form-label"
                            >
                              LinkedIn Profile{" "}
                              <span className="required">*</span>
                            </label>
                            <div className="input-with-icon">
                              <span className="input-icon">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
                                  <rect
                                    x="2"
                                    y="9"
                                    width="4"
                                    height="12"
                                  ></rect>
                                  <circle cx="4" cy="4" r="2"></circle>
                                </svg>
                              </span>
                              <input
                                defaultValue={companydata.company_linkedin}
                                type="url"
                                name="company_linkedin"
                                id="company_linkedin"
                                className="form-input"
                                placeholder="https://linkedin.com/company/yourcompany"
                              />
                            </div>
                          </div>
                          <div className="form-group">
                            <label
                              htmlFor="company_linkedin"
                              className="form-label"
                            >
                              Company Shares <span className="required">*</span>
                            </label>
                            <div className="input-with-icon">
                              <span className="input-icon">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                >
                                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                                  <polyline points="17 6 23 6 23 12"></polyline>
                                </svg>
                              </span>

                              <NumericFormat
                                thousandSeparator={true}
                                decimalScale={2}
                                fixedDecimalScale={true}
                                className="form-input"
                                allowNegative={false}
                                name="company_shares"
                                placeholder="Enter amount"
                                value={companydata.company_shares}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Save Button */}
                        <div className="form-actions">
                          <button
                            type="submit"
                            className="global_btn w-fit"
                            disabled={isLoading}
                          >
                            {isLoading ? (
                              <>
                                <span className="spinner"></span>
                                Saving...
                              </>
                            ) : (
                              <>
                                <div className="d-flex align-items-center gap-2">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                                    <polyline points="7 3 7 8 15 8"></polyline>
                                  </svg>
                                  <span>Save Changes</span>
                                </div>
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                </div>
              </SectionWrapper>
            </div>
          </div>
        </div>
      </Wrapper>

      <style jsx>{`
        .profile-card {
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          overflow: hidden;
        }

        .profile-header {
          display: flex;
          align-items: center;
          padding: 24px 32px;
          border-bottom: 1px solid #f1f3f4;
          background: #efefef;
        }

        .profile-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          border-radius: 12px;
          background: linear-gradient(
            135deg,
            var(--primary) 0%,
            var(--primary-icon) 100%
          );
          color: white;
          margin-right: 16px;
        }

        .profile-title h2 {
          font-size: 24px;
          font-weight: 600;
          color: #0a0a0a;
          margin: 0 0 4px 0;
        }

        .profile-title p {
          color: #6b7280;
          margin: 0;
          font-size: 14px;
        }

        .profile-content {
          padding: 32px;
        }

        .form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 24px;
          margin-bottom: 32px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
        }

        .form-label {
          font-weight: 500;
          color: #374151;
          margin-bottom: 8px;
          font-size: 14px;
        }

        .required {
          color: #f63b3b;
        }

        .form-input {
          padding: 12px 16px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          font-size: 16px;
          transition: all 0.2s ease;
          background: #fff;
        }

        .form-input:focus {
          outline: none;
          border-color: #f63b3b;
          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);
        }

        .form-input:disabled {
          background-color: #f9fafb;
          color: #6b7280;
          cursor: not-allowed;
        }

        .input-note {
          font-size: 12px;
          color: #6b7280;
          margin-top: 4px;
        }

        .phone-input {
          padding: 12px 16px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          font-size: 16px;
          width: 100%;
        }

        .phone-input:focus {
          outline: none;
          border-color: #f63b3b;
          box-shadow: 0 0 0 3px rgba(246, 59, 59, 0.1);
        }

        .input-with-icon {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 12px;
          color: #6b7280;
          z-index: 1;
        }

        .input-with-icon .form-input {
          padding-left: 40px;
        }

        .form-actions {
          display: flex;
          justify-content: flex-end;
          border-top: 1px solid #f1f3f4;
          padding-top: 24px;
        }

        .btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: linear-gradient(135deg, #f63b3b 0%, #e03535 100%);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 12px 24px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-primary:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(246, 59, 59, 0.25);
        }

        .btn-primary:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s ease-in-out infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .alert {
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 24px;
          font-weight: 500;
        }

        .alert-success {
          background-color: #ecfdf5;
          color: #065f46;
          border: 1px solid #a7f3d0;
        }

        .alert-error {
          background-color: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }

        @media (max-width: 768px) {
          .profile-header {
            padding: 20px;
          }

          .profile-content {
            padding: 20px;
          }

          .form-grid {
            grid-template-columns: 1fr;
            gap: 20px;
          }

          .form-actions {
            justify-content: center;
          }

          .btn-primary {
            width: 100%;
            justify-content: center;
          }
        }
      `}</style>
    </>
  );
}
