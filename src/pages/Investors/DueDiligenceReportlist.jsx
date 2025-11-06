import React, { useState, useEffect } from "react";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/RegisterStyles";
import axios from "axios";
import DataTable from "react-data-table-component";
import { Link, useParams } from "react-router-dom";
import { FaDownload, FaEllipsisV } from "react-icons/fa";
import SideBar from "../../components/Investor/Sidebar.jsx";
import { DataRoomSection } from "../../components/Styles/DataRoomStyle.js";
import { BackButton } from "../../components/Styles/GlobalStyles.js";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
function DueDiligenceReportlist() {
  const { id } = useParams();
  const navigate = useNavigate();
  document.title =
    "Company DataRoom Management & Diligence Report List - Investor";
  const customStyles = {
    table: {
      style: {
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
  const [ClientIP, setClientIP] = useState("");
  var apiURL = "http://localhost:5000/api/user/investor/";
  const storedUsername = localStorage.getItem("InvestorData");
  const userLogin = JSON.parse(storedUsername);
  const [searchText, setSearchText] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);
  useEffect(() => {
    const getIP = async () => {
      try {
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json();
        setClientIP(data.ip); // Save this to state
      } catch (error) {
        console.error("Failed to fetch IP", error);
      }
    };

    getIP();
  }, []);
  useEffect(() => {
    getInvestorReportslist();
  }, []);
  const getInvestorReportslist = async () => {
    let formData = {
      investor_id: userLogin.id,
      type: "Due Diligence Document",
      company_id: id,
    };
    try {
      const res = await axios.post(
        apiURL + "getInvestorReportslist",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setRecords(res.data.results);
    } catch (err) { }
  };
  const [records, setRecords] = useState([
    {
      id: 1,
      email: "test1@company.com",
      discount_code: "DISC10",
      percentage: 10,
      company_email_match: "Yes",
    },
    {
      id: 2,
      email: "test2@company.com",
      discount_code: "SAVE20",
      percentage: 20,
      company_email_match: "No",
    },
    {
      id: 3,
      email: "demo@company.com",
      discount_code: "OFF50",
      percentage: 50,
      company_email_match: "Yes",
    },
  ]);

  const filteredData = records.filter((item) => {
    const search = searchText.toLowerCase();

    // Combine all searchable fields into one string
    const combinedFields = `
    ${item.type || ""}
    ${item.version || ""}
    ${item.document_name || ""}
    ${item.download || ""}
  `.toLowerCase();

    return combinedFields.includes(search);
  });

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
  const handledownload = async (idd, url) => {
    let formData = {
      investor_id: userLogin.id,
      id: idd,
      company_id: id,
      ip_address: ClientIP,
    };
    try {
      const res = await axios.post(
        apiURL + "InvestorReportslistDownload",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      window.open(url, "_blank");
    } catch (err) { }
  };
  const handleBackClick = () => {
    navigate("/investor/company-list");
  };
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
                    <BackButton
                      type="button"
                      className="backbtn"
                      onClick={handleBackClick}
                    >
                      <ArrowLeft size={16} className="me-1" /> back
                    </BackButton>
                    <h4 className="mainh1">DataRoom Management & Diligence</h4>
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
                  <div className="d-flex overflow-auto flex-column justify-content-between align-items-start tb-box">
                    <DataTable
                      customStyles={customStyles}
                      columns={[
                        {
                          name: "Report",
                          selector: (row) => row.type, // Changed from row.email
                          sortable: true,
                          cell: (row) => <span>{row.type}</span>,
                        },
                        {
                          name: "Version",
                          selector: (row) => row.version, // Changed from row.email
                          sortable: true,
                          cell: (row) => <span>{row.version}</span>,
                        },
                        {
                          name: "Date Of Report",
                          selector: (row) => formatCurrentDate(row.shared_date), // Changed from row.discount_code
                          sortable: true,
                          cell: (row) => (
                            <span>{formatCurrentDate(row.shared_date)}</span>
                          ),
                        },
                        {
                          name: "Name of Report",
                          selector: (row) => row.document_name, // Changed from percentage
                          sortable: true,
                          cell: (row) => <span>{row.document_name}</span>,
                        },
                        {
                          name: "Actions",
                          cell: (row) => (
                            <div className="d-flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handledownload(row.id, row.downloadUrl)
                                }
                                title="Download/View"
                                className="icon_download"
                              >
                                <FaDownload />
                              </button>
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

export default DueDiligenceReportlist;
