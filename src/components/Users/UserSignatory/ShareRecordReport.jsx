import React, { useEffect, useState } from "react";
import { VscOpenPreview } from "react-icons/vsc";
import {
  FaEye,
  FaCalendar,
  FaEnvelope,
  FaClock,
  FaDownload,
  FaFileSignature,
  FaCheckCircle,
  FaTimesCircle,
} from "react-icons/fa";
import { IoCloseCircleOutline } from "react-icons/io5";
import { MdDescription } from "react-icons/md";
import { API_BASE_URL } from "../../../config/config";
import axios from "axios";
import DataTable from "react-data-table-component";

const ShareRecordReport = ({ onClose, ReportId }) => {
  const apiUrlDashboard = API_BASE_URL + "api/user/signatorydashboard/";
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getShareRecordreport();
  }, []);

  const getShareRecordreport = async () => {
    const formData = {
      id: ReportId,
    };
    setLoading(true);
    try {
      const resp = await axios.post(
        apiUrlDashboard + "getShareRecordreport",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setRecords(resp.data.results);
    } catch (err) {
      console.error("Error fetching data", err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return <span className="text-muted">N/A</span>;
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return <span className="text-muted">N/A</span>;
    const date = new Date(dateString);
    return (
      <div>
        <div>
          {date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </div>
        <div className="text-muted small">
          {date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    );
  };

  const getStatusBadge = (status, type = "default") => {
    const statusColors = {
      access: {
        "Not View": "bg-secondary",
        "Only View": "bg-warning",
        Download: "bg-success",
      },
      download: {
        "Not Download": "bg-danger",
        Download: "bg-success",
      },
      signature: {
        No: "bg-danger",
        Yes: "bg-success",
      },
    };

    const colorClass = statusColors[type]?.[status] || "bg-secondary";

    return (
      <span className={`badge ${colorClass} text-white px-3 py-2`}>
        {status}
      </span>
    );
  };

  const columns = [
    {
      name: "Investor Name",
      selector: (row) =>
        `${row.first_name || ""} ${row.last_name || ""}`.trim() || "N/A",
      sortable: true,
      minWidth: "180px",
      cell: (row) => (
        <div className="fw-medium">
          <div className="text-dark">
            {`${row.first_name || ""} ${row.last_name || ""}`.trim() || "N/A"}
          </div>
          <div className="text-muted small">{row.email || "No email"}</div>
        </div>
      ),
    },
    {
      name: "Round Name",
      selector: (row) => row.nameOfRound,
      sortable: true,
      minWidth: "180px",
      cell: (row) => (
        <div className="fw-medium">
          <div className="text-dark">{row.nameOfRound || "N/A"}</div>
          {row.shareClassType && (
            <div className="text-muted small">{row.shareClassType}</div>
          )}
        </div>
      ),
    },
    {
      name: "Instrument Type",
      selector: (row) => row.instrumentType,
      sortable: true,
      minWidth: "150px",
      cell: (row) => (
        <span className="badge bg-primary text-white px-3 py-2">
          {row.instrumentType || "N/A"}
        </span>
      ),
    },
    {
      name: "Round Size",
      selector: (row) => row.roundsize,
      sortable: true,
      minWidth: "150px",
      cell: (row) => (
        <div className="fw-medium">
          <div className="text-dark">
            {row.roundsize
              ? Number(row.roundsize).toLocaleString("en-US")
              : "N/A"}
          </div>
          {row.currency && (
            <div className="text-muted small">{row.currency}</div>
          )}
        </div>
      ),
    },
    {
      name: "Issued Shares",
      selector: (row) => row.issuedshares,
      sortable: true,
      minWidth: "140px",
      cell: (row) => (
        <div className="fw-medium text-dark">
          {row.issuedshares
            ? Number(row.issuedshares).toLocaleString("en-US")
            : "N/A"}
        </div>
      ),
    },
    {
      name: "Sent Date",
      selector: (row) => row.sent_date,
      sortable: true,
      minWidth: "120px",
      cell: (row) => (
        <div className="d-flex align-items-center gap-2">
          <FaCalendar className="text-primary" />
          {formatDate(row.sent_date)}
        </div>
      ),
    },

    {
      name: "Date Viewed",
      selector: (row) => row.date_view,
      sortable: true,
      minWidth: "120px",
      cell: (row) => (
        <div className="d-flex align-items-center gap-2">
          <FaEye className="text-info" />
          {formatDate(row.date_view)}
        </div>
      ),
    },
    {
      name: "Access Status",
      selector: (row) => row.access_status,
      sortable: true,
      minWidth: "140px",
      cell: (row) => getStatusBadge(row.access_status, "access"),
    },
    {
      name: "Termsheet",
      selector: (row) => row.termsheet_status,
      sortable: true,
      minWidth: "140px",
      cell: (row) => (
        <div className="d-flex align-items-center gap-2">
          {getStatusBadge(row.termsheet_status, "download")}
        </div>
      ),
    },

    {
      name: "Report Status",
      selector: (row) => row.report_status,
      sortable: true,
      minWidth: "150px",
      cell: (row) => (
        <span className="badge bg-info text-white px-3 py-2">
          {row.report_status || "N/A"}
        </span>
      ),
    },
  ];

  const customStyles = {
    headRow: {
      style: {
        backgroundColor: "#f8f9fa",
        borderBottom: "2px solid #dee2e6",
        fontSize: "14px",
        fontWeight: "600",
        color: "#495057",
      },
    },
    headCells: {
      style: {
        paddingLeft: "16px",
        paddingRight: "16px",
      },
    },
    rows: {
      style: {
        fontSize: "14px",
        "&:hover": {
          backgroundColor: "#f8f9fa",
          cursor: "pointer",
        },
      },
    },
    cells: {
      style: {
        paddingLeft: "16px",
        paddingRight: "16px",
        paddingTop: "12px",
        paddingBottom: "12px",
      },
    },
  };

  return (
    <div className="main_popup-overlay">
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          width: "98%",
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
        <div className="px-4 py-3 border-bottom bg-gradient-to-r from-primary to-primary-dark">
          <div className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-3">
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  backgroundColor: "rgba(255, 255, 255, 0.2)",
                  borderRadius: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <VscOpenPreview className="text-white" size={24} />
              </div>
              <div>
                <h3 className="mb-0 fw-bold text-white">Share Record Report</h3>
                <p className="mb-0 text-white-50 small mt-1">
                  Investor activity and document tracking
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="btn btn-light btn-sm d-flex align-items-center gap-2"
              style={{
                borderRadius: "8px",
                padding: "8px 16px",
              }}
            >
              <IoCloseCircleOutline size={20} />
              Close
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="px-4 py-3 bg-light border-bottom">
          <div className="row g-3">
            <div className="col-md-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="d-flex align-items-center gap-3">
                    <div className="bg-primary bg-opacity-10 p-3 rounded">
                      <FaEnvelope className="text-primary fs-4" />
                    </div>
                    <div>
                      <div className="text-muted small">Total Records</div>
                      <div className="fs-4 fw-bold">{records.length}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-md-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="d-flex align-items-center gap-3">
                    <div className="bg-info bg-opacity-10 p-3 rounded">
                      <FaEye className="text-info fs-4" />
                    </div>
                    <div>
                      <div className="text-muted small">Viewed</div>
                      <div className="fs-4 fw-bold">
                        {records.filter((r) => r.date_view !== null).length}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="col-md-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="d-flex align-items-center gap-3">
                    <div className="bg-warning bg-opacity-10 p-3 rounded">
                      <FaDownload className="text-warning fs-4" />
                    </div>
                    <div>
                      <div className="text-muted small">Downloads</div>
                      <div className="fs-4 fw-bold">
                        {
                          records.filter((r) => r.access_status === "Download")
                            .length
                        }
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="flex-1 overflow-auto p-4">
          <DataTable
            columns={columns}
            data={records}
            pagination
            paginationPerPage={10}
            paginationRowsPerPageOptions={[10, 20, 30, 50]}
            progressPending={loading}
            progressComponent={
              <div className="text-center py-5">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
              </div>
            }
            noDataComponent={
              <div className="text-center py-5">
                <MdDescription className="text-muted mb-3" size={48} />
                <p className="text-muted">No records found</p>
              </div>
            }
            customStyles={customStyles}
            highlightOnHover
            pointerOnHover
            responsive
            dense
          />
        </div>
      </div>
    </div>
  );
};

export default ShareRecordReport;
