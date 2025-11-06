import React, { useState, useEffect, useRef } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import { FaTrashAlt } from "react-icons/fa";
import { FaEdit } from "react-icons/fa";
import { useNavigate, useParams } from "react-router-dom";
import { FaPlus } from "react-icons/fa6";
import { Modal, Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import { FaArrowLeft } from "react-icons/fa";
import axios from "axios";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
function AdminModuleAdd() {
  const quillRef = useRef();
  const [contentsharing, setContentsharing] = useState("");
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const [deleteId, setdeleteId] = useState(false);
  const [showEdit, setshowEdit] = useState(false);
  const [editdata, seteditdata] = useState("");
  const [editmodule, seteditmodule] = useState("");
  const { id } = useParams("");
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  useEffect(() => {
    document.title = id ? "Edit Module - Admin" : "Add Module - Admin";
  }, [id]);

  //Check id
  useEffect(() => {
    if (id) {
      checkmoduleData();
    }
  }, [id]);
  const checkmoduleData = async () => {
    let formData = {
      id: id,
    };
    try {
      const res = await axios.post(apiUrl + "checkmoduleData", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      if (respo.length === 0) {
        navigate("/admin/module/list");
      } else {
        setContentsharing(respo[0].description);
        seteditmodule(respo[0]);
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
  //Check id

  useEffect(() => {
    getmodule();
  }, []);
  const getmodule = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getmodulelist", formData, {
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
  const handleEdit = async (id) => {
    setshowEdit(true);
    let formData = {
      id: id,
    };
    try {
      const res = await axios.post(apiUrl + "getmodulerecord", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      console.log(respo);
      seteditdata(respo[0]);
      setMaxLimit(respo[0].max_limit);
      const fullPath = respo[0].video;
      const fileName = fullPath.split("\\").pop();
      setFile(fileName);
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

  const handledelete = (id) => {
    setdeleteId(id);
    setShow(true);
  };
  const handleClose = () => {
    setShow(false);
    setshowEdit(false);
  };
  const handleChangesharing = (value) => {
    setContentsharing(value);
  };
  const handleConfirmDelete = async () => {
    let formData = {
      id: deleteId,
    };
    try {
      const res = await axios.post(apiUrl + "videodelete", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      getmodule();
      setShow(false);
      setTimeout(() => {
        setsuccessMessage("Video deleted successfully");
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
    // Close the modal after deletion
  };
  const [maxLimit, setMaxLimit] = useState("");
  const [file, setFile] = useState(null);
  const [filenew, setFilenew] = useState(null);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    let formdata = {
      name: e.target.name.value,
      status: e.target.status.value,
      description: contentsharing,
      textt: e.target.textt.value,
      id: e.target.id.value,
    };
    try {
      const res = await axios.post(apiUrl + "savemodule", formdata, {
        headers: {
          Accept: "application/json",
        },
      });

      var respo = res.data.results;
      setsuccessMessage("Successfully Created");

      setTimeout(() => {
        navigate("/admin/module/list");
      }, 1000);
    } catch (err) {
      if (err.response) {
        console.error("Server error:", err.response.data);
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
  };
  const handlestatus = (e) => {
    const selected = e.target.value;
    console.log(selected);
    seteditmodule((prev) => ({
      ...prev,
      status: selected,
    }));
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
                    {successMessage && (
                      <SuccessAlert
                        message={successMessage}
                        onClose={() => setsuccessMessage("")}
                      />
                    )}
                    <div className="card p-4">
                      <div className="d-flex justify-content-between gap-2 flex-wrap mb-2">
                        <div className="d-flex mb-3">
                          <Link
                            to="/admin/module/list"
                            className="btn btn-secondary"
                          >
                            <FaArrowLeft /> Back
                          </Link>
                        </div>
                        <h5 className="mb-4">
                          {id !== undefined ? "Edit Module" : "Add Module"}
                        </h5>
                      </div>
                      <form
                        action="javascript:void(0)"
                        onSubmit={handleSubmit}
                        method="post"
                        className="d-flex flex-column gap-4 align-items-start"
                      >
                        <input type="hidden" name="id" value={editmodule.id} />
                        <div className="d-flex flex-wrap gap-4 w-100">
                          <div className="w-100">
                            <label
                              htmlFor="exampleInputLimit"
                              className="form-label text-dark"
                            >
                              Name{" "}
                              <span style={{ color: "var(--primary)" }}>*</span>
                            </label>
                            <input
                              type="text"
                              name="name"
                              defaultValue={editmodule.name}
                              required
                              min="1"
                              placeholder="Enter name"
                              className="form-control w-100"
                              id="exampleInputLimit"
                            />
                          </div>
                          <div className=" text-start w-100">
                            <label
                              htmlFor="exampleInputLimit"
                              className="form-label text-dark"
                            >
                              Status{" "}
                              <span style={{ color: "var(--primary)" }}>*</span>
                            </label>
                            <select
                              value={editmodule.status || ""}
                              className="form-control w-100"
                              name="status"
                              onChange={handlestatus}
                              required
                            >
                              <option value="">--Select--</option>
                              <option value="Active">Active</option>
                              <option value="Inactive">In Active</option>
                            </select>
                          </div>
                        </div>

                        <div className="text-start  w-100">
                          <label
                            htmlFor="exampleInputLimit"
                            className="form-label text-dark"
                          >
                            Text{" "}
                            <span style={{ color: "var(--primary)" }}>*</span>
                          </label>
                          <input
                            defaultValue={editmodule.textt}
                            required
                            className="form-control"
                            name="textt"
                            placeholder="Enter here..."
                          />
                        </div>
                        <div className=" text-start w-100">
                          <label
                            htmlFor="exampleInputLimit"
                            className="form-label text-dark"
                          >
                            Description{" "}
                            <span style={{ color: "var(--primary)" }}>*</span>
                          </label>
                          <ReactQuill
                            ref={quillRef}
                            value={contentsharing}
                            onChange={handleChangesharing}
                            style={{ height: "200px" }}
                            theme="snow"
                          />
                        </div>

                        <div className="d-block mt-5 w-100">
                          {successMessage && (
                            <SuccessAlert
                              message={successMessage}
                              onClose={() => setsuccessMessage("")}
                            />
                          )}
                          <div className="d-flex justify-content-end align-items-end">
                            <button type="submit" className="admin_btn ">
                              Submit
                            </button>
                          </div>
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
      <Modal className="text-white" show={show} onHide={handleClose}>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Deletion</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Are you sure you want to delete this record?</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirmDelete}>
            Confirm Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

export default AdminModuleAdd;
