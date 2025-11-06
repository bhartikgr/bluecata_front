import { FaEye } from "react-icons/fa"; // FontAwesome icons
import { IoCloseCircleOutline } from "react-icons/io5";
import {
  ModalContainer,
  CloseButton,
  ModalBtn,
  ButtonGroup,
} from "../../Styles/DataRoomStyle.js";

const ViewSignature = ({ onClose, ViewData }) => {
  if (!ViewData) return null; // safety check
  const capitalizeFirstLetter = (str) => {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  return (
    <div className="main_popup-overlay">
      <ModalContainer>
        <CloseButton onClick={onClose}>×</CloseButton>

        <div className="previous-section-summary mb-4 p-4 bg-white border rounded-3 shadow-sm">
          <div className="d-flex align-items-center mb-3 pb-2 border-bottom">
            <div
              style={{ width: "45px", height: "45px" }}
              className="bg-success d-flex justify-content-center align-items-center bg-opacity-10 flex-shrink-0 p-1 rounded-circle me-3"
            >
              <FaEye />
            </div>
            <div className="d-flex align-items-center justify-content-between gap-3 w-100">
              <h3 className="mb-0 fw-semibold text-dark">View Signature</h3>
              <button
                type="button"
                className="bg-transparent text-danger p-1 border-0"
                onClick={onClose}
              >
                <IoCloseCircleOutline size={24} />
              </button>
            </div>
          </div>

          <div className="row g-3">
            {/* Type */}
            <div className="col-md-6">
              <div className="p-3 bg-light rounded-3 h-100">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Signature Type:
                </span>
                <p className="mb-0 mt-1 fw-medium text-dark fs-6">
                  {ViewData.type ? (
                    capitalizeFirstLetter(ViewData.type)
                  ) : (
                    <span className="text-muted">Not provided</span>
                  )}
                </p>
              </div>
            </div>

            {/* Status */}

            {/* Signature Preview */}
            <div className="col-md-12">
              <div className="p-3 bg-light rounded-3 h-100 text-center">
                <span className="text-secondary small fw-semibold text-uppercase">
                  Signature:
                </span>
                <div className="mt-2">
                  {ViewData.type === "upload" && (
                    <img
                      src={`http://localhost:5000/api/upload/docs/doc_${ViewData.company_id}/signatory/${ViewData.signature}`}
                      alt="Uploaded Signature"
                      style={{ maxWidth: "300px" }}
                    />
                  )}

                  {ViewData.type === "manual" && (
                    <div
                      dangerouslySetInnerHTML={{ __html: ViewData.signature }}
                      style={{
                        border: "1px solid #ced4da",
                        padding: "10px",
                        minHeight: "120px",
                        background: "#fff",
                      }}
                    />
                  )}

                  {ViewData.type === "pad" && (
                    <img
                      src={ViewData.signature} // base64
                      alt="Signature Pad"
                      style={{ maxWidth: "300px" }}
                    />
                  )}

                  {!ViewData.signature && (
                    <p className="text-muted">No signature available</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <ButtonGroup className="d-flex gap-2">
          <ModalBtn onClick={onClose} className="close_btn w-fit">
            Close
          </ModalBtn>
        </ButtonGroup>
      </ModalContainer>
    </div>
  );
};

export default ViewSignature;
