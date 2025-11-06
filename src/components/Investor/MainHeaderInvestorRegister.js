import { useEffect, useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import { Link } from "react-router-dom";

import {
  Tophead,
  Slan,
  MenuButtonWrapper,
} from "../../components/Styles/MainHeadStyles";
import { useNavigate, useParams } from "react-router-dom";
import { Globe, Menu } from "lucide-react";
import axios from "axios";
export default function MainHeaderInvestorRegister() {
  const [userdataa, setuserdataa] = useState("");
  const code = useParams();
  const navigate = useNavigate();
  const [getdatamodule, setgetdatamodule] = useState([]);
  var apiURL = "http://localhost:5000/api/user/";
  var apiURLINFile = "http://localhost:5000/api/user/investorreport/";
  const [InvestorData, setInvestorData] = useState("");

  useEffect(() => {
    checkinvestorCode();
  }, []);

  const checkinvestorCode = async () => {
    let formData = {
      code: code,
    };

    try {
      const res = await axios.post(
        apiURLINFile + "checkinvestorCode",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      if (res.data.results.length === 0) {
      } else {
        setInvestorData(res.data.results[0]);
      }
    } catch (err) {}
  };
  useEffect(() => {
    getModules();
  }, []);

  const getModules = async () => {
    let formData = {
      id: "",
    };
    try {
      const res = await axios.post(apiURL + "getModules", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setgetdatamodule(res.data.results);
    } catch (err) {}
  };
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };
  const [creditBalanceData, setcreditBalanceData] = useState("");
  const [showPopup, setShowPopup] = useState(false);

  const handleClosepayPopup = () => {
    setShowPopup(false);
  };
  const dateformate = (date) => {
    const formattedDate = new Date(date).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return formattedDate;
  };

  return (
    <>
      <Tophead>
        <div className="container-fluid">
          <div className="d-flex gap-4 position-relative">
            <Link href="/" className="logo">
              <img src="/logos/logo.png" alt="logo" />
            </Link>
            <MenuButtonWrapper>
              <button type="button" onClick={toggleMenu}>
                <Menu strokeWidth={2} />
              </button>
            </MenuButtonWrapper>
            <Slan>
              <Link to="/investor/logout" className="btn bg-dark py-2 hoverbge">
                Logout
              </Link>
            </Slan>
          </div>
        </div>
      </Tophead>
      {showPopup && creditBalanceData && (
        <div
          className="modal fade show d-block"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          tabIndex="-1"
          role="dialog"
          aria-labelledby="paymentModalLabel"
          aria-hidden="false"
        >
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content rounded-4 shadow-lg p-4">
              <button
                type="button"
                className="btn-close position-absolute top-0 end-0 m-3"
                onClick={handleClosepayPopup}
                aria-label="Close"
              ></button>

              <>
                <h2
                  className="modal-title text-center fw-bold text-dark mb-4 "
                  id="paymentModalLabel"
                >
                  Credit Balance
                </h2>

                <div className="mb-4">
                  <ul className="list-group list-group-flush mt-3">
                    <li className="list-group-item text-dark ps-0">
                      Access to Dataroom for 3 months (till{" "}
                      <strong>
                        {dateformate(creditBalanceData.valid_until)}
                      </strong>
                      )
                    </li>

                    <li className="list-group-item text-dark ps-0">
                      Due diligence documents generated:{" "}
                      <strong>{creditBalanceData.total_generated}</strong> / 2
                      allowed
                    </li>
                    <li className="list-group-item text-dark ps-0">
                      Credit Balance Left:{" "}
                      <strong>{creditBalanceData.credit_balance}</strong>
                    </li>
                    {creditBalanceData.extra_generations > 0 && (
                      <li className="list-group-item text-danger ps-0">
                        <strong>
                          {creditBalanceData.extra_generations} additional
                          generation (s) will incur €100 each
                        </strong>
                      </li>
                    )}
                  </ul>
                </div>
              </>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
