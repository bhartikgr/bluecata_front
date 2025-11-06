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
import CompanyShareReferralCode from "../../components/Users/popup/CompanyShareReferralCode.jsx";
import DataTable from "react-data-table-component";
import { Link } from "react-router-dom";
import { FaShareAlt } from "react-icons/fa";
export default function Referralcode() {
  var apiUrl = "http://localhost:5000/api/user/";
  document.title = "Share Referral Code";
  useEffect(() => {
    getallsharedCodeByCompany();
  }, []);
  //
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [records, setrecords] = useState([]);

  const customStyles = {
    table: {
      style: {
        minWidth: "100%",
        boxShadow: "0px 3px 12px rgb(0 0 0 / 16%)",
        borderRadius: "12px",
        overflow: "hidden",
      },
    },
    headCells: {
      style: {
        backgroundColor: "#efefef !important",
        fontWeight: "600",
        fontSize: "0.9rem",
        color: "#000 !important",
        whiteSpace: "nowrap",
      },
    },
    cells: {
      style: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        backgroundColor: "#fff !important",
      },
    },
    rows: {
      style: {
        fontSize: "0.8rem",
        fontWeight: "500",
        "&:hover": {
          backgroundColor: "#e8f0fe",
        },
      },
      stripedStyle: {
        backgroundColor: "#f4f6f8",
      },
    },
    pagination: {
      style: {
        backgroundColor: "#fafafa",
        padding: "12px 16px",
      },
    },
  };

  const [searchText, setSearchText] = useState("");
  const [SharedDiscount, setSharedDiscount] = useState(false);
  const getallsharedCodeByCompany = async () => {
    let formData = {
      user_id: userLogin.id,
    };
    try {
      const res = await axios.post(
        apiUrl + "getallsharedCodeByCompany",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data;
      setrecords(respo.results);
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
  const returnrefresh = () => {
    getallsharedCodeByCompany();
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

  const handlesharepopup = () => {
    setSharedDiscount(true);
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
                <div className="container-fluid">
                  <DataRoomSection className="d-flex flex-column gap-3">
                    <div className="titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3">
                      <h4 className="mainh1">Share Referral Code List</h4>
                      <Button
                        onClick={handlesharepopup}
                        type="button"
                        className="btn d-flex align-items-center gap-2 px-4 py-2"
                        style={{
                          background:
                            "linear-gradient(135deg, #ff3d41 0%, #d40209 100%)",
                          border: "none",
                          borderRadius: "8px",
                          color: "white",
                          fontWeight: "500",
                          boxShadow: "0 4px 6px rgba(13, 110, 253, 0.25)",
                          transition: "all 0.2s ease",
                        }}
                      >
                        <FaShareAlt style={{ fontSize: "14px" }} />
                        Share Referral
                      </Button>
                    </div>
                    <div className="d-flex justify-content-end p-0">
                      <input
                        type="search"
                        placeholder="Search Here..."
                        className="form-control"
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
                    <div className="d-flex overflow-auto flex-column justify-content-between align-items-start tb-box">
                      <DataTable
                        customStyles={customStyles}
                        columns={[
                          {
                            name: "Shared Email",
                            selector: (row) => row.email,
                            sortable: true,
                            cell: (row) => (
                              <div className="d-flex align-items-center">
                                <div className="bg-primary bg-opacity-10 p-2 rounded-circle me-3">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="14"
                                    height="14"
                                    fill="currentColor"
                                    className="text-primary"
                                    viewBox="0 0 16 16"
                                  >
                                    <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4Zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2Zm13 2.383-4.708 2.825L15 11.105V5.383Zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741ZM1 11.105l4.708-2.897L1 5.383v5.722Z" />
                                  </svg>
                                </div>
                                <span>{row.email}</span>
                              </div>
                            ),
                          },
                          {
                            name: "Code",
                            selector: (row) => row.discount_code,
                            sortable: true,
                            cell: (row) => (
                              <div className="d-flex align-items-center">
                                <div className="bg-info bg-opacity-10 p-2 rounded me-2">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="14"
                                    height="14"
                                    fill="currentColor"
                                    className="text-info"
                                    viewBox="0 0 16 16"
                                  >
                                    <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z" />
                                    <path d="M4.5 5.5A.5.5 0 0 1 5 5h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm0 3A.5.5 0 0 1 5 8h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm0 3A.5.5 0 0 1 5 11h3a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5z" />
                                  </svg>
                                </div>
                                <code
                                  className="bg-light px-2 py-1 rounded border"
                                  style={{ fontSize: "13px" }}
                                >
                                  {row.discount_code}
                                </code>
                              </div>
                            ),
                          },
                          {
                            name: "Discount",
                            selector: (row) => row.percentage + "%",
                            sortable: true,
                            cell: (row) => (
                              <div className="d-flex align-items-center">
                                <div className="bg-success bg-opacity-10 p-2 rounded me-2">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="14"
                                    height="14"
                                    fill="currentColor"
                                    className="text-success"
                                    viewBox="0 0 16 16"
                                  >
                                    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
                                    <path d="M8 13A5 5 0 1 1 8 3a5 5 0 0 1 0 10zm0 1A6 6 0 1 0 8 2a6 6 0 0 0 0 12z" />
                                    <path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
                                  </svg>
                                </div>
                                <span className="fw-semibold text-success">
                                  {row.percentage}%
                                </span>
                              </div>
                            ),
                          },
                          {
                            name: "Status",
                            selector: (row) => row.company_email_match,
                            sortable: true,
                            cell: (row) => (
                              <div
                                className="d-flex align-items-center justify-content-center"
                                style={{
                                  backgroundColor:
                                    row.company_email_match === "Yes"
                                      ? "rgba(34, 197, 94, 0.1)"
                                      : "rgba(239, 68, 68, 0.1)",
                                  color:
                                    row.company_email_match === "Yes"
                                      ? "#166534"
                                      : "#991b1b",
                                  padding: "6px 12px",
                                  borderRadius: "20px",
                                  fontSize: "13px",
                                  fontWeight: "500",
                                  width: "fit-content",
                                  border: `1px solid ${row.company_email_match === "Yes"
                                    ? "rgba(34, 197, 94, 0.2)"
                                    : "rgba(239, 68, 68, 0.2)"
                                    }`,
                                }}
                              >
                                {row.company_email_match === "Yes" ? (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="14"
                                    height="14"
                                    fill="currentColor"
                                    className="me-1"
                                    viewBox="0 0 16 16"
                                  >
                                    <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                                  </svg>
                                ) : (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="14"
                                    height="14"
                                    fill="currentColor"
                                    className="me-1"
                                    viewBox="0 0 16 16"
                                  >
                                    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
                                    <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                                  </svg>
                                )}
                                {row.company_email_match === "Yes"
                                  ? "Registered"
                                  : "Pending"}
                              </div>
                            ),
                          },
                          {
                            name: "Actions",
                            cell: (row) => (
                              <div className="d-flex gap-2">
                                <Link
                                  to={`/share/referralcodetracking/${row.id}/${row.discount_code}`}
                                  rel="noopener noreferrer"
                                  className="btn btn-sm d-flex align-items-center"
                                  title="View Usage Code"
                                  style={{
                                    backgroundColor: "rgba(59, 130, 246, 0.1)",
                                    color: "#1d4ed8",
                                    border: "1px solid rgba(59, 130, 246, 0.2)",
                                    borderRadius: "6px",
                                    padding: "6px 10px",
                                    fontSize: "13px",
                                    fontWeight: "500",
                                    transition: "all 0.2s ease",
                                  }}
                                  onMouseEnter={(e) => {
                                    e.target.style.backgroundColor =
                                      "rgba(59, 130, 246, 0.2)";
                                    e.target.style.color = "#1e40af";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.target.style.backgroundColor =
                                      "rgba(59, 130, 246, 0.1)";
                                    e.target.style.color = "#1d4ed8";
                                  }}
                                >
                                  <FaEye
                                    className="me-1"
                                    style={{ fontSize: "12px" }}
                                  />
                                  View
                                </Link>
                              </div>
                            ),
                            ignoreRowClick: true,
                            allowOverflow: true,
                            button: true,
                          },
                        ]}
                        className="datatb-report"
                        data={filteredData}
                        pagination
                        highlightOnHover
                        striped
                        responsive
                        paginationRowsPerPageOptions={[10, 25, 50, 100]}
                        paginationComponentOptions={{
                          rowsPerPageText: "Rows per page:",
                          rangeSeparatorText: "of",
                          noRowsPerPage: false,
                          selectAllRowsItem: false,
                        }}
                      />
                    </div>
                  </DataRoomSection>
                </div>
              </SectionWrapper>
            </div>
          </div>
        </div>
      </Wrapper>

      {SharedDiscount && (
        <CompanyShareReferralCode
          onClose={() => setSharedDiscount(false)}
          returnrefresh={returnrefresh}
        />
      )}
    </>
  );
}
