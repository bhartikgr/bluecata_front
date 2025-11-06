import React, { useState } from "react";
import { Link } from "react-router-dom";
import { FiLogOut } from "react-icons/fi";
import { IoCloseCircleOutline } from "react-icons/io5";
import { Tophead, Slan } from "../../../components/Styles/MainHeadStyles";
import axios from "axios";

function TopBar() {
  var apiURL = "http://localhost:5000/api/user/";
  var apiURLAiFile = "http://localhost:5000/api/user/aifile/";
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };
  const dateformate = (date) => {
    const formattedDate = new Date(date).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return formattedDate;
  };
  const handleClosepayPopup = () => {
    setShowPopup(false);
  };
  const [creditBalanceData, setcreditBalanceData] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const handleClickbalance = async () => {
    const storedUsername = localStorage.getItem("CompanyLoginData");
    const userLogin = JSON.parse(storedUsername);
    let formData = {
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(
        apiURLAiFile + "checkcreditbalance",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setShowPopup(true);
      setcreditBalanceData(res.data);
    } catch (err) { }
  };
  const handleLogout = () => {
    localStorage.removeItem("OwnerLoginData");
    window.location.href = "/user/login";
  };
  return (
    <div className="top_bar">
      <Tophead>
        <div className="container-fluid">
          <div className="d-flex gap-4 position-relative">
            <Slan className="d-flex align-items-center justify-content-end gap-3 w-100">
              <Link
                to="javascript:void(0)"
                onClick={handleLogout}
                title="Logout"
                className="logout_btn_global"
              >
                <FiLogOut />
              </Link>
            </Slan>
          </div>
        </div>
      </Tophead>
      {showPopup && creditBalanceData && (
        <div className="main_popup-overlay">
          <div className="popup-container">
            <div className="d-flex align-items-center gap-3 mb-3 justify-content-between">
              <h2 className="popup-title">Credit Balance</h2>
              <button
                type="button"
                className="close_btn_global"
                onClick={handleClosepayPopup}
                aria-label="Close"
              >
                <IoCloseCircleOutline size={24} />
              </button>
            </div>

            <ul className="popup-list">
              <li>
                Access to Dataroom + Investor reporting for 1 year (till{" "}
                <strong>{dateformate(creditBalanceData.valid_until)}</strong>)
              </li>
              <li>
                Due diligence documents generated:{" "}
                <strong>{creditBalanceData.total_generated}</strong> / 1 allowed
              </li>
              <li>
                Credit Balance Left:{" "}
                <strong>{creditBalanceData.credit_balance}</strong>
              </li>
              {creditBalanceData.extra_generations > 0 && (
                <li className="warn">
                  <strong>
                    {creditBalanceData.extra_generations} additional
                    generation(s) will incur €100 each
                  </strong>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default TopBar;
