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
import { Modal } from "antd";

import DangerAlertPopup from "../../components/Admin/DangerAlertPopup";
import { FaEdit, FaEye, FaTrash } from "react-icons/fa";
export default function DiscountCoupon() {
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const apiURL = "http://localhost:5000/api/user/accesslogs/";
  const [CompanyDiscountCoupon, setCompanyDiscountCoupon] = useState([]);
  const [deleteId, setDeleteId] = useState("");
  const [dangerMessage, setdangerMessage] = useState("");
  document.title = "Discount Coupon Page";
  useEffect(() => {
    getCompanyDiscountCoupon();
  }, []);

  const getCompanyDiscountCoupon = async () => {
    const formData = {
      company_id: userLogin.companies[0].id,
    };
    try {
      const generateRes = await axios.post(
        apiURL + "getCompanyDiscountCoupon",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      setCompanyDiscountCoupon(generateRes.data.results);
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
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedModule, setSelectedModule] = useState("");
  const showModal = (moduleText) => {
    setSelectedModule(moduleText);
    setIsModalVisible(true);
  };

  const handleModalClose = () => {
    setIsModalVisible(false);
    setSelectedModule("");
  };

  const columns = [
    {
      name: "Coupon Code",
      selector: (row) => row.code || "-",
      sortable: true,
    },
    {
      name: "Discount",
      selector: (row) => row.percentage + "%",
      sortable: true,
    },
    {
      name: "For Module",
      selector: (row) => row.type,
      cell: (row) => {
        try {
          // Parse the JSON string to an array
          const typeArray =
            typeof row.type === "string" ? JSON.parse(row.type) : row.type;

          let displayText = "";

          // Check if it's an array
          if (Array.isArray(typeArray)) {
            // Check if it includes the specific value
            if (typeArray.includes("Dataroom_Plus_Investor_Report")) {
              displayText =
                "Dataroom Management + Investor Report + Cap Table Management";
            } else {
              displayText = typeArray.join(", ");
            }
          } else {
            displayText = String(row.type);
          }

          return (
            <span
              onClick={() => showModal(displayText)}
              style={{
                cursor: "pointer",
                color: "#1890ff",
                textDecoration: "underline",
              }}
            >
              {displayText}
            </span>
          );
        } catch (error) {
          // If parsing fails, return the original value
          const displayText = String(row.type);
          return (
            <span
              onClick={() => showModal(displayText)}
              style={{
                cursor: "pointer",
                color: "#1890ff",
                textDecoration: "underline",
              }}
            >
              {displayText}
            </span>
          );
        }
      },
      sortable: true,
    },
    {
      name: "Exp Date",
      selector: (row) => formatCurrentDate(row.exp_date),
      sortable: false,
      cell: (row) => {
        const isExpired = new Date(row.exp_date) < new Date();
        return (
          <span style={{ color: isExpired ? "red" : "green" }}>
            {formatCurrentDate(row.exp_date)}
          </span>
        );
      },
    },
  ];

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

      setdangerMessage("");
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };
  const [searchText, setSearchText] = useState("");

  // Filter data by nameofreport (case insensitive)
  const filteredData = CompanyDiscountCoupon.filter((item) => {
    const valuesToSearch = [
      item.code || "",
      formatCurrentDate(item.created_at) || "",
      formatCurrentDate(item.exp_date) || "",
      item.usage_limit?.toString() || "",
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
                        <h4 className="h5 mb-0">Discount Coupon</h4>
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
      <Modal
        title="Module Details"
        open={isModalVisible}
        onCancel={handleModalClose}
        footer={null}
        width={600}
      >
        <p>{selectedModule}</p>
      </Modal>
    </>
  );
}
