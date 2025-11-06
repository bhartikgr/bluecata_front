import React, { useEffect, useState } from "react";
import { VscOpenPreview } from "react-icons/vsc";
import { FaEye, FaCalendar, FaEnvelope, FaClock } from "react-icons/fa";
import { IoCloseCircleOutline } from "react-icons/io5";
import { MdDescription } from "react-icons/md";
import { API_BASE_URL } from "../../../config/config";
import axios from "axios";
import DataTable from "react-data-table-component";

const ShareInvestorReportList = ({ onClose, ReportId }) => {
  const [records, setrecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterText, setFilterText] = useState("");

  const apiUrlDashboard = API_BASE_URL + "api/user/signatorydashboard/";

  useEffect(() => {
    getShareInvestorreport();
  }, []);

  const getShareInvestorreport = async () => {
    const formData = {
      id: ReportId,
    };
    setLoading(true);
    try {
      const resp = await axios.post(
        apiUrlDashboard + "getShareInvestorreport",
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
      console.error("Error fetching data", err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status) => {
    const badges = {
      "Not View": <span className="badge bg-secondary">Not Viewed</span>,
      "Only View": <span className="badge bg-info">Viewed</span>,
      Download: <span className="badge bg-success">Downloaded</span>,
    };
    return (
      badges[status] || <span className="badge bg-secondary">{status}</span>
    );
  };

  // Define columns for DataTable
  const columns = [
    {
      name: "#",
      selector: (row, index) => index + 1,
      sortable: false,
      width: "60px",
      center: true,
    },
    {
      name: "Investor Name",
      selector: (row) => `${row.first_name || ""} ${row.last_name || ""}`,
      sortable: true,
      width: "180px",
      cell: (row) => (
        <div className="d-flex align-items-center py-2">
          <div
            className="bg-primary bg-opacity-10 rounded-circle d-flex align-items-center justify-content-center me-2"
            style={{ width: "32px", height: "32px", flexShrink: 0 }}
          >
            <FaEye className="text-primary" size={14} />
          </div>
          <div>
            <div className="fw-semibold">
              {row.first_name || ""} {row.last_name || ""}
            </div>
            <small className="text-muted">ID: {row.investor_id}</small>
          </div>
        </div>
      ),
    },
    {
      name: "Email",
      selector: (row) => row.email || row.investor_email || "N/A",
      sortable: true,
      width: "220px",
      cell: (row) => (
        <div className="d-flex align-items-center">
          <FaEnvelope className="me-2 text-muted" size={14} />
          <small>{row.email || row.investor_email || "N/A"}</small>
        </div>
      ),
    },
    {
      name: "Document",
      selector: (row) => row.document_name || "N/A",
      sortable: true,
      width: "200px",
      cell: (row) => (
        <div className="fw-semibold">{row.document_name || "N/A"}</div>
      ),
    },
    {
      name: "Version",
      selector: (row) => row.version || "N/A",
      sortable: true,
      width: "100px",
      center: true,
      cell: (row) => (
        <span className="badge bg-secondary">{row.version || "N/A"}</span>
      ),
    },
    {
      name: "Report Type",
      selector: (row) => row.report_type || "N/A",
      sortable: true,
      width: "150px",
    },
    {
      name: "Sent Date",
      selector: (row) => row.sent_date,
      sortable: true,
      width: "140px",
      cell: (row) => (
        <div className="d-flex align-items-center">
          <FaCalendar className="me-2 text-muted" size={12} />
          <small>{formatDate(row.sent_date)}</small>
        </div>
      ),
    },

    {
      name: "Date Viewed",
      selector: (row) => row.date_view,
      sortable: true,
      width: "160px",
      cell: (row) =>
        row.date_view ? (
          <small>{formatDateTime(row.date_view)}</small>
        ) : (
          <span className="text-muted">Not viewed</span>
        ),
    },
    {
      name: "Status",
      selector: (row) => row.access_status,
      sortable: true,
      width: "130px",
      center: true,
      cell: (row) => getStatusBadge(row.access_status),
    },
    {
      name: "IP Address",
      selector: (row) => row.investor_ip || "N/A",
      sortable: true,
      width: "150px",
      cell: (row) => (
        <small className="font-monospace">{row.investor_ip || "N/A"}</small>
      ),
    },
  ];

  // Filter records based on search
  const filteredRecords = records.filter((record) => {
    const searchLower = filterText.toLowerCase();
    return (
      record.first_name?.toLowerCase().includes(searchLower) ||
      false ||
      record.last_name?.toLowerCase().includes(searchLower) ||
      false ||
      record.email?.toLowerCase().includes(searchLower) ||
      false ||
      record.investor_email?.toLowerCase().includes(searchLower) ||
      false ||
      record.document_name?.toLowerCase().includes(searchLower) ||
      false ||
      record.unique_code?.toLowerCase().includes(searchLower) ||
      false ||
      record.report_type?.toLowerCase().includes(searchLower) ||
      false
    );
  });

  // Custom styles for DataTable
  const customStyles = {
    headRow: {
      style: {
        backgroundColor: "#f8f9fa",
        borderBottom: "2px solid #dee2e6",
        fontWeight: "600",
      },
    },
    headCells: {
      style: {
        fontSize: "14px",
        fontWeight: "600",
        color: "#495057",
        paddingLeft: "12px",
        paddingRight: "12px",
      },
    },
    rows: {
      style: {
        fontSize: "13px",
        "&:hover": {
          backgroundColor: "#f8f9fa",
          cursor: "pointer",
        },
      },
    },
    cells: {
      style: {
        paddingLeft: "12px",
        paddingRight: "12px",
      },
    },
  };

  // Subheader component with search
  const subHeaderComponent = (
    <div className="w-100 d-flex justify-content-between align-items-center mb-3">
      <div>
        <h5 className="mb-0">Total Records: {filteredRecords.length}</h5>
      </div>
      <div style={{ width: "300px" }}>
        <input
          type="text"
          className="form-control"
          placeholder="Search records..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
      </div>
    </div>
  );

  return (
    <div className="main_popup-overlay">
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          width: "95%",
          maxWidth: "1600px",
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.2)",
          margin: "20px auto",
        }}
      >
        {/* Header */}
        <div className="p-4 border-bottom bg-light">
          <div className="d-flex align-items-center">
            <div
              style={{ width: "50px", height: "50px" }}
              className="bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 rounded-circle me-3"
            >
              <VscOpenPreview size={24} className="text-success" />
            </div>
            <div className="d-flex align-items-center justify-content-between gap-3 w-100">
              <div>
                <h3 className="mb-1 fw-bold text-dark">
                  Shared Investor Reports
                </h3>
                <small className="text-muted">View all shared reports</small>
              </div>
              <button
                type="button"
                className="bg-transparent text-danger border-0 p-0"
                onClick={onClose}
                style={{ cursor: "pointer" }}
              >
                <IoCloseCircleOutline size={28} />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Content with DataTable */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px",
          }}
        >
          {loading ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
              <p className="mt-3 text-muted">Loading records...</p>
            </div>
          ) : records.length > 0 ? (
            <DataTable
              columns={columns}
              data={filteredRecords}
              pagination
              paginationPerPage={10}
              paginationRowsPerPageOptions={[5, 10, 25, 50, 100]}
              highlightOnHover
              striped
              responsive
              customStyles={customStyles}
              subHeader
              subHeaderComponent={subHeaderComponent}
              noDataComponent={
                <div className="text-center py-5">
                  <MdDescription size={40} className="text-muted mb-3" />
                  <h5 className="text-muted">No Records Found</h5>
                  <p className="text-muted">
                    No records match your search criteria.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="text-center py-5">
              <div
                className="bg-light rounded-circle d-inline-flex align-items-center justify-content-center mb-3"
                style={{ width: "80px", height: "80px" }}
              >
                <MdDescription size={40} className="text-muted" />
              </div>
              <h5 className="text-muted">No Records Found</h5>
              <p className="text-muted">
                There are no shared reports for this investor update.
              </p>
            </div>
          )}
        </div>

        {/* Footer with Buttons */}
        <div className="p-3 border-top bg-light d-flex justify-content-end gap-2">
          <button
            onClick={onClose}
            className="btn btn-secondary px-4"
            style={{ minWidth: "100px" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShareInvestorReportList;
