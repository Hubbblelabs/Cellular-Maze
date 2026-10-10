import { renderHook, act } from "@testing-library/react";
import { useNetworkDetect } from "../useNetworkDetect";

describe("useNetworkDetect", () => {
  let originalNavigator: Navigator;

  beforeEach(() => {
    originalNavigator = global.navigator;
    // @ts-expect-error -- navigator is non-optional in the DOM typings
    delete global.navigator;
    global.navigator = {
      connection: {
        type: "wifi",
        effectiveType: "4g",
        downlink: 10,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
    } as unknown as Navigator;

    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => {
    global.navigator = originalNavigator;
    jest.restoreAllMocks();
  });

  it("initializes with browser network info", () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {})); // Never resolves
    
    const { result } = renderHook(() => useNetworkDetect());

    expect(result.current.connectionType).toBe("wifi");
    expect(result.current.effectiveType).toBe("4g");
    expect(result.current.downlink).toBe(10);
    expect(result.current.signalStrength).toBe("excellent"); // From downlink > 5 and effectiveType=4g
  });

  it("fetches advanced ISP info from backend and updates state", async () => {
    const mockISPResponse = {
      carrier: "Jio",
      isp: "Reliance Jio Infocomm",
      connection_type: "cellular",
      is_vpn: false,
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockISPResponse,
    });

    const { result } = renderHook(() => useNetworkDetect());

    // Should fetch from api/detect-network
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.type).toBe("Jio");
    expect(result.current.isp).toBe("Reliance Jio Infocomm");
    expect(result.current.detectedProvider).toBe("jio");
    expect(result.current.connectionType).toBe("cellular");
    expect(result.current.isVPN).toBe(false);
  });

  it("handles fetch errors gracefully by keeping browser info", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("Network Error"));

    const { result } = renderHook(() => useNetworkDetect());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.connectionType).toBe("wifi"); // Browser fallback remains
    expect(result.current.isp).toBe(""); 
    expect(result.current.type).toBe("unknown");
  });
});
