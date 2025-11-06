import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate, Link, useParams } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import axios from "axios";
function AdminCompanyView() {
  const navigate = useNavigate();

  const [successMessage, setsuccessMessage] = useState("");

  const { id } = useParams();
  const apiUrl = "http://localhost:5000/api/admin/company/";
  const [records, setRecords] = useState("");
  document.title = "All Registered Companies - Admin";
  useEffect(() => {
    getUsercompnayInfo();
  }, []);
  const getUsercompnayInfo = async () => {
    let formData = {
      company_id: id,
    };

    try {
      const res = await axios.post(apiUrl + "getUsercompnayInfo", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
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
                      <div className="d-flex justify-content-between gap-2 flex-wrap mb-2">
                        <div className="d-flex mb-3 gap-2">
                          <Link
                            to={`/admin/users/company/${records.user_id}`}
                            className="btn btn-secondary"
                          >
                            <FaArrowLeft /> Back
                          </Link>

                          <b>
                            {records?.user_first_name} {records?.user_last_name}
                          </b>
                        </div>
                        <h5 className="mb-4">Company Information</h5>
                      </div>
                      <div className="card p-3 mt-3">
                        <h5 className="mb-3">Company Details</h5>
                        <div className="row">
                          <div className="col-md-6 mb-2">
                            <strong>User:</strong> {records?.user_first_name}{" "}
                            {records?.user_last_name}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Company Name:</strong>{" "}
                            {records?.company_name || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Company Email:</strong>{" "}
                            {records?.company_email || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Phone:</strong> {records?.phone || "-"}
                          </div>

                          <div className="col-md-6 mb-2">
                            <strong>Industory:</strong>{" "}
                            {records?.company_industory || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Employee Number:</strong>{" "}
                            {records?.employee_number || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Street Address:</strong>{" "}
                            {records?.company_street_address || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Country:</strong>{" "}
                            {records?.company_country || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>
                              State / Province / Territory / District:
                            </strong>{" "}
                            {records?.company_state || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>City:</strong>{" "}
                            {records?.company_city || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Postal Code:</strong>{" "}
                            {records?.company_postal_code || "-"}
                          </div>

                          <div className="col-md-6 mb-2">
                            <strong>Year of Registration:</strong>{" "}
                            {records?.year_registration || 0}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>
                              One-sentence headliner about the company:
                            </strong>{" "}
                            {records?.descriptionStep4 || 0}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>What problem are you solving:</strong>{" "}
                            {records?.problemStep4 || 0}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>
                              What is Your Solution to the Problem:
                            </strong>{" "}
                            {records?.solutionStep4 || 0}
                          </div>
                        </div>
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

export default AdminCompanyView;
