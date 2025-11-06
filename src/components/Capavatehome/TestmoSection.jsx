import React from "react";
import Slider from "react-slick";
import { GrLineChart } from "react-icons/gr";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import { RiDoubleQuotesL } from "react-icons/ri";

export default function TestmoSection() {
  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 3, // Desktop
    slidesToScroll: 1,
    responsive: [
      { breakpoint: 992, settings: { slidesToShow: 2 } }, // Tablet
      { breakpoint: 576, settings: { slidesToShow: 1 } }, // Mobile
    ],
  };
  return (
    <>
      <section className="testmobox d-block">
        <div className="overlaye d-block gapy">
          <div className="container-lg">
            <div className="row mb-5 justify-content-center">
              <div className="col-md-6">
                <div className="d-flex flex-column gap-2 text-center titlecontent">
                  <div className="d-flex gap-2 align-items-center text-center align-items-center smalltext mx-auto">
                    <GrLineChart /> <h6>TESTIMONIAL </h6>
                  </div>
                  <h2>What Our Clients Say</h2>
                </div>
              </div>
            </div>
            <div className="d-block sliderbox ">
              <Slider {...settings}>
                <div className="px-md-3">
                  <div className="d-flex flex-column gap-3 testmoreviw">
                    <div className="clientimg rel">
                      <div className="cimg ofit">
                        <img
                          src="/assets/images/testimonial-1-1.webp"
                          alt="pic"
                        />
                      </div>
                      <RiDoubleQuotesL />
                    </div>
                    <div className="textqu">
                      <p>
                        Ingenieux Encon LLC made our sourcing process so easy.
                        Their attention to detail is unmatched.
                      </p>
                    </div>
                    <div className="quname d-flex flex-column gap-1">
                      <h5>John Doe</h5>
                      <h6>Agro Distributor</h6>
                    </div>
                  </div>
                </div>
                <div className="px-md-3">
                  <div className="d-flex flex-column gap-3 testmoreviw">
                    <div className="clientimg rel">
                      <div className="cimg ofit">
                        <img
                          src="/assets/images/testimonial-1-2.webp"
                          alt="pic"
                        />
                      </div>
                      <RiDoubleQuotesL />
                    </div>
                    <div className="textqu">
                      <p>Excellent quality and timely delivery every time.</p>
                    </div>
                    <div className="quname">
                      <h5>Jane Smith</h5>
                      <h6>Cocoa Importer</h6>
                    </div>
                  </div>
                </div>
                <div className="px-md-3">
                  <div className="d-flex flex-column gap-3 testmoreviw">
                    <div className="clientimg rel">
                      <div className="cimg ofit">
                        <img
                          src="/assets/images/testimonial-1-1.webp"
                          alt="pic"
                        />
                      </div>
                      <RiDoubleQuotesL />
                    </div>
                    <div className="textqu">
                      <p>
                        Ingenieux Encon LLC made our sourcing process so easy.
                        Their attention to detail is unmatched.
                      </p>
                    </div>
                    <div className="quname d-flex flex-column gap-1">
                      <h5>John Doe</h5>
                      <h6>Agro Distributor</h6>
                    </div>
                  </div>
                </div>
                <div className="px-md-3">
                  <div className="d-flex flex-column gap-3 testmoreviw">
                    <div className="clientimg rel">
                      <div className="cimg ofit">
                        <img
                          src="/assets/images/testimonial-1-2.webp"
                          alt="pic"
                        />
                      </div>
                      <RiDoubleQuotesL />
                    </div>
                    <div className="textqu">
                      <p>Excellent quality and timely delivery every time.</p>
                    </div>
                    <div className="quname">
                      <h5>Jane Smith</h5>
                      <h6>Cocoa Importer</h6>
                    </div>
                  </div>
                </div>
              </Slider>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
