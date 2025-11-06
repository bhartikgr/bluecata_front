import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import MainHeaderInvestor from "../../components/Investor/MainHeaderInvestor.js";
import ModuleSideNav from "../../components/Investor/ModuleSideNav";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  DataRoomSection,
  FormProfile,
} from "../../components/Styles/DataRoomStyle.js";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/MainHeadStyles.js";
import axios from "axios";
export default function Profile() {
  const navigate = useNavigate();
  const [records, setrecords] = useState("");
  var apiURL = "http://localhost:5000/api/user/investorreport/";
  const storedUsername = localStorage.getItem("InvestorData");
  const userLogin = JSON.parse(storedUsername);
  const [dangerMessage, setdangerMessage] = useState("");
  const [errr, seterrr] = useState(false);
  document.title = "Investor Profile";
  useEffect(() => {
    getinvestordetail();
  }, []);
  const getinvestordetail = async () => {
    const formData = {
      email: userLogin.email,
    };
    try {
      const res = await axios.post(apiURL + "getinvestorData", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      if (res.data.results.length > 0) {
        setrecords(res.data.results[0]);
      }
    } catch (err) {
      console.error("Error generating summary", err);
    }
    //  Optionally, call AI Summary API here
  };
  const handleSubmit = async (e) => {
    e.preventDefault();

    let formData = {
      first_name: e.target.first_name.value,
      last_name: e.target.last_name.value,
      phone: e.target.phone.value,
      city: e.target.city.value,
      email: userLogin.email,
    };

    try {
      const respo = await axios.post(`${apiURL}investordataUpdate`, formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setdangerMessage("Profile updated successfully");
      getinvestordetail();
      setTimeout(() => {
        setdangerMessage("");
      }, 2500);
    } catch (err) { }
  };
  //handle Share Report
  const [isCollapsed, setIsCollapsed] = useState(false);
  //handle Share Report
  return (
    <>
      <Wrapper>
        <div className="fullpage d-block">
          <MainHeaderInvestor />
          <SectionWrapper className="d-block py-5">
            <div className="container-fluid">
              <div className="row">
                <div className="col-md-3">
                  <ModuleSideNav
                    isCollapsed={isCollapsed}
                    setIsCollapsed={setIsCollapsed}
                  />
                </div>

                <div className="col-md-9">
                  {dangerMessage && (
                    <p
                      className={errr ? " mt-3 error_pop" : "success_pop mt-3"}
                    >
                      {dangerMessage}
                    </p>
                  )}
                  <DataRoomSection className="d-flex flex-column gap-4">
                    <div className="titleroom d-flex  justify-content-between align-items-center text-center">
                      <h4>Profile Settings</h4>
                    </div>
                    <FormProfile>
                      <form
                        method="post"
                        action="javascript:void(0)"
                        onSubmit={handleSubmit}
                      >
                        <div className="row gy-4">
                          {/* Name */}
                          <div className="col-md-6">
                            <div className="d-flex flex-column gap-1">
                              <label htmlFor="name">
                                First Name{" "}
                                <span className="text-danger fs-5">*</span>
                              </label>
                              <input
                                required
                                defaultValue={records.first_name}
                                type="text"
                                name="first_name"
                                id="name"
                                className="form-control"
                                placeholder="Enter your first name"
                              />
                            </div>
                          </div>
                          <div className="col-md-6">
                            <div className="d-flex flex-column gap-1">
                              <label htmlFor="name">
                                Last Name{" "}
                                <span className="text-danger fs-5">*</span>
                              </label>
                              <input
                                required
                                defaultValue={records.first_name}
                                type="text"
                                name="last_name"
                                id="name"
                                className="form-control"
                                placeholder="Enter your last name"
                              />
                            </div>
                          </div>

                          {/* Email */}
                          <div className="col-md-6">
                            <div className="d-flex flex-column gap-1">
                              <label htmlFor="email">
                                Email{" "}
                                <span className="text-danger fs-5">*</span>
                              </label>
                              <input
                                disabled
                                defaultValue={records.email}
                                type="email"
                                name="email"
                                id="email"
                                className="form-control"
                                placeholder="Enter your email"
                              />
                            </div>
                          </div>

                          {/* Phone */}
                          <div className="col-md-6">
                            <div className="d-flex flex-column gap-1">
                              <label htmlFor="phone">
                                Phone{" "}
                                <span className="text-danger fs-5">*</span>
                              </label>
                              <input
                                defaultValue={records.phone}
                                type="tel"
                                name="phone"
                                id="phone"
                                className="form-control"
                                placeholder="Enter phone number"
                              />
                            </div>
                          </div>

                          {/* LinkedIn Profile */}
                          <div className="col-md-6">
                            <div className="d-flex flex-column gap-1">
                              <label htmlFor="linkedin">
                                City <span className="text-danger fs-5">*</span>
                              </label>
                              <input
                                defaultValue={records.city}
                                type="text"
                                name="city"
                                id="linkedin"
                                className="form-control"
                                placeholder="Enter city"
                              />
                            </div>
                          </div>

                          {/* Save Button */}
                          <div className="col-12 text-end mt-3">
                            <button type="submit" className="">
                              Save Changes
                            </button>
                          </div>
                        </div>
                      </form>
                    </FormProfile>
                  </DataRoomSection>
                </div>
              </div>
            </div>
          </SectionWrapper>
        </div>
      </Wrapper>
    </>
  );
}
