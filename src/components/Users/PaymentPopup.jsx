// PaymentPopup.jsx
import React from "react";
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
} from "../../components/Styles/MainStyle.js";

const PaymentPopup = ({ moduledata, show, onClose, onSubmit }) => {
  if (!show) return null;

  return (
    <Overlay>
      <Popup>
        <CloseBtn onClick={onClose}>×</CloseBtn>
        <TitlePay>Payment</TitlePay>
        <CardImageContainer>
          <CardImage src="/assets/user/images/cardimage.jpg" alt="cards" />
        </CardImageContainer>
        <Form onSubmit={onSubmit}>
          <FormGroup>
            <Label>Name</Label>
            <Input type="text" name="name" required placeholder="name" />
          </FormGroup>
          <FormGroup>
            <Label>Email</Label>
            <Input type="email" name="email" required placeholder="email" />
          </FormGroup>
          <FormGroup>
            <Label>Card Number</Label>
            <Input
              type="text"
              name="cardnumber"
              required
              placeholder="card number"
              inputMode="numeric"
              maxLength={19}
              onInput={(e) => {
                let value = e.target.value.replace(/\D/g, "");
                value = value.substring(0, 16);
                value = value.replace(/(.{4})/g, "$1 ").trim();
                e.target.value = value;
              }}
            />
          </FormGroup>

          <Row>
            <FormGroup>
              <Label>Expiry Date</Label>
              <Input
                type="text"
                name="expiry"
                required
                placeholder="MM/YYYY"
                inputMode="numeric"
                maxLength={7}
                pattern="(0[1-9]|1[0-2])\/\d{4}"
                onInput={(e) => {
                  let value = e.target.value.replace(/\D/g, "");
                  if (value.length > 6) value = value.slice(0, 6);
                  if (value.length >= 3) {
                    value = value.slice(0, 2) + "/" + value.slice(2);
                  }
                  e.target.value = value;
                }}
              />
            </FormGroup>

            <FormGroup>
              <Label>CVV</Label>
              <Input type="text" name="cvv" required placeholder="123" />
            </FormGroup>
          </Row>

          <ButtonGroup>
            <Button type="button" className="cancel" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="submit">
              Pay Now ${moduledata.price}
            </Button>
          </ButtonGroup>
        </Form>
      </Popup>
    </Overlay>
  );
};

export default PaymentPopup;
