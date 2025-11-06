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
import { Country, State, City } from "country-state-city";
import { useLocation } from "react-router-dom";
import { Tooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";
import {
  Tophead,
  Slan,
  Stepblock,
  Titletext1,
  Subtext,
  Titletext,
  RadioGroup,
  RadioOption,
  Iconblock,
  Sup,
  SectionWrapper,
} from "../../components/Styles/RegisterStyles";

import {
  Globe,
  User,
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
  const [spinners, setspinners] = useState(false);
  const [startDate, setStartDate] = useState(new Date());
  const [errorUrl, seterrorUrl] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [allcountry, setallcountry] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [selectedCountryStep2, setselectedCountryStep2] = useState(null);
  const [step1, setstep1] = useState(true);
  const [step2, setstep2] = useState(true);
  const [step3, setstep3] = useState(false);
  const [step4, setstep4] = useState(false);
  const [States, setStates] = useState([]);
  const [selectedState, setSelectedState] = useState("");
  const [step2Countrycode, setstep2Countrycode] = useState("");
  const companyWebsiteRef = useRef(null);
  const [charCount_step3, setCharCount_step3] = useState(0);
  const [charCount_headlinestep4, setcharCount_headlinestep4] = useState(0);
  const [charCount_descriptionStep4, setcharCount_descriptionStep4] =
    useState(0);

  const [charCount_problemStep4, setcharCount_problemStep4] = useState(0);
  const [charCount_solutionStep4, setcharCount_solutionStep4] = useState(0);
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
    const storedUsername = localStorage.getItem("CompanyLoginData");
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

  const handleClick = (color) => {
    document.documentElement.style.setProperty("--primary", color);
    document.documentElement.style.setProperty("--primary-icon", `${color}90`);
    localStorage.setItem("primaryColor", color); // Save color
  };

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
    if (formData.email !== formData.confirm_email) {
      setFormErrors((prev) => ({
        ...prev,
        emailMatch: "Emails do not match.",
      }));
      return;
    }
    if (
      !formData.first_name ||
      !formData.last_name ||
      !formData.email ||
      !formData.confirm_email ||
      !formData.phone
    ) {
      return;
    }
    try {
      const payload = {
        ...formData,
        referralCode: referralCode, // 👈 include the referral code here
      };
      const res = await axios.post(apiURL + "checkCompanyEmail", payload, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      if (res.data.status === "2") {
        seterrr(true);
        setdangerMessage(res.data.message);
        setTimeout(() => {
          setstep1(true);
          setstep2(false);
          setstep3(false);
          setstep4(false);
          seterrr(false);
          setdangerMessage("");
        }, 2500);
      } else {
        setstep1(false);
        setstep2(true);
      }
    } catch (err) { }
  };
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    role: "",
    email: "",
    confirm_email: "",
    linked_in: "",
    // maimai: "",
    // wechat: "",
    // boss_zhipin: "",
    phone: "",
    // area: "",
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
    company_street_address: "",
    // country: "",
    company_industory: "",
    company_name: "",
    year_registration: "",
    company_website: "",
    employee_number: "",
    company_linkedin: "",
    // company_maimai: "",
    // company_zhipin: "",
    //company_mail_address: "",
    company_state: "",
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
    console.log(name);
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

  const handlePhoneChange = (phone) => {
    setFormData((prev) => ({ ...prev, phone }));
  };

  const handleSubmitForm_Two = (e) => {
    e.preventDefault();
    const { name, value } = e.target;

    if (formData_Step2.company_website !== "") {
      if (!isValidURL(formData_Step2.company_website)) {
        companyWebsiteRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        seterrorUrl(true);
        return;
      } else {
        seterrorUrl(false);
      }
    }

    if (
      !formData_Step2.company_name ||
      !formData_Step2.employee_number ||
      !formData_Step2.company_website
    ) {
      return;
    }

    // If valid
    setstep2(false);
    setstep3(true);
  };

  const countryOptionsFormatted = allcountry.map((country) => ({
    value: country.code,
    label: country.name,
  }));

  //Step 2
  const handleStep2CountryChange = (e) => {
    setSelectedCountry(e.target.options[e.target.selectedIndex].text);
    setFormData_Step2((prev) => ({
      ...prev,
      country: e.target.value, // Store the value (e.g., "US")
    }));
  };
  const isValidURL = (string) => {
    const pattern = new RegExp(
      "^(https?:\\/\\/)?" + // optional http or https
      "((([a-zA-Z0-9\\-])+\\.)+[a-zA-Z]{2,})" + // domain
      "(\\:[0-9]{1,5})?" + // optional port
      "(\\/.*)?$", // optional path
      "i"
    );
    return !!pattern.test(string);
  };
  const handlepreStep1 = () => {
    setstep1(true);
    setstep2(false);
  };
  const [step2required, setstep2required] = useState(true);
  const handleStep2getstate = (event) => {
    const countryCode = event.target.value; // Get the selected country code from the event
    const countryName = event.target.options[event.target.selectedIndex].text;

    if (countryName === "Aruba") {
      console.log(countryName);
      setstep2required(false);
    } else {
      setstep2required(true);
    }
    setstep2Countrycode(countryCode);
    setselectedCountryStep2(countryName);
    setFormData_Step2((prev) => ({
      ...prev,
      company_country: event.target.value, // Store the value (e.g., "US")
    }));
    // Assuming you have a method to fetch states based on country code
    const indiaStates = State.getStatesOfCountry(countryCode);
    setStates(indiaStates);
  };

  const handleStep2getcity = async (event) => {
    const city = event.target.value;
    const state = formData_Step2.company_state; // from your state selection
    const country = formData_Step2.company_country; // from your country selection
    const countryCode = formData_Step2.company_country;

    const cityList = City.getCitiesOfState(countryCode, city);

    // Update form data with selected city
    setFormData_Step2((prev) => ({
      ...prev,
      city_step2: city,
    }));

    // Get postal code from Google API
  };

  const [Cities, setCities] = useState([]);
  const handleStateChange = (e) => {
    setSelectedState(e.target.value);
    const stateCode = e.target.value;
    setFormData_Step2((prev) => ({
      ...prev,
      company_state: stateCode,
    }));

    // Get cities of that state
    const cities = City.getCitiesOfState(
      formData_Step2.company_country,
      stateCode
    );
    console.log(cities);
    if (cities.length === 0) {
      setstep2required(false);
    } else {
      setstep2required(true);
    }
    setCities(cities);
  };

  //Step 2

  //Step 3

  const handleHeadlineChange = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData_Step3((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setCharCount_step3(valuee.length); // Update character count
  };

  const handlepreStep2 = () => {
    setstep3(false);
    setstep2(true);
  };
  //Step 3

  //Step 4
  const handlepreStep3 = () => {
    setstep3(true);
    setstep4(false);
  };
  const handleheadlinevalueChangeStep4 = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData_Step4((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setcharCount_headlinestep4(valuee.length);
  };
  const handledescriptionStep4 = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData_Step4((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setcharCount_descriptionStep4(valuee.length);
  };
  const handleproblemStep4 = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData_Step4((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setcharCount_problemStep4(valuee.length);
  };
  const handlesolutionStep4 = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData_Step4((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setcharCount_solutionStep4(valuee.length);
  };
  const handleSubmitForm_Four = async (e) => {
    e.preventDefault();

    let SaveFormData = {
      first_name: formData.first_name,
      last_name: formData.last_name,
      email: formData.email,
      role: formData.role,
      linked_in: formData.linked_in,
      phone: formData.phone,
      city_step2: formData_Step2.city_step2,
      company_street_address: formData_Step2.company_street_address,
      company_name: formData_Step2.company_name,
      year_registration: formData_Step2.year_registration,
      company_website: formData_Step2.company_website,
      employee_number: formData_Step2.employee_number,
      company_linkedin: formData_Step2.company_linkedin,
      company_mail_address: "",
      company_state: selectedState,

      company_postal_code: formData_Step2.company_postal_code,
      company_country: selectedCountryStep2,
      stage_step3: formData_Step3.stage_step3,
      gross_revenue: formData_Step3.gross_revenue,
      headline: formData_Step3.headline,

      headlineStep4: formData_Step4.headlineStep4,
      descriptionStep4: formData_Step4.descriptionStep4,
      problemStep4: formData_Step4.problemStep4,
      solutionStep4: formData_Step4.solutionStep4,
      company_industory: formData_Step2.company_industory,
      referralCode: referralCode,
    };
    setspinners(true);
    try {
      const res = await axios.post(apiURL + "userRegister", SaveFormData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      const checkData = res.data;
      setspinners(false);
      if (checkData.status === "2") {
        setstep1(true);
        setstep4(false);
        setFormErrors((prev) => ({
          ...prev,
          emailMatch: checkData.message,
        }));
        seterrr(true);
        setdangerMessage(checkData.message);
        setTimeout(() => {
          seterrr(false);
          setdangerMessage("");
          setFormErrors((prev) => ({
            ...prev,
            emailMatch: "",
          }));
        }, 10000);
      } else {
        setFormErrors((prev) => ({
          ...prev,
          emailMatch: "",
        }));
        let userData = {
          id: checkData.id,
          email: checkData.email,
          first_name: checkData.first_name,
          last_name: checkData.last_name,
          access_token: checkData.access_token,
        };
        localStorage.setItem("CompanyLoginData", JSON.stringify(userData));
        setdangerMessage(
          "Registration successful. Your login password has been sent to your email"
        );
        setTimeout(() => {
          navigate("/dashboard");
        }, 2500);
      }
    } catch (err) {
      if (err.response && err.response.data && err.response.data.message) {
      } else {
      }
    }
    //setstep5(true);
    //setstep4(false);
  };
  //Step 4
  //Signatury
  const [signatories, setSignatories] = useState([
    {
      first_name: "",
      last_name: "",
      email: "",
      confirm_email: "",
      linked_in: "",
      phone: "",
      signature_role: "",
      other_role: "",
    },
  ]);
  const addSignatory = () => {
    const emails = signatories.map((s) => s.email).filter(Boolean);
    const uniqueEmails = new Set(emails);

    if (emails.length !== uniqueEmails.size) {
      alert(
        "Please make sure all existing emails are unique before adding a new signatory."
      );
      return;
    }

    setSignatories([
      ...signatories,
      {
        first_name: "",
        last_name: "",
        email: "",
        confirm_email: "",
        linked_in: "",
        phone: "",
        signature_role: "",
      },
    ]);
    setSignatoryErrors([...signatoryErrors, { emailMatch: "" }]);
  };
  const handlePhoneChangeSignature = (index, value) => {
    const updatedSignatories = [...signatories];
    updatedSignatories[index].phone = value;
    setSignatories(updatedSignatories);
  };
  // Remove a signatory
  const removeSignatory = (index) => {
    const newSignatories = signatories.filter((_, i) => i !== index);
    setSignatories(newSignatories);
  };
  const [signatoryErrors, setSignatoryErrors] = useState(
    signatories.map(() => ({ emailMatch: "" }))
  );
  const handleChangeSignature = (index, e) => {
    const { name, value } = e.target;
    const updatedSignatories = [...signatories];
    updatedSignatories[index][name] = value;

    // Copy of errors
    const errorsCopy = [...signatoryErrors];

    // Email & confirm email match
    if (name === "email" || name === "confirm_email") {
      const email = updatedSignatories[index].email;
      const confirm = updatedSignatories[index].confirm_email;

      if (email && confirm && email !== confirm) {
        errorsCopy[index].emailMatch = "Emails do not match!";
      } else {
        errorsCopy[index].emailMatch = "";
      }

      // Check for duplicate emails
      const allEmails = updatedSignatories.map((s) => s.email);
      const duplicates = allEmails.filter(
        (e, i) => e && allEmails.indexOf(e) !== i
      );
      if (duplicates.includes(email)) {
        errorsCopy[index].emailMatch = "Email must be unique!";
      }

      setSignatoryErrors(errorsCopy);
    }
    if (name === "signature_role" && value !== "Other") {
      updatedSignatories[index].other_role = "";
    }
    setSignatories(updatedSignatories);
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
                      <Link style={{ color: "var(--primary)" }} to="/login">
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
                        {step2 && (
                          <form
                            action="javascript:void(0)"
                            method="post"
                            onSubmit={handleSubmitForm_Two}
                          >
                            <Stepblock id="step2">
                              <div className="d-flex flex-column gap-4">
                                <div className="d-flex flex-column gap-1 justify-content-start align-items-start">
                                  <Titletext1>Company Contact Info</Titletext1>
                                  <Subtext>
                                    Please Enter your company Contact Info.
                                  </Subtext>
                                </div>
                                <div className="row gy-3">
                                  <div className="col-md-12">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        Name of Company{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <Iconblock>
                                        <Building />
                                        <input
                                          defaultValue={
                                            formData_Step2.company_name
                                          }
                                          onChange={handleChange}
                                          type="text"
                                          placeholder=""
                                          name="company_name"
                                          required
                                        />
                                      </Iconblock>
                                    </div>
                                  </div>
                                  <div className="col-md-6">
                                    <div className="d-flex flex-column gap-2">
                                      <label className="mainp" htmlFor="">
                                        Company Email{" "}
                                        <Sup className="labelsize">*</Sup>
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
                                        Company Confirm Email{" "}
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
                                  <div className="col-md-12">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        Industry{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <Iconblock>
                                        <Building />
                                        <select
                                          onChange={handleChange}
                                          className="form-select"
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
                                  <div className="col-md-6">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        Company Website / URL{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <Iconblock>
                                        <Globe strokeWidth={1.5} />
                                        <input
                                          ref={companyWebsiteRef}
                                          required
                                          defaultValue={
                                            formData_Step2.company_website
                                          }
                                          onChange={handleChange}
                                          type="text"
                                          name="company_website"
                                          placeholder=""
                                        />
                                        {errorUrl && (
                                          <div
                                            style={{ fontSize: "13px" }}
                                            className="text-danger text-start fw-semibold"
                                          >
                                            Please enter valid website url
                                            (eg:www.domain.com)
                                          </div>
                                        )}
                                      </Iconblock>
                                    </div>
                                  </div>

                                  <div className="col-md-6">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        Number of Employees{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <Iconblock>
                                        <Users />
                                        <input
                                          value={formData_Step2.employee_number}
                                          onChange={(e) => {
                                            const value = e.target.value;
                                            // Only allow digits
                                            if (/^\d*$/.test(value)) {
                                              setFormData_Step2((prev) => ({
                                                ...prev,
                                                employee_number: value,
                                              }));
                                            }
                                          }}
                                          type="text"
                                          name="employee_number"
                                          required
                                          placeholder=""
                                        />
                                      </Iconblock>
                                    </div>
                                  </div>

                                  <div className="col-md-12">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        Year of Registration
                                      </label>
                                      <Iconblock>
                                        <Clipboard />
                                        <input
                                          value={
                                            formData_Step2.year_registration
                                          }
                                          onChange={(e) => {
                                            const value = e.target.value;
                                            // Only allow digits
                                            if (/^\d*$/.test(value)) {
                                              setFormData_Step2((prev) => ({
                                                ...prev,
                                                year_registration: value,
                                              }));
                                            }
                                          }}
                                          type="text"
                                          inputMode="numeric"
                                          pattern="\d*"
                                          name="year_registration"
                                          required
                                          placeholder=""
                                        />
                                      </Iconblock>
                                    </div>
                                  </div>
                                  <div className="col-12">
                                    <div className="d-flex flex-column gap-3">
                                      <label
                                        style={{
                                          fontWeight: "600",
                                          fontSize: "1rem",
                                        }}
                                        htmlFor=""
                                      >
                                        Can you formally/legally initiate a new
                                        round of investment on behalf of this
                                        company?{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <RadioGroup id="companyStage">
                                        <RadioOption>
                                          <input
                                            type="radio"
                                            name="formally_legally"
                                            checked={
                                              formData_Step3.formally_legally ===
                                              "Yes"
                                            }
                                            required // Mark as required
                                            value="Yes"
                                            id="concept"
                                            onChange={handleChange}
                                          />
                                          <label htmlFor="concept">Yes</label>
                                        </RadioOption>
                                        <RadioOption>
                                          <input
                                            type="radio"
                                            checked={
                                              formData_Step3.formally_legally ===
                                              "No"
                                            }
                                            name="formally_legally"
                                            value="No"
                                            id="planning5"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="planning5">No</label>
                                        </RadioOption>
                                      </RadioGroup>
                                    </div>
                                  </div>
                                  <div className="col-md-12 mt-5">
                                    <div className="d-flex justify-content-between  gap-2">
                                      <label htmlFor="">
                                        <h4>Signatories for the Company</h4>
                                      </label>
                                      <button
                                        type="button"
                                        onClick={addSignatory}
                                        className="global_btn w-fit"
                                        data-step="2"
                                      >
                                        + Add A New Signatory
                                      </button>
                                    </div>
                                  </div>
                                  {signatories.map((signData, index) => (
                                    <Stepblock
                                      key={index}
                                      id={`step${index + 1}`}
                                    >
                                      <div className="d-flex flex-column gap-4">
                                        <div className="d-flex flex-column gap-1 justify-content-start align-items-start"></div>
                                        <div className="row gy-3">
                                          {/* First Name */}
                                          <div className="col-md-6">
                                            <div className="d-flex flex-column gap-2">
                                              <label className="mainp">
                                                First Name{" "}
                                                <Sup className="labelsize">
                                                  *
                                                </Sup>
                                              </label>
                                              <Iconblock>
                                                <User />
                                                <input
                                                  value={signData.first_name}
                                                  onChange={(e) =>
                                                    handleChangeSignature(
                                                      index,
                                                      e
                                                    )
                                                  }
                                                  type="text"
                                                  name="first_name"
                                                  required
                                                />
                                              </Iconblock>
                                            </div>
                                          </div>

                                          {/* Last Name */}
                                          <div className="col-md-6">
                                            <div className="d-flex flex-column gap-2">
                                              <label className="mainp">
                                                Last Name{" "}
                                                <Sup className="labelsize">
                                                  *
                                                </Sup>
                                              </label>
                                              <Iconblock>
                                                <User />
                                                <input
                                                  value={signData.last_name}
                                                  onChange={(e) =>
                                                    handleChangeSignature(
                                                      index,
                                                      e
                                                    )
                                                  }
                                                  type="text"
                                                  name="last_name"
                                                  required
                                                />
                                              </Iconblock>
                                            </div>
                                          </div>

                                          {/* Email */}
                                          <div className="col-md-6">
                                            <div className="d-flex flex-column gap-2">
                                              <label className="mainp">
                                                Email{" "}
                                                <Sup className="labelsize">
                                                  *
                                                </Sup>
                                              </label>
                                              <Iconblock>
                                                <Mail />
                                                <input
                                                  value={signData.email}
                                                  onChange={(e) =>
                                                    handleChangeSignature(
                                                      index,
                                                      e
                                                    )
                                                  }
                                                  type="email"
                                                  name="email"
                                                  required
                                                />
                                              </Iconblock>
                                            </div>
                                          </div>

                                          {/* Confirm Email */}
                                          <div className="col-md-6">
                                            <div className="d-flex flex-column gap-2">
                                              <label className="mainp">
                                                Confirm Email{" "}
                                                <Sup className="labelsize">
                                                  *
                                                </Sup>
                                              </label>
                                              <Iconblock>
                                                <Mail />
                                                <input
                                                  value={signData.confirm_email}
                                                  onChange={(e) =>
                                                    handleChangeSignature(
                                                      index,
                                                      e
                                                    )
                                                  }
                                                  type="email"
                                                  name="confirm_email"
                                                  required
                                                />
                                                {signatoryErrors[index]
                                                  ?.emailMatch && (
                                                    <div
                                                      style={{ fontSize: "13px" }}
                                                      className="text-danger text-start fw-semibold"
                                                    >
                                                      {
                                                        signatoryErrors[index]
                                                          .emailMatch
                                                      }
                                                    </div>
                                                  )}
                                              </Iconblock>
                                            </div>
                                          </div>

                                          {/* LinkedIn */}
                                          <div className="col-md-6">
                                            <div className="d-flex flex-column gap-2">
                                              <label className="mainp">
                                                LinkedIn Profile
                                              </label>
                                              <Iconblock>
                                                <Linkedin />
                                                <input
                                                  value={signData.linked_in}
                                                  onChange={(e) =>
                                                    handleChangeSignature(
                                                      index,
                                                      e
                                                    )
                                                  }
                                                  type="text"
                                                  name="linked_in"
                                                />
                                              </Iconblock>
                                            </div>
                                          </div>

                                          {/* Phone */}
                                          <div className="col-md-6">
                                            <div className="d-flex flex-column gap-2">
                                              <label className="mainp">
                                                Phone Number{" "}
                                                <Sup className="labelsize">
                                                  *
                                                </Sup>
                                              </label>
                                              <Iconblock>
                                                <PhoneInput
                                                  required
                                                  name="phone"
                                                  defaultCountry="CA"
                                                  className="phonregister"
                                                  value={signData.phone}
                                                  onChange={(value) =>
                                                    handlePhoneChangeSignature(
                                                      index,
                                                      value
                                                    )
                                                  }
                                                  placeholder="Enter phone number"
                                                />
                                              </Iconblock>
                                            </div>
                                          </div>

                                          {/* Role */}
                                          <div className="col-md-12">
                                            <div className="d-flex flex-column gap-2">
                                              <label className="mainp">
                                                Role{" "}
                                                <Sup className="labelsize">
                                                  *
                                                </Sup>
                                              </label>
                                              <Iconblock>
                                                <User size={20} color="#555" />
                                                <select
                                                  onChange={(e) =>
                                                    handleChangeSignature(
                                                      index,
                                                      e
                                                    )
                                                  }
                                                  className="form-select"
                                                  name="signature_role"
                                                  required
                                                  value={
                                                    signData.signature_role
                                                  }
                                                >
                                                  <option value="Founder and Chief Executive Officer (CEO) – Visionary and strategic leader">
                                                    Founder and Chief Executive
                                                    Officer (CEO) – Visionary
                                                    and strategic leader
                                                  </option>
                                                  <option value="Chief Operating Officer (COO) – Oversees daily operations">
                                                    Chief Operating Officer
                                                    (COO) – Oversees daily
                                                    operations
                                                  </option>
                                                  <option value="Chief Financial Officer (CFO) – Manages finances and fundraising">
                                                    Chief Financial Officer
                                                    (CFO) – Manages finances and
                                                    fundraising
                                                  </option>
                                                  <option value="Chief Investment Officer (CIO) – Manages engagements with investors and shareholders">
                                                    Chief Investment Officer
                                                    (CIO) – Manages engagements
                                                    with investors and
                                                    shareholders
                                                  </option>
                                                  <option value="Chief Technology Officer (CTO) – Leads product and tech development">
                                                    Chief Technology Officer
                                                    (CTO) – Leads product and
                                                    tech development
                                                  </option>
                                                  <option value="Chief Marketing Officer (CMO) – Drives brand and customer acquisition">
                                                    Chief Marketing Officer
                                                    (CMO) – Drives brand and
                                                    customer acquisition
                                                  </option>
                                                  <option value="Chief Product Officer (CPO) – Owns product strategy and roadmap">
                                                    Chief Product Officer (CPO)
                                                    – Owns product strategy and
                                                    roadmap
                                                  </option>
                                                  <option value="Chief Revenue Officer (CRO) – Focuses on sales and revenue growth">
                                                    Chief Revenue Officer (CRO)
                                                    – Focuses on sales and
                                                    revenue growth
                                                  </option>
                                                  <option value="Chief People Officer (CPO) – Builds company culture and HR strategy">
                                                    Chief People Officer (CPO) –
                                                    Builds company culture and
                                                    HR strategy
                                                  </option>
                                                  <option value="Legal Counsel – Advises on contracts, IP, and compliance">
                                                    Legal Counsel – Advises on
                                                    contracts, IP, and
                                                    compliance
                                                  </option>
                                                  <option value="Advisory Board Member – Expert advisor guiding strategy, growth, and investor relations">
                                                    Advisory Board Member –
                                                    Expert advisor guiding
                                                    strategy, growth, and
                                                    investor relations
                                                  </option>
                                                  <option value="Other">
                                                    Other
                                                  </option>
                                                </select>
                                              </Iconblock>
                                            </div>
                                          </div>
                                          {signData.signature_role ===
                                            "Other" && (
                                              <div className="col-md-12">
                                                <div className="d-flex flex-column gap-2 mt-2">
                                                  <label className="mainp">
                                                    Please specify role{" "}
                                                    <Sup className="labelsize">
                                                      *
                                                    </Sup>
                                                  </label>
                                                  <Iconblock>
                                                    <User
                                                      size={20}
                                                      color="#555"
                                                    />
                                                    <input
                                                      type="text"
                                                      name="other_role"
                                                      value={signData.other_role}
                                                      onChange={(e) =>
                                                        handleChangeSignature(
                                                          index,
                                                          e
                                                        )
                                                      }
                                                      required
                                                      placeholder="Enter role"
                                                    />
                                                  </Iconblock>
                                                </div>
                                              </div>
                                            )}
                                          {/* Remove button */}
                                          <div className="col-md-12 d-flex justify-content-end">
                                            {index > 0 && (
                                              <button
                                                type="button"
                                                className="btn btn-danger"
                                                onClick={() =>
                                                  removeSignatory(index)
                                                }
                                              >
                                                Remove
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </Stepblock>
                                  ))}
                                  <div className="col-md-12 mt-5">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        <h4>Company Mailing Address</h4>
                                      </label>
                                    </div>
                                  </div>
                                  <div className="col-md-6">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        Street{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <Iconblock>
                                        <Building />
                                        <input
                                          defaultValue={
                                            formData_Step2.company_street_address
                                          }
                                          onChange={handleChange}
                                          name="company_street_address"
                                          required
                                          id=""
                                          placeholder=""
                                          type="text"
                                        />
                                      </Iconblock>
                                    </div>
                                  </div>
                                  <div className="col-md-6">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        Country{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <Iconblock>
                                        <Globe strokeWidth={1.5} />
                                        <select
                                          required
                                          name="company_country"
                                          onChange={handleStep2getstate}
                                          value={formData_Step2.company_country}
                                          placeholder="Select or type a country"
                                          className="form-select" // Add Bootstrap class or custom styling
                                        >
                                          <option value="">
                                            Select or type a country
                                          </option>
                                          {countryOptionsFormatted.map(
                                            (option) => (
                                              <option value={option.value}>
                                                {option.label}
                                              </option>
                                            )
                                          )}
                                        </select>
                                      </Iconblock>
                                    </div>
                                  </div>
                                  <div className="col-12">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        State / Province / Territory / District{" "}
                                        {step2required && (
                                          <Sup className="labelsize">*</Sup>
                                        )}
                                      </label>
                                      <Iconblock>
                                        <Building />
                                        <select
                                          className="form-select"
                                          required={
                                            step2required ? true : false
                                          }
                                          name="company_state"
                                          value={selectedState}
                                          onChange={handleStateChange}
                                        >
                                          <option value="">
                                            -- Select State --
                                          </option>
                                          {States.map((state) => (
                                            <option
                                              key={state.isoCode}
                                              value={state.isoCode}
                                            >
                                              {state.name}
                                            </option>
                                          ))}
                                        </select>
                                      </Iconblock>
                                    </div>
                                  </div>
                                  <div className="col-md-6">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        City{" "}
                                        {step2required && (
                                          <Sup className="labelsize">*</Sup>
                                        )}
                                      </label>
                                      <Iconblock>
                                        <Building2 />
                                        <select
                                          required={
                                            step2required ? true : false
                                          }
                                          name="city_step2"
                                          onChange={handleStep2getcity}
                                          value={formData_Step2.city_step2}
                                          placeholder="Select or type a city"
                                          className="form-select" // Add Bootstrap class or custom styling
                                        >
                                          <option value="">
                                            Select or type a city
                                          </option>

                                          {Cities.map((Citi) => (
                                            <option
                                              key={Citi.name}
                                              value={Citi.name}
                                            >
                                              {Citi.name}
                                            </option>
                                          ))}
                                        </select>
                                        {/* <input
                                  defaultValue={formData_Step2.city_step2}
                                  onChange={handleChange}
                                  type="text"
                                  name="city_step2"
                                  required
                                  placeholder=""
                                /> */}
                                      </Iconblock>
                                    </div>
                                  </div>

                                  <div className="col-md-6">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        Postal code/Zip{" "}
                                        {step2required && (
                                          <Sup className="labelsize">*</Sup>
                                        )}
                                      </label>
                                      <Iconblock>
                                        <MapPin />

                                        <input
                                          defaultValue={
                                            formData_Step2.company_postal_code
                                          }
                                          onChange={handleChange}
                                          type="text"
                                          required={
                                            step2required ? true : false
                                          }
                                          name="company_postal_code"
                                          placeholder=""
                                        />
                                      </Iconblock>
                                    </div>
                                  </div>

                                  <div className="col-12">
                                    <div className="d-flex justify-content-between mt-2">
                                      <div className="flex-shrink-0"></div>
                                      <div className="d-flex flex-row flex-shrink-0 gap-2">
                                        <button
                                          type="button"
                                          className="global_btn w-fit"
                                          data-step="2"
                                        >
                                          + Add A New Company
                                        </button>
                                        <button
                                          type="submit"
                                          className="global_btn w-fit"
                                          data-step="2"
                                        >
                                          Next
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </Stepblock>
                          </form>
                        )}
                        {step3 && (
                          <form
                            action="javascript:void(0)"
                            method="post"
                            onSubmit={handleSubmitForm_Four}
                          >
                            <Stepblock id="step3">
                              <div className="d-flex flex-column gap-4">
                                {/* <div className="d-flex flex-column gap-1 justify-content-start align-items-start">
                                  <Titletext1>Company status</Titletext1>
                                  <Subtext>
                                    Please Enter your company status.
                                  </Subtext>
                                </div> */}
                                <div className="row gy-3">
                                  <div className="col-12">
                                    <div className="d-flex flex-column gap-2">
                                      {/* Updated Headline (Merged) */}
                                      <label
                                        style={{
                                          fontWeight: "600",
                                          fontSize: "1rem",
                                        }}
                                      >
                                        One-sentence headliner about the company{" "}
                                        <Sup className="labelsize">*</Sup>
                                        <span
                                          className="tooltip-icon"
                                          data-tooltip-id="tt-cat-1"
                                          data-tooltip-html={`
                                          <div class="d-flex flex-column gap-1 tip-content">
                                            <ul>
                                              <li><em>FinTech Startup:</em> "We simplify international payments for small businesses with an instant, low-cost digital solution."</li>
                                              <li><em>HealthTech:</em> "Our AI-powered diagnostics make early disease detection accessible and affordable for underserved communities."</li>
                                              <li><em>SaaS Solution:</em> "We help businesses automate repetitive tasks, boosting productivity and reducing operational costs."</li>
                                              <li><em>Consumer Goods:</em> "We create stylish, eco-friendly clothing from recycled materials, redefining sustainable fashion."</li>
                                            </ul>
                                            <strong>Pro Tips</strong>
                                            <ul class="list-none">
                                              <li>✔ Keep it concise — Aim for 1–2 sentences.</li>
                                              <li>✔ Highlight your unique value — What makes your company different?</li>
                                              <li>✔ Use clear, compelling language — Avoid jargon; keep it simple.</li>
                                              <li>✔ Focus on impact — How does your product/service solve a key problem?</li>
                                            </ul>
                                          </div>
                                        `}
                                        >
                                          <img
                                            className="blackdark"
                                            width="15"
                                            height="15"
                                            src="/assets/user/images/question.png"
                                            alt="Tip"
                                          />
                                        </span>
                                        <Tooltip
                                          id="tt-cat-1"
                                          place="top"
                                          float
                                          interactive={true}
                                          className="custom-tooltip"
                                          positionStrategy="fixed"
                                        />
                                      </label>

                                      <Iconblock>
                                        <Building />
                                        <textarea
                                          required
                                          id="description"
                                          name="descriptionStep4"
                                          maxLength="800"
                                          onChange={handledescriptionStep4}
                                          value={
                                            formData_Step4.descriptionStep4 ||
                                            ""
                                          }
                                          placeholder="Max 800 characters..."
                                        />
                                      </Iconblock>
                                      <div className="char-count">
                                        {charCount_descriptionStep4}/800
                                      </div>
                                    </div>
                                  </div>

                                  {/* About Company */}
                                  {/* <div className="col-12">
                                    <div className="d-flex flex-column gap-2">
                                      <label
                                        style={{
                                          fontWeight: "600",
                                          fontSize: "1rem",
                                        }}
                                      >
                                        About your company in one sentence{" "}
                                        <Sup className="labelsize">*</Sup>
                                        <span
                                          className="tooltip-icon"
                                          data-tooltip-id="tt-cat-1"
                                          data-tooltip-html={`
                                              <div class="d-flex flex-column gap-1 tip-content">
                                                <ul>
                                                  <li><em>FinTech Startup:</em> "We simplify international payments for small businesses with an instant, low-cost digital solution."</li>
                                                  <li><em>HealthTech:</em> "Our AI-powered diagnostics make early disease detection accessible and affordable for underserved communities."</li>
                                                  <li><em>SaaS Solution:</em> "We help businesses automate repetitive tasks, boosting productivity and reducing operational costs."</li>
                                                  <li><em>Consumer Goods:</em> "We create stylish, eco-friendly clothing from recycled materials, redefining sustainable fashion."</li>
                                                </ul>
                                                <strong>Pro Tips</strong>
                                                <ul class="list-none">
                                                  <li>✔ Keep it concise — Aim for 1–2 sentences.</li>
                                                  <li>✔ Highlight your unique value — What makes your company different?</li>
                                                  <li>✔ Use clear, compelling language — Avoid jargon; keep it simple.</li>
                                                  <li>✔ Focus on impact — How does your product/service solve a key problem?</li>
                                                </ul>
                                              </div>
                                            `}
                                        >
                                          <img
                                            className="blackdark"
                                            width="15"
                                            height="15"
                                            src="/assets/user/images/question.png"
                                            alt="Tip"
                                          />
                                        </span>
                                        <Tooltip
                                          id="tt-cat-1"
                                          place="top"
                                          float
                                          interactive={true}
                                          className="custom-tooltip"
                                          positionStrategy="fixed"
                                        />
                                      </label>

                                      <Iconblock>
                                        <Building />
                                        <textarea
                                          required
                                          id="description"
                                          name="descriptionStep4"
                                          maxLength="800"
                                          onChange={handledescriptionStep4}
                                          value={
                                            formData_Step4.descriptionStep4 ||
                                            ""
                                          }
                                          placeholder="Max 800 characters..."
                                        />
                                      </Iconblock>
                                      <div className="char-count">
                                        {charCount_descriptionStep4}/800
                                      </div>
                                    </div>
                                  </div> */}

                                  {/* Problem */}
                                  <div className="col-12">
                                    <div className="d-flex flex-column gap-2">
                                      <label
                                        style={{
                                          fontWeight: "600",
                                          fontSize: "1rem",
                                        }}
                                      >
                                        What problem are you solving?{" "}
                                        <Sup className="labelsize">*</Sup>
                                        <span
                                          className="tooltip-icon"
                                          data-tooltip-id="tt-cat-2"
                                          data-tooltip-html={`
                                          <div class="d-flex flex-column gap-1 tip-content">
                                            <ul>
                                              <li><em>FinTech Startup:</em> "Small businesses struggle with slow, expensive international transactions. We provide an instant, low-cost payment solution that simplifies global trade."</li>
                                              <li><em>HealthTech:</em> "Millions lack access to early disease detection. We develop affordable AI-powered diagnostics to improve health outcomes."</li>
                                              <li><em>SaaS Solution:</em> "Teams waste hours on manual data entry. Our automation tool eliminates repetitive tasks, saving companies time and money."</li>
                                              <li><em>Consumer Goods:</em> "The fashion industry produces massive waste. We create stylish apparel from recycled materials to promote sustainability."</li>
                                            </ul>
                                          </div>
                                        `}
                                        >
                                          <img
                                            className="blackdark"
                                            width="15"
                                            height="15"
                                            src="/assets/user/images/question.png"
                                            alt="Tip"
                                          />
                                        </span>
                                        <Tooltip
                                          id="tt-cat-2"
                                          place="top"
                                          float
                                          interactive={true}
                                          className="custom-tooltip"
                                          positionStrategy="fixed"
                                        />
                                      </label>

                                      <Iconblock>
                                        <OctagonAlert />
                                        <textarea
                                          required
                                          id="problem"
                                          name="problemStep4"
                                          maxLength="400"
                                          onChange={handleproblemStep4}
                                          value={
                                            formData_Step4.problemStep4 || ""
                                          }
                                          placeholder="Max 400 characters..."
                                        />
                                      </Iconblock>
                                      <div className="char-count">
                                        {charCount_problemStep4}/400
                                      </div>
                                    </div>
                                  </div>

                                  {/* Solution */}
                                  <div className="col-12">
                                    <div className="d-flex flex-column gap-2">
                                      <label
                                        style={{
                                          fontWeight: "600",
                                          fontSize: "1rem",
                                        }}
                                      >
                                        What is Your Solution to the Problem?{" "}
                                        <Sup className="labelsize">*</Sup>
                                        <span
                                          className="tooltip-icon"
                                          data-tooltip-id="tt-cat-3"
                                          data-tooltip-html={`
                                              <div class="d-flex flex-column gap-1 tip-content">
                                                <ul>
                                                  <li><em>FinTech Startup:</em> "We provide a seamless, low-cost digital payment system that enables small businesses to send and receive international transactions instantly."</li>
                                                  <li><em>HealthTech:</em> "Our AI-powered diagnostics identify diseases at an early stage, making healthcare more accessible and reducing treatment costs."</li>
                                                  <li><em>SaaS Solution:</em> "We automate data entry and workflow processes, eliminating repetitive tasks so businesses can focus on growth."</li>
                                                  <li><em>Consumer Goods:</em> "We create high-quality, stylish apparel from recycled materials, reducing fashion waste and promoting sustainability."</li>
                                                </ul>
                                                <strong>Pro Tips</strong>
                                                <ul class="list-none">
                                                  <li>✔ Be direct — Explain exactly how your solution addresses the problem.</li>
                                                  <li>✔ Show innovation — Highlight what makes your approach unique.</li>
                                                  <li>✔ Make it investor-friendly — Demonstrate scalability and growth potential.</li>
                                                  <li>✔ Keep it concise — 1–2 sentences for a clear, impactful answer.</li>
                                                </ul>
                                              </div>
                                            `}
                                        >
                                          <img
                                            className="blackdark"
                                            width="15"
                                            height="15"
                                            src="/assets/user/images/question.png"
                                            alt="Tip"
                                          />
                                        </span>
                                        <Tooltip
                                          id="tt-cat-3"
                                          place="top"
                                          float
                                          interactive={true}
                                          className="custom-tooltip"
                                          positionStrategy="fixed"
                                        />
                                      </label>

                                      <Iconblock>
                                        <OctagonAlert />
                                        <textarea
                                          required
                                          id="solution"
                                          name="solutionStep4"
                                          maxLength="400"
                                          onChange={handlesolutionStep4}
                                          value={
                                            formData_Step4.solutionStep4 || ""
                                          }
                                          placeholder="Max 400 characters..."
                                        />
                                      </Iconblock>
                                      <div className="char-count">
                                        {charCount_solutionStep4}/400
                                      </div>
                                    </div>
                                  </div>

                                  <div className="col-12">
                                    <div className="d-flex justify-content-between mt-2">
                                      <div className="flex-shrink-0">
                                        <button
                                          type="button"
                                          className="sbtn backbtn"
                                          data-step="3"
                                          onClick={handlepreStep2}
                                        >
                                          Back
                                        </button>
                                      </div>
                                      <div className="flex-shrink-0">
                                        <button
                                          type="submit"
                                          className="sbtn nextbtn"
                                          data-step="4"
                                        >
                                          Next
                                        </button>
                                        {/* <button
                                          disabled={spinners}
                                          type="submit"
                                          className="sbtn nextbtn"
                                          data-step="3"
                                        >
                                          Submit
                                          {spinners && (
                                            <div
                                              className="spinner-border text-white spinneronetimepay mt-1"
                                              role="status"
                                            >
                                              <span className="visually-hidden"></span>
                                            </div>
                                          )}
                                        </button> */}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </Stepblock>
                          </form>
                        )}
                        {step4 && (
                          <form
                            action="javascript:void(0)"
                            method="post"
                            onSubmit={handleSubmitForm_Four}
                          >
                            <Stepblock id="step4">
                              <div className="d-flex flex-column gap-4">
                                <div className="d-flex flex-column gap-1 justify-content-start align-items-start">
                                  <Titletext1>Select Company</Titletext1>
                                  <Subtext>
                                    If you have multiple accounts, select one
                                    below or add a new company.
                                  </Subtext>
                                </div>
                                <div className="d-flex justify-content-end align-items-end">
                                  <button
                                    className="global_btn w-fit"

                                  // onClick={() => setstep4(true)}
                                  >
                                    + ADD A NEW COMPANY
                                  </button>
                                </div>

                                <div className="row gy-3">
                                  {companyList?.map((company, index) => (
                                    <button
                                      key={index}
                                      type="button"
                                      className="col-md-4 border-0"
                                      onClick={() => handleClick(company.color)}
                                    >
                                      <div
                                        className="card_deisgn_register"
                                        style={{
                                          borderColor: company.color || "#ccc",
                                          backgroundColor:
                                            `${company.color}50` || "#ffffff80",
                                        }}
                                      >
                                        <h5
                                          className="text-center"
                                          style={{
                                            backgroundColor:
                                              company.color || "#000",
                                            color: "#fff",
                                            padding: "10px 20px",
                                            borderRadius: "8px",
                                            fontSize: "1rem",
                                          }}
                                        >
                                          {company.name}
                                        </h5>
                                        <p
                                          className="py-3 text-center mb-0"
                                          style={{
                                            fontSize: "0.9rem",
                                            fontWeight: "600",
                                          }}
                                        >
                                          Access this account.
                                        </p>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </Stepblock>
                          </form>
                        )}
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
