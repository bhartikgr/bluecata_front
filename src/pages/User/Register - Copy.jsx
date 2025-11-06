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
  UserCog,
  Mail,
  Linkedin,
  MessageCircle,
  Phone,
  MapPin,
  Building,
  Building2,
  Clipboard,
  Users,
  ArrowLeft,
  ArrowRight,
  Clock,
  Video,
  Calendar,
  AlertCircle,
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
  const [step2, setstep2] = useState(false);
  const [step3, setstep3] = useState(false);
  const [step4, setstep4] = useState(false);
  const [step5, setstep5] = useState(false);
  const [step6, setstep6] = useState(false);
  const [step7, setstep7] = useState(false);
  const [step8, setstep8] = useState(false);
  const [phone, setPhone] = useState("");
  const [States, setStates] = useState([]);
  const [selectedState, setSelectedState] = useState("");
  const [step2Countrycode, setstep2Countrycode] = useState("");
  const companyWebsiteRef = useRef(null);
  const [charCount_step3, setCharCount_step3] = useState(0);
  const [charCount_Briefstep3, setcharCount_Briefstep3] = useState(0);
  const [charCount_Problemstep3, setcharCount_Problemstep3] = useState(0);
  const [charCount_Solutionstep3, setcharCount_Solutionstep3] = useState(0);
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
  const handleSubmitForm_Three = (e) => {
    e.preventDefault();

    setstep4(true);
    setstep3(false);
  };
  const handleHeadlineChange = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData_Step3((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setCharCount_step3(valuee.length); // Update character count
  };
  const handleBriefChange = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData_Step3((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setcharCount_Briefstep3(valuee.length); // Update character count
  };
  const handleProblemChange = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData_Step3((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setcharCount_Problemstep3(valuee.length); // Update character count
  };
  const handleSolutionvalueChange = (e) => {
    const valuee = e.target.value;
    const { name, value } = e.target;
    setFormData_Step3((prevData) => ({
      ...prevData,
      [name]: value, // Update the value for 'headline'
    }));
    setcharCount_Solutionstep3(valuee.length); // Update character count
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
                        {step1 && (
                          <form
                            action="javascript:void(0)"
                            method="post"
                            onSubmit={handleSubmit}
                          >
                            <Stepblock id="step1">
                              <div className="d-flex flex-column gap-4">
                                <div className="d-flex flex-column gap-1 justify-content-start align-items-start">
                                  <Titletext1>
                                    Signatory contact info
                                  </Titletext1>
                                </div>
                                <div className="row gy-3">
                                  <div className="col-md-6">
                                    <div className="d-flex flex-column gap-2">
                                      <label className="mainp" htmlFor="">
                                        First Name{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <Iconblock>
                                        <User />
                                        <input
                                          value={formData.first_name}
                                          onChange={handleChange}
                                          type="text"
                                          name="first_name"
                                          required
                                          placeholder=""
                                        />
                                      </Iconblock>
                                    </div>
                                  </div>
                                  <div className="col-md-6">
                                    <div className="d-flex flex-column gap-2">
                                      <label className="mainp" htmlFor="">
                                        Last Name{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <Iconblock>
                                        <User />
                                        <input
                                          value={formData.last_name}
                                          onChange={handleChange}
                                          type="text"
                                          name="last_name"
                                          required
                                          placeholder=""
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
                                        LinkedIn Profile
                                      </label>
                                      <Iconblock>
                                        <Linkedin />
                                        <input
                                          value={formData.linked_in}
                                          onChange={handleChange}
                                          type="text"
                                          name="linked_in"
                                          placeholder=""
                                        />
                                      </Iconblock>
                                    </div>
                                  </div>
                                  {/* <div className="col-md-6">
                            <div className="d-flex flex-column gap-2">
                              <label htmlFor="">Maimai (脉脉)</label>
                              <Iconblock>
                                <Link />
                                <input
                                  value={formData.maimai}
                                  onChange={handleChange}
                                  type="text"
                                  name="maimai"
                                  placeholder=""
                                />
                              </Iconblock>
                            </div>
                          </div> */}

                                  {/* <div className="col-md-6">
                            <div className="d-flex flex-column gap-2">
                              <label htmlFor="">WeChat (微信)</label>
                              <Iconblock>
                                <MessageCircle />
                                <input
                                  value={formData.wechat}
                                  onChange={handleChange}
                                  type="text"
                                  name="wechat"
                                  placeholder=""
                                />
                              </Iconblock>
                            </div>
                          </div> */}

                                  {/* <div className="col-md-6">
                            <div className="d-flex flex-column gap-2">
                              <label htmlFor="">BOSS Zhipin (BOSS直聘)</label>
                              <Iconblock>
                                <Link />
                                <input
                                  value={formData.boss_zhipin}
                                  onChange={handleChange}
                                  type="text"
                                  name="boss_zhipin"
                                  placeholder=""
                                />
                              </Iconblock>
                            </div>
                          </div> */}

                                  <div className="col-md-6">
                                    <div className="d-flex flex-column gap-2">
                                      <label className="mainp" htmlFor="">
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
                                  {/* <div className="col-md-12">
                                    <div className="d-flex flex-column gap-2">
                                      <label className="mainp" htmlFor="">
                                        Role / Position at the company
                                      </label>
                                      <Iconblock>
                                        <UserCog />
                                        <input
                                          value={formData.role}
                                          onChange={handleChange}
                                          type="text"
                                          name="role"
                                          placeholder=""
                                        />
                                      </Iconblock>
                                    </div>
                                  </div> */}

                                  {/* <div className="col-md-6">
                            <div className="d-flex flex-column gap-2">
                              <label htmlFor="">Area/City code</label>
                              <Iconblock>
                                <MapPin />
                                <input
                                  type="text"
                                  name="area"
                                  value={formData.area}
                                  onChange={handleChange}
                                />
                              </Iconblock>
                            </div>
                          </div> */}

                                  <div className="col-12">
                                    <div className="d-flex justify-content-end mt-2">
                                      <div className="flex-shrink-0">
                                        <button
                                          type="submit"
                                          className="sbtn nextbtn"
                                          data-step="1"
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
                        {!step2 && (
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
                                  {/* <div className="col-md-6">
                            <div className="d-flex flex-column gap-2">
                              <label htmlFor="">
                                Country <Sup className="labelsize">*</Sup>
                              </label>
                              <Iconblock>
                                <Globe strokeWidth={1.5} />
                                <select
                                  required
                                  name="country"
                                  onChange={handleStep2CountryChange}
                                  value={formData_Step2.country}
                                  placeholder="Select a country"
                                  className="form-select" // Add Bootstrap class or custom styling
                                >
                                  <option value="">
                                    Select or type a country
                                  </option>
                                  {countryOptionsFormatted.map((option) => (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </Iconblock>
                            </div>
                          </div> */}

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
                                  {/* <div className="col-md-6">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        Company LinkedIn Profile
                                      </label>
                                      <Iconblock>
                                        <Linkedin />
                                        <input
                                          defaultValue={
                                            formData_Step2.company_linkedin
                                          }
                                          onChange={handleChange}
                                          type="text"
                                          name="company_linkedin"
                                          placeholder=""
                                        />
                                      </Iconblock>
                                    </div>
                                  </div> */}
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

                                  <div className="col-md-6">
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
                                  <div className="col-md-12 mt-5">
                                    <div className="d-flex flex-column gap-2">
                                      <label htmlFor="">
                                        <h4>Signatories for the Company</h4>
                                      </label>
                                    </div>
                                  </div>
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
                                      <div className="flex-shrink-0">
                                        <button
                                          type="button"
                                          className="sbtn backbtn"
                                          data-step="2"
                                          onClick={handlepreStep1}
                                        >
                                          Back
                                        </button>
                                      </div>
                                      <div className="flex-shrink-0">
                                        <button
                                          type="submit"
                                          className="sbtn nextbtn"
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
                        {!step3 && (
                          <form
                            action="javascript:void(0)"
                            method="post"
                            onSubmit={handleSubmitForm_Four}
                          >
                            <Stepblock id="step3">
                              <div className="d-flex flex-column gap-4">
                                <div className="d-flex flex-column gap-1 justify-content-start align-items-start">
                                  <Titletext1>Company status</Titletext1>
                                  <Subtext>
                                    Please Enter your company status.
                                  </Subtext>
                                </div>
                                <div className="row gy-3">
                                  <div className="col-12">
                                    <label
                                      style={{
                                        fontWeight: "500",
                                        fontSize: "1rem",
                                      }}
                                      htmlFor=""
                                    >
                                      Sector (pull-down menu CHECK OUR DEALUM
                                      PLATFORM)
                                    </label>
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
                                        What is your company's current stage?{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <RadioGroup id="companyStage">
                                        <RadioOption>
                                          <input
                                            type="radio"
                                            name="stage_step3"
                                            checked={
                                              formData_Step3.stage_step3 ===
                                              "company_current_seed"
                                            }
                                            required // Mark as required
                                            value="company_current_seed"
                                            id="concept"
                                            onChange={handleChange}
                                          />
                                          <label htmlFor="concept">
                                            <b>Concept Stage:</b> Defining the
                                            business idea and identifying a
                                            problem to solve
                                          </label>
                                        </RadioOption>
                                        <RadioOption>
                                          <input
                                            type="radio"
                                            checked={
                                              formData_Step3.stage_step3 ===
                                              "company_current_PreSeed"
                                            }
                                            name="stage_step3"
                                            value="company_current_PreSeed"
                                            id="planning5"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="planning5">
                                            <b>Pre-Seed Stage:</b> Validating
                                            the idea, conducting market
                                            research, and assembling a core
                                            team.
                                          </label>
                                        </RadioOption>
                                        <RadioOption>
                                          <input
                                            checked={
                                              formData_Step3.stage_step3 ===
                                              "company_current_seedstage"
                                            }
                                            type="radio"
                                            name="stage_step3"
                                            value="company_current_seedstage"
                                            id="execution4"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="execution4">
                                            <b>Seed Stage:</b> Securing initial
                                            funding, refining its business
                                            model, and beginning early
                                            commercialization.
                                          </label>
                                        </RadioOption>
                                        <RadioOption>
                                          <input
                                            checked={
                                              formData_Step3.stage_step3 ===
                                              "company_current_earlystage"
                                            }
                                            type="radio"
                                            name="stage_step3"
                                            value="company_current_earlystage"
                                            id="execution3"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="execution3">
                                            <b>Early Stage:</b> Focusing on
                                            product development, market
                                            validation, and acquiring initial
                                            customers.
                                          </label>
                                        </RadioOption>
                                        <RadioOption>
                                          <input
                                            checked={
                                              formData_Step3.stage_step3 ===
                                              "company_current_growthstage"
                                            }
                                            type="radio"
                                            name="stage_step3"
                                            value="company_current_growthstage"
                                            id="execution2"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="execution2">
                                            <b>Growth Stage:</b> Scaling
                                            operations, optimizing processes,
                                            and expanding the customer base.
                                          </label>
                                        </RadioOption>
                                        <RadioOption>
                                          <input
                                            checked={
                                              formData_Step3.stage_step3 ===
                                              "company_current_expansionthstage"
                                            }
                                            type="radio"
                                            name="stage_step3"
                                            value="company_current_expansionthstage"
                                            id="execution1"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="execution1">
                                            <b>Expansion Stage:</b> Entering new
                                            markets, diversifying offerings, and
                                            increasing revenue streams.
                                          </label>
                                        </RadioOption>
                                        <RadioOption>
                                          <input
                                            checked={
                                              formData_Step3.stage_step3 ===
                                              "company_current_exitthstage"
                                            }
                                            type="radio"
                                            name="stage_step3"
                                            value="company_current_exitthstage"
                                            id="exit"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="exit">
                                            <b>Exit Stage: </b> Preparing for
                                            acquisition, IPO, or other forms of
                                            exit strategy.
                                          </label>
                                        </RadioOption>
                                      </RadioGroup>
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
                                        How would you define the company's
                                        status, if generating revenue?”{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <RadioGroup id="companygross">
                                        <RadioOption>
                                          <input
                                            checked={
                                              formData_Step3.gross_revenue ===
                                              "gross_revenue_market_notinmarket"
                                            }
                                            type="radio"
                                            name="gross_revenue"
                                            value="gross_revenue_market_notinmarket"
                                            id="market-validationid"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="market-validationid">
                                            Not in-market (Not generating
                                            revenues)
                                          </label>
                                        </RadioOption>

                                        <RadioOption>
                                          <input
                                            checked={
                                              formData_Step3.gross_revenue ===
                                              "gross_revenue_market"
                                            }
                                            type="radio"
                                            name="gross_revenue"
                                            value="gross_revenue_market"
                                            id="market-validation"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="market-validation">
                                            Market validation (at least one
                                            paying customer)
                                          </label>
                                        </RadioOption>
                                        <RadioOption>
                                          <input
                                            checked={
                                              formData_Step3.gross_revenue ===
                                              "gross_revenue_Inmarket"
                                            }
                                            type="radio"
                                            name="gross_revenue"
                                            value="gross_revenue_Inmarket"
                                            id="in-market"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="in-market">
                                            In-market (more than one paying
                                            customer)
                                          </label>
                                        </RadioOption>
                                        <RadioOption>
                                          <input
                                            checked={
                                              formData_Step3.gross_revenue ===
                                              "gross_revenue_small"
                                            }
                                            type="radio"
                                            name="gross_revenue"
                                            value="gross_revenue_small"
                                            id="small-scale"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="small-scale">
                                            Small Scale (regional, national
                                            paying customers)
                                          </label>
                                        </RadioOption>
                                        <RadioOption>
                                          <input
                                            type="radio"
                                            checked={
                                              formData_Step3.gross_revenue ===
                                              "gross_revenue_large"
                                            }
                                            name="gross_revenue"
                                            value="gross_revenue_large"
                                            id="large-scale"
                                            onChange={handleChange}
                                            required // Mark as required
                                          />
                                          <label htmlFor="large-scale">
                                            Large Scale (includes international
                                            customers)
                                          </label>
                                        </RadioOption>
                                      </RadioGroup>
                                    </div>
                                  </div>
                                  <div className="col-12">
                                    <div className="d-flex flex-column gap-2 mt-3">
                                      <label
                                        style={{
                                          fontWeight: "600",
                                          fontSize: "1rem",
                                        }}
                                        htmlFor=""
                                      >
                                        One-sentence headliner about the company{" "}
                                        <Sup className="labelsize">*</Sup>
                                      </label>
                                      <Iconblock>
                                        <Building />
                                        <textarea
                                          id="headline"
                                          required
                                          name="headline"
                                          onChange={handleHeadlineChange}
                                          maxLength="240"
                                          placeholder="Max 240 characters..."
                                        >
                                          {formData_Step3.headline || ""}
                                        </textarea>
                                      </Iconblock>
                                      <div className="char-count">
                                        {charCount_step3}/240
                                      </div>
                                    </div>
                                  </div>

                                  <div className="col-12">
                                    <div className="d-flex flex-column gap-2">
                                      <label
                                        style={{
                                          fontWeight: "600",
                                          fontSize: "1rem",
                                        }}
                                        htmlFor=""
                                      >
                                        About your company in one sentence{" "}
                                        <Sup className="labelsize">*</Sup>
                                        <span
                                          className="tooltip-icon"
                                          tabIndex={0}
                                          aria-describedby="tooltip1"
                                        >
                                          <img
                                            className="blackdark"
                                            width="20"
                                            height="20"
                                            src="/assets/user/images/question.png"
                                            alt="Tip Image"
                                          />
                                          <div className="tooltip-text">
                                            <ul>
                                              <li>
                                                <em>FinTech Startup:</em> "We
                                                simplify international payments
                                                for small businesses with an
                                                instant, low-cost digital
                                                solution."
                                              </li>
                                              <li>
                                                <em>HealthTech:</em> "Our
                                                AI-powered diagnostics make
                                                early disease detection
                                                accessible and affordable for
                                                underserved communities."
                                              </li>
                                              <li>
                                                <em>SaaS Solution:</em> "We help
                                                businesses automate repetitive
                                                tasks, boosting productivity and
                                                reducing operational costs."
                                              </li>
                                              <li>
                                                <em>Consumer Goods:</em> "We
                                                create stylish, eco-friendly
                                                clothing from recycled
                                                materials, redefining
                                                sustainable fashion."
                                              </li>
                                            </ul>
                                            <strong>Pro Tips</strong>
                                            <ul>
                                              <li>
                                                ✔ Keep it concise—Aim for 1-2
                                                sentences.
                                              </li>
                                              <li>
                                                ✔ Highlight your unique
                                                value—What makes your company
                                                different?
                                              </li>
                                              <li>
                                                ✔ Use clear, compelling
                                                language—Avoid jargon; keep it
                                                simple.
                                              </li>
                                              <li>
                                                ✔ Focus on impact—How does your
                                                product/service solve a key
                                                problem?
                                              </li>
                                            </ul>
                                          </div>
                                        </span>
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
                                        ></textarea>
                                      </Iconblock>
                                      <div className="char-count">
                                        {charCount_descriptionStep4}/800
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-12">
                                    <div className="d-flex flex-column gap-2">
                                      <label
                                        style={{
                                          fontWeight: "600",
                                          fontSize: "1rem",
                                        }}
                                        htmlFor=""
                                      >
                                        What problem are you solving?{" "}
                                        <Sup className="labelsize">*</Sup>
                                        <span
                                          className="tooltip-icon"
                                          tabIndex={0}
                                          aria-describedby="tooltip1"
                                        >
                                          <img
                                            className="blackdark"
                                            width="20"
                                            height="20"
                                            src="/assets/user/images/question.png"
                                            alt="Tip Image"
                                          />
                                          <div
                                            className="tooltip-text"
                                            id="tooltip1"
                                            role="tooltip"
                                          >
                                            <ul>
                                              <li>
                                                <em>FinTech Startup:</em> "Small
                                                businesses struggle with slow,
                                                expensive international
                                                transactions. We provide an
                                                instant, low-cost payment
                                                solution that simplifies global
                                                trade."
                                              </li>
                                              <li>
                                                <em>HealthTech:</em> "Millions
                                                lack access to early disease
                                                detection. We develop affordable
                                                AI-powered diagnostics to
                                                improve health outcomes."
                                              </li>
                                              <li>
                                                <em>SaaS Solution:</em> "Teams
                                                waste hours on manual data
                                                entry. Our automation tool
                                                eliminates repetitive tasks,
                                                saving companies time and
                                                money."
                                              </li>
                                              <li>
                                                <em>Consumer Goods:</em> "The
                                                fashion industry produces
                                                massive waste. We create stylish
                                                apparel from recycled materials
                                                to promote sustainability."
                                              </li>
                                            </ul>
                                          </div>
                                        </span>
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
                                        ></textarea>
                                      </Iconblock>
                                      <div className="char-count">
                                        {charCount_problemStep4}/400
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-12">
                                    <div className="d-flex flex-column gap-2">
                                      <label
                                        style={{
                                          fontWeight: "600",
                                          fontSize: "1rem",
                                        }}
                                        htmlFor=""
                                      >
                                        What is Your Solution to the Problem?{" "}
                                        <Sup className="labelsize">*</Sup>
                                        <span
                                          className="tooltip-icon"
                                          tabIndex={0}
                                          aria-describedby="tooltip1"
                                        >
                                          <img
                                            className="blackdark"
                                            width="20"
                                            height="20"
                                            src="/assets/user/images/question.png"
                                            alt="Tip Image"
                                          />
                                          <div
                                            className="tooltip-text"
                                            id="tooltip1"
                                            role="tooltip"
                                          >
                                            <strong>
                                              Some examples of descriptions:
                                            </strong>
                                            <ul>
                                              <li>
                                                <em>FinTech Startup:</em> "We
                                                provide a seamless, low-cost
                                                digital payment system that
                                                enables small businesses to send
                                                and receive international
                                                transactions instantly."
                                              </li>
                                              <li>
                                                <em>HealthTech:</em> "Our
                                                AI-powered diagnostics identify
                                                diseases at an early stage,
                                                making healthcare more
                                                accessible and reducing
                                                treatment costs."
                                              </li>
                                              <li>
                                                <em>SaaS Solution:</em> "We
                                                automate data entry and workflow
                                                processes, eliminating
                                                repetitive tasks so businesses
                                                can focus on growth."
                                              </li>
                                              <li>
                                                <em>Consumer Goods:</em> "We
                                                create high-quality, stylish
                                                apparel from recycled materials,
                                                reducing fashion waste and
                                                promoting sustainability."
                                              </li>
                                            </ul>
                                            <strong>Pro Tips</strong>
                                            <ul>
                                              <li>
                                                ✔ Be direct—Explain exactly how
                                                your solution addresses the
                                                problem.
                                              </li>
                                              <li>
                                                ✔ Show innovation—Highlight what
                                                makes your approach unique.
                                              </li>
                                              <li>
                                                ✔ Make it
                                                investor-friendly—Demonstrate
                                                scalability and growth
                                                potential.
                                              </li>
                                              <li>
                                                ✔ Keep it concise—1-2 sentences
                                                for a clear, impactful answer.
                                              </li>
                                            </ul>
                                          </div>
                                        </span>
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
                                        ></textarea>
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
          {/* <div className="col-md-6 d-md-block d-none h-100">
            <Slider {...settings}>
              <div className="login_right">
                <img
                  className="inverted w-100 h-100 object-center  object-fit-cover"
                  src={require("../../assets/images/login.jpg")}
                  alt="login_page"
                />
              </div>
              <div className="login_right">
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
              </div>
            </Slider>
          </div> */}
        </div>
      </div>
    </>
  );
}
