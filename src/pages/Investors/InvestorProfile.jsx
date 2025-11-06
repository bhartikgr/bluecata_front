import React, { useState, useEffect } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import SideBar from "../../components/Investor/Sidebar.jsx";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/MainHeadStyles.js";
import { IoCloseCircleOutline } from "react-icons/io5";
import "react-big-calendar/lib/css/react-big-calendar.css";
import axios from "axios";
import {
  ModalContainer1,
  ModalTitle,
  DropArea,
  ModalBtn,
  ButtonGroup,
} from "../../components/Styles/DataRoomStyle.js";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { useNavigate } from "react-router-dom";
function InvestorProfile() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const storedUsername = localStorage.getItem("InvestorData");
  const userLogin = JSON.parse(storedUsername);
  const [formData, setFormData] = useState({
    phone: "",
  });
  const navigate = useNavigate();
  const [companydata, setcompanydata] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [allcountry, setallcountry] = useState([]);
  const [successmessage, setsuccessmessage] = useState("");
  const [errr, seterrr] = useState(false);
  document.title = "Investor Profile";
  var apiURLUser = "http://localhost:5000/api/user/";
  var apiURL = "http://localhost:5000/api/user/capitalround/";
  useEffect(() => {
    getinvestorprofile();
    getallcountry();
  }, []);
  const getinvestorprofile = async () => {
    let formData = {
      investor_id: userLogin.id,
    };
    try {
      const res = await axios.post(apiURL + "getinvestorprofile", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      if (res.data.results.length === 0) {
        navigate("/investor/dashboard");
      } else {
        const recordData = res.data.results[0];

        setcompanydata(recordData);
      }
    } catch (err) { }
  };
  const getallcountry = async () => {
    try {
      const res = await axios.post(apiURLUser + "getallcountry", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setallcountry(res.data.results);
    } catch (err) { }
  };
  const handleSubmit = async (e) => {
    e.preventDefault();

    const formDataToSend = new FormData();

    formDataToSend.append("user_id", userLogin.id);
    formDataToSend.append("first_name", e.target.first_name.value);
    formDataToSend.append("last_name", e.target.last_name.value);
    formDataToSend.append("phone", e.target.phone.value);
    formDataToSend.append("city", e.target.city.value);
    formDataToSend.append("country", e.target.country.value);

    // Extra fields
    formDataToSend.append("full_address", e.target.full_address.value);
    formDataToSend.append("country_tax", e.target.country_tax.value);
    formDataToSend.append("tax_id", e.target.tax_id.value);
    formDataToSend.append("type_of_investor", e.target.type_of_investor.value);
    formDataToSend.append(
      "accredited_status",
      e.target.accredited_status.value
    );
    formDataToSend.append(
      "industry_expertise",
      e.target.industry_expertise.value
    );
    formDataToSend.append("linkedIn_profile", e.target.linkedIn_profile.value);

    // File field (KYC/AML Document)
    if (e.target.kyc_document.files.length > 0) {
      for (let i = 0; i < e.target.kyc_document.files.length; i++) {
        formDataToSend.append("kyc_document", e.target.kyc_document.files[i]);
      }
    }

    try {
      const res = await axios.post(
        apiURL + "updateInvestorProfile",
        formDataToSend,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );
      setsuccessmessage("Profile updated successfully");
      getinvestorprofile();
      setTimeout(() => {
        setsuccessmessage("");
      }, 3500);
    } catch (err) {
      console.error("Error updating profile:", err);
    }
  };

  const handlePhoneChange = (phone) => {
    setFormData((prev) => ({ ...prev, phone }));
  };
  const countryOptionsFormatted = allcountry.map((country) => ({
    value: country.code,
    label: country.name,
  }));
  const [isOpen, setIsOpen] = useState(false);
  let files = [];

  // Ensure we have an array
  if (companydata.kyc_document) {
    if (Array.isArray(companydata.kyc_document)) {
      try {
        // Try parsing first element if it looks like JSON
        files = JSON.parse(companydata.kyc_document[0]);
      } catch (e) {
        // fallback: it's already an array of strings
        files = companydata.kyc_document;
      }
    } else {
      // single string case
      try {
        files = JSON.parse(companydata.kyc_document);
      } catch (e) {
        files = [companydata.kyc_document];
      }
    }
  }

  const handleOpen = () => setIsOpen(true);
  const handleClose = () => setIsOpen(false);

  const isImage = (file) => {
    return /\.(jpg|jpeg|png|gif)$/i.test(file);
  };
  const baseUrl =
    "http://localhost:5000/api/upload/investor/inv_" + userLogin.id;
  return (
    <Wrapper className="investor-login-wrapper">
      <div className="fullpage d-block">
        <div className="d-flex align-items-start gap-0">
          <SideBar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />

          <div
            className={`global_view ${isCollapsed ? "global_view_col" : ""}`}
          >
            <SectionWrapper className="d-block p-md-4 p-3">
              <div className="container-fluid">
                <div className="profile-card">
                  {successmessage && (
                    <p
                      className={errr ? " mt-3 error_pop" : "success_pop mt-3"}
                    >
                      {successmessage}
                    </p>
                  )}
                  <div className="profile-header ">
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
                            value={companydata.phone}
                            className="phone-input"
                            placeholder="Enter phone number"
                          />
                        </div>

                        <div className="form-group">
                          <label htmlFor="email" className="form-label">
                            City <span className="required">*</span>
                          </label>
                          <input
                            defaultValue={companydata.city}
                            type="text"
                            name="city"
                            className="form-input"
                            placeholder="Enter your city"
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="email" className="form-label">
                            Mailing Address <span className="required">*</span>
                          </label>
                          <textarea
                            required
                            defaultValue={companydata.full_address}
                            type="text"
                            name="full_address"
                            className="form-input"
                            placeholder="Enter your mailing address"
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="last_name" className="form-label">
                            Country <span className="required">*</span>
                          </label>

                          <select
                            required
                            name="country"
                            value={companydata.country}
                            className="form-select"
                            onChange={(e) =>
                              setcompanydata({
                                ...companydata,
                                country: e.target.value,
                              })
                            }
                          >
                            <option value="">Select or type a country</option>
                            {countryOptionsFormatted.map((option) => (
                              <option value={option.value} key={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group">
                          <label htmlFor="email" className="form-label">
                            Country of Tax Residency{" "}
                            <span className="required">*</span>
                          </label>
                          <input
                            required
                            defaultValue={companydata.country_tax}
                            type="text"
                            name="country_tax"
                            className="form-input"
                            placeholder="Enter your country of tax residency"
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="email" className="form-label">
                            Tax ID or National ID
                          </label>
                          <input
                            defaultValue={companydata.tax_id}
                            type="text"
                            name="tax_id"
                            className="form-input"
                            placeholder="Enter Tax ID or National ID"
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="email" className="form-label">
                            LinkedIn or Professional Profile{" "}
                          </label>
                          <input
                            defaultValue={companydata.linkedIn_profile}
                            type="text"
                            name="linkedIn_profile"
                            className="form-input"
                            placeholder="Enter your LinkedIn or professional profile URL"
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="email" className="form-label">
                            Accredited Status{" "}
                          </label>
                          <select
                            value={companydata.accredited_status || ""}
                            className="form-select"
                            name="accredited_status"
                            onChange={(e) =>
                              setcompanydata({
                                ...companydata,
                                accredited_status: e.target.value,
                              })
                            }
                          >
                            <option value="">--Select--</option>
                            <option value="Accredited Investor">
                              Accredited Investor
                            </option>
                            <option value="Non-Accredited">
                              Non-Accredited
                            </option>
                            <option value="Does not apply">
                              Does not apply
                            </option>
                            <option value="Unknow">Unknow</option>
                            <option></option>
                          </select>
                        </div>

                        <div className="form-group">
                          <label htmlFor="email" className="form-label">
                            Industry Expertise{" "}
                          </label>
                          <select
                            name="industry_expertise"
                            value={companydata.industry_expertise || ""}
                            className="form-select"
                            placeholder=""
                            onChange={(e) =>
                              setcompanydata({
                                ...companydata,
                                industry_expertise: e.target.value,
                              })
                            }
                          >
                            <option value="">--Select--</option>
                            <option value="Aerospace & Defense">
                              Aerospace & Defense
                            </option>
                            <option value="Agriculture & Farming">
                              Agriculture & Farming
                            </option>
                            <option value="Artificial Intelligence & Machine Learning">
                              Artificial Intelligence & Machine Learning
                            </option>
                            <option value="Automotive">Automotive</option>
                            <option value="Banking & Financial Services">
                              Banking & Financial Services
                            </option>
                            <option value="Biotechnology">Biotechnology</option>
                            <option value="Chemical Industry">
                              Chemical Industry
                            </option>
                            <option value="Construction & Engineering">
                              Construction & Engineering
                            </option>
                            <option value="Consumer Goods">
                              Consumer Goods
                            </option>
                            <option value="Cybersecurity">Cybersecurity</option>
                            <option value="Data Storage & Management">
                              Data Storage & Management
                            </option>
                            <option value="Education & Training">
                              Education & Training
                            </option>
                            <option value="Electric Vehicles & Sustainable Transportation">
                              Electric Vehicles & Sustainable Transportation
                            </option>
                            <option value="Energy & Utilities">
                              Energy & Utilities
                            </option>
                            <option value="Entertainment & Media">
                              Entertainment & Media
                            </option>
                            <option value="Environmental Services & Sustainability">
                              Environmental Services & Sustainability
                            </option>
                            <option value="Fashion & Apparel">
                              Fashion & Apparel
                            </option>
                            <option value="Fintech & Digital Payments">
                              Fintech & Digital Payments
                            </option>
                            <option value="Food & Beverage">
                              Food & Beverage
                            </option>
                            <option value="Gaming & Esports">
                              Gaming & Esports
                            </option>
                            <option value="Healthcare & Pharmaceuticals">
                              Healthcare & Pharmaceuticals
                            </option>
                            <option value="Heavy Industry">
                              Heavy Industry
                            </option>
                            <option value="Hospitality & Tourism">
                              Hospitality & Tourism
                            </option>
                            <option value="Information Technology (IT)">
                              Information Technology (IT)
                            </option>
                            <option value="Insurance">Insurance</option>
                            <option value="Jewelry & Luxury Goods">
                              Jewelry & Luxury Goods
                            </option>
                            <option value="Legal Services">
                              Legal Services
                            </option>
                            <option value="Logistics & Supply Chain">
                              Logistics & Supply Chain
                            </option>
                            <option value="Manufacturing">Manufacturing</option>
                            <option value="Mining & Metals">
                              Mining & Metals
                            </option>
                            <option value="Nanotechnology">
                              Nanotechnology
                            </option>
                            <option value="Pet Care & Supplies">
                              Pet Care & Supplies
                            </option>
                            <option value="Public Administration & Government Services">
                              Public Administration & Government Services
                            </option>
                            <option value="Quantum Computing">
                              Quantum Computing
                            </option>
                            <option value="Real Estate & Property Management">
                              Real Estate & Property Management
                            </option>
                            <option value="Retail & E-commerce">
                              Retail & E-commerce
                            </option>
                            <option value="Robotics">Robotics</option>
                            <option value="Security & Surveillance">
                              Security & Surveillance
                            </option>
                            <option value="Social Media & Digital Marketing">
                              Social Media & Digital Marketing
                            </option>
                            <option value="Space Exploration & Satellite Technology">
                              Space Exploration & Satellite Technology
                            </option>
                            <option value="Sports & Fitness">
                              Sports & Fitness
                            </option>
                            <option value="Supply Chain & Procurement">
                              Supply Chain & Procurement
                            </option>
                            <option value="Telecommunications">
                              Telecommunications
                            </option>
                            <option value="Traditional Crafts & Artisanal Goods">
                              Traditional Crafts & Artisanal Goods
                            </option>
                            <option value="Transportation & Logistics">
                              Transportation & Logistics
                            </option>
                            <option value="Venture Capital & Private Equity">
                              Venture Capital & Private Equity
                            </option>
                            <option value="Video Game Industry">
                              Video Game Industry
                            </option>
                            <option value="Waste Management">
                              Waste Management
                            </option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label htmlFor="email" className="form-label">
                            Type of Investor <span className="required">*</span>
                          </label>

                          <select
                            name="type_of_investor"
                            required
                            value={companydata.type_of_investor || ""}
                            onChange={(e) =>
                              setcompanydata({
                                ...companydata,
                                type_of_investor: e.target.value,
                              })
                            }
                            className="form-input"
                          >
                            <option value="">Select Investor Type</option>
                            <option value="Founder">Founder</option>
                            <option value="Co-Founder">Co-Founder</option>
                            <option value="Family & Friends">
                              Family & Friends
                            </option>
                            <option value="Advisor">Advisor</option>
                            <option value="Angel Investor">
                              Angel Investor
                            </option>
                            <option value="Incubator/Accelerator">
                              Incubator / Accelerator
                            </option>
                            <option value="Venture Capital">
                              Venture Capital (VC)
                            </option>
                            <option value="Private Equity">
                              Private Equity (PE)
                            </option>
                            <option value="Corporate Investor">
                              Corporate Investor (CVC)
                            </option>
                            <option value="Hedge Fund">Hedge Fund</option>
                            <option value="Bank/Financial Institution">
                              Bank / Financial Institution
                            </option>
                            <option value="Government/Grant">
                              Government / Grant
                            </option>
                            <option value="Employee (ESOP)">
                              Employee (via ESOP)
                            </option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label htmlFor="kyc_document" className="form-label">
                            KYC/AML Documentation (for institutional or
                            cross-border investors)
                          </label>
                          <input
                            type="file"
                            name="kyc_document"
                            className="form-input"
                            accept=".pdf,.jpg,.jpeg,.png"
                            multiple
                          />
                          <small className="form-text text-muted">
                            Upload ID proof, address proof, or institutional
                            documents
                          </small>

                          {/* Conditional view button */}
                          {companydata.kyc_document &&
                            companydata.kyc_document.length > 0 && (
                              <div className="mt-2">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary me-2"
                                  onClick={handleOpen}
                                >
                                  View Document
                                </button>
                              </div>
                            )}
                        </div>

                        {/* LinkedIn Profile */}
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
      {isOpen && (
        <div className="main_popup-overlay">
          <ModalContainer1>
            <div className="d-flex align-items-center gap-3 mb-4 justify-content-between">
              <ModalTitle>View KYC/AML Documentation</ModalTitle>
              <button
                type="button"
                className="close_btn_global"
                aria-label="Close"
                onClick={() => setIsOpen(false)}
              >
                <IoCloseCircleOutline size={24} />
              </button>
            </div>

            {/* Images container */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
                maxHeight: "60vh",
                overflowY: "auto",
              }}
            >
              {files.map((file, index) => {
                const fileUrl = `${baseUrl}/${file}`;
                return isImage(file) ? (
                  <img
                    key={index}
                    src={fileUrl}
                    alt={`Document ${index + 1}`}
                    style={{
                      maxWidth: "200px",
                      maxHeight: "200px",
                      objectFit: "contain",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      padding: "4px",
                      background: "#f9f9f9",
                    }}
                  />
                ) : (
                  <a
                    key={index}
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary"
                    style={{ margin: "5px" }}
                  >
                    Open Document {index + 1}
                  </a>
                );
              })}
            </div>

            <ButtonGroup>
              <ModalBtn
                onClick={() => setIsOpen(false)}
                className="close_btn w-fit"
              >
                Close
              </ModalBtn>
            </ButtonGroup>
          </ModalContainer1>
        </div>
      )}

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
          padding: 10px 16px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          font-size: 0.9rem;
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
          padding: 10px 16px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          font-size: 0.9rem;
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
    </Wrapper>
  );
}

export default InvestorProfile;
