import React from "react";
import { BsArrowRight } from "react-icons/bs";
export default function HeroBanner() {
  return (
    <>
      <section className="herobanner d-block gapy">
        <div className="container-lg">
          <div className="row gy-4 align-items-center">
            <div className="col-md-6">
              <div className="d-flex flex-column gap-2">
                <h1>Smart Financial Strategies</h1>
                <p>
                  Lorem qui nisi irure non. Laborum qui esse cupidatat laboris
                  ullamco Lorem culpa labore.
                </p>
                <div className="d-block pbtn mt-4">
                  <a href="#">
                    {" "}
                    <span>Get Started</span>
                    <BsArrowRight />
                  </a>
                </div>
              </div>
            </div>
            <div className="col-md-5 offset-md-1">
              <div className="imgblock">
                <img src="/assets/images/help.svg" alt="image" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
