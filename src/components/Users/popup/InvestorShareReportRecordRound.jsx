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
const InvestorShareReportRecordRound = ({
  onClose,
  records,
  allinvestor,
  returnrefresh,
}) => {
  var apiURLInvestor = "http://localhost:5000/api/user/capitalround/";
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [spinners, setspinners] = useState(false);
  const [err, seterr] = useState(false);
  const [successresponse, setsuccessresponse] = useState("");
  const handleSubmit = async (e) => {
    e.preventDefault();
    let payload = {
      company_id: userLogin.companies[0].id,
      created_by_id: userLogin.id,
      created_by_role: userLogin.role,
      records: records,
      selectedRecords: selectedRecords,
    };
    setspinners(true);
    try {
      const res = await axios.post(
        apiURLInvestor + "SendRecordRoundToinvestor",
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

        // Map duplicates to a readable format
        const duplicateInfo = res.data.duplicates.map(
          (d) => `${d.investor_email} - ${d.record_name}`
        );

        // Join them as a string for display
        setsuccessresponse(
          `Record already shared: ${duplicateInfo.join(", ")}`
        );
      }
      if (res.data.status === "1") {
        seterr(false);
        setTimeout(() => {
          onClose();
          returnrefresh();
        }, 3500);
        setsuccessresponse(res.data.message);
      }

      setTimeout(() => {
        setsuccessresponse("");
      }, 3500);
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
    if (selectedRecords.length === records.length) {
      setSelectedRecords([]);
    } else {
      setSelectedRecords(records.map((r) => r.id));
    }
  };

  return (
    <div className="main_popup-overlay">
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
          <h4 className="aititle pb-3">Share Report to Investors</h4>
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
    </div>
  );
};

export default InvestorShareReportRecordRound;
