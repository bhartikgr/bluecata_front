import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin/TopBar";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa";
import axios from "axios";
import ReactQuill from "react-quill"; // npm install react-quill
import "react-quill/dist/quill.snow.css";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import DangerAlert from "../../../components/Admin/DangerAlert";
function AdminZoomCreate() {
  const navigate = useNavigate();
  const apiUrl = "http://localhost:5000/api/admin/module/";
  document.title = "Create Zoom Meeting - Admin";
  const { id } = useParams("");
  useEffect(() => {
    document.title = id
      ? "Edit Zoom Meeting - Admin"
      : "Create Zoom Meeting - Admin";
  }, [id]);
  const [successMessage, setsuccessMessage] = useState("");
  const [errorMessage, seterrorMessage] = useState("");
  const [allmodule, setAllModule] = useState([]);
  const [editdata, seteditdata] = useState("");
  const [ClientIP, setClientIP] = useState("");
  const [form, setForm] = useState({
    module_id: "",
    date: "",
    meeting_id: "",
    topic: "",
    meeting_date: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    zoom_link: "",
  });
  useEffect(() => {
    const getIP = async () => {
      try {
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json();
        setClientIP(data.ip); // Save this to state
      } catch (error) {
        console.error("Failed to fetch IP", error);
      }
    };

    getIP();
  }, []);
  useEffect(() => {
    if (id) {
      getzoomdata();
    }
  }, [id]);
  const getzoomdata = async () => {
    try {
      const res = await axios.post(apiUrl + "getzoomdata", { id: id });
      if (res.data.results.length === 0) {
        navigate("/admin/zoomeetlist");
      } else {
        seteditdata(res.data.results[0]);
      }
    } catch (err) {
      console.error("Error fetching modules", err);
    }
  };
  useEffect(() => {
    if (editdata) {
      const datePart = formatDate(editdata.meeting_date);
      const timePart = formatTime(editdata.time);

      setForm({
        module_id: editdata.module_id || "",
        date: editdata.date || "",
        meeting_date: `${datePart}T${timePart}`, // final format
        meeting_id: editdata.meeting_id,
        topic: editdata.topic,
        timezone:
          editdata.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        zoom_link: editdata.zoom_link || "",
      });
    }
  }, [editdata]);
  const formatDate = (isoDate) => {
    const dt = new Date(isoDate);
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return "00:00";
    // Handles time like "14:57:00" or "14:57"
    return timeStr.slice(0, 5); // Only keep "HH:mm"
  };

  const formatDateTimeLocal = (isoDateString) => {
    if (!isoDateString) return "";
    const dt = new Date(isoDateString);

    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    const hours = String(dt.getHours()).padStart(2, "0");
    const minutes = String(dt.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const combineDateAndTime = (dateString, timeString) => {
    if (!dateString || !timeString) return "";
    const date = new Date(dateString);
    const [hh, mm] = timeString.split(":");
    date.setHours(hh);
    date.setMinutes(mm);
    return formatDateTimeLocal(date.toISOString());
  };

  useEffect(() => {
    getmodule();
  }, []);

  const getmodule = async () => {
    try {
      const res = await axios.post(apiUrl + "getmodulelist", { user_id: "" });
      setAllModule(res.data.results || []);
    } catch (err) {
      console.error("Error fetching modules", err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    var forms = e.target;
    let formdata = {
      module_id: form.module_id,
      meeting_date: form.meeting_date,
      timezone: form.timezone,
      zoom_link: form.zoom_link,
      ip_address: ClientIP,
      meeting_id: form.meeting_id,
      topic: form.topic,
      id: id,
    };

    try {
      const res = await axios.post(apiUrl + "createzoommeet", formdata);
      console.log(res.data.message);
      if (res.data.status === "1") {
        setsuccessMessage(res.data.message);
        setTimeout(() => {
          navigate("/admin/zoomeetlist");
        }, 1100);
      } else {
        seterrorMessage(res.data.message);
      }
      setTimeout(() => {
        setsuccessMessage("");
        seterrorMessage("");
      }, 1200);
    } catch (err) {
      console.error("Error creating zoom meet", err);
      alert("Error creating zoom meeting.");
    }
  };

  return (
    <div className="d-flex align-items-start gap-0">
      <Sidebar />
      <div className="d-flex flex-column gap-0 w-100 dashboard_padding">
        <TopBar />
        <section className="dashboard_adminh">
          <div className="container-xl">
            <div className="row gy-4">
              <div className="col-12">
                {successMessage && (
                  <SuccessAlert
                    message={successMessage}
                    onClose={() => setsuccessMessage("")}
                  />
                )}
                {errorMessage && (
                  <DangerAlert
                    message={errorMessage}
                    onClose={() => seterrorMessage("")}
                  />
                )}
                <div className="card p-4">
                  <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                    <Link to="/admin/zoomeetlist" className="btn btn-secondary">
                      <FaArrowLeft /> Back
                    </Link>
                    <h5 className="mb-0">
                      {id !== undefined
                        ? "Edit Zoom Meeting"
                        : "Create Zoom Meeting"}
                    </h5>
                  </div>

                  <form onSubmit={handleSubmit}>
                    <input type="hidden" name="id" value={editdata.id} />
                    <div className="d-flex flex-column gap-3">
                      <div className="d-flex flex-column gap-1">
                        <label>
                          Topic{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          value={form.topic}
                          onChange={(e) =>
                            setForm({ ...form, topic: e.target.value })
                          }
                          placeholder="Enter here..."
                          required
                        />
                      </div>
                      <div className="d-flex flex-column gap-1">
                        <label>
                          Module{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <select
                          className="form-select"
                          name="module_id"
                          value={form.module_id}
                          onChange={(e) =>
                            setForm({ ...form, module_id: e.target.value })
                          }
                          required
                        >
                          <option value="">Select Module</option>
                          {allmodule.map((m, idx) => (
                            <option key={idx} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="d-flex flex-column gap-1">
                        <label>
                          Event Date & Time{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="datetime-local"
                          name="meeting_date"
                          className="form-control"
                          value={form.meeting_date}
                          onChange={(e) =>
                            setForm({ ...form, meeting_date: e.target.value })
                          }
                          required
                        />
                      </div>

                      <div className="d-flex flex-column gap-1">
                        <label>Timezone</label>
                        <select
                          className="form-select"
                          value={form.timezone}
                          name="timezone"
                          onChange={(e) =>
                            setForm({ ...form, timezone: e.target.value })
                          }
                          required
                        >
                          {Intl.supportedValuesOf("timeZone").map((tz, idx) => (
                            <option key={idx} value={tz}>
                              {tz}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="d-flex flex-column gap-1">
                        <label>
                          Zoom Link{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="url"
                          className="form-control"
                          value={form.zoom_link}
                          onChange={(e) =>
                            setForm({ ...form, zoom_link: e.target.value })
                          }
                          placeholder="https://zoom.us/..."
                          required
                        />
                      </div>
                      <div className="d-flex flex-column gap-1">
                        <label>
                          Meeting Id{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          value={form.meeting_id}
                          onChange={(e) =>
                            setForm({ ...form, meeting_id: e.target.value })
                          }
                          placeholder="123 5555 5454"
                          required
                        />
                      </div>
                    </div>
                    <div className="d-flex justify-content-end align-items-end">
                      <button className="admin_btn mt-4">
                        {id !== undefined
                          ? "Edit Zoom Meeting"
                          : "Create Zoom Meeting"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default AdminZoomCreate;
