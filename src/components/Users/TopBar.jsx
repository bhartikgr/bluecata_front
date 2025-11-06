import React, { useState } from "react";
import { FiLogOut } from "react-icons/fi";
import { IoCloseCircleOutline } from "react-icons/io5";
import {
  Tophead,
  Slan,
  MenuButtonWrapper,
} from "../../components/Styles/MainHeadStyles";
import useSignatoryAuth from "../../hooks/useSignatoryAuth";
import { Menu } from "lucide-react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
function TopBar() {
  const navigate = useNavigate();
  var apiURLAiFile = "http://localhost:5000/api/user/aifile/";
  const [menuOpen, setMenuOpen] = useState(false);
  const [ShowPopupRole, setShowPopupRole] = useState(false);
  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };
  const userLoginCheck = useSignatoryAuth();

  // useEffect for redirect if not logged in
  React.useEffect(() => {
    if (!userLoginCheck) return; // wait until the hook finishes loading

    if (!userLoginCheck.role) {
      navigate("/signatory/login", { replace: true });
    }
  }, [userLoginCheck, navigate]);
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
    setShowPopupRole(false);
    setShowPopupRolePermission(false);
  };
  const [creditBalanceData, setcreditBalanceData] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const [CompanyRole, setCompanyRole] = useState(null);
  const [ShowPopupRolePermission, setShowPopupRolePermission] = useState(false);
  const handleClickbalance = async () => {
    const storedUsername = localStorage.getItem("SignatoryLoginData");
    const userLogin = JSON.parse(storedUsername);
    let formData = {
      company_id: userLogin.companies[0].id,
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
      console.log(res.data);
      setShowPopup(true);
      setcreditBalanceData(res.data);
    } catch (err) { }
  };
  const handleLogout = () => {
    localStorage.removeItem("SignatoryLoginData");
    window.location.href = "/signatory/login";
  };
  const handleClickRole = async () => {
    const storedUsername = localStorage.getItem("SignatoryLoginData");
    const userLogin = JSON.parse(storedUsername);
    let formData = {
      company_id: userLogin.companies[0].id,
      role_id: userLogin.id,
    };
    if (userLogin.role === "owner") {
      // setShowPopupRolePermission(true);
      //setCompanyRole("Company Owner");
    } else {
      try {
        const res = await axios.post(apiURLAiFile + "companyRole", formData, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        });

        setShowPopupRolePermission(true);
        if (res.data.results.length > 0) {
          setCompanyRole(res.data.results[0].signature_role);
        }
      } catch (err) { }
    }
  };
  const handleClickYourRolePermission = () => {
    const storedUsername = localStorage.getItem("SignatoryLoginData");
    const userLogin = JSON.parse(storedUsername);
    setShowPopupRole(true);
    if (userLogin.role === "owner") {
      setCompanyRole("Company Owner");
    } else {
      setCompanyRole(
        userLogin.role.charAt(0).toUpperCase() + userLogin.role.slice(1)
      );
    }
  };
  return (
    <div className="top_bar">
      <Tophead>
        <div className="container-fluid">
          <div className="d-flex gap-4 position-relative">
            <div className="d-flex align-items-center justify-content-between w-100 gap-3">
              {/* Left side buttons */}
              <div className="d-flex gap-2">
                <button
                  type="button"
                  onClick={handleClickbalance}
                  className="btn bg-dark text-white py-2 hoverbge creditb"
                >
                  Credit Balance
                </button>

                <button
                  type="button"
                  onClick={handleClickYourRolePermission}
                  className="btn bg-dark text-white py-2 hoverbge creditb"
                >
                  Your Role/Permissions
                </button>
              </div>

              {/* Right side logout */}
              <Link
                to="javascript:void(0)"
                onClick={handleLogout}
                title="Logout"
                className="logout_btn_global"
              >
                <FiLogOut />
              </Link>
            </div>
          </div>
        </div>
      </Tophead>
      {showPopup && creditBalanceData && (
        <div className="main_popup-overlay">
          <div className="popup-container" style={{ maxWidth: "400px" }}>
            <div className="d-flex align-items-center gap-3 mb-3 justify-content-between">
              <h2 className="popup-title">Subscription Status</h2>
              <button
                type="button"
                className="close_btn_global"
                onClick={handleClosepayPopup}
                aria-label="Close"
              >
                <IoCloseCircleOutline size={24} />
              </button>
            </div>

            {/* ✅ Status Badge based on type */}
            {creditBalanceData.type === 2 ? (
              // ❌ No Subscription - RED
              <div
                onClick={() => navigate("/package-subscription")}
                style={{
                  backgroundColor: "#dc3545",
                  color: "white",
                  padding: "20px",
                  borderRadius: "8px",
                  textAlign: "center",
                  fontWeight: "bold",
                  fontSize: "18px",
                  marginBottom: "15px",
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                  boxShadow: "0 2px 8px rgba(220, 53, 69, 0.3)",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = "#bd2130";
                  e.currentTarget.style.transform = "scale(1.02)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = "#dc3545";
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                <div>Please Activate Account</div>
                <small
                  style={{
                    fontSize: "14px",
                    opacity: "0.9",
                    marginTop: "8px",
                    display: "block",
                  }}
                >
                  Click here to subscribe
                </small>
              </div>
            ) : (
              // ✅ Active Subscription - GREEN
              <>
                <div
                  style={{
                    backgroundColor: "#28a745",
                    color: "white",
                    padding: "20px",
                    borderRadius: "8px",
                    textAlign: "center",
                    fontWeight: "bold",
                    fontSize: "18px",
                    marginBottom: "15px",
                  }}
                >
                  Active Subscription
                </div>

                {/* Subscription Details */}
                <ul className="popup-list">
                  <li>
                    Access to Dataroom + Investor reporting for 1 year (till{" "}
                    <strong>
                      {dateformate(creditBalanceData.valid_until)}
                    </strong>
                    )
                  </li>
                  <li>
                    Due diligence documents generated:{" "}
                    <strong>{creditBalanceData.total_generated}</strong> / 2
                    allowed
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
              </>
            )}
          </div>
        </div>
      )}
      {ShowPopupRole && (
        <div className="main_popup-overlay">
          <div className="popup-container">
            <div className="d-flex align-items-center gap-3  justify-content-between">
              <h2 className="popup-title">Your Role/Permission</h2>
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
                <Link onClick={handleClickRole} to="javascript:void(0)">
                  {CompanyRole}
                </Link>
              </li>
            </ul>
          </div>
        </div>
      )}
      {ShowPopupRolePermission && (
        <div className="main_popup-overlay">
          <div className="popup-container">
            <div className="d-flex align-items-center gap-3 justify-content-between">
              <h2 className="popup-title">Your Role</h2>
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
              <li onClick={handleClickRole}>{CompanyRole}</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default TopBar;
