import React from "react";
import { GrLineChart } from "react-icons/gr";
import { IoIosStar } from "react-icons/io";
import { BsArrowRight } from "react-icons/bs";
export default function AboutSection() {
  return (
    <>
      <section className="aboutblock d-block gapy gbg">
        <div className="container-lg">
          <div className="row gy-4 align-items-center">
            <div className="col-md-6">
              <div className="d-flex flex-column gap-3 titlecontent">
                <div className="d-flex gap-2 align-items-center smalltext ">
                  <GrLineChart /> <h6>About us</h6>
                </div>
                <h2>We Invest in Founders Building the Future</h2>
                <p>
                  Lorem Ipsum is simply dummy text of the printing and
                  typesetting industry. Lorem Ipsum has been the industry's.
                </p>
                <div className="happystar d-flex flex-column gap-2">
                  <div className="d-flex gap-2 align-items-center instars">
                    <IoIosStar />
                    <IoIosStar />
                    <IoIosStar />
                    <IoIosStar />
                    <IoIosStar />
                  </div>
                  <h3>2k+ Happy Inverters</h3>

                  <p>
                    “Working with them has been a win-win. They consistently
                    present investor-ready startups with strong fundamentals and
                    innovative ideas.”{" "}
                  </p>
                </div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="d-flex flex-column gap-4 rel gimages">
                <div className="aboutimg ofit d-block rounded-2 overflow-hidden">
                  <img src="/assets/images/faq-1.webp" alt="image" />
                </div>
                <div className="aboutsimg ofit">
                  <img src="/assets/images/about.webp" alt="image" />
                </div>
              </div>
            </div>
            <div className="col-12">
              <div className="d-inline-block pbtn mt-5 mt-md-0">
                <a href="#">
                  {" "}
                  <span>Get Started</span>
                  <BsArrowRight />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
