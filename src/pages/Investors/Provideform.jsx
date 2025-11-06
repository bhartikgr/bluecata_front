import React, { useState, useEffect } from "react";

import { Mails, User, Phone, Globe, Building2 } from "lucide-react";
import "bootstrap/dist/css/bootstrap.min.css";
import "../../components/Styles/InvestorLogin.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/MainHeadStyles.js";
import {
  Stepblock,
  Iconblock,
  Sup,
} from "../../components/Styles/RegisterStyles";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { State, City } from "country-state-city";
import { useParams } from "react-router-dom";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
export default function Provideform() {
  const navigate = useNavigate();
  const storedUsername = localStorage.getItem("InvestorData");
  const userLogin = JSON.parse(storedUsername);
  const [spinners, setspinners] = useState(false);
  var apiURLINFile = "http://localhost:5000/api/user/investorreport/";
  var apiURL = "http://localhost:5000/api/user/";
  document.title = "Investor Page";
  // Component के top में
  const [formErrors, setFormErrors] = useState({});

  const [successresponse, setsuccessresponse] = useState("");
  const [err, seterr] = useState(false);
  const [allcountry, setallcountry] = useState([]);
  const [InvestorData, setInvestorData] = useState("");
  const code = useParams();
  useEffect(() => {
    checkinvestorCode();

    getallcountry();
  }, []);
  const getallcountry = async () => {
    let formData = {};
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
  const checkinvestorCode = async () => {
    let formData = {
      code: code,
    };

    try {
      const res = await axios.post(
        apiURLINFile + "checkinvestorCode",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      if (res.data.results.length === 0) {
        navigate("/investor/login");
      } else {
        if (res.data.results[0].is_register === "Yes") {
          navigate("/investor/login");
        } else {
          setInvestorData(res.data.results[0]);
        }
      }
    } catch (err) { }
  };
  useEffect(() => {
    getInvestorInfocheck();
  }, []);
  const getInvestorInfocheck = async () => {
    const formData = {
      code: code.code,
    };
    try {
      const res = await axios.post(
        apiURLINFile + "getInvestorInfocheck",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      if (res.data.results.length > 0) {
        navigate("/investor/login/");
      }
    } catch (err) {
      console.error("Error generating summary", err);
    }
    //  Optionally, call AI Summary API here
  };
  const countryOptionsFormatted = allcountry.map((country) => ({
    value: country.code,
    label: country.name,
  }));
  const [step2required, setstep2required] = useState(true);
  const [selectedCountryStep2, setselectedCountryStep2] = useState(null);
  const [formData_Step2, setFormData_Step2] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    ciyt: "",
    country: "",
    comments: "",
  });
  const [States, setStates] = useState([]);
  const handleStep2getstate = (event) => {
    const countryCode = event.target.value; // Get the selected country code from the event
    const countryName = event.target.options[event.target.selectedIndex].text;
    if (countryName === "Aruba") {
      setstep2required(false);
    }
    setselectedCountryStep2(countryName);
    setFormData_Step2((prev) => ({
      ...prev,
      company_country: event.target.value, // Store the value (e.g., "US")
    }));
    const indiaStates = State.getStatesOfCountry(countryCode);
    setStates(indiaStates);
  };
  const handlesubmitinfo = async (e) => {
    e.preventDefault();

    // Build FormData object if you have files (KYC documents)
    let kycFiles = e.target.kyc_document ? e.target.kyc_document.files : null;
    const digitsOnly = formData_Step2.phone.replace(/\D/g, "");

    if (digitsOnly.length < 10) {
      setFormErrors((prev) => ({
        ...prev,
        phone: "Phone number must be at least 10 digits",
      }));
      return;
    }
    setspinners(true);
    let formdata = {
      first_name: e.target.first_name.value,
      last_name: e.target.last_name.value,
      email: e.target.email.value,
      phone: formData_Step2.phone,
      country: e.target.country.value,
      city: e.target.city.value,
      comments: "",

      // New fields added
      full_address: e.target.full_address?.value || "",
      country_tax: e.target.country_tax?.value || "",
      tax_id: e.target.tax_id?.value || "",
      linkedIn_profile: e.target.linkedIn_profile?.value || "",
      accredited_status: e.target.accredited_status?.value || "",
      industry_expertise: e.target.industry_expertise?.value || "",
      type_of_investor: e.target.type_of_investor?.value || "",
      id: InvestorData.id,
      // Add KYC files (if multiple)
      kyc_document: kycFiles ? Array.from(kycFiles) : [],

      code: code,
    };

    try {
      const res = await axios.post(
        apiURLINFile + "investorInformation",
        formdata,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );

      setspinners(false);
      setsuccessresponse(res.data.message);

      if (res.data.status === "2") {
        seterr(true);
      } else {
        if (res.data.status === "1") {
          seterr(false);
          let InvestorDataa = {
            code: code.code,
            first_name: e.target.first_name.value,
            last_name: e.target.last_name.value,
            email: e.target.email.value,
            phone: e.target.phone.value,
            country: e.target.country.value,
            city: e.target.city.value,
            comments: "",
            full_address: e.target.full_address?.value || "",
            country_tax: e.target.country_tax?.value || "",
            tax_id: e.target.tax_id?.value || "",
            linkedIn_profile: e.target.linkedIn_profile?.value || "",
            accredited_status: e.target.accredited_status?.value || "",
            industry_expertise: e.target.industry_expertise?.value || "",
            type_of_investor: e.target.type_of_investor?.value || "",
            id: InvestorData.id,
          };

          setTimeout(() => {
            navigate("/investor/login");
          }, 2000);
        }
        setTimeout(() => {
          navigate("/investor/login");
        }, 2000);
      }

      setTimeout(() => {
        setsuccessresponse("");
      }, 2000);
    } catch (err) { }
  };
  const handlePhoneChange = (value) => {
    setFormData_Step2((prev) => ({ ...prev, phone: value }));
  };

  return (
    <>
      <>
        <Wrapper className="investor-login-wrapper">
          <div className="fullpage d-block w-100">
            {/* {dangerMessage && (
              <div
                className={`alert ${
                  errr ? "alert-danger" : "alert-success"
                } alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3 z-3`}
                role="alert"
              >
                {dangerMessage}
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setdangerMessage("")}
                  aria-label="Close"
                ></button>
              </div>
            )} */}
            {successresponse && (
              <p className={err ? " mt-3 error_pop" : "success_pop mt-3"}>
                {successresponse}
              </p>
            )}
            <SectionWrapper className="d-block login-main-section py-5">
              <div className="container-fluid">
                <div className="row justify-content-center">
                  <div className="col-xl-5 col-lg-6 col-md-8">
                    <div className="card login-card shadow-lg border-0 rounded-4">
                      <div className="card-body p-5">
                        <div className="text-start mb-4">
                          <img
                            src="/logos/capavate.png"
                            alt="Capavate Logo"
                            className="login-logo img-fluid mb-4"
                            style={{ maxHeight: "40px" }}
                          />

                          <h2 className="mainh1 mb-2">Provide Information</h2>
                          <p className="mainp">
                            Access your investor dashboard
                          </p>
                        </div>

                        <form
                          action="javascript:void(0)"
                          method="post"
                          onSubmit={handlesubmitinfo}
                        >
                          <Stepblock id="step1">
                            <div className="d-flex flex-column gap-5">
                              <div className="row gy-3">
                                {/* First Name */}
                                <div className="col-md-6">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      First Name{" "}
                                      <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <User />
                                      <input
                                        type="text"
                                        name="first_name"
                                        required
                                        placeholder=""
                                      />
                                    </Iconblock>
                                  </div>
                                </div>

                                {/* Last Name */}
                                <div className="col-md-6">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      Last Name{" "}
                                      <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <User />
                                      <input
                                        type="text"
                                        name="last_name"
                                        required
                                        placeholder=""
                                      />
                                    </Iconblock>
                                  </div>
                                </div>

                                {/* City */}
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      City <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <Building2 />
                                      <input
                                        type="text"
                                        name="city"
                                        required
                                        placeholder=""
                                      />
                                    </Iconblock>
                                  </div>
                                </div>

                                {/* Email */}
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      Email <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <Mails />
                                      <input
                                        value={InvestorData.email}
                                        disabled
                                        type="text"
                                        name="email"
                                        required
                                        placeholder=""
                                      />
                                    </Iconblock>
                                  </div>
                                </div>

                                {/* Phone */}
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      Phone Number{" "}
                                      <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <Phone />

                                      <PhoneInput
                                        required
                                        name="phone"
                                        defaultCountry="CA"
                                        className="phonregister"
                                        onChange={handlePhoneChange}
                                        placeholder="Enter phone number"
                                      />
                                      {formErrors.phone && (
                                        <div
                                          className="text-danger"
                                          style={{ fontSize: "13px" }}
                                        >
                                          {formErrors.phone}
                                        </div>
                                      )}
                                    </Iconblock>
                                  </div>
                                </div>

                                {/* Mailing Address */}
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      Mailing Address{" "}
                                      <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <textarea
                                        required
                                        name="full_address"
                                        placeholder=""
                                      />
                                    </Iconblock>
                                  </div>
                                </div>
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      Country <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <Globe />
                                      <select
                                        required
                                        name="country"
                                        onChange={handleStep2getstate}
                                        placeholder="Select or type a country"
                                        className="form-select"
                                      >
                                        <option value="">
                                          Select or type a country
                                        </option>
                                        {countryOptionsFormatted.map(
                                          (option) => (
                                            <option
                                              value={option.value}
                                              key={option.value}
                                            >
                                              {option.label}
                                            </option>
                                          )
                                        )}
                                      </select>
                                    </Iconblock>
                                  </div>
                                </div>

                                {/* Country of Tax Residency */}
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      Country of Tax Residency{" "}
                                      <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <Globe />
                                      <input
                                        type="text"
                                        name="country_tax"
                                        required
                                        placeholder=""
                                      />
                                    </Iconblock>
                                  </div>
                                </div>
                                {/* Country */}

                                {/* Tax ID or National ID */}
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      Tax ID or National ID{" "}
                                    </label>
                                    <Iconblock>
                                      <User />
                                      <input
                                        type="text"
                                        name="tax_id"
                                        placeholder=""
                                      />
                                    </Iconblock>
                                  </div>
                                </div>

                                {/* LinkedIn / Professional Profile */}
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      LinkedIn or Professional Profile{" "}
                                    </label>
                                    <Iconblock>
                                      <User />
                                      <input
                                        type="text"
                                        name="linkedIn_profile"
                                        placeholder=""
                                      />
                                    </Iconblock>
                                  </div>
                                </div>

                                {/* Accredited Status */}
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">Accredited Status </label>
                                    <Iconblock>
                                      <Building2 />

                                      <select
                                        name="accredited_status"
                                        placeholder="Select Accredited Status"
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
                                    </Iconblock>
                                  </div>
                                </div>

                                {/* Industry Expertise */}
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      Industry Expertise{" "}
                                    </label>
                                    <Iconblock>
                                      <Building2 />

                                      <select
                                        name="industry_expertise"
                                        placeholder=""
                                      >
                                        <option value="">--Select--</option>
                                        <option value="Aerospace & Defense">
                                          Aerospace & Defense
                                        </option>
                                        <option value="Agriculture & Farming">
                                          Agriculture & Farming
                                        </option>
                                        <option value="Artificial Intelligence & Machine Learning">
                                          Artificial Intelligence & Machine
                                          Learning
                                        </option>
                                        <option value="Automotive">
                                          Automotive
                                        </option>
                                        <option value="Banking & Financial Services">
                                          Banking & Financial Services
                                        </option>
                                        <option value="Biotechnology">
                                          Biotechnology
                                        </option>
                                        <option value="Chemical Industry">
                                          Chemical Industry
                                        </option>
                                        <option value="Construction & Engineering">
                                          Construction & Engineering
                                        </option>
                                        <option value="Consumer Goods">
                                          Consumer Goods
                                        </option>
                                        <option value="Cybersecurity">
                                          Cybersecurity
                                        </option>
                                        <option value="Data Storage & Management">
                                          Data Storage & Management
                                        </option>
                                        <option value="Education & Training">
                                          Education & Training
                                        </option>
                                        <option value="Electric Vehicles & Sustainable Transportation">
                                          Electric Vehicles & Sustainable
                                          Transportation
                                        </option>
                                        <option value="Energy & Utilities">
                                          Energy & Utilities
                                        </option>
                                        <option value="Entertainment & Media">
                                          Entertainment & Media
                                        </option>
                                        <option value="Environmental Services & Sustainability">
                                          Environmental Services &
                                          Sustainability
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
                                        <option value="Insurance">
                                          Insurance
                                        </option>
                                        <option value="Jewelry & Luxury Goods">
                                          Jewelry & Luxury Goods
                                        </option>
                                        <option value="Legal Services">
                                          Legal Services
                                        </option>
                                        <option value="Logistics & Supply Chain">
                                          Logistics & Supply Chain
                                        </option>
                                        <option value="Manufacturing">
                                          Manufacturing
                                        </option>
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
                                          Public Administration & Government
                                          Services
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
                                        <option value="Robotics">
                                          Robotics
                                        </option>
                                        <option value="Security & Surveillance">
                                          Security & Surveillance
                                        </option>
                                        <option value="Social Media & Digital Marketing">
                                          Social Media & Digital Marketing
                                        </option>
                                        <option value="Space Exploration & Satellite Technology">
                                          Space Exploration & Satellite
                                          Technology
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
                                    </Iconblock>
                                  </div>
                                </div>

                                {/* Type of Investor */}
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      Investor Type{" "}
                                      <Sup className="labelsize">*</Sup>
                                    </label>
                                    <Iconblock>
                                      <User />
                                      <select
                                        name="type_of_investor"
                                        required
                                        placeholder="Select Investor Type"
                                      >
                                        <option value="">
                                          Select Investor Type
                                        </option>
                                        <option value="Founder">Founder</option>
                                        <option value="Co-Founder">
                                          Co-Founder
                                        </option>
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
                                        <option value="Hedge Fund">
                                          Hedge Fund
                                        </option>
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
                                    </Iconblock>
                                  </div>
                                </div>
                                {/* KYC/AML Documentation */}
                                <div className="col-12">
                                  <div className="d-flex flex-column gap-2">
                                    <label htmlFor="">
                                      KYC/AML Documentation (for institutional
                                      or cross-border investors)
                                    </label>
                                    <Iconblock>
                                      <input
                                        type="file"
                                        name="kyc_document"
                                        className="form-input"
                                        accept=".pdf,.jpg,.jpeg,.png"
                                        multiple
                                      />
                                    </Iconblock>
                                    <small className="form-text text-muted">
                                      Upload ID proof, address proof, or
                                      institutional documents
                                    </small>
                                    {/* Conditional view button (optional, if you have existing files) */}
                                  </div>
                                </div>

                                {/* Submit Button */}
                                <div className="col-12">
                                  <div className="d-flex justify-content-end mt-4">
                                    <div className="flex-shrink-0">
                                      <button
                                        type="submit"
                                        className="sbtn nextbtn"
                                        data-step="1"
                                      >
                                        Submit
                                        {spinners && (
                                          <div
                                            className="white-spinner spinner-border spinneronetimepay m-0"
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
                            </div>
                          </Stepblock>
                        </form>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </SectionWrapper>
          </div>
        </Wrapper>
      </>
    </>
  );
}
