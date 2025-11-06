import React, { useState } from "react";
import cardImage from "../../../assets/images/cardimage.jpg";
import {
  Overlay,
  Popup,
  CloseBtn,
  styles,
  CardImageContainer,
  CardImage,
  TitlePay,
  Form,
  FormGroup,
  Label,
  Input,
  Row,
  ButtonGroup,
  Button,
} from "../../Styles/MainStyle.js";

export default function CardPopup() {
  const [showPopup, setShowPopup] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    // handle form submission
    alert("Form submitted!");
    setShowPopup(false);
  };

  return (
    <>
      <button onClick={() => setShowPopup(true)}>Open Form</button>
      {showPopup && (
        <Overlay>
          <Popup>
            <CloseBtn onClick={() => setShowPopup(false)}>×</CloseBtn>
            <TitlePay>Payment Details</TitlePay>
            <CardImageContainer>
              <CardImage src={cardImage} alt="cards" />
            </CardImageContainer>
            <Form onSubmit={handleSubmit}>
              <FormGroup>
                <Label>Name:</Label>
                <Input
                  type="text"
                  name="name"
                  required
                  placeholder="type here..."
                />
              </FormGroup>
              <FormGroup>
                <Label>Email:</Label>
                <Input
                  type="email"
                  name="email"
                  required
                  placeholder="type here..."
                />
              </FormGroup>
              <FormGroup>
                <Label>Card Number:</Label>
                <Input
                  type="text"
                  name="cardNumber"
                  required
                  placeholder="type here..."
                />
              </FormGroup>
              <Row>
                <FormGroup>
                  <Label>CVV:</Label>
                  <Input
                    type="text"
                    name="cvv"
                    required
                    placeholder="type here..."
                  />
                </FormGroup>
                <FormGroup>
                  <Label>Expiry Date:</Label>
                  <Input
                    type="month"
                    name="expiry"
                    required
                    placeholder="type here..."
                  />
                </FormGroup>
              </Row>
              <ButtonGroup>
                <Button
                  type="button"
                  className="cancel"
                  onClick={() => setShowPopup(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" className="submit">
                  Submit
                </Button>
              </ButtonGroup>
            </Form>
          </Popup>
        </Overlay>
      )}
    </>
  );
}
