import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import DataTable from "react-data-table-component";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import { FaEye, FaArrowLeft } from "react-icons/fa"; // FontAwesome icons
function AdminTrackingReferralCodeview() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const { discount_code } = useParams();
  useEffect(() => {
    document.title = "Referral Tracking Table - Admin";
  }, []);
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [searchQuery, setSearchQuery] = useState("");
  const [DiscountCode, setDiscountCode] = useState([]);
  const [CodeId, setCodeId] = useState("");
  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  const [successMessage, setsuccessMessage] = useState("");

  const columns = [
    {
      name: "Registered Company Name",
      cell: (row) => (
        <>
          <div className="d-flex align-items-center gap-2">
            {row.used_by_company_id !== 0 ? (
              <Link
                target="_blank"
                to={`/admin/company/viewdetails/${row.used_by_company_id}`}
                title="Referral Codes"
              >
                {row.registered_company_name}
              </Link>
            ) : (
              <span className="text-muted">{row.registered_company_name}</span>
            )}
          </div>
        </>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
    {
      name: "Referred By Company Name",
      cell: (row) => (
        <>
          <div className="d-flex align-items-center gap-2">
            {row.referred_by_id !== 0 ? (
              <Link
                target="_blank"
                to={`/admin/company/viewdetails/${row.referred_by_id}`}
                title="Referral Codes"
              >
                {row.referred_by_company_name}
              </Link>
            ) : (
              <span className="text-muted">{row.referred_by_company_name}</span>
            )}
          </div>
        </>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
    {
      name: "Registered on",
      selector: (row) => {
        const date = new Date(row.registered_on);
        return date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "2-digit",
        });
      },
      sortable: true,
      className: "age",
    },
    {
      name: "Used Referral Code",
      selector: (row) => row.discount_code,
      sortable: true,
      className: "age",
    },

    {
      name: "Discount",
      selector: (row) => row.percentage + "%",
      sortable: true,
      className: "age",
    },
    {
      name: "Actions",
      cell: (row) => (
        <Link
          to={`/admin/setting/tracking/view/${row.discount_code}/${row.used_by_company_id}`}
          className="dataedit_btn"
          title="View Details"
        >
          <FaEye />
        </Link>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];

  useEffect(() => {
    gettrackingData();
  }, []);
  const gettrackingData = async () => {
    let formData = {
      discount_code: discount_code,
    };
    try {
      const res = await axios.post(apiUrl + "gettrackingData", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      setRecords(respo);
    } catch (err) {
      // Enhanced error handling
      if (err.response) {
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
  };
  const customStyles = {
    table: {
      style: {
        minWidth: "100%",
        boxShadow: "0 10px 15px rgba(0, 0, 0, 0.2)",
        border: "1px solid #00000036",
        borderRadius: "12px",
        overflow: "hidden",
        display: "block",
      },
    },
    headRow: {
      style: {
        display: "grid",
        gridTemplateColumns:
          "minmax(150px, 1fr) minmax(150px, 1fr) minmax(200px, 1fr) minmax(120px, 1fr) 80px 150px",
        backgroundColor: "#ff3f45",
        color: "#fff",
        fontWeight: "600",
        fontSize: "12px",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      },
    },
    headCells: {
      style: {
        padding: "8px",
        textAlign: "left",
      },
    },
    rows: {
      style: {
        display: "grid",
        gridTemplateColumns:
          "minmax(150px, 1fr) minmax(150px, 1fr) minmax(200px, 1fr) minmax(120px, 1fr) 80px 150px",
        fontSize: "14px",
        "&:hover": {
          backgroundColor: "#e8f0fe",
        },
      },
      stripedStyle: {
        backgroundColor: "#f4f6f8",
      },
    },
    cells: {
      style: {
        whiteSpace: "normal",
        overflow: "hidden",
        textOverflow: "ellipsis",
        padding: "8px",
        display: "flex",
        alignItems: "center",
      },
    },
    pagination: {
      style: {
        backgroundColor: "#fafafa",
        padding: "12px 16px",
      },
    },
  };
  return (
    <>
      <div>
        <div className="d-flex align-items-start gap-0">
          <Sidebar />
          <div className="d-flex flex-column gap-0 w-100 dashboard_padding">
            <TopBar />
            <section className="dashboard_adminh">
              <div className="container-xl">
                <div className="row gy-4">
                  <div className="col-12">
                    <div className="card p-4">
                      {successMessage && (
                        <SuccessAlert
                          message={successMessage}
                          onClose={() => setsuccessMessage("")}
                        />
                      )}
                      <div className="d-flex justify-content-between mb-3">
                        <Link
                          to={`/admin/setting/tracking/code/`}
                          className="btn btn-secondary py-2 my-3"
                          style={{ width: "fit-content" }}
                        >
                          <FaArrowLeft /> Back
                        </Link>
                        <h5 className="mb-3">Registered Company By Referral</h5>
                      </div>

                      <div className="d-flex justify-content-end align-items-end">
                        <div class="search-bar">
                          <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                          />
                          <span class="search-icon">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                              />
                            </svg>
                          </span>
                        </div>
                      </div>
                      <DataTable
                        columns={columns}
                        data={filteredRecords}
                        pagination
                        highlightOnHover
                        striped
                        responsive
                        customStyles={customStyles}
                        className="custom-scrollbar custome-icon"
                        noDataComponent={
                          <div className="text-center py-2">
                            <span>No users found</span>
                          </div>
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

export default AdminTrackingReferralCodeview;
