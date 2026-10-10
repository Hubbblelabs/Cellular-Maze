import { render, screen, fireEvent, act } from "@testing-library/react";
import { Toast } from "../Toast";

describe("Toast", () => {
  it("renders message when provided", () => {
    render(<Toast message="Signal dropping ahead" />);
    expect(screen.getByText("Signal dropping ahead")).toBeInTheDocument();
  });

  it("returns null when message is null", () => {
    const { container } = render(<Toast message={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("dismisses when X button clicked", () => {
    render(<Toast message="Test alert" />);
    expect(screen.getByText("Test alert")).toBeInTheDocument();

    const closeBtn = screen.getByRole("button");
    fireEvent.click(closeBtn);

    expect(screen.queryByText("Test alert")).not.toBeInTheDocument();
  });

  it("shows again when a new message arrives after dismissal", () => {
    const { rerender } = render(<Toast message="First" />);
    fireEvent.click(screen.getByRole("button"));
    rerender(<Toast message="Second" />);
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("auto-hides after 8 seconds", () => {
    jest.useFakeTimers();
    render(<Toast message="Temporary" />);
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(screen.queryByText("Temporary")).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it("shows warning styling for warning type", () => {
    const { container } = render(
      <Toast message="Dead zone ahead" type="warning" />,
    );
    const toast = container.firstChild as HTMLElement;
    expect(toast.className).toContain("border-l-amber-400");
  });

  it("shows reroute styling for reroute type", () => {
    const { container } = render(
      <Toast message="Rerouting..." type="reroute" />,
    );
    const toast = container.firstChild as HTMLElement;
    expect(toast.className).toContain("border-l-cyan-400");
  });

  it("shows default styling for info type", () => {
    const { container } = render(
      <Toast message="Info message" type="info" />,
    );
    const toast = container.firstChild as HTMLElement;
    expect(toast.className).toContain("border-l-white/40");
  });
});
