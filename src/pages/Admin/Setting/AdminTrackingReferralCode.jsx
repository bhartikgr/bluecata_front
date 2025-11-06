import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Link } from "react-router-dom";
import DataTable from "react-data-table-component";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import { FaEye } from "react-icons/fa"; // FontAwesome icons
function AdminTrackingReferralCode() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  useEffect(() => {
    document.title = "Tracking Referral - Admin";
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
      name: "Referral Code",
      selector: (row) => row.discount_code,
      sortable: true,
      className: "age",
    },

    {
      name: "Actions",
      cell: (row) => (
        <Link
          to={`/admin/setting/tracking/code/view/${row.discount_code}`}
          className="btn btn-sm btn-outline-primary"
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
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getcodelist", formData, {
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
                        <h5 className="mb-3">Tracking Referral Code</h5>
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
                        noDataComponent={
                          <div className="text-center">
                            <span>No results found</span>
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

export default AdminTrackingReferralCode;
