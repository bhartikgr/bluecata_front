import React from "react";
import { GrLineChart } from "react-icons/gr";

export default function WorkSection() {
  return (
    <>
      <section className="workblock d-block gapy gbg">
        <div className="container-lg">
          <div className="row mb-5 justify-content-center">
            <div className="col-md-6">
              <div className="d-flex flex-column gap-2 text-center titlecontent">
                <div className="d-flex gap-2 align-items-center text-center align-items-center smalltext mx-auto">
                  <GrLineChart /> <h6>How it works </h6>
                </div>

                <h2>Steps of Recruitment work process</h2>
              </div>
            </div>
          </div>
          <div className="row gy-4">
            <div className="col-md-4">
              <div className="d-flex flex-column gap-4 text-center workbox">
                <div className="imgbox rel">
                  <h4>01</h4>
                  <div className="inimage ofit">
                    <img src="/assets/images/service1.webp" alt="image" />
                  </div>
                </div>
                <div className="d-flex flex-column gap-2">
                  <h3>Differentiate from the competition</h3>
                  <p>
                    Capitalize on low hanging fruit to identify a ballpark value
                    added.
                  </p>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="d-flex flex-column gap-4 text-center workbox">
                <div className="imgbox rel">
                  <h4>02</h4>
                  <div className="inimage ofit">
                    <img src="/assets/images/service2.webp" alt="image" />
                  </div>
                </div>
                <div className="d-flex flex-column gap-2">
                  <h3>Target the right people effectively</h3>
                  <p>
                    Capitalize on low hanging fruit to identify a ballpark value
                    added.
                  </p>
                </div>
              </div>
            </div>
            <div className="col-md-4">
              <div className="d-flex flex-column gap-4 text-center workbox">
                <div className="imgbox rel">
                  <h4>03</h4>
                  <div className="inimage ofit">
                    <img src="/assets/images/service3.webp" alt="image" />
                  </div>
                </div>
                <div className="d-flex flex-column gap-2">
                  <h3>Communicate your story consistently</h3>
                  <p>
                    Capitalize on low hanging fruit to identify a ballpark value
                    added.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
