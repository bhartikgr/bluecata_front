import styled from "styled-components";
export const Wrapper = styled.div`
  input,
  textarea,
  select,
  a,
  p,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 0;
    text-decoration: none;
    outline: none;
    word-break: break-word;
    overflow-wrap: break-word;
  }

  input:focus,
  textarea:focus,
  select:focus {
    outline: none;
    box-shadow: none;
    border-color: inherit;
  }
`;

export const SectionWrapper = styled.div`
  display: block;
  height: 100%;
`;
export const Tophead = styled.div`
  margin-bottom: auto;

  .logo {
    display: inline-block;
    width: 140px;
    img {
      width: 100%;
    }
  }
`;

export const Slan = styled.div`
  display: flex;
  gap: 15px;
  align-items: center;
  margin-left: auto;
  svg {
    stroke: #fff;
    stroke-width: 1.2; /* thinner stroke if needed */
  }
  a {
    display: inline-block;
    color: #fff;
    text-decoration: none;
    flex-shrink: 0;
    font-size: 13px;
    padding: 0px 10px 6px 10px;
    text-transform: capitalize;

    &:hover {
      background: var(--secondary);
    }
  }
  ,
  select {
    background: #fff;
    color: #111;
    border: none;
    font-size: 14px;
  }
`;

export const CenterNav = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(255, 255, 255);
  height: 100%;
  flex: 1;
  @media (max-width: 991px) {
    flex-direction: column;
    align-items: flex-start;
    position: absolute;
    background: var(--primary);
    left: -15px;
    right: -15px;
    top: 65px;
    z-index: 33;
    display: ${({ isOpen }) => (isOpen ? "flex" : "none")};
  }
`;

export const MenuButtonWrapper = styled.div`
  button {
    margin-left: auto;
    background: none;
    border: none;
    cursor: pointer;
    color: #000;
  }
`;

export const NavList = styled.ul`
  display: flex;
  flex-direction: column;

  gap: 1px;
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 0.9rem;
  @media (max-width: 786px) {
    flex-direction: column;
    gap: 0rem;
    width: 100%;
    justify-content: center;
    align-items: center;
  }
`;

export const NavItem = styled.li`
  // Your existing styles

  .sidebar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    text-decoration: none;
    color: #000;
    transition: all 0.2s ease;
    border-radius: 6px;
    margin: 4px 0;
    font-weight: 450;
    font-size: 0.9rem;
    &:hover {
      background: #f5f5f5;
      color: #333;
    }

    &.active {
      background: var(--primary);
      color: #fff;
      font-weight: 500;
      width: 100%;
      svg {
        color: #fff;
      }
    }

    svg {
      color: #000;
      flex-shrink: 0;
      margin-top: 2px;
    }
  }
`;

export const NavContainer = styled.nav`
  // display: ${({ isOpen }) => (isOpen ? "flex" : "none")};
  background: #fff;
  min-height: 635px;
  overflow-y: auto;
  min-height: fit-content;
`;

export const DropdownToggle = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  cursor: pointer;
  color: #000;
  transition: all 0.2s ease;
  border-radius: 6px;
  margin: 4px 0;
  font-weight: 450;
  font-size: 0.9rem;
  &:hover {
    background: #f5f5f5;
    color: #333;
  }

  svg {
    color: #000;
    flex-shrink: 0;
    margin-top: 2px;
  }
`;

export const DropdownMenu = styled.ul`
  // Your existing styles

  li {
    margin: 0;
    padding: 0 !important;
    a {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px 10px 48px;
      text-decoration: none;
      color: #000;
      transition: all 0.2s ease;
      font-size: 0.9rem;
      font-weight: 450;
      &:hover {
        background: #f0f0f0;
        color: #333;
      }

      &.active {
        background: #e8f4fd;
        color: #1976d2;
        font-weight: 500;

        svg {
          color: #1976d2;
        }
      }

      svg {
        color: #000;
        flex-shrink: 0;
        margin-top: 2px;
      }
    }
  }
`;

export const Arrow = styled.span`
  display: inline-block;
  transition: transform 0.3s ease;
  flex-shrink: 0;
  font-size: 20px;
  transform: ${({ isOpen }) => (isOpen ? "rotate(-180deg)" : "rotate(0deg)")};
`;
