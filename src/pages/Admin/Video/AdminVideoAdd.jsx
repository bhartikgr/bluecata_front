import React, { useState, useEffect, useRef } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
function AdminVideoAdd() {
  const navigate = useNavigate();
  const quillRef = useRef();
  const [contentsharing, setContentsharing] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const [spinners, setspinnsers] = useState(false);
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  useEffect(() => {
    document.title = "Upload Video - Admin";
  }, []);
  const apiUrl = "http://localhost:5000/api/admin/video/";
  const [records, setRecords] = useState([]);
  useEffect(() => {
    getvideo();
  }, []);
  const getvideo = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getvideolist", formData, {
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
  const [maxLimit, setMaxLimit] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setspinnsers(false);
    if (selectedFile) {
      const maxSize = 35 * 1024 * 1024; // 35 MB in bytes

      if (selectedFile.size > maxSize) {
        setError("File size should not exceed 35MB.");
        e.target.value = null; // clear the selected file
        setFile(null);
      } else {
        setError("");
        setFile(selectedFile);
      }
    }
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("max_limit", maxLimit);
    formData.append("description", contentsharing);
    setspinnsers(true);
    try {
      const res = await axios.post(apiUrl + "savevideo", formData, {
        headers: {
          Accept: "application/json",
        },
      });
      var respo = res.data.results;
      setsuccessMessage("Video uploaded successfully");
      setTimeout(() => {
        navigate("/admin/video/list");
      }, 1000); // 3
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
  const handleChangesharing = (value) => {
    setContentsharing(value);
  };
  return (
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
                    <h5 className="mb-4">Add Video</h5>
                    <form
                      onSubmit={handleSubmit}
                      method="post"
                      className="d-flex flex-column gap-4 align-items-end"
                    >
                      {/* File Upload */}
                      <div className="w-100">
                        <label
                          htmlFor="exampleInputFile"
                          className="form-label fw-normal"
                        >
                          Upload File{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="file"
                          accept="video/*"
                          required
                          name="file"
                          className="form-control"
                          id="exampleInputFile"
                          aria-describedby="fileHelp"
                          onChange={handleFileChange}
                        />
                        {error && (
                          <div className="text-danger mt-1">{error}</div>
                        )}
                      </div>

                      {/* Max Limit */}
                      <div className="w-100">
                        <label
                          htmlFor="exampleInputLimit"
                          className="form-label fw-normal"
                        >
                          Maximum Views Per Client{" "}
                          <span style={{ color: "var(--primary)" }}>*</span>
                        </label>
                        <input
                          type="number"
                          name="max_limit"
                          required
                          min="1"
                          className="form-control"
                          id="exampleInputLimit"
                          value={maxLimit}
                          onChange={(e) => setMaxLimit(e.target.value)}
                        />
                      </div>
                      <div className="w-100 ">
                        <label
                          htmlFor="exampleInputLimit"
                          className="form-label text-dark"
                        >
                          Video Summary
                        </label>
                        <ReactQuill
                          ref={quillRef}
                          value={contentsharing}
                          onChange={handleChangesharing}
                          className="custom_quill"
                          theme="snow"
                        />
                      </div>
                      {/* Submit Button */}
                      <div className="mt-1">
                        <button
                          type="submit"
                          className="admin_btn position-relative"
                        >
                          {spinners && (
                            <span
                              className="spinner-border spinner-border-sm  text-dark position-absolute"
                              style={{
                                top: "30%",
                                left: "40%",
                              }}
                              role="status"
                            >
                              <span className="visually-hidden">
                                Loading...
                              </span>
                            </span>
                          )}
                          Submit
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
    </div>
  );
}

export default AdminVideoAdd;
