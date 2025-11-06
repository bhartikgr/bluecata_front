import React, { useState } from "react";
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Building,
  Linkedin,
  Phone,
  UserCog,
  Globe,
  Users,
  Clipboard,
  MapPin,
  Building2,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import styled from "styled-components";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";

const RegisterContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background-color: #efefef;
  font-family: "Inter", sans-serif;
  padding: 2rem;
`;

const RegisterCard = styled.div`
  background: white;
  border-radius: 16px;
  padding: 3rem;
  width: 100%;
  max-width: 800px;
  box-shadow: 0 10px 30px rgba(10, 10, 10, 0.08);
`;

const ProgressBar = styled.div`
  display: flex;
  justify-content: space-between;
  position: relative;
  margin-bottom: 3rem;

  &::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 2px;
    background: #ddd;
    z-index: 1;
    transform: translateY(-50%);
  }
`;

const ProgressStep = styled.div`
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const StepCircle = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${(props) => (props.active ? "#F63B3B" : "#ddd")};
  color: ${(props) => (props.active ? "white" : "#666")};
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  margin-bottom: 0.5rem;
  border: 2px solid white;
`;

const StepLabel = styled.span`
  font-size: 0.85rem;
  color: ${(props) => (props.active ? "#0A0A0A" : "#666")};
  font-weight: ${(props) => (props.active ? "600" : "400")};
`;

const FormTitle = styled.h2`
  font-size: 1.5rem;
  color: #0a0a0a;
  margin-bottom: 1.5rem;
  font-weight: 700;
`;

const FormSection = styled.div`
  margin-bottom: 2rem;
`;

const SectionTitle = styled.h3`
  font-size: 1.1rem;
  color: #0a0a0a;
  margin-bottom: 1.5rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const InputContainer = styled.div`
  position: relative;
  margin-bottom: 1.5rem;
`;

const InputLabel = styled.label`
  display: block;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
  color: #0a0a0a;
  font-weight: 500;

  span {
    color: #f63b3b;
  }
`;

const InputIcon = styled.div`
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: #888;
`;

const InputField = styled.input`
  width: 100%;
  padding: 14px 16px 14px 48px;
  border-radius: 8px;
  border: 1px solid #ddd;
  font-size: 0.95rem;
  transition: all 0.2s ease;
  color: #0a0a0a;

  &:focus {
    outline: none;
    border-color: #f63b3b;
    box-shadow: 0 0 0 2px rgba(246, 59, 59, 0.2);
  }
`;

const SelectField = styled.select`
  width: 100%;
  padding: 14px 16px 14px 48px;
  border-radius: 8px;
  border: 1px solid #ddd;
  font-size: 0.95rem;
  transition: all 0.2s ease;
  color: #0a0a0a;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 16px center;
  background-size: 16px;

  &:focus {
    outline: none;
    border-color: #f63b3b;
    box-shadow: 0 0 0 2px rgba(246, 59, 59, 0.2);
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  justify-content: ${(props) =>
    props.step === 1 ? "flex-end" : "space-between"};
  margin-top: 2rem;
`;

const FormButton = styled.button`
  padding: 12px 24px;
  border-radius: 8px;
  border: none;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.5rem;

  &.next {
    background-color: #f63b3b;
    color: white;

    &:hover {
      background-color: #e53535;
    }
  }

  &.back {
    background-color: white;
    color: #0a0a0a;
    border: 1px solid #ddd;

    &:hover {
      background-color: #f5f5f5;
    }
  }
`;

const ErrorMessage = styled.div`
  color: #f63b3b;
  font-size: 0.8rem;
  margin-top: 0.25rem;
  font-weight: 500;
`;

