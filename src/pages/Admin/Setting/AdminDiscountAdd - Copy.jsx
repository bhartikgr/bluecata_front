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
  const [amount, setAmount] = useState(""); // This will be set via payment type
  const [discount, setDiscount] = useState("");
  const [finalAmount, setFinalAmount] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [paymentTypeShowhide, setpaymentTypeShowhide] = useState(false);
  useEffect(() => {
    document.title = "Amount Add DataRoom, Extra Due Diligence - Admin";
  }, []);
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [getDataroompay, setgetDataroompay] = useState(null);
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
  useEffect(() => {
    if (id && getDataroompay) {
      geteditCodeData();
    }
  }, [id, getDataroompay]);

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

        console.log("getDataroompay:", getDataroompay);
        seteditdata(data);
        setCode(data.code);
        setPaymentType(data.payment_type);
        setpaymentTypeShowhide(true);

        // Use a local variable to calculate amount before calling setState
        let selectedAmount = "";

        switch (data.payment_type) {
          case "Dataroom":
            selectedAmount = getDataroompay?.onetime_Fee || "";
            break;
          case "Extra_DD":
            selectedAmount = getDataroompay?.investorAnnual_Fee || "";
            break;
          case "Dataroom_per_instance":
            selectedAmount = getDataroompay?.perInstance_Fee || "";
            break;
          case "Academy":
            selectedAmount = getDataroompay?.academy_Fee || "";
            break;
          default:
            selectedAmount = "";
        }

        setAmount(selectedAmount); // update the UI
        setDiscount(data.percentage);

        // Calculate and set the final amount
        if (selectedAmount && data.percentage) {
          const discountValue = (selectedAmount * data.percentage) / 100;
          const final = selectedAmount - discountValue;
          setFinalAmount(final.toFixed(2));
        } else {
          setFinalAmount("");
        }
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
      payment_type: paymentType,
      exp_date: e.target.exp_date.value,
      usage_limit: e.target.usage_limit.value,
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
        window.location.reload();
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

  const handleDiscountChange = (e) => {
    const value = e.target.value;
    if (value > 100) {
      return;
    }
    setDiscount(value);

    // Calculate final amount only if valid amount & discount
    if (amount && value >= 0 && value <= 100) {
      const discountValue = (amount * value) / 100;
      setFinalAmount((amount - discountValue).toFixed(2));
    } else {
      setFinalAmount("");
    }
  };

  const handlePaymentTypeChange = (e) => {
    const selectedType = e.target.value;
    setPaymentType(selectedType);

    if (selectedType !== "") {
      setpaymentTypeShowhide(true);
    } else {
      setpaymentTypeShowhide(false);
    }

    // Use local variable instead of relying on old 'amount' state
    let selectedAmount = "";

    switch (selectedType) {
      case "Dataroom":
        selectedAmount = getDataroompay?.onetime_Fee || "";
        break;
      case "Extra_DD":
        selectedAmount = getDataroompay?.investorAnnual_Fee || "";
        break;
      case "Dataroom_per_instance":
        selectedAmount = getDataroompay?.perInstance_Fee || "";
        break;
      case "Academy":
        selectedAmount = getDataroompay?.academy_Fee || "";
        break;
      default:
        selectedAmount = "";
    }

    setAmount(selectedAmount); // update state with selected amount

    if (id) {
      const numm = Number(editdata.percentage);
      if (selectedAmount && numm >= 0 && numm <= 100) {
        const discountValue = (selectedAmount * numm) / 100;
        setFinalAmount((selectedAmount - discountValue).toFixed(2));
      } else {
        setFinalAmount("");
      }
    }
  };

  const getTomorrowDate = () => {
    const today = new Date();
    today.setDate(today.getDate() + 1); // Add 1 day for tomorrow
    return today.toISOString().split("T")[0]; // Format as 'YYYY-MM-DD'
  };

  return (
    <div>
      <div className="d-flex align-items-start gap-0">
        <Sidebar />
        <div className="d-flex flex-column gap-0 w-100">
          <TopBar />
          <section className="dashboard_adminh">
            <div className="container-xl">
              <div className="row gy-4">
                <div className="col-12">
                  <div className="card p-4">
                    <div className="d-flex justify-content-between mb-3">
                      <h5 className="mb-3">
                        {id !== "" ? "Edit" : "Add"} Code
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
                          Code{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>

                        <div className="input-group">
                          <input
                            type="text"
                            name="code"
                            required
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="Enter or generate code"
                            className="form-control"
                            id="codeInput"
                          />
                          <button
                            type="button"
                            onClick={generateRandomCode}
                            className="btn btn-outline-secondary"
                          >
                            Generate Code
                          </button>
                        </div>
                      </div>

                      <div className="w-100">
                        <label
                          htmlFor="codeInput"
                          className="form-label text-dark"
                        >
                          Payment Type{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>

                        <div className="input-group">
                          <select
                            required
                            className="form-control"
                            value={paymentType}
                            onChange={handlePaymentTypeChange}
                            name="payment_type"
                          >
                            <option value="">--Select--</option>
                            <option value="Dataroom">Dataroom</option>
                            <option value="Dataroom_per_instance">
                              Dataroom Per Instance
                            </option>
                            <option value="Extra_DD">Extra DD</option>
                            <option value="Academy">Academy</option>
                          </select>
                        </div>
                      </div>
                      {paymentTypeShowhide && (
                        <div className="w-100" disabled>
                          <label
                            htmlFor="codeInput"
                            className="form-label text-dark"
                          >
                            Actual Amount
                          </label>

                          <div className="input-group">
                            <input
                              type="number"
                              disabled
                              value={amount}
                              required
                              className="form-control"
                              id="codeInput"
                            />
                          </div>
                          {finalAmount && <span> Amount: {finalAmount}</span>}
                        </div>
                      )}
                      {paymentTypeShowhide && (
                        <div className="w-100">
                          <label
                            htmlFor="codeInput"
                            className="form-label text-dark"
                          >
                            Discount{" "}
                            <span style={{ color: "var(--primary)" }}>*</span>
                          </label>

                          <div className="input-group">
                            <input
                              type="number"
                              name="percentage"
                              value={discount}
                              onChange={handleDiscountChange}
                              required
                              maxLength="100"
                              min="1"
                              placeholder="Enter discount here %"
                              className="form-control"
                              id="codeInput"
                            />
                          </div>
                        </div>
                      )}
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
                            value={editdata.usage_limit}
                            min="1"
                            required
                            placeholder="Enter here..."
                            className="form-control"
                            id="codeInputLimit"
                          />
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
                            value={
                              editdata.exp_date
                                ? editdata.exp_date.slice(0, 10)
                                : ""
                            }
                            min={getTomorrowDate()} // 🔒 only allow tomorrow and future
                            required
                            placeholder="Enter or generate code"
                            className="form-control"
                            id="codeInput"
                          />
                        </div>
                      </div>
                      <div className="d-grid">
                        <button type="submit" className="btn btn-primary">
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
