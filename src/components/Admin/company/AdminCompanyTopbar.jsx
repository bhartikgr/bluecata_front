import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { FaArrowLeft } from "react-icons/fa";
import { Building2, User } from "lucide-react";

function AdminCompanyTopbar({ id }) {
  // ✅ receive id prop
  const [Userid, setUserid] = useState("");
  const [CompanyName, setCompanyName] = useState("");
  const [ownername, setownername] = useState("");
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

  return (
    <div className="col-12">
      <div
        className="dashmain_box"
        style={{
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          color: "white",
          padding: "1.5rem",
        }}
      >
        <div className="d-flex align-items-center gap-3">
          {/* Back Button */}
          <Link
            to={`/admin/users/company/${Userid}`}
            className="btn"
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              color: "white",
              border: "none",
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              transition: "background-color 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor =
                "rgba(255, 255, 255, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor =
                "rgba(255, 255, 255, 0.2)";
            }}
          >
            <FaArrowLeft />
            Back
          </Link>

          {/* Icon */}
          <div
            style={{
              width: "56px",
              height: "56px",
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Building2 style={{ width: "28px", height: "28px" }} />
          </div>

          {/* Company Info */}
          <div className="flex-grow-1">
            <h3
              className="mb-1"
              style={{ fontSize: "1.75rem", fontWeight: "600" }}
            >
              {CompanyName || "Company Name"}
            </h3>
            <p
              className="mb-0 d-flex align-items-center gap-2"
              style={{ fontSize: "0.95rem", opacity: 0.9 }}
            >
              <User style={{ width: "16px", height: "16px" }} />
              <span>Owner: {ownername}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminCompanyTopbar;
