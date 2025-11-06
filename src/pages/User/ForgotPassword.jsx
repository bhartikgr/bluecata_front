import React from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  Tophead,
  Slan,
  Stepblock,
  Titletext,
  Iconblock,
  Sup,
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/RegisterStyles";
import { Link } from "react-router-dom";
import { Globe, User, Lock } from "lucide-react";

export default function ForgotPassword() {
  return (
    <Wrapper>
      <div className="fullpage d-block">
        <Tophead>
          <div className="container-fluid">
            <div className="d-flex justify-content-between">
              <a href="/" className="logo">
                <img src="/logos/logo.png" alt="logo" />
              </a>
              <Slan>
                <Link to="/register" className="logo text-white">
                  Register
                </Link>
              </Slan>
            </div>
          </div>
        </Tophead>

        <SectionWrapper className="d-block py-5">
          <div className="container-fluid">
            <div className="row justify-content-center">
              <div className="col-lg-6 col-md-10">
                <form>
                  <Stepblock>
                    <div className="d-flex flex-column gap-5">
                      <Titletext>Forgot Password</Titletext>
                      <div className="row gy-3">
                        <div className="col-md-12">
                          <div className="d-flex flex-column gap-2">
                            <label htmlFor="">
                              Email <Sup>*</Sup>
                            </label>
                            <Iconblock>
                              <User />
                              <input
                                type="email"
                                name="email"
                                required
                                placeholder="type your email address here..."
                              />
                            </Iconblock>
                          </div>
                        </div>

                        <div className="col-12">
                          <div className="d-flex justify-content-center mt-4">
                            <div className="flex-shrink-0 gap-4">
                              <button type="submit" className="sbtn nextbtn">
                                Reset My Password
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Stepblock>
                </form>
              </div>
            </div>
          </div>
        </SectionWrapper>
      </div>
    </Wrapper>
  );
}
