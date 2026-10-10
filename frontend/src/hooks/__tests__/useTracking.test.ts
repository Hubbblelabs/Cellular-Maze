import { act, renderHook } from "@testing-library/react";
import { closestOnPath, cumulativeKm, useTracking } from "../useTracking";

// ~11 km straight north-south line, 11 points
const path = Array.from({ length: 11 }, (_, i) => ({ lat: 12.9 + i * 0.01, lng: 77.6 }));

describe("useTracking", () => {
  const originalGeo = navigator.geolocation;

  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", { value: originalGeo, configurable: true });
    jest.useRealTimers();
  });

  it("is idle when inactive", () => {
    const { result } = renderHook(() => useTracking(path, false));
    expect(result.current).toEqual({ position: null, progress: 0, traveledKm: 0, mode: null });
  });

  it("simulates a drive along the route when geolocation is unavailable", () => {
    jest.useFakeTimers();
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });

    const { result } = renderHook(() => useTracking(path, true));
    act(() => {
      jest.advanceTimersByTime(45_000); // half of the compressed 90 s trip
    });

    expect(result.current.mode).toBe("simulated");
    expect(result.current.progress).toBeGreaterThan(0.45);
    expect(result.current.progress).toBeLessThan(0.55);
    expect(result.current.position!.lat).toBeCloseTo(12.95, 2);
  });

  it("falls back to simulation when the GPS fix is far from the route", () => {
    jest.useFakeTimers();
    const watchPosition = jest.fn((success: PositionCallback) => {
      // A fix in Mumbai, nowhere near the Bengaluru route
      success({ coords: { latitude: 19.07, longitude: 72.87 } } as GeolocationPosition);
      return 1;
    });
    Object.defineProperty(navigator, "geolocation", {
      value: { watchPosition, clearWatch: jest.fn() },
      configurable: true,
    });

    const { result } = renderHook(() => useTracking(path, true));
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.mode).toBe("simulated");
  });

  it("uses live GPS when the user is on the route", () => {
    const watchPosition = jest.fn((success: PositionCallback) => {
      success({ coords: { latitude: 12.95, longitude: 77.6 } } as GeolocationPosition);
      return 1;
    });
    Object.defineProperty(navigator, "geolocation", {
      value: { watchPosition, clearWatch: jest.fn() },
      configurable: true,
    });

    const { result } = renderHook(() => useTracking(path, true));
    expect(result.current.mode).toBe("gps");
    expect(result.current.progress).toBeCloseTo(0.5, 1);
  });
});

describe("path helpers", () => {
  it("computes cumulative distance and closest vertex", () => {
    const cum = cumulativeKm(path);
    expect(cum[0]).toBe(0);
    expect(cum[10]).toBeCloseTo(11.1, 0);
    expect(closestOnPath(path, { lat: 12.931, lng: 77.6 }).index).toBe(3);
  });
});
