// InvestorReport.js
import React, { useState, useEffect } from "react";
import DataTable from "react-data-table-component";
import axios from "axios";
import { API_BASE_URL } from "../../../config/config";
import { FaEllipsis } from "react-icons/fa6";
import { Link } from "react-router-dom";
import { FaEye, FaShareAlt } from "react-icons/fa";
import ViewInvestorInfo from "../../../components/Users/UserSignatory/ViewInvestorInfo";
const InvestorList = ({ id, signatory_id, visibleFields = [], data = [] }) => {
  const storedUsername = localStorage.getItem("OwnerLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [records, setrecords] = useState([]);
  const apiUrlDashboard = API_BASE_URL + "api/user/signatorydashboard/";
  useEffect(() => {
    getCompanyInvestorList();
  }, []);
  const getCompanyInvestorList = async () => {
    const formData = {
      signatory_id: signatory_id,
      company_id: id,
      user_id: userLogin.id,
    };
    try {
      const resp = await axios.post(
        apiUrlDashboard + "getCompanyInvestorList",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      setrecords(resp.data.results);
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };
  const [searchText, setSearchText] = useState("");
  const [openDropdown, setOpenDropdown] = useState(null);

  const toggleDropdown = (id) => {
    // If the clicked row is already open, close it; otherwise open it
    setOpenDropdown(openDropdown === id ? null : id);
  };
  const columns = [
    {
      name: "First Name",
      selector: (row) => row.first_name,
      sortable: true,
    },
    {
      name: "Last Name",
      selector: (row) => row.last_name,
      sortable: true,
    },

    {
      name: "Email",
      selector: (row) => row.email,
      sortable: true,
    },
    {
      name: "Phone",
      selector: (row) => row.phone,
      sortable: true,
    },

    {
      name: "Actions",
      cell: (row) => (
        <div className="position-relative">
          <button
            className="block bg-transprent border-0"
            onClick={() => toggleDropdown(row.id)}
          >
            <FaEllipsis />
          </button>

          {openDropdown === row.id && (
            <div
              className="dropdown-menu show"
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                minWidth: "200px",
                zIndex: 9999,
                borderRadius: "8px",
                boxShadow:
                  "0 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)",
                backgroundColor: "#ffffff",
                padding: "6px",
                animation: "fadeInDown 0.2s ease-out",
              }}
            >
              <Link
                to="javascript:void(0)"
                className="dropdown-item"
                onClick={() => handleClickViewDetail(row)}
                title="View Details"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 12px",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "#374151",
                  textDecoration: "none",
                  borderRadius: "6px",
                  transition: "all 0.15s ease",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#111827";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#374151";
                }}
              >
                <FaEye style={{ fontSize: "16px", color: "#10b981" }} />
                <span>View Details</span>
              </Link>
            </div>
          )}
        </div>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];

  const [selectedRecord, setSelectedRecord] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [ReportId, setReportId] = useState("");
  const handleClickViewDetail = (data) => {
    setOpenDropdown(null);
    setSelectedRecord(data);
    setShowModal(true);
  };
  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedRecord(null);
  };
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
  const conditionalRowStyles = [
    {
      when: (row) => true, // apply to all rows
      style: {
        "&:hover": {
          backgroundColor: "var(--lightRed)", // apna hover color
        },
      },
    },
  ];
  const filteredData =
    records?.filter((item) => {
      if (!item) return false;
      const name = `${item.company_name || ""} - ${item.update_date || ""} - ${
        item.version || ""
      }`;
      const search = searchText.toLowerCase();
      return (
        name.toLowerCase().includes(search) ||
        (item.update_date || "").toLowerCase().includes(search) ||
        (item.download || "").toLowerCase().includes(search)
      );
    }) || [];
  const handleShareReport = (id) => {
    setReportId(id);
    setShowModalShareReport(true);
  };
  const [showModalShareReport, setShowModalShareReport] = useState(false);
  return (
    <div className="d-flex flex-column overflow-auto justify-content-between align-items-start tb-box">
      <DataTable
        customStyles={customStyles}
        conditionalRowStyles={conditionalRowStyles}
        columns={columns}
        className="datatb-report"
        data={filteredData}
        pagination
        highlightOnHover
        striped
        responsive
      />
      {showModal && (
        <ViewInvestorInfo
          recordViewData={selectedRecord}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
};

export default InvestorList;
