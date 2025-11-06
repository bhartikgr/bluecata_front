import React, { useState, useEffect } from "react";
import Sidebar from "../../components/Admin/Sidebar";
import TopBar from "../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import { Modal, Button } from "react-bootstrap";
import { useNavigate, Link, useParams } from "react-router-dom";
import { FaEye, FaTrashAlt } from "react-icons/fa";
import { HiOutlineUserAdd } from "react-icons/hi";

import SuccessAlert from "../../components/Admin/SuccessAlert";
import axios from "axios";
function AdminCompanyReferralRegsitered() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const [companydata, setcompanydata] = useState("");
  const { id } = useParams();
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  document.title = "Tracking Referral Detail - Admin";
  useEffect(() => {
    getcompanyDetail();
  }, []);
  const getcompanyDetail = async () => {
    let formData = {
      user_id: id,
    };
    try {
      const res = await axios.post(apiUrl + "getcompanyDetail", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      if (respo.length === 0) {
        navigate("/admin/company");
      } else {
        setcompanydata(respo[0]);
      }
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
  useEffect(() => {
    getreferralCompanyDetail();
  }, []);
  const getreferralCompanyDetail = async () => {
    let formData = {
      user_id: id,
    };
    try {
      const res = await axios.post(
        apiUrl + "getreferralCompanyDetail",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data.results;
      console.log(respo);
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
  const columns = [
    {
      name: "Company Name",
      selector: (row) => row.registered_company_name,
      sortable: true,
      className: "age",
    },

    {
      name: "Email",
      selector: (row) => row.registered_company_email,
      sortable: true,
      className: "age",
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
      name: "Discount Code",
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
      name: "Action",
      cell: (row) => (
        <>
          <div className="d-flex align-items-center gap-2">
            <Link className="fs-5">
              <FaEye />
            </Link>
          </div>
        </>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
  const [deleteId, setdeleteId] = useState("");
  const handleDelete = (id) => {
    setdeleteId(id);
    setShow(true);
  };

  const [searchQuery, setSearchQuery] = useState("");

  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

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
                    <div className="card p-3">
                      {successMessage && (
                        <SuccessAlert
                          message={successMessage}
                          onClose={() => setsuccessMessage("")}
                        />
                      )}

                      <div className="d-flex justify-content-between mb-3">
                        <h5 className="mb-3">
                          Tracking Table ({companydata.company_name})
                        </h5>
                      </div>
                      <div className="d-flex justify-content-end align-items-end">
                        <div class="search-bar">
                          <input
                            type="text"
                            placeholder="Search by name or email..."
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

export default AdminCompanyReferralRegsitered;
