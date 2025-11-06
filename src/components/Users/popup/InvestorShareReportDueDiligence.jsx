import React, { useState, useEffect } from "react";
import {
  Overlay,
  ModalContainer,
  ModalTitle,
  CloseButton,
  DropArea,
  ModalBtn,
  ButtonGroup,
} from "../../Styles/DataRoomStyle.js";
import axios from "axios";
import { Button } from "bootstrap";
const InvestorShareReport = ({
  onClose,
  recordsDataroom,
  allinvestor,
  returnrefresh,
}) => {
  var apiURLINFile = "http://localhost:5000/api/user/investorreport/";
  var apiURLInvestor = "http://localhost:5000/api/user/investor/";
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [spinners, setspinners] = useState(false);
  const [err, seterr] = useState(false);
  const [successresponse, setsuccessresponse] = useState("");
  console.log(recordsDataroom);
  const handleSubmit = async (e) => {
    e.preventDefault();
    let payload = {
      user_id: userLogin.id,
      records: recordsDataroom,
      selectedRecords: selectedRecords,
    };
    setspinners(true);
    try {
      const res = await axios.post(
        apiURLInvestor + "SendreportToinvestor",
        payload,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setspinners(false);
      if (res.data.status === "2") {
        seterr(true);
      }
      if (res.data.status === "1") {
        seterr(false);
        setTimeout(() => {
          onClose();
          returnrefresh();
        }, 2000);
      }
      setsuccessresponse(res.data.message);
      setTimeout(() => {
        setsuccessresponse("");
      }, 2000);
    } catch (err) {
      console.error("Submit error:", err);
    }
  };
  const [selectedRecords, setSelectedRecords] = useState([]);

  const handleRecordSelect = (recordId) => {
    setSelectedRecords((prev) =>
      prev.includes(recordId)
        ? prev.filter((id) => id !== recordId)
        : [...prev, recordId]
    );
  };

  // Optional: handle "select all"
  const handleSelectAll = () => {
    if (selectedRecords.length === recordsDataroom.length) {
      setSelectedRecords([]);
    } else {
      setSelectedRecords(recordsDataroom.map((r) => r.id));
    }
  };

  return (
    <Overlay>
      <ModalContainer>
        <form onSubmit={handleSubmit} method="post" action="javascript:void(0)">
          <CloseButton onClick={onClose}>×</CloseButton>
          {successresponse && (
            <p
              className={
                err ? " mt-3 error_pop_sendreport" : "success_pop mt-3"
              }
            >
              {successresponse}
            </p>
          )}
          <h4 className="aititle mb-2">Share Report to Investors</h4>
          <div className="formmodalreport">
            <table className="table table-bordered">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      onChange={handleSelectAll}
                      checked={
                        selectedRecords.length === allinvestor.length &&
                        allinvestor.length > 0
                      }
                    />
                  </th>

                  <th>Investor Email</th>
                </tr>
              </thead>
              <tbody>
                {allinvestor.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedRecords.includes(record.id)}
                        onChange={() => handleRecordSelect(record.id)}
                      />
                    </td>

                    <td>{record.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-group  mt-4">
            {/* Flex container for buttons */}
            <div className="d-flex justify-content-between align-items-center flex-wrap">
              {/* Left side - Add More Email */}

              {/* Right side - Close and Submit */}
              <ButtonGroup className="d-flex gap-2">
                <ModalBtn onClick={onClose} className="close_btn w-fit">
                  Close
                </ModalBtn>
                <ModalBtn
                  disabled={spinners}
                  variant="upload"
                  type="submit"
                  style={{
                    opacity: selectedRecords.length === 0 ? 0.5 : 1,
                    pointerEvents:
                      selectedRecords.length === 0 ? "none" : "auto",
                  }}
                  className="global_btn w-fit align-items-center gap-2"
                >
                  Submit
                  {spinners && (
                    <div
                      className="white-spinner spinner-border spinneronetimepay m-0"
                      role="status"
                    >
                      <span className="visually-hidden"></span>
                    </div>
                  )}
                </ModalBtn>
              </ButtonGroup>
            </div>
          </div>
        </form>
      </ModalContainer>
    </Overlay>
  );
};

export default InvestorShareReport;
