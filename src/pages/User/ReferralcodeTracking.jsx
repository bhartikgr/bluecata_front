import React, { useState, useEffect } from "react";
import "react-datepicker/dist/react-datepicker.css";
import TopBar from "../../components/Users/TopBar";
import "bootstrap/dist/css/bootstrap.min.css";

import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/RegisterStyles";
import { FaEye } from "react-icons/fa"; // FontAwesome icons
import "react-big-calendar/lib/css/react-big-calendar.css";
import ModuleSideNav from "../../components/Users/ModuleSideNav";
import axios from "axios";
import { DataRoomSection } from "../../components/Styles/DataRoomStyle.js";
import { Button } from "../../components/Styles/MainStyle.js";
import DataTable from "react-data-table-component";
import CompanyShareReferralCodetrack from "../../components/Users/popup/CompanyShareReferralCodetrack.jsx";
import { Link, useParams, useNavigate } from "react-router-dom";
export default function ReferralcodeTracking() {
  var apiUrl = "http://localhost:5000/api/user/";
  document.title = "Tracking Referral Code";
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState("");
  const [records, setrecords] = useState([]);
  const [sharedDetail, setsharedDetail] = useState("");
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [ViewtrackCodePopup, setViewtrackCodePopup] = useState(false);
  const [sharedDetailSingle, setsharedDetailSingle] = useState("");
  const [sharedDetailSingleUsage, setsharedDetailSingleUsage] = useState("");
  const { id, discount_code } = useParams();

  const customStyles = {
    table: {
      style: {
        border: "1px solid #dee2e6",
        borderRadius: "12px",
        overflow: "auto",
      },
    },
    headCells: {
      style: {
        backgroundColor: "#efefef",
        fontWeight: "600",
        fontSize: "0.8rem",
        color: "#000",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      },
    },
    cells: {
      style: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
    },
    rows: {
      style: {
        fontSize: "0.8rem",
        fontWeight: "500",
      },
      stripedStyle: {
        backgroundColor: "#fff",
      },
    },
    pagination: {
      style: {
        marginTop: "15px",
        backgroundColor: "#fafafa",
        padding: "12px 16px",
      },
    },
  };

  useEffect(() => {
    getallCodetrack();
  }, []);
  const getallCodetrack = async () => {
    let formData = {
      user_id: userLogin.id,
      id: id,
      discount_code: discount_code,
    };
    try {
      const res = await axios.post(apiUrl + "getallCodetrack", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data;
      console.log(res);
      if (respo.status === "2") {
        navigate("/share/referralcode");
      }
      setsharedDetail(respo.shared);
      setrecords(respo.usage);
      console.log(respo.usage);
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
  const columns = [
    {
      name: "Company Email",
      selector: (row) => row.company_email,
      sortable: true,
    },
    {
      name: "Referral Code",
      selector: (row) => row.discount_code,
      sortable: true,
    },
    {
      name: "Discount (%)",
      selector: (row) => row.discounts + "%",
      sortable: true,
      right: true,
    },
    {
      name: "Payment Type",
      selector: (row) => {
        switch (row.payment_type) {
          case "Dataroom_Plus_Investor_Report":
            return "Dataroom Management & Diligence + Investor Reporting";
          case "Academy":
            return "International Entrepreneur Academy Program";
          default:
            return row.payment_type;
        }
      },
      sortable: true,
    },
    {
      name: "Actions",
      cell: (row) => (
        <Link
          to=""
          onClick={() => handletrackCode(row.usage_id, row.discount_code)}
          className="btn btn-sm btn-outline-primary"
          title="View Usage Code"
        >
          <FaEye />
        </Link>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
  const handletrackCode = async (idd, discode) => {
    setViewtrackCodePopup(true);
    let formData = {
      user_id: userLogin.id,
      id: id,
      idd: idd,
      discount_code: discode,
    };
    try {
      const res = await axios.post(
        apiUrl + "getallCodetrackSingleDetail",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data;
      setsharedDetailSingle(respo.shared);
      setsharedDetailSingleUsage(respo.usage);
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
  const filteredData = records.filter((item) => {
    const name = `${item.company_name || ""} - ${item.update_date || ""} - ${item.version || ""
      }`;
    return (
      name.toLowerCase().includes(searchText.toLowerCase()) ||
      (item.update_date || "")
        .toLowerCase()
        .includes(searchText.toLowerCase()) ||
      (item.download || "").toLowerCase().includes(searchText.toLowerCase())
    );
  });
  //
  function formatCurrentDate(input) {
    const date = new Date(input);

    if (isNaN(date)) return "";
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();

    const getOrdinal = (n) => {
      if (n >= 11 && n <= 13) return "th";
      switch (n % 10) {
        case 1:
          return "st";
        case 2:
          return "nd";
        case 3:
          return "rd";
        default:
          return "th";
      }
    };

    return `${month} ${day}${getOrdinal(day)}, ${year}`;
  }
  const returnrefresh = () => { };
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
                <div className="container-fluid">
                  <DataRoomSection className="d-flex flex-column gap-2">
                    <div className="titleroom d-flex justify-content-between align-items-center border-bottom pb-3">
                      <h2 className="mainh1">
                        Referral Code Details/Tracking Codes
                      </h2>
                    </div>

                    <div className="d-flex flex-column justify-content-between align-items-start py-4 tb-box">
                      <div className="mb-5">
                        <div className="row g-3 text-sm text-muted">
                          <div className="col-12 col-md-4">
                            <span className="mainp">
                              <b>Referral Date:</b>
                            </span>{" "}
                            <span className="mainp1">
                              {" "}
                              {formatCurrentDate(sharedDetail.created_at)}
                            </span>
                          </div>
                          <div className="col-12 col-md-4">
                            <span className="mainp">
                              <b>Referral Code:</b>
                            </span>{" "}
                            <span className="mainp1">
                              {sharedDetail.discount_code}
                            </span>
                          </div>
                          <div className="col-12 col-md-4">
                            <span className="mainp">
                              <b>Company:</b>
                            </span>{" "}
                            <span className="mainp1">
                              {" "}
                              {sharedDetail.company_name}
                            </span>
                          </div>
                          <div className="col-12 col-md-4">
                            <span className="mainp">
                              <b>Company Email:</b>
                            </span>{" "}
                            <span className="mainp1">
                              {" "}
                              {sharedDetail.company_email}
                            </span>
                          </div>
                          <div className="col-12 col-md-4">
                            <span className="mainp">
                              <b>Referred/Partner By:</b>
                            </span>{" "}
                            <span className="mainp1">{userLogin.email}</span>
                          </div>
                        </div>
                      </div>
                      <div className="d-flex justify-content-between align-items-center gap-3 mb-3 p-0">
                        <p></p>
                        <input
                          type="search"
                          placeholder="Search Here..."
                          className="textarea_input"
                          value={searchText}
                          onChange={(e) => setSearchText(e.target.value)}
                          style={{
                            padding: "10px",
                            width: "100%",
                            maxWidth: "200px",
                            fontSize: "14px",
                          }}
                        />
                      </div>
                      <DataTable
                        customStyles={customStyles}
                        columns={columns}
                        className="datatb-report"
                        data={filteredData}
                        pagination
                        highlightOnHover
                        striped
                        responsive
                      />
                    </div>
                  </DataRoomSection>
                </div>
              </SectionWrapper>
            </div>
          </div>
        </div>
      </Wrapper>

      {ViewtrackCodePopup && (
        <CompanyShareReferralCodetrack
          onClose={() => setViewtrackCodePopup(false)}
          returnrefresh={returnrefresh}
          sharedDetail={sharedDetail}
          sharedDetailSingleUsage={sharedDetailSingleUsage}
        />
      )}
    </>
  );
}
