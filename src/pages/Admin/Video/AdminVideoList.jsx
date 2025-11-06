import React, { useState, useEffect, useRef } from "react";

import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { FaTrashAlt } from "react-icons/fa";
import { FaEdit, FaVideo } from "react-icons/fa";
import { FaPlus } from "react-icons/fa6";
import { Modal, Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import axios from "axios";
import ReactQuill from "react-quill";
import {
  ModalOverlay,
  ModalContent,
  CloseButton,
} from "../../../components/Styles/AdviceVideoStyles";
import "react-quill/dist/quill.snow.css";
function AdminVideoList() {
  const quillRef = useRef();
  const videoRef = useRef();
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [contentsharing, setContentsharing] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const [deleteId, setdeleteId] = useState(false);
  const [showEdit, setshowEdit] = useState(false);
  const [editdata, seteditdata] = useState("");
  const [spinners, setspinnsers] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const apiUrl = "http://localhost:5000/api/admin/video/";
  const [records, setRecords] = useState([]);

  document.title = "Video List - Admin";
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
  const handleEdit = async (id) => {
    setContentsharing("");
    seteditdata("");
    setMaxLimit("");
    setshowEdit(true);
    let formData = {
      id: id,
    };
    try {
      const res = await axios.post(apiUrl + "getvideorecord", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      console.log(respo);
      setContentsharing(respo[0].description);
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
  const columns = [
    {
      name: "Video",
      selector: (row) => row.video,
      sortable: true,
      cell: (row) => (
        <video width="100" height="70" controls>
          <source
            src={`http://localhost:5000/api/upload/video/${row.video}`}
            type="video/mp4"
          />
          Your browser does not support the video tag.
        </video>
      ),
    },
    {
      name: "Maximum Views Per Client",
      selector: (row) => row.max_limit,
      sortable: true,
      className: "age",
    },
    {
      name: "Action",
      cell: (row) => (
        <div className="d-flex align-items-center justify-content-between">
          <button
            type="button"
            onClick={() => handleEdit(row.id)}
            className="dataedit_btn text-primary border-0 fs-5"
            title="Edit"
          >
            <FaEdit />
          </button>
          <button
            type="button"
            onClick={() => handledelete(row.id)}
            className="dataedit_btn text-danger border-0 fs-5"
            title="Delete"
          >
            <FaTrashAlt />
          </button>
        </div>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
  //const [videos, setVideos] = useState([]);
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
  };

  const handleDragEnter = (e, index) => {
    if (draggedIndex === null || draggedIndex === index) return;

    const newRecords = [...records];
    const draggedItem = newRecords[draggedIndex];

    newRecords.splice(draggedIndex, 1);
    newRecords.splice(index, 0, draggedItem);

    setDraggedIndex(index);
    setRecords(newRecords);
  };

  const handleDrop = async () => {
    setDraggedIndex(null);

    // Send updated order to API
    const orderedIds = records.map((item) => item.id);
    console.log(orderedIds);
    try {
      await axios.post(`${apiUrl}reorder_videos`, { orderedIds });
      console.log("Order updated");
    } catch (err) {
      console.error("Failed to update order:", err);
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
  const [searchQuery, setSearchQuery] = useState("");

  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );
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
      getvideo();
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
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setspinnsers(false);
    if (selectedFile) {
      const maxSize = 15 * 1024 * 1024; // 15 MB in bytes

      if (selectedFile.size > maxSize) {
        setError("File size should not exceed 15MB.");
        e.target.value = null; // clear the selected file
        setFile(null);
        setFilenew(null);
      } else {
        setError("");
        setFilenew(selectedFile);
        setFile(selectedFile);
      }
    }
  };
  const handleChangesharing = (value) => {
    setContentsharing(value);
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("file", filenew);
    formData.append("id", editdata.id);
    formData.append("max_limit", maxLimit);
    formData.append("description", contentsharing);
    setspinnsers(true);
    try {
      if (filenew === null) {
        const res = await axios.post(apiUrl + "updatelimit", formData, {
          headers: {
            Accept: "application/json",
          },
        });
        setspinnsers(false);
        var respo = res.data.results;
        setsuccessMessage("Updated successfully");
        setTimeout(() => {
          setsuccessMessage("");
          setshowEdit(false);
          getvideo();
          window.location.reload();
        }, 1000); // 3
      } else {
        const res = await axios.post(apiUrl + "updatevideo", formData, {
          headers: {
            Accept: "application/json",
          },
        });
        setspinnsers(false);
        var respo = res.data.results;
        setsuccessMessage("Updated successfully");
        setTimeout(() => {
          setsuccessMessage("");
          setshowEdit(false);
          getvideo();
          window.location.reload();
        }, 1000); // 3
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
  const handleviewvideo = (url) => {
    setSelectedVideo(url);
    setIsModalOpen(true);
    setTimeout(() => {
      videoRef.current?.play();
    }, 100);
  };
  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedVideo(null);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
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
                      <div className="d-flex justify-content-between flex-wrap  pb-3 align-items-center ">
                        <h5 className="mb-3">Video Management</h5>
                        <Link to="/admin/video/add" className="admin_btn">
                          Add <FaPlus />
                        </Link>
                      </div>

                      <div
                        className="custom-scrollbar"
                        style={{
                          minWidth: "100%",
                          boxShadow: "0 10px 15px rgba(0, 0, 0, 0.2)",
                          border: "1px solid #00000036",
                          borderRadius: "12px",
                          overflow: "auto",
                        }}
                      >
                        <table className="table  custome-table table-bordered custome-icon table-striped mb-0">
                          <thead
                            style={{
                              backgroundColor: "#ff3f45 !important",
                              color: "#fff",
                              fontWeight: 600,
                              fontSize: "12px",
                              textTransform: "uppercase",
                              whiteSpace: "nowrap",
                              borderRadius: "12px",
                              overflow: "hidden",
                            }}
                          >
                            <tr className="text-center">
                              <th>#</th>
                              <th>Video</th>
                              <th>Max Views</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {records.map((row, index) => (
                              <tr
                                key={row.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragEnter={(e) => handleDragEnter(e, index)}
                                onDragEnd={handleDrop}
                                style={{
                                  cursor: "move",
                                  fontSize: "14px",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <td className="text-center ">{index + 1}</td>
                                <td className="mx-auto d-flex">
                                  <video
                                    width="100"
                                    height="60"
                                    controls
                                    className="mx-auto"
                                  >
                                    <source
                                      src={`http://localhost:5000/api/upload/video/${row.video}`}
                                      type="video/mp4"
                                    />
                                    Your browser does not support the video tag.
                                  </video>
                                </td>
                                <td className="text-center ">
                                  {row.max_limit}
                                </td>
                                <td>
                                  <div
                                    className="d-flex align-items-center gap-3 justify-content-center"
                                    style={{ width: "100%" }}
                                  >
                                    <button
                                      title="View Video"
                                      className="dataedit_btn border-0 fs-5"
                                      onClick={() =>
                                        handleviewvideo(
                                          `http://localhost:5000/api/upload/video/${row.video}`
                                        )
                                      }
                                    >
                                      <FaVideo />
                                    </button>
                                    <button
                                      title="Edit"
                                      className="dataedit_btn border-0 fs-5"
                                      onClick={() => handleEdit(row.id)}
                                    >
                                      <FaEdit />
                                    </button>
                                    <button
                                      className="deleteedit_btn border-0 fs-5"
                                      title="Delete"
                                      onClick={() => handledelete(row.id)}
                                    >
                                      <FaTrashAlt />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
      <Modal show={show} onHide={handleClose}>
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

      <Modal show={showEdit} onHide={handleClose}>
        <Modal.Header closeButton>
          <Modal.Title className="text-dark">Update</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="row g-4">
            <div className="col-sm-12">
              <div className="bglight rounded h-100 p-2">
                {successMessage && (
                  <SuccessAlert
                    message={successMessage}
                    onClose={() => setsuccessMessage("")}
                  />
                )}

                <form
                  action="javascript:void(0)"
                  onSubmit={handleSubmit}
                  method="post"
                  className="d-flex flex-column gap-3"
                >
                  <div className=" text-start">
                    <label htmlFor="exampleInputFile" className="form-label">
                      Upload File{" "}
                      <span style={{ color: "var(--primary)" }}>*</span>
                    </label>
                    <input type="hidden" name="id" value={editdata.id} />
                    <input
                      type="file"
                      accept="video/*"
                      required={!file}
                      name="file"
                      className="form-control"
                      id="exampleInputFile"
                      aria-describedby="fileHelp"
                      title={file}
                      onChange={handleFileChange}
                    />
                    {error && <div className="text-danger mt-1">{error}</div>}
                  </div>

                  <div className=" text-start">
                    <label htmlFor="exampleInputLimit" className="form-label">
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
                      defaultValue={maxLimit}
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
                      style={{ height: "200px" }}
                      theme="snow"
                    />
                  </div>
                  <div className="d-grid">
                    <button
                      type="submit"
                      className="btn btn-primary position-relative"
                    >
                      {spinners && (
                        <span
                          className="spinner-border text-light position-absolute"
                          style={{
                            top: "15%",
                            left: "48%",
                          }}
                          role="status"
                        >
                          <span className="visually-hidden">Loading...</span>
                        </span>
                      )}
                      Update
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </Modal.Body>
      </Modal>
      <ModalOverlay open={isModalOpen}>
        <ModalContent>
          {selectedVideo && (
            <video
              ref={videoRef}
              className="advicevideo"
              controls
              autoPlay
              controlsList="nodownload nofullscreen noremoteplayback"
              onContextMenu={(e) => e.preventDefault()}
              style={{ width: "100%" }}
            >
              <source src={selectedVideo} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          )}
          <CloseButton onClick={closeModal}>&times;</CloseButton>
        </ModalContent>
      </ModalOverlay>
    </>
  );
}

export default AdminVideoList;
