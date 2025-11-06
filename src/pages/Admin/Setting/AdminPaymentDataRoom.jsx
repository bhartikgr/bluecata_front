import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
function AdminPaymentDataRoom() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const [spinners, setspinnsers] = useState(false);
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  useEffect(() => {
    document.title = "Amount Add DataRoom, Extra Due Diligence - Admin";
  }, []);
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [getDataroompay, setgetDataroompay] = useState("");
  useEffect(() => {
    getDataroompayment();
  }, []);
  const getDataroompayment = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getDataroompayment", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.row;
      console.log(respo);
      setgetDataroompay(respo[0]);
    } catch (err) {
      // Enhanced error handling
      if (err.response) {
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    let formData = {
      onetime_Fee: e.target.onetime_Fee.value,
      perInstance_Fee: e.target.perInstance_Fee.value,
      investorAnnual_Fee: "",
      academy_Fee: e.target.academy_Fee.value,
    };
    setspinnsers(true);
    try {
      const res = await axios.post(apiUrl + "dataroomPaymentadd", formData, {
        headers: {
          Accept: "application/json",
        },
      });
      var respo = res.data.message;
      setsuccessMessage(respo);
      setspinnsers(false);
    } catch (err) {
      // Enhanced error handling
      if (err.response) {
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
  };
  return (
    <div>
      <div className="d-flex align-items-start gap-0">
        <Sidebar />
        <div className="d-flex flex-column gap-0 w-100 dashboard_padding">
          <TopBar />
          <section className="dashboard_adminh">
            <div className="container-xl">
              <div className="row gy-4">
                <div className="col-12">
                  <div className="card p-4">
                    <h5 className="">Add Payment For</h5>
                    <h6 className="mb-4 fw-semibold">
                      (DataRoom Management & Diligence + Investor Reporting)
                    </h6>
                    {successMessage && (
                      <div className="pt-3 px-3">
                        <SuccessAlert
                          message={successMessage}
                          onClose={() => setsuccessMessage("")}
                        />
                      </div>
                    )}
                    <form
                      onSubmit={handleSubmit}
                      method="post"
                      className="d-flex flex-column gap-4 align-items-start"
                    >
                      {/* File Upload */}

                      {/* Max Limit */}

                      <div className="w-100">
                        <label
                          htmlFor="exampleInputLimit1"
                          className="form-label "
                        >
                          Fees (One Time){" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="number"
                          name="onetime_Fee"
                          required
                          min="1"
                          defaultValue={getDataroompay.onetime_Fee}
                          className="form-control"
                          id="exampleInputLimit1"
                        />
                      </div>
                      <div className="w-100">
                        <label
                          htmlFor="exampleInputLimit2"
                          className="form-label "
                        >
                          Fees (Per instance){" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="number"
                          name="perInstance_Fee"
                          required
                          defaultValue={getDataroompay.perInstance_Fee}
                          min="1"
                          className="form-control"
                          id="exampleInputLimit2"
                        />
                      </div>
                      {/* <h6 className="fw-semibold">(Plus Investor Reporting)</h6>

                      <div className="w-100">
                        <label
                          htmlFor="exampleInputLimit3"
                          className="form-label "
                        >
                          Annual Fees
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="number"
                          name="investorAnnual_Fee"
                          required
                          defaultValue={getDataroompay.investorAnnual_Fee}
                          min="1"
                          className="form-control"
                          id="exampleInputLimit3"
                        />
                      </div> */}
                      <h6 className="fw-semibold">(Academy)</h6>

                      <div className="w-100">
                        <label
                          htmlFor="exampleInputLimit3"
                          className="form-label "
                        >
                          Fees Academy (One Time)
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="number"
                          name="academy_Fee"
                          required
                          defaultValue={getDataroompay.academy_Fee}
                          min="1"
                          className="form-control"
                          id="exampleInputLimit3"
                        />
                      </div>
                      {/* Submit Button */}
                      <button
                        type="submit"
                        className="admin_btn ms-auto position-relative"
                      >
                        {spinners && (
                          <span
                            className="spinner-border spinner-border-sm  text-dark position-absolute"
                            style={{
                              top: "30%",
                              left: "40%",
                            }}
                            role="status"
                          >
                            <span className="visually-hidden"></span>
                          </span>
                        )}
                        Submit
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default AdminPaymentDataRoom;
