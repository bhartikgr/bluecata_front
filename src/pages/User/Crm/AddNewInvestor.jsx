import React, { useState, useEffect } from "react";

import ModuleSideNav from "../../../components/Users/ModuleSideNav.jsx";
import TopBar from "../../../components/Users/TopBar";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../../components/Styles/MainHeadStyles.js";
import { DataRoomSection } from "../../../components/Styles/DataRoomStyle.js";
import { BackButton } from "../../../components/Styles/GlobalStyles.js";
import { ArrowLeft } from "lucide-react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
export default function AddNewInvestor() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState();
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [spinners, setspinnsers] = useState(false);
  const [message, setmessage] = useState("");
  const [errr, seterrr] = useState(false);
  const [editInvestor, seteditInvestor] = useState("");
  const { id } = useParams();
  const [investortype, setinvestortype] = useState("");
  const [ClientIP, setClientIP] = useState("");
  var apiURL = "http://localhost:5000/api/user/investor/";
  document.title = "Investor Report Form";
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };
  useEffect(() => {
    if (id) {
      getInvestoreditlist();
    }
  }, []);
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
  const getInvestoreditlist = async () => {
    const formData = {
      company_id: userLogin.companies[0].id,
      id: id,
    };
    try {
      const generateRes = await axios.post(
        apiURL + "getInvestoreditlist",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      if (generateRes.data.results.length > 0) {
        setinvestortype(generateRes.data.results[0].investorType);
        seteditInvestor(generateRes.data.results[0]);
      } else {
        navigate("/crm/investor-directory");
      }
    } catch (err) {
      console.error("Error generating summary", err);
    }
    //  Optionally, call AI Summary API here
  };
  const handleSubmit = async (e) => {
    e.preventDefault();

    const formData = {
      email: e.target["email"].value,
      first_name: e.target["first_name"].value,
      last_name: e.target["last_name"].value,
      company_id: userLogin.companies[0].id,
      created_by_id: userLogin.id,
      created_by_role: userLogin.role,
      id: editInvestor.id,
      ip_address: ClientIP,
    };
    try {
      const generateRes = await axios.post(
        apiURL + "Addnewinvenstor",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setspinnsers(false);
      seterrr(false);
      var dataa = generateRes.data;
      if (dataa.status === 2) {
        seterrr(true);
        setmessage(dataa.message);
      } else {
        setmessage(dataa.message);
        setTimeout(() => {
          navigate("/crm/investor-directory");
        }, 2500);
      }
      setTimeout(() => {
        setmessage("");
      }, 2500);
    } catch (err) {
      console.error("Error generating summary", err);
    }
    //  Optionally, call AI Summary API here
    //generateExecutiveSummary(formData);
  };
  const handleBackClick = () => {
    navigate("/crm/investor-directory");
  };
  const handletype = (e) => {
    setinvestortype(e.target.value);
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
                {message && (
                  <p className={errr ? " mt-3 error_pop" : "success_pop mt-3"}>
                    {message}
                  </p>
                )}
                <div className="container-fluid">
                  <DataRoomSection className="d-flex flex-column gap-2">
                    <div className="titleroom d-flex justify-content-between align-items-center border-bottom pb-3">
                      <BackButton
                        type="button"
                        className="backbtn"
                        onClick={handleBackClick}
                      >
                        <ArrowLeft size={16} className="me-1" /> back
                      </BackButton>
                      <h4>
                        {editInvestor && editInvestor.id
                          ? "Edit Investor"
                          : "Add Investor"}
                      </h4>
                    </div>

                    <form onSubmit={handleSubmit}>
                      <div className="formlist">
                        <div className="row">
                          {/* Email */}
                          <div className="col-6">
                            <label className="d-block mt-3">
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h5>
                                  Email{" "}
                                  <span style={{ color: "var(--primary)" }}>
                                    *
                                  </span>
                                </h5>
                              </div>
                              <input
                                className="form-control"
                                type="email"
                                name="email"
                                id="email"
                                placeholder="Enter your email..."
                                defaultValue={editInvestor.email || ""}
                                onChange={handleChange}
                                required
                                disabled={!!editInvestor.email} // disabled if email exists
                              />
                            </label>
                          </div>

                          {/* Investor Type */}
                          <div className="col-6">
                            <label className="d-block mt-3">
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h5>
                                  First Name{" "}
                                  <span style={{ color: "var(--primary)" }}>
                                    *
                                  </span>
                                </h5>
                              </div>
                              <input
                                className="form-control"
                                onChange={handleChange}
                                type="text"
                                defaultValue={editInvestor.first_name}
                                name="first_name"
                                placeholder="Enter here..."
                                id="first_name"
                                required
                              />
                            </label>
                          </div>
                          <div className="col-6">
                            <label className="d-block mt-3">
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h5>
                                  Last Name{" "}
                                  <span style={{ color: "var(--primary)" }}>
                                    *
                                  </span>
                                </h5>
                              </div>
                              <input
                                className="form-control"
                                onChange={handleChange}
                                type="text"
                                defaultValue={editInvestor.last_name}
                                name="last_name"
                                placeholder="Enter here..."
                                id="last_name"
                                required
                              />
                            </label>
                          </div>
                        </div>

                        {/* Submit + Spinner + Message */}
                        <div className="d-flex justify-content-start align-items-center mt-3">
                          <input
                            type="submit"
                            disabled={spinners}
                            className="global_btn ms-auto w-fit"
                            value="Submit"
                            style={{ opacity: spinners ? 0.6 : 1 }}
                          />
                          {spinners && (
                            <div
                              className="spinner-border text-light ms-2"
                              role="status"
                              style={{ width: "1.5rem", height: "1.5rem" }}
                            >
                              <span className="visually-hidden">
                                Loading...
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </form>
                  </DataRoomSection>
                </div>
              </SectionWrapper>
            </div>
          </div>
        </div>
      </Wrapper>
    </>
  );
}
