import React from "react";
import Container from "react-bootstrap/Container";
import Navbar from "react-bootstrap/Navbar";
import { Link } from "react-router-dom";

function AdminLoginHeader() {
  return (
    <div>
      <header className="admin_header">
        <Navbar expand="lg" className="p-0">
          <Container>
            <Navbar.Brand className="logo mx-auto" as={Link} to="/admin/login">
              <img
                className="w-100 h-100 object-fit-cover"
                src={require("../../assets/images/capavate.png")}
                alt="logo"
              />
            </Navbar.Brand>
            <Navbar.Toggle aria-controls="basic-navbar-nav" />
            {/* <Navbar.Collapse id="basic-navbar-nav">
              <Nav className="ms-auto d-flex align-items-center gap-2">
                <Globe color="#fff" strokeWidth={1.5} />
                <select name="" id="" className="form-control">
                  <option value="">Select Language</option>
                  <option value="">Mandarin</option>
                  <option value="">English</option>
                </select>
              </Nav>
            </Navbar.Collapse> */}
          </Container>
        </Navbar>
      </header>
    </div>
  );
}

export default AdminLoginHeader;
