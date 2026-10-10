import { render, screen, fireEvent } from "@testing-library/react";
import { FilterPanel } from "../FilterPanel";

// Mock ChatBot
jest.mock("@/src/components/chat/ChatBot", () => ({
  ChatBot: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="chatbot">
      <button onClick={onClose}>Close Chat</button>
    </div>
  ),
}));

// Mock WeatherBadge
jest.mock("@/src/components/common/WeatherBadge", () => ({
  WeatherBadge: () => <div data-testid="weather-badge" />,
}));

describe("FilterPanel", () => {
  const defaultProps = {
    selectedIsps: [] as string[],
    onIspsChange: jest.fn(),
    detectedNetwork: "unknown",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders personalised route button", () => {
    render(<FilterPanel {...defaultProps} />);
    expect(screen.getByText("Personalised Route")).toBeInTheDocument();
  });

  it("renders ISP checkboxes", () => {
    render(<FilterPanel {...defaultProps} />);
    expect(screen.getByText("Jio")).toBeInTheDocument();
    expect(screen.getByText("Airtel")).toBeInTheDocument();
    expect(screen.getByText("Vi")).toBeInTheDocument();
    expect(screen.getByText("BSNL")).toBeInTheDocument();
  });

  it("calls onIspsChange when ISP clicked", () => {
    render(<FilterPanel {...defaultProps} />);
    fireEvent.click(screen.getByText("Jio"));
    expect(defaultProps.onIspsChange).toHaveBeenCalledWith(["jio"]);
  });

  it("deselects an ISP on second click", () => {
    render(<FilterPanel {...defaultProps} selectedIsps={["jio"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Jio" }));
    expect(defaultProps.onIspsChange).toHaveBeenCalledWith([]);
  });

  it("shows clear button when ISPs selected", () => {
    render(<FilterPanel {...defaultProps} selectedIsps={["jio"]} />);
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("shows heatmap options when handler provided", () => {
    const onHeatmapFilterChange = jest.fn();
    render(
      <FilterPanel
        {...defaultProps}
        heatmapFilter="signal"
        onHeatmapFilterChange={onHeatmapFilterChange}
      />,
    );
    expect(screen.getByText("Signal")).toBeInTheDocument();
    expect(screen.getByText("Traffic")).toBeInTheDocument();
  });

  it("calls onHeatmapFilterChange when layer clicked", () => {
    const onHeatmapFilterChange = jest.fn();
    render(
      <FilterPanel
        {...defaultProps}
        heatmapFilter="signal"
        onHeatmapFilterChange={onHeatmapFilterChange}
      />,
    );
    fireEvent.click(screen.getByText("Traffic"));
    expect(onHeatmapFilterChange).toHaveBeenCalledWith("traffic");
    // Clicking the active layer toggles it off
    fireEvent.click(screen.getByText("Signal"));
    expect(onHeatmapFilterChange).toHaveBeenCalledWith("none");
  });

  it("opens chatbot panel on button click", () => {
    render(<FilterPanel {...defaultProps} />);
    fireEvent.click(screen.getByText("Personalised Route"));
    expect(screen.getByTestId("chatbot")).toBeInTheDocument();
  });

  it("shows detected network pill when available", () => {
    render(<FilterPanel {...defaultProps} detectedNetwork="Bharti Airtel" />);
    expect(screen.getByText("Bharti Airtel")).toBeInTheDocument();
    expect(screen.getByText("On:")).toBeInTheDocument();
  });

  it("shows weather section when weather prop provided", () => {
    const weather = {
      temperature_c: 33,
      condition: "Clear",
      description: "clear sky",
      icon: "01d",
      humidity_pct: 45,
      wind_speed_ms: 3.2,
      visibility_m: 10000,
      weather_factor: 0.95,
      signal_impact: "Optimal signal conditions",
      weather_id: 800,
    };
    render(<FilterPanel {...defaultProps} weather={weather} />);
    expect(screen.getByText("Weather")).toBeInTheDocument();
    expect(screen.getByTestId("weather-badge")).toBeInTheDocument();
  });

});
