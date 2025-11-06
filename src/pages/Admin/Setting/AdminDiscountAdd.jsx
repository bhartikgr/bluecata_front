import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { Link } from "react-router-dom";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
function AdminDiscountAdd() {
  const navigate = useNavigate();
  const [editdata, seteditdata] = useState("");
  const [code, setCode] = useState(editdata?.name || "");
  const [successMessage, setsuccessMessage] = useState("");
  const { id } = useParams();
  const [selectedType, setSelectedTypes] = useState([]);
  useEffect(() => {
    document.title = "Add Coupon - Admin";
  }, []);
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [getDataroompay, setgetDataroompay] = useState(null);

  useEffect(() => {
    if (id) {
      geteditCodeData();
    }
  }, [id]);

  const geteditCodeData = async () => {
    if (id) {
      let formData = {
        id: id,
      };
      try {
        const res = await axios.post(apiUrl + "geteditCodeData", formData, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        });
        const data = res.data.results;
        console.log(data.type);
        const parsedType = Array.isArray(data.type)
          ? data.type
          : JSON.parse(data.type || "[]");

        setSelectedTypes(parsedType); // 👈 important fix

        seteditdata(data);
        setCode(data.code);
      } catch (err) {
        if (err.response) {
          console.error("Server error:", err.response.data);
        } else if (err.request) {
          console.error("No response received:", err.request);
        } else {
          console.error("Error message:", err.message);
        }
      }
    }
  };
  useEffect(() => {
    getmodule();
  }, []);
  const [modulelist, setmodulelist] = useState([]);
  const getmodule = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getmodulelist", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      setmodulelist(respo);
    } catch (err) {
      if (err.response) {
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
  };
  const handleCheckboxChange = (e) => {
    const { value, checked } = e.target;
    if (checked) {
      setSelectedTypes((prev) => [...prev, value]);
    } else {
      setSelectedTypes((prev) => prev.filter((type) => type !== value));
    }
  };

  // Define filtered data based on the search query
  const generateRandomCode = () => {
    const random = Math.random().toString(36).substring(2, 8).toUpperCase(); // e.g., "A3F9KQ"
    setCode(`${random}`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    let formData = {
      code: e.target.code.value,
      percentage: e.target.percentage.value,
      exp_date: e.target.exp_date.value,
      id: e.target.id.value,
      usage_limit: e.target.usage_limit.value,
      type: selectedType,
    };

    try {
      const res = await axios.post(apiUrl + "discountAddEdit", formData, {
        headers: {
          Accept: "application/json",
        },
      });
      var respo = res.data.results;
      setsuccessMessage(res.data.message);
      setTimeout(() => {
        navigate("/admin/setting/paymentdiscountlist");
      }, 1200);
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

  const getTomorrowDate = () => {
    const today = new Date();
    today.setDate(today.getDate() + 1); // Add 1 day for tomorrow
    return today.toISOString().split("T")[0]; // Format as 'YYYY-MM-DD'
  };
  const toInputDateFormat = (dateStr) => {
    if (!dateStr) return "";
    const local = new Date(dateStr);
    const offsetDate = new Date(
      local.getTime() - local.getTimezoneOffset() * 60000
    );
    return offsetDate.toISOString().split("T")[0];
  };
  console.log(id);
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
                    <div className="d-flex justify-content-between mb-3">
                      <h5 className="mb-3">
                        {id !== undefined ? "Edit" : "Add"} Coupon
                      </h5>
                    </div>
                    {successMessage && (
                      <div className="pt-3 px-3">
                        <SuccessAlert
                          message={successMessage}
                          onClose={() => setsuccessMessage("")}
                        />
                      </div>
                    )}
                    <form
                      action="javascript:void(0)"
                      onSubmit={handleSubmit}
                      method="post"
                      className="d-flex flex-column gap-4 align-items-start"
                    >
                      <input type="hidden" name="id" value={editdata.id} />
                      <div className="w-100">
                        <label
                          htmlFor="codeInput"
                          className="form-label text-dark"
                        >
                          Coupon Code{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>

                        <div className="input-group">
                          <input
                            type="text"
                            name="code"
                            required
                            disabled={!!id}
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="Enter or generate code"
                            className="form-control"
                            id="codeInput"
                          />
                          <button
                            disabled={!!id}
                            type="button"
                            onClick={generateRandomCode}
                            className="btn btn-outline-secondary"
                          >
                            Generate Coupon Code
                          </button>
                        </div>
                      </div>

                      <div className="w-100">
                        <label
                          htmlFor="codeInput"
                          className="form-label text-dark"
                        >
                          Discount %{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>

                        <div className="input-group">
                          <input
                            type="number"
                            name="percentage"
                            defaultValue={editdata.percentage}
                            required
                            maxLength="100"
                            min="1"
                            placeholder="10%"
                            className="form-control"
                            id="codeInput"
                          />
                        </div>
                      </div>

                      <div className="w-100">
                        <label
                          htmlFor="codeInputLimit"
                          className="form-label text-dark"
                        >
                          Use Limit{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>

                        <div className="input-group">
                          <input
                            type="number"
                            name="usage_limit"
                            defaultValue={editdata.usage_limit}
                            min="1"
                            required
                            placeholder="Enter here..."
                            className="form-control"
                            id="codeInputLimit"
                          />
                        </div>
                      </div>
                      <div className="w-100">
                        <label className="form-label text-lg font-semibold text-gray-800 mb-3 block">
                          Service Type <span className="text-red-500">*</span>
                        </label>

                        <div className="d-flex flex-column gap-1">
                          {[
                            {
                              id: "dataroom_plus",
                              label:
                                "Dataroom Management/Investor Report/Cap Table Management",
                              value: "Dataroom_Plus_Investor_Report",
                            },
                          ].map((item) => (
                            <div
                              key={item.id}
                              className="d-flex align-items-center gap-2 checkbox_design"
                            >
                              <input
                                type="checkbox"
                                id={item.id}
                                value={item.value}
                                checked={selectedType.includes(item.value)}
                                onChange={handleCheckboxChange}
                              />
                              <label
                                htmlFor={item.id}
                                className="form-check-label"
                              >
                                {item.label}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="w-100">
                        <label
                          htmlFor="codeInput"
                          className="form-label text-dark"
                        >
                          Expiry Date{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>

                        <div className="input-group">
                          <input
                            type="date"
                            name="exp_date"
                            defaultValue={toInputDateFormat(editdata.exp_date)}
                            min={getTomorrowDate()} // 🔒 only allow tomorrow and future
                            required
                            placeholder="Enter or generate code"
                            className="form-control"
                            id="codeInput"
                          />
                        </div>
                      </div>
                      <div className="ms-auto ">
                        <button type="submit" className="admin_btn">
                          Submit
                        </button>
                      </div>
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

export default AdminDiscountAdd;
