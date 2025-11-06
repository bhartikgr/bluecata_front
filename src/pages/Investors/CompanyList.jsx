import React, { useState, useEffect } from "react";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/RegisterStyles";
import axios from "axios";
import DataTable from "react-data-table-component";
import { Link } from "react-router-dom";
import { FaEye, FaEllipsisV } from "react-icons/fa";
import SideBar from "../../components/Investor/Sidebar.jsx";
import { DataRoomSection } from "../../components/Styles/DataRoomStyle.js";

// import { overflow } from "html2canvas/dist/types/css/property-descriptors/overflow.js";

function CompanyList() {
  const [open, setOpen] = useState(false);

  const customStyles = {
    table: {
      style: {
        overflow: "visible !important",
        minWidth: "100%",
        boxShadow: "0px 3px 12px rgb(0 0 0 / 16%)",
        borderRadius: "12px",
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
  var apiURL = "http://localhost:5000/api/user/investor/";

  const storedUsername = localStorage.getItem("InvestorData");
  const userLogin = JSON.parse(storedUsername);
  const [searchText, setSearchText] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);
  document.title = "Company List - Investor";
  useEffect(() => {
    getInvestorCompany();
  }, []);
  const getInvestorCompany = async () => {
    let formData = {
      investor_id: userLogin.id,
    };
    try {
      const res = await axios.post(apiURL + "getInvestorCompany", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      setRecords(res.data.results);
    } catch (err) { }
  };
  const [records, setRecords] = useState([]);

  const filteredData = records.filter((item) => {
    const search = searchText.toLowerCase();

    // Combine all searchable fields into one string
    const combinedFields = `
    ${item.company_name || ""}
    ${item.update_date || ""}
    ${item.version || ""}
    ${item.document_name || ""}
    ${item.company_city || ""}
    ${item.phone || ""}
    ${item.company_country || ""}
  `.toLowerCase();

    return combinedFields.includes(search);
  });

  return (
    <Wrapper className="investor-login-wrapper">
      <div className="fullpage d-block">
        <div className="d-flex align-items-start gap-0">
          <SideBar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />

          <div
            className={`global_view ${isCollapsed ? "global_view_col" : ""}`}
          >
            <SectionWrapper className="d-block p-md-4 p-3">
              <div className="container-fluid">
                <DataRoomSection className="d-flex flex-column gap-3">
                  <div className="titleroom flex-wrap  gap-3 d-flex justify-content-between align-items-center border-bottom pb-3">
                    <h4 className="mainh1">Company List</h4>
                  </div>
                  <div className="d-flex justify-content-end p-0">
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
                  <div className="d-flex  flex-column justify-content-between align-items-start tb-box">
                    <style>
                      {`
                        .datatb-report {
                          overflow: visible !important;
                        }
                      `}
                    </style>
                    <DataTable
                      customStyles={customStyles}
                      columns={[
                        {
                          name: "Company Name",
                          selector: (row) => row.company_name, // Changed from row.email
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
                                  {/* Building icon for company name */}
                                  <path d="M14.763.075A.5.5 0 0 1 15 .5v15a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5V14h-1v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V10H.5a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5H2V.5a.5.5 0 0 1 .5-.5h12a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H14v8.5a.5.5 0 0 1 .5.5h2a.5.5 0 0 1 .5-.5V.575a.5.5 0 0 1-.237.5zM3 1.5v13h8V1.5H3zm10.5 0v13h1V1.5h-1z" />
                                </svg>
                              </div>
                              <span>{row.company_name}</span>{" "}
                              {/* Changed from row.email */}
                            </div>
                          ),
                        },
                        {
                          name: "Company Contact",
                          selector: (row) => row.phone,
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
                                  {/* Phone icon for company contact */}
                                  <path d="M3.654 1.328a.678.678 0 0 1 .736-.128l2.261.904c.329.131.445.507.249.777L5.08 4.58a.678.678 0 0 1-.746.225l-1.01-.303a11.72 11.72 0 0 0 5.516 5.516l.303-1.01a.678.678 0 0 1 .225-.746l1.195-1.195c.27-.196.646-.08.777.249l.904 2.261a.678.678 0 0 1-.128.736l-2.307 2.307c-.329.329-.888.329-1.217 0l-1.927-1.927a13.134 13.134 0 0 1-6.29-6.29L1.328 2.545c-.329-.329-.329-.888 0-1.217L3.654 1.328z" />
                                </svg>
                              </div>
                              <span>{row.phone}</span>
                            </div>
                          ),
                        },

                        {
                          name: "Country",
                          selector: (row) => row.company_country, // Changed from percentage
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
                                  {/* Globe icon for country */}
                                  <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM4.882 1.731a.482.482 0 0 0 .14.291.487.487 0 0 0 .292.14.49.49 0 0 0 .356 0 .487.487 0 0 0 .292-.14.482.482 0 0 0 .14-.291.484.484 0 0 0-.14-.292.483.483 0 0 0-.292-.14.484.484 0 0 0-.356 0 .483.483 0 0 0-.292.14.484.484 0 0 0-.14.292zM7.5 11.5V12h-4v-1h1v-1h1v-1h1v-1h-1V8h1V7h1V6h1V5h-1V4h1V3h1V2h1v9h-1z" />
                                </svg>
                              </div>
                              <span>{row.company_country}</span>{" "}
                              {/* Changed from percentage display */}
                            </div>
                          ),
                        },
                        {
                          name: "City",
                          selector: (row) => row.company_city, // Changed from company_email_match
                          sortable: true,
                          cell: (row) => (
                            <div className="d-flex align-items-center">
                              <div className="bg-warning bg-opacity-10 p-2 rounded me-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="14"
                                  height="14"
                                  fill="currentColor"
                                  className="text-warning"
                                  viewBox="0 0 16 16"
                                >
                                  {/* Location pin icon for city */}
                                  <path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" />
                                </svg>
                              </div>
                              <span>{row.company_city}</span>{" "}
                              {/* Changed from company_email_match display */}
                            </div>
                          ),
                        },
                        {
                          name: "Actions",
                          cell: (row) => (
                            <div className="position-relative">
                              <button
                                className="btn btn-light btn-sm"
                                onClick={() =>
                                  setOpen(open === row.id ? null : row.id)
                                }
                                style={{
                                  border: "1px solid #ddd",
                                  borderRadius: "6px",
                                  padding: "4px 8px",
                                }}
                              >
                                <FaEllipsisV />
                              </button>

                              {open === row.id && (
                                <div
                                  className="dropdown-menu show"
                                  style={{
                                    position: "absolute",
                                    top: "100%",
                                    right: 0,
                                    minWidth: "220px",
                                    zIndex: 9999,
                                    borderRadius: "8px",
                                    boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                                  }}
                                >
                                  <Link
                                    to={`/investor/company/reportlist/${row.id}`}
                                    className="dropdown-item"
                                  >
                                    <FaEye
                                      className="me-2"
                                      style={{ fontSize: "14px" }}
                                    />{" "}
                                    Investor Report
                                  </Link>
                                  <Link
                                    to={`/investor/company/duediligence-reportlist/${row.id}`}
                                    className="dropdown-item"
                                  >
                                    <FaEye
                                      className="me-2"
                                      style={{ fontSize: "14px" }}
                                    />{" "}
                                    DataRoom Report
                                  </Link>
                                  <Link
                                    to={`/investor/company/capital-round-list/${row.id}`}
                                    className="dropdown-item"
                                  >
                                    <FaEye
                                      className="me-2"
                                      style={{ fontSize: "14px" }}
                                    />{" "}
                                    Capital Round Documents
                                  </Link>
                                </div>
                              )}
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
  );
}

export default CompanyList;
