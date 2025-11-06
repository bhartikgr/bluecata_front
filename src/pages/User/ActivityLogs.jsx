import React, { useState, useEffect, useRef } from "react";
import TopBar from "../../components/Users/TopBar";
import DataTable from "react-data-table-component";
import ModuleSideNav from "../../components/Users/ModuleSideNav";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/MainHeadStyles.js";
import { DataRoomSection } from "../../components/Styles/DataRoomStyle.js";
import axios from "axios";
import { Link } from "react-router-dom";
import DangerAlertPopup from "../../components/Admin/DangerAlertPopup";
import { FaEdit, FaEye, FaTrash } from "react-icons/fa";
export default function ActivityLogs() {
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const apiURL = "http://localhost:5000/api/user/accesslogs/";
  const [CompanyProfileLogs, setCompanyProfileLogs] = useState([]);
  const [deleteId, setDeleteId] = useState("");
  const [dangerMessage, setdangerMessage] = useState("");
  document.title = "Logs Page";
  useEffect(() => {
    getCompanyLogs();
  }, []);

  const getCompanyLogs = async () => {
    const formData = {
      company_id: userLogin.companies[0].id,
    };
    try {
      const generateRes = await axios.post(
        apiURL + "getCompanyLogs",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      console.log(generateRes.data.results);
      setCompanyProfileLogs(generateRes.data.results);
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };
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

  const columns = [
    {
      name: "Module",
      selector: (row) => row.module || "-", // show module name (e.g., CompanyProfile)
      sortable: true,
    },
    {
      name: "Action",
      selector: (row) => row.action || "-", // CREATE, UPDATE, DELETE
      sortable: true,
    },
    {
      name: "Entity Name / Details",
      selector: (row) => row.entity_type,
      sortable: false,
    },
    {
      name: "Date",
      selector: (row) => formatCurrentDate(row.created_at), // show human readable
      sortable: true,
    },
    {
      name: "IP Address",
      selector: (row) => row.ip_address || "-",
      sortable: false,
    },
    {
      name: "Action",
      cell: (row) => {
        let viewLink = "#"; // default
        if (row.module === "company-profile") {
          viewLink = "/company-profile";
        } else if (row.module === "investorReport") {
          viewLink = "/investor-report";
        } else if (row.module === "dataroom") {
          viewLink = "/dataroom";
        } else if (row.module === "capital_round") {
          viewLink = "/record-round-list";
        } else if (row.module === "investorlist") {
          viewLink = "/investorlist";
        } else if (row.module === "Authorized Signature") {
          viewLink = "/authorized-signature";
        } else if (row.module === "package-subscription") {
          viewLink = "/package-subscription";
        }

        return (
          <div className="d-flex gap-2">
            <Link to={viewLink} className="icon_btn green_clr">
              <FaEye /> View
            </Link>
            <button
              type="button"
              onClick={() => handleDelete(row.id)}
              className="icon_btn red_clr"
            >
              <FaTrash /> Delete
            </button>
          </div>
        );
      },
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
      width: "200px",
    },
  ];
  const handleDelete = async (id) => {
    setDeleteId(id);
    setdangerMessage("Are you sure? You want to delete this log");
  };
  const handleConfirm = async () => {
    const formData = {
      id: deleteId,
    };
    try {
      const generateRes = await axios.post(apiURL + "deleteLogs", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      getCompanyLogs();
      setdangerMessage("");
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };
  const [searchText, setSearchText] = useState("");

  // Filter data by nameofreport (case insensitive)
  const filteredData = CompanyProfileLogs.filter((item) => {
    let details = item.details;
    if (typeof details === "string") {
      try {
        details = JSON.parse(details);
      } catch (e) {
        details = {};
      }
    }

    // Collect all searchable fields from your columns
    const valuesToSearch = [
      item.module || "",
      item.action || "",
      details?.company_name ||
      details?.entity_name ||
      details?.document_name ||
      "",
      item.ip_address || "",
      formatCurrentDate(item.created_at) || "",
      item.update_date || "",
      item.version || "",
      item.download || "",
    ];

    // Convert all to lowercase and check if searchText exists in any
    return valuesToSearch.some((val) =>
      val.toString().toLowerCase().includes(searchText.toLowerCase())
    );
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

    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";

    hours = hours % 12;
    hours = hours ? hours : 12; // 0 => 12

    return `${month} ${day}${getOrdinal(
      day
    )}, ${year} ${hours}:${minutes} ${ampm}`;
  }
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
              {dangerMessage && (
                <DangerAlertPopup
                  message={dangerMessage}
                  onConfirm={handleConfirm}
                  onCancel={() => {
                    setdangerMessage("");
                  }}
                />
              )}
              <TopBar />
              <SectionWrapper className="d-block p-md-4 p-3">
                <div className="container-fluid">
                  <DataRoomSection className="d-flex flex-column gap-2">
                    <div className="titleroom flex-wrap gap-3 d-flex justify-content-between align-items-center  pb-3">
                      {/* Heading on the left */}
                      <div className="pb-3 bar_design">
                        <h4 className="h5 mb-0">Activity Logs</h4>
                      </div>
                      {/* Buttons on the right */}
                      <div className="d-flex gap-2">
                        <input
                          type="search"
                          placeholder="Search Here..."
                          className="form-control"
                          value={searchText}
                          onChange={(e) => setSearchText(e.target.value)}
                          style={{
                            padding: "10px 15px",
                            width: "100%",
                            maxWidth: "300px",
                            fontSize: "14px",
                            borderRadius: "10px",
                          }}
                        />
                      </div>
                    </div>

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
                    </div>
                  </DataRoomSection>
                </div>
              </SectionWrapper>
            </div>
          </div>
        </div>
      </Wrapper>
    </>
  );
}
