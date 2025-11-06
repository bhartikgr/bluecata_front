import React, { useState, useEffect, useRef } from "react";
import TopBar from "../../components/Users/TopBar";
import ModuleSideNav from "../../components/Users/ModuleSideNav";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/MainHeadStyles.js";
import "react-big-calendar/lib/css/react-big-calendar.css";
import axios from "axios";
import { State, City } from "country-state-city";
import { useNavigate } from "react-router-dom";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";

export default function CompanyProfile() {
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const apiURL = "http://localhost:5000/api/user/";
  document.title = "Company Profile";
  const [errr, seterrr] = useState(false);
  const [dangerMessage, setdangerMessage] = useState("");
  const [companydata, setcompanydata] = useState("");
  const [formStep1, setformStep1] = useState(true);
  const [formStep2, setformStep2] = useState(false);
  const [formStep3, setformStep3] = useState(false);
  const [state_codes, setstate_codes] = useState("");
  const [States, setStates] = useState([]);
  const [selectedState, setSelectedState] = useState("");
  const [Cities, setCities] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [Filenamearticle, setFilenamearticle] = useState("");
  const [step2Countrycode, setstep2Countrycode] = useState("");
  const [selectedCountryStep2, setselectedCountryStep2] = useState(null);
  const [step2required, setstep2required] = useState(true);
  const navigate = useNavigate();
  const [charCount_descriptionStep4, setcharCount_descriptionStep4] =
    useState(0);
  const [charCount_problemStep4, setcharCount_problemStep4] = useState(0);
  const [charCount_solutionStep4, setcharCount_solutionStep4] = useState(0);
  const [allcountry, setallcountry] = useState([]);
  const countryOptionsFormatted = allcountry.map((country) => ({
    value: country.name,
    label: country.name,
  }));
  const countryOptionsFormattedCode = allcountry.map((country) => ({
    value: country.code,
    label: country.name,
  }));
  const [ClientIP, setClientIP] = useState("");
  useEffect(() => {
    const getIP = async () => {
      try {
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json();
        setClientIP(data.ip); // Save this to state
      } catch (error) {
        console.error("Failed to fetch IP", error);
      }
    };

    getIP();
  }, []);
  useEffect(() => {
    getcompanydetail();
  }, []);

  const getcompanydetail = async () => {
    let formdata = {
      company_id: userLogin.companies[0].id,
    };

    try {
      const res = await axios.post(apiURL + "getcompanydetail", formdata, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      const data = res.data.results[0];

      // ✅ set the formData first
      setFormData(data);
      setselectedCountryStep2(data.company_country);
      setstep2Countrycode(data.company_country);
      setstate_codes(data.state_code);
      setFilenamearticle(data.articles);
      setJurisdiction(data.jurisdiction_country);
      setEntityType(data.entity_type);
      // ✅ populate States list
      if (data.company_country) {
        const states = State.getStatesOfCountry(data.country_code);
        setStates(states);

        // ✅ if company_state exists, populate Cities
        if (data.company_state) {
          const stateObj = states.find(
            (s) =>
              s.name === data.company_state || s.isoCode === data.company_state
          );

          if (stateObj) {
            const cities = City.getCitiesOfState(
              data.country_code,
              data.state_code
            );
            if (cities.length === 0) {
              setstep2required(false);
            } else {
              setstep2required(true);
            }
            setCities(cities);
            setSelectedState(stateObj.isoCode);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching company details:", err);
    }
  };

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

  const [formData, setFormData] = useState({
    company_email: "",
    phone: "",
    city_step2: "",
    company_city: "",
    company_street_address: "",
    company_industory: "",
    company_name: "",
    year_registration: "",
    company_website: "",
    employee_number: "",
    company_linkedin: "",
    descriptionStep4: "",
    problemStep4: "",
    solutionStep4: "",
    company_state: "",
    company_postal_code: "",
    company_country: selectedCountryStep2,
    articles_files: "",
    business_number: "",
    entity_name: "",
    jurisdiction: "",
    state_code: state_codes,
    country_code: step2Countrycode,
    date_of_incorporation: "",
    entity_type: "",
    jurisdiction_country: "",
    entity_structure: "",
    mailing_address: "",
    office_address: "",
    articles: "",
  });
  const handleSubmit = async () => {
    // setIsLoading(true);
    const formDataToSend = new FormData();

    formDataToSend.append("company_id", userLogin.companies[0].id);
    formDataToSend.append("ip_address", ClientIP);

    Object.entries(formData).forEach(([key, value]) => {
      if (key === "articles") {
        if (value) {
          formDataToSend.append("articles", value); // ✅ append file
        }
      } else {
        formDataToSend.append(key, value ?? "");
      }
    });
    try {
      const respo = await axios.post(
        `${apiURL}companyProfileUpdate`,
        formDataToSend,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "multipart/form-data", // ✅ force multipart
          },
        }
      );
      setdangerMessage("Profile updated successfully!");
      seterrr(false);
      getcompanydetail();
      setTimeout(() => {
        setdangerMessage("");
        window.location.reload();
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

  //
  const [formErrors, setFormErrors] = useState({
    emailMatch: "",
  });
  const companyWebsiteRef = useRef(null);
  const [errorUrl, seterrorUrl] = useState(false);
  const handleChange = (e) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    // Validate email matching on the fly
    // if (name === "email" || name === "confirm_email") {
    //   if (
    //     (name === "email" && value !== formData.confirm_email) ||
    //     (name === "confirm_email" && value !== formData.email)
    //   ) {
    //     setFormErrors((prev) => ({
    //       ...prev,
    //       emailMatch: "Emails do not match.",
    //     }));
    //   } else {
    //     setFormErrors((prev) => ({ ...prev, emailMatch: "" }));
    //   }
    // }
  };
  const handleproblemStep4 = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setcharCount_problemStep4(valuee.length);
  };
  const handlesolutionStep4 = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setcharCount_solutionStep4(valuee.length);
  };
  const handledescriptionStep4 = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setcharCount_descriptionStep4(valuee.length);
  };
  const [phoneError, setPhoneError] = useState("");
  const handlePhoneChange = (value) => {
    setFormData({ ...formData, phone: value });

    // ✅ Custom validation
    if (value && value.replace(/\D/g, "").length < 10) {
      setPhoneError("Phone number must be at least 10 digits");
    } else {
      setPhoneError("");
    }
  };

  const handleStep2getstate = (event) => {
    const countryCode = event.target.value; // Get the selected country code from the event
    const countryName = event.target.options[event.target.selectedIndex].text;

    if (countryName === "Aruba" || countryName === "American Samoa") {
      setstep2required(false);
    } else {
      setstep2required(true);
    }

    setselectedCountryStep2(countryName);

    // Assuming you have a method to fetch states based on country code
    const indiaStates = State.getStatesOfCountry(countryCode);
    console.log(indiaStates);
    setCities([]);
    setStates(indiaStates);
  };
  const handleStateChange = (e) => {
    setSelectedState(e.target.value);

    const stateCode = e.target.value;
    // Get cities of that state
    const cities = City.getCitiesOfState(formData.country_code, stateCode);
    const selectedStateObj = States.find(
      (state) => state.isoCode === stateCode
    );
    setstate_codes(stateCode);
    // Get the state name if found
    const stateName = selectedStateObj ? selectedStateObj.name : "";

    setFormData((prev) => ({
      ...prev,

      company_state: stateName, // State name
    }));
    if (cities.length === 0) {
      setstep2required(false);
    } else {
      setstep2required(true);
    }
    console.log(cities);
    setCities(cities);
  };
  const handleStep2getcity = async (event) => {
    const city = event.target.value;

    const countryCode = formData.company_country;

    const cityList = City.getCitiesOfState(countryCode, city);
    // Update form data with selected city
    setFormData((prev) => ({
      ...prev,
      city_step2: city,
      company_city: city,
    }));

    // Get postal code from Google API
  };
  const entityTypesByCountry = {
    Argentina: [
      "SA (Sociedad Anónima)",
      "SRL (Sociedad de Responsabilidad Limitada)",
      "SCS",
      "SCA",
      "Cooperative",
      "Sole Proprietorship",
    ],
    Australia: [
      "Pty Ltd",
      "Public Company",
      "Sole Trader",
      "Trust",
      "Incorporated Association",
      "Cooperative",
      "Indigenous Corporation",
    ],
    Austria: [
      "GmbH",
      "AG",
      "OG (General Partnership)",
      "KG (Limited Partnership)",
      "Verein (Association)",
      "Stiftung (Foundation)",
    ],
    Belgium: [
      "SA/NV",
      "SRL/BV",
      "Cooperative Society",
      "ASBL/VZW (Nonprofit)",
      "Partnership",
      "Sole Proprietorship",
    ],
    Brazil: [
      "LTDA",
      "SA (open/closed)",
      "MEI (Microentrepreneur)",
      "EIRELI",
      "S.A.S.",
      "Cooperative",
      "Sole Proprietorship",
    ],
    Canada: [
      "Corporation (Federal/Provincial)",
      "Sole Proprietorship",
      "Partnership",
      "Cooperative",
      "Not-for-Profit",
      "Trust",
      "ULC (Unlimited Liability)",
    ],
    Chile: [
      "SRL",
      "SA",
      "SpA (Simplified Joint Stock)",
      "EIRL (Individual Limited Liability)",
      "Cooperative",
    ],
    China: [
      "LLC",
      "Company Limited by Shares",
      "WFOE (Wholly Foreign-Owned Enterprise)",
      "JV",
      "Sole Proprietorship",
    ],
    Colombia: [
      "SA",
      "SAS",
      "SRL",
      "SCA",
      "SCS",
      "Cooperative",
      "Simplified Stock Company",
    ],
    "Czech Republic": [
      "s.r.o.",
      "a.s.",
      "v.o.s.",
      "k.s.",
      "Cooperative",
      "Foundation",
      "Sole Proprietorship",
    ],
    Denmark: ["ApS", "A/S", "I/S", "K/S", "Cooperative", "Foundation"],
    Egypt: [
      "Joint Stock Company",
      "LLC",
      "Partnership",
      "Sole Proprietorship",
      "Cooperative",
    ],
    Estonia: [
      "OÜ (Private Limited)",
      "AS (Public Limited)",
      "TÜ (General Partnership)",
      "UÜ (Limited Partnership)",
      "MTÜ (Nonprofit)",
    ],
    Finland: ["Oy", "Oyj", "Ay", "Ky", "Cooperative", "Foundation"],
    France: [
      "SARL",
      "SA",
      "SAS",
      "SNC",
      "SCS",
      "SCOP (Worker Co-op)",
      "Association",
      "Foundation",
    ],
    Germany: [
      "GmbH",
      "AG",
      "OHG",
      "KG",
      "e.V. (Nonprofit)",
      "Stiftung",
      "KGaA (Limited Partnership with Shares)",
    ],
    Greece: ["AE", "EPE", "OE", "EE", "Cooperative", "Nonprofit Association"],
    "Hong Kong": ["Ltd", "Sole Proprietorship", "Partnership", "NGO"],
    Hungary: ["Kft", "Rt", "Bt", "Kkt", "Cooperative", "Foundation"],
    India: [
      "Pvt Ltd",
      "Public Ltd",
      "LLP",
      "OPC (One Person Company)",
      "Section 8 Company (Nonprofit)",
      "Trust",
      "Society",
    ],
    Indonesia: ["PT", "CV", "Firm", "Cooperative", "Foundation"],
    Ireland: ["Ltd", "PLC", "DAC", "CLG", "ULC", "Sole Trader", "Partnership"],
    Israel: ["Ltd", "Partnership", "Cooperative Society", "Amutah (Nonprofit)"],
    Italy: [
      "S.p.A.",
      "S.r.l.",
      "S.a.s.",
      "S.n.c.",
      "Cooperative",
      "Foundation",
    ],
    Japan: [
      "KK (Kabushiki Kaisha)",
      "GK (Godo Kaisha)",
      "NPO",
      "Tokumei Kumiai (Silent Partnership)",
      "Foundation",
    ],
    Kenya: [
      "Ltd",
      "PLC",
      "Partnership",
      "Sole Proprietorship",
      "NGO",
      "Cooperative",
    ],
    Luxembourg: ["Sàrl", "SA", "SCA", "SCSp", "Cooperative", "Foundation"],
    Malaysia: [
      "Sdn Bhd",
      "Berhad",
      "LLP",
      "Sole Proprietorship",
      "Cooperative",
    ],
    Mexico: [
      "S.A. de C.V.",
      "S. de R.L. de C.V.",
      "S.C.",
      "A.C.",
      "Cooperative",
    ],
    Netherlands: [
      "BV",
      "NV",
      "VOF",
      "CV",
      "Stichting (Foundation)",
      "Cooperative",
    ],
    "New Zealand": ["Ltd", "Partnership", "Trust", "Incorporated Society"],
    Nigeria: [
      "Ltd",
      "PLC",
      "Business Name",
      "Incorporated Trustees",
      "Cooperative",
    ],
    Norway: ["AS", "ASA", "ANS", "DA", "Cooperative", "Foundation"],
    Pakistan: [
      "Pvt Ltd",
      "Public Ltd",
      "Partnership",
      "Sole Proprietorship",
      "NGO",
    ],
    Peru: ["SA", "SAC", "SRL", "Cooperative"],
    Philippines: [
      "Corporation",
      "Partnership",
      "Sole Proprietorship",
      "Cooperative",
    ],
    Poland: ["Sp. z o.o.", "S.A.", "S.C.", "S.J.", "Cooperative", "Foundation"],
    Portugal: ["Lda", "SA", "S.C.", "Cooperative", "Foundation"],
    Romania: ["SRL", "SA", "SNC", "SCS", "Cooperative", "Foundation"],
    Russia: ["OOO", "AO", "IP", "Non-commercial Organization", "Foundation"],
    "Saudi Arabia": [
      "LLC",
      "Joint Stock Company",
      "Sole Proprietorship",
      "Cooperative",
    ],
    Singapore: [
      "Pte Ltd",
      "Ltd",
      "LLP",
      "Sole Proprietorship",
      "VCC (Variable Capital Company -- Funds)",
      "Cooperative",
    ],
    "South Africa": [
      "Pty Ltd",
      "CC",
      "NPC (Nonprofit)",
      "Sole Proprietor",
      "Cooperative",
    ],
    "South Korea": [
      "Yuhan Hoesa (Ltd)",
      "Chusik Hoesa (Corp)",
      "Hapja Hoesa (LP)",
      "Cooperative",
    ],
    Spain: ["SA", "SL", "S.C.", "S.Coop", "Foundation", "Association"],
    Sweden: ["AB", "HB", "KB", "Enskild Firma", "Cooperative", "Foundation"],
    Switzerland: [
      "AG",
      "GmbH",
      "Kollektivgesellschaft",
      "Kommanditgesellschaft",
      "Stiftung",
      "Verein",
    ],
    Thailand: ["Ltd", "Partnership", "Sole Proprietorship", "Cooperative"],
    Turkey: [
      "A.Ş.",
      "Ltd. Şti.",
      "Kollektif Şirket",
      "Komandit Şirket",
      "Cooperative",
      "Foundation",
    ],
    Ukraine: ["TOV", "AT", "PP", "Cooperative", "Foundation"],
    "United Arab Emirates": [
      "LLC",
      "PJSC",
      "Sole Establishment",
      "Free Zone Company",
      "Offshore Company",
    ],
    "United Kingdom": [
      "Ltd",
      "PLC",
      "LLP",
      "Sole Trader",
      "CIC",
      "CIO",
      "Charitable Trust",
    ],
    "United States": [
      "LLC",
      "C Corp",
      "S Corp",
      "B Corp",
      "L3C",
      "Series LLC",
      "Sole Proprietorship",
      "Partnership",
      "501(c)(3)",
      "REIT",
      "PC (Professional Corp)",
    ],
  };

  const [jurisdiction, setJurisdiction] = useState(
    formData.jurisdiction_country || ""
  );
  const [entityType, setEntityType] = useState(formData.entity_type || "");

  const handleJurisdictionChange = (e) => {
    const selected = e.target.value;
    setJurisdiction(selected);
    setEntityType(""); // reset entity type when changing jurisdiction
    setFormData({
      ...formData,
      jurisdiction_country: selected,
      entity_type: "",
    });
  };

  const handleEntityTypeChange = (e) => {
    const selected = e.target.value;
    setEntityType(selected);
    setFormData({ ...formData, entity_type: selected });
  };
  const handleSubmitForm_One = () => {
    const phoneDigits = formData.phone ? formData.phone.replace(/\D/g, "") : "";

    // Validate phone number
    if (!formData.phone || phoneDigits.length < 10) {
      setPhoneError("Phone number must be at least 10 digits");
      return; // stop form submission
    }

    // Clear any previous error
    setPhoneError("");

    // Move to next step
    setformStep2(true);
    setformStep1(false);
  };

  const handleSubmitForm_Two = () => {
    setformStep2(false);
    setformStep3(true);
  };
  const handlebackSteps = (id) => {
    if (id === 1) {
      setformStep2(false);
      setformStep1(true);
    }
    if (id === 2) {
      setformStep2(true);
      setformStep3(false);
    }
  };

  // Handle file selection
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    console.log(file);
    if (file) {
      setFilenamearticle(file.name);
      setFormData((prev) => ({
        ...prev,
        articles: file, // keep File object for upload
      }));
    }
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
                  <div className="profile-card">
                    {formStep1 && (
                      <div className="profile-header">
                        <div className="d-flex align-items-center justify-content-between gap-3 w-100">
                          <div className="d-flex align-items-center justify-content-start gap-2">
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
                              <h2>Company Contact Info</h2>
                            </div>
                          </div>
                          <p
                            style={{
                              background: "#ff3d41",
                              color: "#fff",
                              fontSize: "0.9rem",
                              borderRadius: "8px",
                            }}
                            className="rounded-xl px-3 py-1 w-fit"
                          >
                            1/3
                          </p>
                        </div>
                      </div>
                    )}

                    {formStep1 && (
                      <div className="profile-content">
                        <form
                          onSubmit={handleSubmitForm_One}
                          method="post"
                          action="javascript:void(0)"
                        >
                          <div className="row g-3">
                            {/* First Name */}
                            <div className="col-12">
                              <label
                                htmlFor="company_name"
                                className="label_fontWeight"
                              >
                                Name of Company{" "}
                                <span className="required">*</span>
                              </label>
                              <input
                                required
                                onChange={handleChange}
                                value={formData.company_name}
                                type="text"
                                name="company_name"
                                id="company_name"
                                className="form-input"
                                placeholder="Enter company name"
                              />
                            </div>
                            <div className="col-12">
                              <label
                                htmlFor="company_name"
                                className="label_fontWeight"
                              >
                                Company Email{" "}
                                <span className="required">*</span>
                              </label>
                              <input
                                required
                                onChange={handleChange}
                                value={formData.company_email}
                                type="text"
                                name="company_email"
                                id="company_email"
                                className="form-input"
                                placeholder="Enter company email"
                              />
                            </div>
                            <div className="col-md-6">
                              <label
                                htmlFor="Industry"
                                className="label_fontWeight"
                              >
                                Industry <span className="required">*</span>
                              </label>
                              <select
                                id="Industry"
                                value={formData.company_industory}
                                className="form-select"
                                onChange={handleChange}
                                name="company_industory"
                                required
                              >
                                <option value="">Industry</option>
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
                            <div className="col-md-6">
                              <label
                                htmlFor="phone"
                                className="label_fontWeight"
                              >
                                Phone <span className="required">*</span>
                              </label>
                              <PhoneInput
                                required
                                value={formData.phone}
                                name="phone"
                                defaultCountry="CA"
                                onChange={handlePhoneChange}
                                className="phonregister form-control"
                                placeholder="Enter phone number"
                              />
                              {phoneError && (
                                <small style={{ color: "red" }}>
                                  {phoneError}
                                </small>
                              )}
                            </div>
                            <div className="col-md-6">
                              <label
                                htmlFor="company_website"
                                className="label_fontWeight"
                              >
                                Company Website / URL{" "}
                                <span className="required">*</span>
                              </label>
                              <input
                                ref={companyWebsiteRef}
                                type="text"
                                required
                                value={formData.company_website}
                                onChange={handleChange}
                                name="company_website"
                                id="company_website"
                                className="form-control"
                                placeholder="Enter your company url"
                              />
                              {errorUrl && (
                                <div
                                  style={{ fontSize: "13px" }}
                                  className="text-danger fw-semibold"
                                >
                                  Please enter valid website url
                                  (eg:www.domain.com)
                                </div>
                              )}
                            </div>
                            <div className="col-md-6">
                              <label
                                htmlFor="employee_number"
                                className="label_fontWeight"
                              >
                                Number of Employees{" "}
                                <span className="required">*</span>
                              </label>
                              <select
                                required
                                onChange={handleChange}
                                value={formData.employee_number}
                                name="employee_number"
                                id="employee_number"
                                className="form-select"
                              >
                                <option value="">
                                  Select employee count range
                                </option>
                                <option value="1-10">1-10 employees</option>
                                <option value="11-50">11-50 employees</option>
                                <option value="51-200">51-200 employees</option>
                                <option value="201-500">
                                  201-500 employees
                                </option>
                                <option value="501-1000">
                                  501-1000 employees
                                </option>
                                <option value="1000+">1000+ employees</option>
                              </select>
                            </div>
                            <div className="col-12">
                              <label
                                htmlFor="year_registration"
                                className="label_fontWeight"
                              >
                                Year of Registration{" "}
                                <span className="required">*</span>
                              </label>
                              <input
                                type="number"
                                required
                                value={formData.year_registration}
                                name="year_registration"
                                id="year_registration"
                                className="form-control"
                                placeholder="Enter here"
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (/^\d*$/.test(value)) {
                                    setFormData((prev) => ({
                                      ...prev,
                                      year_registration: value,
                                    }));
                                  }
                                }}
                              />
                            </div>
                            <div className="col-12">
                              <label className="label_fontWeight">
                                One-sentence headliner about the company{" "}
                                <span className="required">*</span>
                              </label>
                              <textarea
                                required
                                id="description"
                                name="descriptionStep4"
                                className="form-control"
                                maxLength="800"
                                value={formData.descriptionStep4}
                                onChange={handledescriptionStep4}
                                placeholder="Max 800 characters..."
                              />
                              <div className="char-count">
                                {charCount_descriptionStep4}/800
                              </div>
                            </div>

                            {/* Problem */}
                            <div className="col-12">
                              <label className="label_fontWeight">
                                What problem are you solving?{" "}
                                <span className="required">*</span>
                              </label>
                              <textarea
                                required
                                id="problem"
                                name="problemStep4"
                                className="form-control"
                                maxLength="400"
                                value={formData.problemStep4}
                                onChange={handleproblemStep4}
                                placeholder="Max 400 characters..."
                              />
                              <div className="char-count">
                                {charCount_problemStep4}/400
                              </div>
                            </div>

                            {/* Solution */}
                            <div className="col-12">
                              <label className="label_fontWeight">
                                What is Your Solution to the Problem?{" "}
                                <span className="required">*</span>
                              </label>
                              <textarea
                                required
                                id="solution"
                                name="solutionStep4"
                                className="form-control"
                                maxLength="400"
                                value={formData.solutionStep4}
                                onChange={handlesolutionStep4}
                                placeholder="Max 400 characters..."
                              />
                              <div className="char-count">
                                {charCount_solutionStep4}/400
                              </div>
                            </div>
                          </div>
                          <div className="col-12 mt-4">
                            <div className="d-flex justify-content-between mt-2">
                              <div className="flex-shrink-0"></div>
                              <div className="flex-shrink-0">
                                <button
                                  disabled={isLoading}
                                  style={{ opacity: isLoading ? 0.6 : 1 }}
                                  type="submit"
                                  className="global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2"
                                >
                                  Next
                                  {isLoading && (
                                    <div
                                      className=" spinner-white spinner-border spinneronetimepay m-0"
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
                    )}
                    {formStep2 && (
                      <>
                        <form
                          onSubmit={handleSubmitForm_Two}
                          method="post"
                          action="javascript:void(0)"
                        >
                          <div className="row g-3">
                            <div className="col-md-12 mt-5">
                              <div className="d-flex flex-column gap-2">
                                <p
                                  style={{
                                    background: "#ff3d41",
                                    color: "#fff",
                                    fontSize: "0.9rem",
                                    borderRadius: "8px",
                                  }}
                                  className="rounded-xl px-3 py-1 w-fit"
                                >
                                  2/3
                                </p>
                                <label htmlFor="">
                                  <h4>Company Mailing Address</h4>
                                </label>
                              </div>
                            </div>

                            <div className="col-md-6">
                              <div className="d-flex flex-column gap-2">
                                <label htmlFor="" className="label_fontWeight">
                                  Street <span className="required">*</span>
                                </label>

                                <input
                                  value={formData.company_street_address}
                                  onChange={handleChange}
                                  name="company_street_address"
                                  required
                                  id=""
                                  className="form-control"
                                  placeholder="Enter here"
                                  type="text"
                                />
                              </div>
                            </div>

                            <div className="col-md-6">
                              <div className="d-flex flex-column gap-2">
                                <label htmlFor="" className="label_fontWeight">
                                  Country <span className="required">*</span>
                                </label>

                                <select
                                  required
                                  defaultValue={formData.country_code}
                                  name="company_country"
                                  onChange={handleStep2getstate}
                                  placeholder="Select or type a country"
                                  className="form-select" // Add Bootstrap class or custom styling
                                >
                                  <option value="">
                                    Select or type a country
                                  </option>
                                  {countryOptionsFormattedCode.map((option) => (
                                    <option value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div className="col-12">
                              <div className="d-flex flex-column gap-2">
                                <label htmlFor="" className="label_fontWeight">
                                  State / Province / Territory / District{" "}
                                  {step2required && (
                                    <span className="required">*</span>
                                  )}
                                </label>

                                <select
                                  className="form-select"
                                  required={step2required ? true : false}
                                  name="company_state"
                                  defaultValue={selectedState}
                                  onChange={handleStateChange}
                                >
                                  <option value="">-- Select State --</option>
                                  {States.map((state) => (
                                    <option
                                      key={state.isoCode}
                                      value={state.isoCode}
                                    >
                                      {state.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div className="col-md-6">
                              <div className="d-flex flex-column gap-2">
                                <label htmlFor="" className="label_fontWeight">
                                  City{" "}
                                  {step2required && (
                                    <span className="required">*</span>
                                  )}
                                </label>

                                <select
                                  defaultValue={formData.company_city}
                                  required={step2required ? true : false}
                                  name="company_country"
                                  onChange={handleStep2getcity}
                                  placeholder="Select or type a city"
                                  className="form-select" // Add Bootstrap class or custom styling
                                >
                                  <option value="">
                                    Select or type a city
                                  </option>

                                  {Cities.map((Citi) => (
                                    <option key={Citi.name} value={Citi.name}>
                                      {Citi.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div className="col-md-6">
                              <div className="d-flex flex-column gap-2">
                                <label htmlFor="" className="label_fontWeight">
                                  Postal code/Zip{" "}
                                  {step2required && (
                                    <span className="required">*</span>
                                  )}
                                </label>

                                <input
                                  onChange={handleChange}
                                  type="text"
                                  value={formData.company_postal_code}
                                  className="form-control"
                                  required={step2required ? true : false}
                                  name="company_postal_code"
                                  placeholder="Enter postal code/zip"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="col-12 mt-4">
                            <div className="d-flex justify-content-between mt-2">
                              <div className="flex-shrink-0">
                                <button
                                  type="button"
                                  className="global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2"
                                  data-step="3"
                                  onClick={() => handlebackSteps(1)}
                                >
                                  Back
                                </button>
                              </div>
                              <div className="flex-shrink-0">
                                <button
                                  disabled={isLoading}
                                  style={{ opacity: isLoading ? 0.6 : 1 }}
                                  type="submit"
                                  className="global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2"
                                >
                                  Next
                                  {isLoading && (
                                    <div
                                      className=" spinner-white spinner-border spinneronetimepay m-0"
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
                      </>
                    )}
                    {formStep3 && (
                      <form
                        onSubmit={handleSubmit}
                        action="javascript:void(0)"
                        method="post"
                      >
                        <div className="row g-3">
                          <div className="col-md-12 mt-5">
                            <div className="d-flex flex-column gap-2">
                              <p
                                style={{
                                  background: "#ff3d41",
                                  color: "#fff",
                                  fontSize: "0.9rem",
                                  borderRadius: "8px",
                                }}
                                className="rounded-xl px-3 py-1 w-fit"
                              >
                                3/3
                              </p>
                              <label htmlFor="">
                                <h4>Legal Entity Information</h4>
                              </label>
                            </div>
                          </div>
                          <div className="col-md-6">
                            <label
                              htmlFor="first_name"
                              className="label_fontWeight"
                            >
                              Upload Articles of Incorporation{" "}
                              <span className="required">*</span>
                            </label>
                            <input
                              type="file"
                              name="articles"
                              id="articles"
                              className="form-control"
                              accept=".pdf,.doc,.docx,.jpg,.png" // restrict to supported types if needed
                              onChange={handleFileChange}
                              required={!Filenamearticle} // only required if no file exists
                            />
                            <span>{Filenamearticle}</span>
                          </div>
                          <div className="col-md-6">
                            <label
                              htmlFor="entity_name"
                              className="label_fontWeight"
                            >
                              Legal Entity Name{" "}
                              <span className="required">*</span>
                            </label>
                            <input
                              defaultValue={formData.entity_name}
                              type="text"
                              onChange={handleChange}
                              name="entity_name"
                              placeholder="Enter here"
                              value={formData.entity_name}
                              id="entity_name"
                              className="form-control"
                              required
                            />
                          </div>
                          <div className="col-md-6">
                            <label
                              htmlFor="entity_name"
                              className="label_fontWeight"
                            >
                              Business Number{" "}
                              <span className="required">*</span>
                            </label>
                            <input
                              onChange={handleChange}
                              defaultValue={formData.business_number}
                              type="text"
                              name="business_number"
                              value={formData.business_number}
                              id="business_number"
                              className="form-control"
                              placeholder="Enter your business number"
                              required
                            />
                          </div>

                          <div className="col-md-6">
                            <label
                              htmlFor="jurisdiction"
                              className="label_fontWeight"
                            >
                              Jurisdiction of Incorporation{" "}
                              <span className="required">*</span>
                            </label>
                            <select
                              required
                              value={formData.jurisdiction_country}
                              name="jurisdiction_country"
                              onChange={handleJurisdictionChange}
                              placeholder="Select or type a country"
                              className="form-select" // Add Bootstrap class or custom styling
                            >
                              <option value="">Select or type a country</option>
                              {countryOptionsFormatted.map((option) => (
                                <option value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="col-md-6">
                            <label
                              htmlFor="entity_type"
                              className="label_fontWeight"
                            >
                              Type of Entity{" "}
                              {entityTypesByCountry[jurisdiction] && (
                                <span className="required">*</span>
                              )}
                            </label>
                            <select
                              id="entity_type"
                              name="entity_type"
                              className="form-select"
                              value={entityType}
                              onChange={handleEntityTypeChange}
                              disabled={!jurisdiction}
                              required={!!entityTypesByCountry[jurisdiction]}
                            >
                              <option value="">Select entity type</option>
                              {jurisdiction &&
                                entityTypesByCountry[jurisdiction]?.map(
                                  (type) => (
                                    <option key={type} value={type}>
                                      {type}
                                    </option>
                                  )
                                )}
                            </select>
                          </div>
                          <div className="col-md-6">
                            <label
                              htmlFor="date_of_incorporation"
                              className="label_fontWeight"
                            >
                              Date of Incorporation{" "}
                              <span className="required">*</span>
                            </label>
                            <input
                              required
                              onChange={handleChange}
                              defaultValue={formData.date_of_incorporation}
                              type="date"
                              name="date_of_incorporation"
                              id="date_of_incorporation"
                              className="form-control"
                            />
                          </div>
                          <div className="col-md-6">
                            <label
                              htmlFor="entity_structure"
                              className="label_fontWeight"
                            >
                              Entity Structure{" "}
                              <span className="required">*</span>
                            </label>

                            <select
                              required
                              onChange={handleChange}
                              name="entity_structure"
                              id="entity_structure"
                              className="form-select"
                              defaultValue={formData.entity_structure}
                            >
                              <option value="">Select</option>
                              <option value="private">
                                Private Corporation
                              </option>
                              <option value="public">Public Corporation</option>
                            </select>
                          </div>
                          <div className="col-md-6">
                            <label
                              htmlFor="office_address"
                              className="label_fontWeight"
                            >
                              Registered Office Address{" "}
                              <span className="required">*</span>
                            </label>
                            <textarea
                              onChange={handleChange}
                              required
                              defaultValue={formData.office_address}
                              type="date"
                              name="office_address"
                              id="office_address"
                              className="form-control"
                              placeholder="Enter office address"
                            />
                          </div>
                          <div className="col-md-12">
                            <label
                              htmlFor="mailing_address"
                              className="label_fontWeight"
                            >
                              Mailing Address{" "}
                              <span className="required">*</span>
                            </label>
                            <textarea
                              required
                              onChange={handleChange}
                              value={formData.mailing_address}
                              type="date"
                              name="mailing_address"
                              id="mailing_address"
                              className="form-control"
                              placeholder="Enter mailing address"
                            />
                          </div>
                        </div>
                        <div className="col-12 mt-4">
                          <div className="d-flex justify-content-between mt-2">
                            <div className="flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => handlebackSteps(2)}
                                className="global_btn_clear w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2"
                                data-step="3"
                              >
                                Back
                              </button>
                            </div>
                            <div className="flex-shrink-0">
                              <button
                                disabled={isLoading}
                                style={{ opacity: isLoading ? 0.6 : 1 }}
                                type="submit"
                                className="global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2"
                              >
                                Save
                                {isLoading && (
                                  <div
                                    className=" spinner-white spinner-border spinneronetimepay m-0"
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
                    )}
                    {/* Save Button */}
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
