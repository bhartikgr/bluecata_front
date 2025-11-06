import React from "react";
import { FaFacebookF, FaInstagram, FaLinkedinIn } from "react-icons/fa";
import { TbBrandX } from "react-icons/tb";
import { IoIosSend } from "react-icons/io";

export default function Footer() {
  return (
    <footer className="cfooter d-block">
      <div className="cftblock d-block">
        <div className="container">
          <div className="row gy-4">
            {/* Brand + Social */}
            <div className="col-md-3">
              <div className="d-flex flex-column gap-3 ftblock">
                <p>
                  Ea mollit culpa pariatur proident eu nisi occaecat ullamco
                  duis do exercitation qui enim consectetur. Dolor consequat est
                  veniam fugiat sint.
                </p>
                <div className="social-icons d-flex gap-3">
                  <a href="#">
                    <FaFacebookF />
                  </a>
                  <a href="#">
                    <TbBrandX />
                  </a>
                  <a href="#">
                    <FaInstagram />
                  </a>
                  <a href="#">
                    <FaLinkedinIn />
                  </a>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="col-md-3">
              <div className="d-flex flex-column gap-3 ftblock">
                <h5>Navigation</h5>
                <div className="d-flex flex-column gap-2 footer-links">
                  <a href="#">Preparation and Launch</a>
                  <a href="#">Go-To-Market Planning</a>
                  <a href="#">VC Investment Strategy</a>
                  <a href="#">Investment Pipeline</a>
                  <a href="#">Portfolio Management</a>
                </div>
              </div>
            </div>

            {/* Contact */}
            <div className="col-md-3">
              <div className="d-flex flex-column gap-3 ftblock">
                <h5>Our Contact</h5>
                <div className="d-flex flex-column gap-2">
                  <p>24/7 CALL US</p>
                  <p>+(528) 456-7592</p>
                  <p>ADDRESS</p>
                  <p>
                    132, Kingston, New York 12401 <br />
                    United States of America
                  </p>
                </div>
              </div>
            </div>

            {/* Newsletter */}
            <div className="col-md-3">
              <div className="d-flex flex-column gap-3 ftblock">
                <h5>Get Updates</h5>
                <p>🔔 - Subscribe for Investment Tips and Market Trends.</p>
                <div className="input-group overflow-hidden rounded-2">
                  <input
                    type="email"
                    className="form-control"
                    placeholder="Email Address"
                  />
                  <button className="submitbtn" type="submit">
                    <IoIosSend />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="copyblock d-block py-2 text-center">
        <div className="container-lg">
          <div className="row">
            <div className="col-12">
              <p>© Copyright 2025. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
