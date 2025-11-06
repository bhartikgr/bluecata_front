import React, { useState, useEffect } from "react";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/RegisterStyles";
import axios from "axios";
import DataTable from "react-data-table-component";
import { Link, useParams } from "react-router-dom";
import { FaDownload, FaEye } from "react-icons/fa";
import SideBar from "../../components/Investor/Sidebar.jsx";
import { DataRoomSection } from "../../components/Styles/DataRoomStyle.js";
import { BackButton } from "../../components/Styles/GlobalStyles.js";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
function CapitalRoundList() {
  const [open, setOpen] = useState(false);
  const { id } = useParams();
  const navigate = useNavigate();
  document.title = "Company Capital Round List - Investor";
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
  var apiURL = "http://localhost:5000/api/user/capitalround/";

  const storedUsername = localStorage.getItem("InvestorData");
  const userLogin = JSON.parse(storedUsername);
  const [searchText, setSearchText] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);
  useEffect(() => {
    getInvestorCapitalMotionlist();
  }, []);
  const getInvestorCapitalMotionlist = async () => {
    let formData = {
      investor_id: userLogin.id,
      company_id: Number(id),
    };

    try {
      const res = await axios.post(
        apiURL + "getInvestorCapitalMotionlist",
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
  const [records, setRecords] = useState([]);

  const filteredData = records.filter((item) => {
    const search = searchText.toLowerCase();

    // Combine all searchable fields into one string
    const combinedFields = `
    ${item.nameOfRound || ""}
    ${item.shareClassType || ""}
     ${item.roundsize || ""}
    ${item.issuedshares || ""}
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

  const handleBackClick = () => {
    navigate("/investor/company-list");
  };
  const handleViewRound = (id) => { };
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
                    <h4 className="mainh1">Investor Report List</h4>
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
                          name: "Share Class (Name of Round)",
                          selector: (row) =>
                            row.shareClassType + " " + row.nameOfRound, // Changed from row.email
                          sortable: true,
                          cell: (row) => (
                            <span>
                              {row.shareClassType} {row.nameOfRound}
                            </span>
                          ),
                        },
                        {
                          name: "Amount",
                          selector: (row) =>
                            row.currency +
                            " " +
                            Number(row.roundsize).toLocaleString("en-US"), // Changed from row.email
                          sortable: true,
                          cell: (row) => (
                            <span>
                              {row.currency +
                                " " +
                                Number(row.roundsize).toLocaleString("en-US")}
                            </span>
                          ),
                        },
                        {
                          name: "Issue of Share",
                          selector: (row) =>
                            Number(row.issuedshares).toLocaleString("en-US"), // Changed from row.discount_code
                          sortable: true,
                          cell: (row) => (
                            <span>
                              {Number(row.issuedshares).toLocaleString("en-US")}
                            </span>
                          ),
                        },
                        {
                          name: "Date of Share",
                          selector: (row) => formatCurrentDate(row.sent_date), // Changed from percentage
                          sortable: true,
                          cell: (row) => (
                            <span>{formatCurrentDate(row.sent_date)}</span>
                          ),
                        },
                        {
                          name: "Actions",
                          cell: (row) => (
                            <div className="d-flex gap-2">
                              <Link
                                to={`/investor/company/capital-round-list/view/${row.company_id}/${row.id}`}
                                title="View Round Record"
                                className="icon_btn green_clr"
                              >
                                <FaEye /> View Round
                              </Link>
                            </div>
                          ),
                          ignoreRowClick: true,
                          allowOverflow: true,
                          button: true,
                          width: "200px",
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

export default CapitalRoundList;
