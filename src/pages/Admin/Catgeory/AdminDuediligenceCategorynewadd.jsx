import React, { useState, useEffect, useRef } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import DataTable from "react-data-table-component";
import { useNavigate, useParams } from "react-router-dom";
import { FaTrashAlt, FaEdit } from "react-icons/fa";
import { FaPlus } from "react-icons/fa6";
import { Modal, Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import axios from "axios";
import { FaEye, FaArrowLeft } from "react-icons/fa";
import ReactQuill from "react-quill";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import "react-quill/dist/quill.snow.css";
function AdminDuediligenceCategorynewadd() {
  const navigate = useNavigate();
  const quillRef = useRef();
  const quillRef1 = useRef();
  const quillRef2 = useRef();
  const [errorset, seterror] = useState("");
  const [contentsharing, setContentsharing] = useState("");
  const [documentcontentsharing, setContentsharingdocument] = useState("");
  const [existcontentsharing, setexistcontentsharing] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const [deleteId, setdeleteId] = useState("");
  const [showEdit, setshowEdit] = useState(false);
  const [editdata, seteditdata] = useState("");
  const [spinners, setspinnsers] = useState(false);
  const [nameval, setnameval] = useState("");
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  const { id } = useParams();
  document.title = "Data Rooms Add Category - Admin";
  useEffect(() => {
    getallUsersDetaillist();
  }, []);
  useEffect(() => {
    checkCatgeory();
  }, [id]);
  const checkCatgeory = async () => {
    if (id) {
      let formData = {
        id: id,
      };
      try {
        const res = await axios.post(apiUrl + "checkCatgeory", formData, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        });
        var respo = res.data.results;
        if (respo.length === 0) {
          navigate("/admin/duediligencecategoryList");
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
    }
  };
  useEffect(() => {
    if (id !== undefined) {
      getcategoryData();
    }
  }, [id]);
  const getcategoryData = async () => {
    if (id !== undefined) {
      let formData = {
        id: id,
      };
      try {
        const res = await axios.post(apiUrl + "getcategoryData", formData, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        });
        var dd = res.data.results[0];
        setContentsharing(dd.category_tips);
        setContentsharingdocument(dd.document_tips);
        setexistcontentsharing(dd.exits_tips);
        seteditdata(res.data.results[0]);
      } catch (err) {
        // Enhanced error handling
        if (err.response) {
        } else if (err.request) {
          console.error("Request data:", err.request);
        } else {
          console.error("Error message:", err.message);
        }
      }
    }
  };
  const getallUsersDetaillist = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(apiUrl + "getallcatgeorylist", formData, {
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

  const columns = [
    {
      name: "Name",
      selector: (row) => row.name,
      sortable: true,
      className: "age",
    },
    {
      name: "Total Subcategory",
      selector: (row) => row.subcategory_count,
      sortable: true,
      className: "age",
    },

    {
      name: "View",
      cell: (row) => (
        <>
          <div className="d-flex align-items-center gap-2">
            <Link
              className=" fs-5"
              to={`/admin/duediligencecategorytip/add/${row.id}`}
              title="View List"
            >
              <FaEye />
            </Link>
            <button
              onClick={() => handledelete(row.id)}
              type="button"
              className="dataedit_btn text-danger border-0 fs-5"
              title="Delete"
            >
              <FaTrashAlt />
            </button>
          </div>
        </>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
  const handledelete = (id) => {
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
  const handleClose = () => {
    setShow(false);
  };
  const handleConfirmDelete = async () => {
    let formData = {
      id: deleteId,
    };
    try {
      const res = await axios.post(
        apiUrl + "dataroomcategorydelete",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data.results;
      getallUsersDetaillist();
      setShow(false);
      setTimeout(() => {
        setsuccessMessage("Deleted successfully");
      }, 1200); // 3
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
  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log(contentsharing);
    let formData = {
      id: e.target.id.value,
      name: e.target.name.value,
      category_tips: contentsharing,
      document_tips: documentcontentsharing,
      exits_tips: existcontentsharing,
    };
    try {
      const res = await axios.post(apiUrl + "addDataroomCategory", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      setsuccessMessage(res.data.message);
      setTimeout(() => {
        navigate("/admin/duediligencecategoryList");
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
  const handleDocumentChange = (value) => {
    setContentsharingdocument(value);
  };
  const handleExitsharing = (value) => {
    setexistcontentsharing(value);
  };
  const handleaddcate = () => {
    setshowEdit(true);
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
                      <div className="d-flex justify-content-between flex-wrap mb-2">
                        <div className="d-flex mb-3">
                          <Link
                            to="/admin/duediligencecategoryList"
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
                        className="d-flex flex-column gap-3 align-items-start"
                      >
                        <input type="hidden" name="id" value={editdata.id} />
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
                            required
                            defaultValue={editdata.name}
                            min="1"
                            placeholder="Enter name"
                            className="form-control"
                            id="exampleInputLimit"
                          />
                        </div>
                        <div className="w-100 ">
                          <label
                            htmlFor="exampleInputLimit"
                            className="form-label text-dark"
                          >
                            Category Tips
                          </label>
                          <ReactQuill
                            ref={quillRef}
                            value={contentsharing}
                            onChange={handleChangesharing}
                            className="text_edior"
                            theme="snow"
                          />
                        </div>
                        <div className="w-100 ">
                          <label
                            htmlFor="exampleInputLimit"
                            className="form-label text-dark ="
                          >
                            Document Tips
                          </label>
                          <ReactQuill
                            ref={quillRef1}
                            value={documentcontentsharing}
                            onChange={handleDocumentChange}
                            className="text_edior"
                            theme="snow"
                          />
                        </div>
                        <div className="w-100 ">
                          <label
                            htmlFor="exampleInputLimit"
                            className="form-label text-dark ="
                          >
                            Exist Tips
                          </label>
                          <ReactQuill
                            ref={quillRef2}
                            value={existcontentsharing}
                            onChange={handleExitsharing}
                            className="text_edior "
                            theme="snow"
                          />
                        </div>

                        <div className="d-flex justify-content-end align-items-end w-100 mt-1">
                          {successMessage && (
                            <SuccessAlert
                              message={successMessage}
                              onClose={() => setsuccessMessage("")}
                            />
                          )}
                          <button type="submit" className="admin_btn ">
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
    </>
  );
}

export default AdminDuediligenceCategorynewadd;
