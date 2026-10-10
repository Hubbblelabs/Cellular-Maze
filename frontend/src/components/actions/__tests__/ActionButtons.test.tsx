import { render, screen, fireEvent } from "@testing-library/react";
import { ActionButtons } from "../ActionButtons";

describe("ActionButtons", () => {
  const defaultProps = {
    tracking: false,
    loading: false,
    onToggleTracking: jest.fn(),
    onReroute: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders tracking and reroute buttons", () => {
    render(<ActionButtons {...defaultProps} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onToggleTracking when tracking button clicked", () => {
    render(<ActionButtons {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Start navigation" }));
    expect(defaultProps.onToggleTracking).toHaveBeenCalled();
  });

  it("disables navigation and reroute until a route exists", () => {
    render(<ActionButtons {...defaultProps} canNavigate={false} />);
    expect(screen.getByRole("button", { name: "Start navigation" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Smart reroute" })).toBeDisabled();
  });

  it("calls onReroute when reroute button clicked", () => {
    render(<ActionButtons {...defaultProps} />);
    const reroute = screen.getByTitle("Smart reroute");
    fireEvent.click(reroute);
    expect(defaultProps.onReroute).toHaveBeenCalled();
  });

  it("shows active tracking state", () => {
    render(<ActionButtons {...defaultProps} tracking={true} />);
    const trackBtn = screen.getByRole("button", { name: "Stop navigation" });
    expect(trackBtn.className).toContain("from-cyan-500");
  });

  it("disables reroute button when loading", () => {
    render(<ActionButtons {...defaultProps} loading={true} />);
    const reroute = screen.getByTitle("Smart reroute");
    expect(reroute).toBeDisabled();
  });

  it("shows locate me button when handler provided", () => {
    const onLocateMe = jest.fn();
    render(
      <ActionButtons {...defaultProps} onLocateMe={onLocateMe} />,
    );
    const locBtn = screen.getByTitle("Use my location");
    fireEvent.click(locBtn);
    expect(onLocateMe).toHaveBeenCalled();
  });

  it("disables locate button when geoLoading", () => {
    render(
      <ActionButtons
        {...defaultProps}
        onLocateMe={jest.fn()}
        geoLoading={true}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const locBtn = buttons.find((b) => b.hasAttribute("disabled"));
    expect(locBtn).toBeTruthy();
  });

  it("shows geo error in title", () => {
    render(
      <ActionButtons
        {...defaultProps}
        onLocateMe={jest.fn()}
        geoError="Permission denied"
      />,
    );
    expect(screen.getByTitle("Permission denied")).toBeInTheDocument();
  });
});
