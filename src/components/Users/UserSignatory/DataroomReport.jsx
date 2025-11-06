// DataroomReport.js
import React, { useState } from "react";
import DataTable from "react-data-table-component";
import { VscOpenPreview } from "react-icons/vsc";

const DataroomReport = ({ visibleFields = [], data = [] }) => {
  const showField = (field) => visibleFields.includes(field);

  // Sample data - replace with your actual data prop
  const sampleData = [];

  const tableData = data.length > 0 ? data : sampleData;

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  // Format number with commas
  const formatNumber = (num) => {
    return new Intl.NumberFormat("en-US").format(num);
  };

  // Capitalize first letter
  const capitalize = (text) => {
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  };

  const columns = [
    showField("share_class") && {
      name: "Share Class",
      selector: (row) => row.share_class,
      sortable: true,
      cell: (row) => <strong>{row.share_class}</strong>,
    },
    showField("target_raise_amount") && {
      name: "Target Raise Amount",
      selector: (row) => row.target_raise_amount,
      sortable: true,
      cell: (row) => formatCurrency(row.target_raise_amount),
      right: true,
    },
    showField("number_of_shares") && {
      name: "Number of Shares",
      selector: (row) => row.number_of_shares,
      sortable: true,
      cell: (row) => formatNumber(row.number_of_shares),
      right: true,
    },
    showField("status") && {
      name: "Status of Round",
      cell: (row) => {
        const statusStyles = {
          active: {
            backgroundColor: "#d4edda",
            color: "#155724",
          },
          pending: {
            backgroundColor: "#fff3cd",
            color: "#856404",
          },
          completed: {
            backgroundColor: "#d1ecf1",
            color: "#0c5460",
          },
          closed: {
            backgroundColor: "#f8d7da",
            color: "#721c24",
          },
        };

        const style = statusStyles[row.status] || {
          backgroundColor: "#f8f9fa",
          color: "#212529",
        };

        return (
          <div
            title={row.status || ""}
            style={{
              ...style,
              padding: "5px 10px",
              borderRadius: "5px",
              textAlign: "center",
              minWidth: "80px",
            }}
          >
            {capitalize(row.status)}
          </div>
        );
      },
      sortable: true,
    },
    {
      name: "Action",
      cell: (row) => (
        <button
          className="icon_btn blue_clr"
          type="button"
          onClick={() => handleView(row.id)}
          title="View Details"
        >
          <VscOpenPreview /> View
        </button>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
      width: "150px",
    },
  ].filter(Boolean); // Remove false values from hidden fields

  const handleView = (id) => {
    console.log("View details for round:", id);
    // Add your view logic here
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

  return (
    <div className="d-flex flex-column overflow-auto justify-content-between align-items-start tb-box">
      <DataTable
        customStyles={customStyles}
        columns={columns}
        className="datatb-report"
        data={tableData}
        pagination
        highlightOnHover
        striped
        responsive
      />
    </div>
  );
};

export default DataroomReport;