export default function Demopage() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    // Step 1
    first_name: "",
    last_name: "",
    email: "",
    confirm_email: "",
    linked_in: "",
    phone: "",
    role: "",

    // Step 2
    company_name: "",
    company_industory: "",
    company_website: "",
    company_linkedin: "",
    employee_number: "",
    year_registration: "",
    company_street_address: "",
    company_country: "",
    company_state: "",
    city_step2: "",
    company_postal_code: "",
  });

  const [formErrors, setFormErrors] = useState({
    emailMatch: "",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    // Validate email match
    if (name === "email" || name === "confirm_email") {
      if (
        formData.email &&
        formData.confirm_email &&
        formData.email !== formData.confirm_email
      ) {
        setFormErrors((prev) => ({
          ...prev,
          emailMatch: "Emails do not match",
        }));
      } else {
        setFormErrors((prev) => ({ ...prev, emailMatch: "" }));
      }
    }
  };

  const handlePhoneChange = (value) => {
    setFormData((prev) => ({
      ...prev,
      phone: value,
    }));
  };

  const handleSubmitStep1 = (e) => {
    e.preventDefault();
    // Validate step 1
    if (formData.email !== formData.confirm_email) {
      return;
    }
    setStep(2);
  };

  const handleSubmitStep2 = (e) => {
    e.preventDefault();
    // Submit all data
    console.log("Form submitted:", formData);
    // Navigate to dashboard or next page
  };

  const handleBack = () => {
    setStep(1);
  };

  return (
    <RegisterContainer>
      <RegisterCard>
        <ProgressBar>
          <ProgressStep>
            <StepCircle active={step >= 1}>{step > 1 ? "✓" : "1"}</StepCircle>
            <StepLabel active={step >= 1}>Personal Info</StepLabel>
          </ProgressStep>
          <ProgressStep>
            <StepCircle active={step >= 2}>2</StepCircle>
            <StepLabel active={step >= 2}>Company Info</StepLabel>
          </ProgressStep>
        </ProgressBar>

        {step === 1 && (
          <form onSubmit={handleSubmitStep1}>
            <FormTitle>Create your account</FormTitle>

            <FormSection>
              <SectionTitle>
                <User size={20} /> Personal Information
              </SectionTitle>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "1.5rem",
                }}
              >
                <InputContainer>
                  <InputLabel>
                    First Name <span>*</span>
                  </InputLabel>
                  <div style={{ position: "relative" }}>
                    <InputIcon>
                      <User size={18} />
                    </InputIcon>
                    <InputField
                      type="text"
                      name="first_name"
                      value={formData.first_name}
                      onChange={handleChange}
                      required
                    />
                  </div>
                </InputContainer>

                <InputContainer>
                  <InputLabel>
                    Last Name <span>*</span>
                  </InputLabel>
                  <div style={{ position: "relative" }}>
                    <InputIcon>
                      <User size={18} />
                    </InputIcon>
                    <InputField
                      type="text"
                      name="last_name"
                      value={formData.last_name}
                      onChange={handleChange}
                      required
                    />
                  </div>
                </InputContainer>
              </div>

              <InputContainer>
                <InputLabel>
                  Email <span>*</span>
                </InputLabel>
                <div style={{ position: "relative" }}>
                  <InputIcon>
                    <Mail size={18} />
                  </InputIcon>
                  <InputField
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                  />
                </div>
              </InputContainer>

              <InputContainer>
                <InputLabel>
                  Confirm Email <span>*</span>
                </InputLabel>
                <div style={{ position: "relative" }}>
                  <InputIcon>
                    <Mail size={18} />
                  </InputIcon>
                  <InputField
                    type="email"
                    name="confirm_email"
                    value={formData.confirm_email}
                    onChange={handleChange}
                    required
                  />
                  {formErrors.emailMatch && (
                    <ErrorMessage>{formErrors.emailMatch}</ErrorMessage>
                  )}
                </div>
              </InputContainer>

              <InputContainer>
                <InputLabel>LinkedIn Profile</InputLabel>
                <div style={{ position: "relative" }}>
                  <InputIcon>
                    <Linkedin size={18} />
                  </InputIcon>
                  <InputField
                    type="text"
                    name="linked_in"
                    value={formData.linked_in}
                    onChange={handleChange}
                  />
                </div>
              </InputContainer>

              <InputContainer>
                <InputLabel>
                  Phone Number <span>*</span>
                </InputLabel>
                <PhoneInput
                  country={"us"}
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  inputStyle={{
                    width: "100%",
                    padding: "14px 16px 14px 56px",
                    borderRadius: "8px",
                    border: "1px solid #ddd",
                    fontSize: "0.95rem",
                  }}
                  containerStyle={{
                    width: "100%",
                  }}
                  inputProps={{
                    name: "phone",
                    required: true,
                  }}
                />
              </InputContainer>

              <InputContainer>
                <InputLabel>Role / Position at the company</InputLabel>
                <div style={{ position: "relative" }}>
                  <InputIcon>
                    <UserCog size={18} />
                  </InputIcon>
                  <InputField
                    type="text"
                    name="role"
                    value={formData.role}
                    onChange={handleChange}
                  />
                </div>
              </InputContainer>
            </FormSection>

            <ButtonGroup step={1}>
              <FormButton type="submit" className="next">
                Next <ArrowRight size={18} />
              </FormButton>
            </ButtonGroup>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleSubmitStep2}>
            <FormTitle>Company Information</FormTitle>

            <FormSection>
              <SectionTitle>
                <Building size={20} /> Company Details
              </SectionTitle>

              <InputContainer>
                <InputLabel>
                  Name of Company <span>*</span>
                </InputLabel>
                <div style={{ position: "relative" }}>
                  <InputIcon>
                    <Building size={18} />
                  </InputIcon>
                  <InputField
                    type="text"
                    name="company_name"
                    value={formData.company_name}
                    onChange={handleChange}
                    required
                  />
                </div>
              </InputContainer>

              <InputContainer>
                <InputLabel>
                  Industry <span>*</span>
                </InputLabel>
                <div style={{ position: "relative" }}>
                  <InputIcon>
                    <Building size={18} />
                  </InputIcon>
                  <SelectField
                    name="company_industory"
                    value={formData.company_industory}
                    onChange={handleChange}
                    required
                  >
                    <option value="">Select Industry</option>
                    <option value="Aerospace & Defense">
                      Aerospace & Defense
                    </option>
                    <option value="Agriculture & Farming">
                      Agriculture & Farming
                    </option>
                    <option value="Artificial Intelligence">
                      Artificial Intelligence
                    </option>
                    {/* Add other industry options */}
                  </SelectField>
                </div>
              </InputContainer>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "1.5rem",
                }}
              >
                <InputContainer>
                  <InputLabel>
                    Company Website <span>*</span>
                  </InputLabel>
                  <div style={{ position: "relative" }}>
                    <InputIcon>
                      <Globe size={18} />
                    </InputIcon>
                    <InputField
                      type="url"
                      name="company_website"
                      value={formData.company_website}
                      onChange={handleChange}
                      required
                    />
                  </div>
                </InputContainer>

                <InputContainer>
                  <InputLabel>Company LinkedIn Profile</InputLabel>
                  <div style={{ position: "relative" }}>
                    <InputIcon>
                      <Linkedin size={18} />
                    </InputIcon>
                    <InputField
                      type="text"
                      name="company_linkedin"
                      value={formData.company_linkedin}
                      onChange={handleChange}
                    />
                  </div>
                </InputContainer>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "1.5rem",
                }}
              >
                <InputContainer>
                  <InputLabel>
                    Number of Employees <span>*</span>
                  </InputLabel>
                  <div style={{ position: "relative" }}>
                    <InputIcon>
                      <Users size={18} />
                    </InputIcon>
                    <InputField
                      type="number"
                      name="employee_number"
                      value={formData.employee_number}
                      onChange={handleChange}
                      required
                      min="1"
                    />
                  </div>
                </InputContainer>

                <InputContainer>
                  <InputLabel>Year of Registration</InputLabel>
                  <div style={{ position: "relative" }}>
                    <InputIcon>
                      <Clipboard size={18} />
                    </InputIcon>
                    <InputField
                      type="number"
                      name="year_registration"
                      value={formData.year_registration}
                      onChange={handleChange}
                      min="1900"
                      max={new Date().getFullYear()}
                    />
                  </div>
                </InputContainer>
              </div>
            </FormSection>

            <FormSection>
              <SectionTitle>
                <MapPin size={20} /> Company Address
              </SectionTitle>

              <InputContainer>
                <InputLabel>
                  Street Address <span>*</span>
                </InputLabel>
                <div style={{ position: "relative" }}>
                  <InputIcon>
                    <Building size={18} />
                  </InputIcon>
                  <InputField
                    type="text"
                    name="company_street_address"
                    value={formData.company_street_address}
                    onChange={handleChange}
                    required
                  />
                </div>
              </InputContainer>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "1.5rem",
                }}
              >
                <InputContainer>
                  <InputLabel>
                    Country <span>*</span>
                  </InputLabel>
                  <div style={{ position: "relative" }}>
                    <InputIcon>
                      <Globe size={18} />
                    </InputIcon>
                    <SelectField
                      name="company_country"
                      value={formData.company_country}
                      onChange={handleChange}
                      required
                    >
                      <option value="">Select Country</option>
                      <option value="US">United States</option>
                      <option value="CA">Canada</option>
                      {/* Add other countries */}
                    </SelectField>
                  </div>
                </InputContainer>

                <InputContainer>
                  <InputLabel>State/Province</InputLabel>
                  <div style={{ position: "relative" }}>
                    <InputIcon>
                      <Building size={18} />
                    </InputIcon>
                    <SelectField
                      name="company_state"
                      value={formData.company_state}
                      onChange={handleChange}
                    >
                      <option value="">Select State</option>
                      {/* Populate states based on country */}
                    </SelectField>
                  </div>
                </InputContainer>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "1.5rem",
                }}
              >
                <InputContainer>
                  <InputLabel>City</InputLabel>
                  <div style={{ position: "relative" }}>
                    <InputIcon>
                      <Building2 size={18} />
                    </InputIcon>
                    <SelectField
                      name="city_step2"
                      value={formData.city_step2}
                      onChange={handleChange}
                    >
                      <option value="">Select City</option>
                      {/* Populate cities based on state */}
                    </SelectField>
                  </div>
                </InputContainer>

                <InputContainer>
                  <InputLabel>Postal/Zip Code</InputLabel>
                  <div style={{ position: "relative" }}>
                    <InputIcon>
                      <MapPin size={18} />
                    </InputIcon>
                    <InputField
                      type="text"
                      name="company_postal_code"
                      value={formData.company_postal_code}
                      onChange={handleChange}
                    />
                  </div>
                </InputContainer>
              </div>
            </FormSection>

            <ButtonGroup step={2}>
              <FormButton type="button" className="back" onClick={handleBack}>
                <ArrowLeft size={18} /> Back
              </FormButton>
              <FormButton type="submit" className="next">
                Complete Registration <ArrowRight size={18} />
              </FormButton>
            </ButtonGroup>
          </form>
        )}
      </RegisterCard>
    </RegisterContainer>
  );
}
