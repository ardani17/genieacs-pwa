import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "./page";

test("renders neutral application entry without customer data", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { name: "GenieACS PWA" })).toBeVisible();
  expect(screen.queryByText(/password|pppoe/i)).toBeNull();
});
