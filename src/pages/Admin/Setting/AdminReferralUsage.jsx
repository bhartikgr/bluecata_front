import React, { useState, useEffect, useRef } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate, useParams, Link } from "react-router-dom";
import axios from "axios";
import DataTable from "react-data-table-component";
import { Modal, Button } from "react-bootstrap";
import { FaArrowLeft } from "react-icons/fa";
function AdminReferralUsage() {
  useEffect(() => {
    document.title = "Referral Usage- Admin";
  }, []);
  const [records, setrecords] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const { code } = useParams();
  useEffect(() => {
    if (code) {
      getallreferredUsage();
    }
  }, []);
  const getallreferredUsage = async () => {
    let formData = {
      code: code,
    };
    try {
      const res = await axios.post(apiUrl + "getallreferredUsage", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      setrecords(respo);
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
  const columns = [
    {
      name: "Code",
      selector: (row) => row.discount_code,
      sortable: true,
      className: "age",
    },

    {
      name: "Used By Company",
      selector: (row) => row.company_name,
      sortable: true,
      className: "age",
    },

    {
      name: "Company Email",
      selector: (row) => row.email,
      sortable: true,
      className: "age",
    },
    {
      name: "Company Country",
      selector: (row) => row.company_country,
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
      name: "Register On",
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
  ];
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  const customStyles = {
    table: {
      style: {
        width: "100%",
        boxShadow: "0 10px 15px rgba(0, 0, 0, 0.2)",
        border: "1px solid #00000036",
        borderRadius: "12px",
        overflow: "hidden",
      },
    },
    headCells: {
      style: {
        backgroundColor: "#ff3f45 !important",
        fontWeight: "600",
        fontSize: "12px",
        color: "#fff !important",
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
        fontSize: "14px",
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

  return (
    <>
      <div>
        <div className="d-flex align-items-start gap-0">
          <div>
            <Sidebar />
          </div>
          <div className="d-flex flex-column gap-0 w-100 dashboard_padding">
            <TopBar />
            <section className="dashboard_adminh">
              <div className="container-xl">
                <div className="row gy-4">
                  <div className="col-12">
                    <div className="card p-4">
                      <div className="d-flex justify-content-between align-items-center mb-3">
                        <Link
                          to={`/admin/setting/paymentdiscountlist`}
                          className="btn btn-secondary py-2 "
                          style={{ width: "fit-content" }}
                        >
                          <FaArrowLeft /> Back
                        </Link>
                        <h5 className="m-0">Referral Usage</h5>
                      </div>
                      <div className="d-flex justify-content-end pb-3 align-items-end">
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
                      <div className="responsive-table-wrapper">
                        <DataTable
                          columns={columns}
                          data={filteredRecords}
                          pagination
                          highlightOnHover
                          striped
                          responsive={true}
                          customStyles={customStyles}
                          className="custom-scrollbar custome-icon"
                          noDataComponent={
                            <div className="text-center py-2">
                              <span>No results found</span>
                            </div>
                          }
                        />
                      </div>
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

export default AdminReferralUsage;
