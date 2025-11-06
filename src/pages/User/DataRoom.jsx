import React, { useState, useEffect } from "react";
import MainHeader from "../../components/MainHeader";
// import "bootstrap/dist/css/bootstrap.min.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/MainHeadStyles.js";
import {
  DataRoomSection,
  Title,
  TableHeader,
  TableData,
  UploadButton,
} from "../../components/Styles/DataRoomStyle.js";
import UploadModal from "../../components/Admin/popup/UploadModal.jsx";

export default function DataRoom() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  return (
    <>
      <Wrapper>
        <div className="fullpage d-block">
          <MainHeader />
        </div>
        <SectionWrapper className="d-block py-5">
          <div className="container-fluid">
            <div className="row">
              <div className="col-12">
                <DataRoomSection className="d-flex flex-column gap-4">
                  <div className="d-block text-center titleroom">
                    <Title>Due diligence data room</Title>
                  </div>
                  <div className="table-responsive">
                    <table className="table">
                      <thead>
                        <tr>
                          <TableHeader>GENERAL BUSINESS OVERVIEW</TableHeader>
                          <TableHeader>Upload Documents</TableHeader>
                          <TableHeader>Does NOT Exist (N/A)</TableHeader>
                          <TableHeader>Exists but NOT Available</TableHeader>
                          <TableHeader>Provided</TableHeader>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <TableData>
                            <h6>1. Completed due diligence report</h6>
                          </TableData>
                          <TableData>
                            <UploadButton
                              type="button"
                              onClick={() => setIsModalOpen(true)}
                            >
                              Click to upload
                            </UploadButton>
                          </TableData>
                          <TableData>
                            <h5>--</h5>
                          </TableData>
                          <TableData>
                            <h5>--</h5>
                          </TableData>
                          <TableData>
                            <p>No</p>
                          </TableData>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </DataRoomSection>
              </div>
            </div>
          </div>
        </SectionWrapper>
      </Wrapper>

      {/* pop up */}
      {isModalOpen && <UploadModal onClose={() => setIsModalOpen(false)} />}
    </>
  );
}
