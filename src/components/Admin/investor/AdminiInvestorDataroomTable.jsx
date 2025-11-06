import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import DataTable from "react-data-table-component";

function AdminiInvestorDataroomTable({ id }) {
  // ✅ receive id prop
  const [Userid, setUserid] = useState("");
  const [CompanyName, setCompanyName] = useState("");
  const [ownername, setownername] = useState("");
  const [InvestorDetail, setInvestorDetail] = useState([]);
  const apiUrlAll = "http://localhost:5000/api/admin/adminall/";
  useEffect(() => {
    if (id) totalDocs(); // ✅ only run when id is available
  }, [id]);

  const totalDocs = async () => {
    let formData = { company_id: id };

    try {
      const res = await axios.post(apiUrlAll + "totalDocs", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      const respo = res.data;
      setCompanyName(respo.company_name);
      setownername(respo.owner_full_name);
      setUserid(respo.user_id);
    } catch (err) {
      console.error("Error fetching company data:", err);
    }
  };
  const [searchText, setSearchText] = useState("");
  const customStyles = {
    table: {
      style: {
        overflow: "visible",
        minWidth: "100%",
        boxShadow:
          "0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)",
        borderRadius: "12px",
        border: "1px solid #e5e7eb",
      },
    },
    headCells: {
      style: {
        backgroundColor: "#f9fafb",
        fontWeight: "600",
        fontSize: "13px",
        color: "#374151",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        padding: "16px 12px",
        borderBottom: "2px solid #e5e7eb",
      },
    },
    cells: {
      style: {
        padding: "14px 12px",
        fontSize: "14px",
        color: "#1f2937",
        backgroundColor: "#ffffff",
      },
    },
    rows: {
      style: {
        fontSize: "14px",
        fontWeight: "500",
        minHeight: "56px",
        transition: "background-color 0.15s ease",
        "&:not(:last-of-type)": {
          borderBottom: "1px solid #f3f4f6",
        },
        "&:hover": {
          backgroundColor: "#f9fafb",
          cursor: "pointer",
        },
      },
      stripedStyle: {
        backgroundColor: "#fafafa",
      },
    },
    pagination: {
      style: {
        backgroundColor: "#f9fafb",
        padding: "14px 16px",
        borderTop: "1px solid #e5e7eb",
        borderBottomLeftRadius: "12px",
        borderBottomRightRadius: "12px",
        fontSize: "14px",
        color: "#6b7280",
      },
      pageButtonsStyle: {
        borderRadius: "6px",
        height: "36px",
        width: "36px",
        padding: "8px",
        margin: "0 4px",
        cursor: "pointer",
        transition: "all 0.2s",
        backgroundColor: "transparent",
        fill: "#6b7280",
        "&:disabled": {
          cursor: "not-allowed",
          fill: "#d1d5db",
        },
        "&:hover:not(:disabled)": {
          backgroundColor: "#e5e7eb",
          fill: "#374151",
        },
      },
    },
  };
  const columnsinvestor = [
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
      name: "Register",
      selector: (row) => row.is_register,
      sortable: true,
      cell: (row) => {
        const isRegistered =
          row.is_register === "Yes" || row.is_register === "yes";

        return (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 12px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: "500",
                backgroundColor: isRegistered ? "#dcfce7" : "#fee2e2",
                color: isRegistered ? "#166534" : "#991b1b",
                border: `1px solid ${isRegistered ? "#bbf7d0" : "#fecaca"}`,
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: isRegistered ? "#22c55e" : "#ef4444",
                }}
              />
              {row.is_register}
            </span>
          </div>
        );
      },
    },
  ];
  const filteredInvestors = InvestorDetail.filter((row) => {
    const search = searchText.toLowerCase();

    return (
      (row.first_name || "").toLowerCase().includes(search) ||
      (row.last_name || "").toLowerCase().includes(search) ||
      (row.email || "").toLowerCase().includes(search) ||
      (row.phone || "").toLowerCase().includes(search) ||
      (row.is_register || "").toLowerCase().includes(search)
    );
  });
  return (
    <div className="col-12">
      <div className="card p-3">
        <h5 className="mb-3">DataRoom Management</h5>
        <div className="d-flex  flex-column justify-content-between align-items-start tb-box">
          <style>
            {`
                        .datatb-report {
                          overflow: visible !important;
                        }
                      `}
          </style>
          <DataTable
            columns={columnsinvestor}
            data={filteredInvestors}
            pagination
            highlightOnHover
            striped
            responsive
            customStyles={customStyles}
            className="custom-scrollbar custome-icon datatb-report"
            noDataComponent={
              <div className="text-center py-2">
                <span>No record found</span>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}

export default AdminiInvestorDataroomTable;
