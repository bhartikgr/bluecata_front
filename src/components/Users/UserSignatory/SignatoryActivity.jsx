// InvestorReport.js
import React, { useState, useEffect } from "react";
import DataTable from "react-data-table-component";
import axios from "axios";
import { API_BASE_URL } from "../../../config/config";

const SignatoryActivity = ({
  id,
  signatory_id,

  visibleFields = [],
  data = [],
}) => {
  const storedUsername = localStorage.getItem("OwnerLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [records, setrecords] = useState([]);
  const apiUrlDashboard = API_BASE_URL + "api/user/signatorydashboard/";
  useEffect(() => {
    getSignatoryActivity();
  }, []);
  const getSignatoryActivity = async () => {
    const formData = {
      signatory_id: signatory_id,
      company_id: id,
      user_id: userLogin.id,
    };
    try {
      // Fetch audit logs
      const auditResp = await axios.post(
        apiUrlDashboard + "getSignatoryActivity",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      // Fetch company round access logs
      const roundResp = await axios.post(
        apiUrlDashboard + "getCompanyRoundAccessLogs",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      // Merge results
      const combinedResults = [
        ...auditResp.data.results.map((item) => ({
          ...item,
          source: "Audit Logs",
        })),
        ...roundResp.data.results.map((item) => ({
          ...item,
          source: "Round Logs",
          module: item.module || "Round Record", // fallback if null
          action: item.action || "Accessed Round", // fallback if null
          entity_type: item.entity_type || "Round Access", // fallback if null
        })),
      ];

      // Sort by date descending
      combinedResults.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      console.log(combinedResults);
      setrecords(combinedResults);
    } catch (err) {
      console.error("Error fetching activity logs", err);
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
      name: "Action",
      selector: (row) => row.action,
      sortable: true,
    },
    {
      name: "Module",
      selector: (row) => row.module,
      sortable: true,
    },

    {
      name: "Ip Address",
      selector: (row) => row.ip_address,
      sortable: true,
    },
    {
      name: "Date",
      selector: (row) => formatCurrentDate(row.created_at),
      sortable: true,
    },
  ];

  const handleClickViewDetail = (data) => {};

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
    </div>
  );
};

export default SignatoryActivity;
