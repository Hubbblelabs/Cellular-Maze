"use client";

import { useEffect, useState } from "react";
import type { TelecomMode } from "@/src/types/route";

type NetworkInfo = {
  type: string;              // ISP/carrier name or connection type
  effectiveType: string;     // 4g, 3g, etc.
  detectedProvider: TelecomMode;
  downlink: number | null;
  connectionType: "wifi" | "cellular" | "unknown";
  isp: string;               // ISP name from IP lookup
  signalStrength: string;    // estimated from effectiveType + downlink
  isVPN: boolean;
};

type ISPResponse = {
  isp: string;
  carrier: string;
  connection_type: string;
  is_vpn: boolean;
  ip: string;
  org: string;
  country: string;
  city: string;
};

export function useNetworkDetect() {
  const [info, setInfo] = useState<NetworkInfo>({
    type: "unknown",
    effectiveType: "",
    detectedProvider: "all",
    downlink: null,
    connectionType: "unknown",
    isp: "",
    signalStrength: "unknown",
    isVPN: false,
  });

  // Phase 1: Browser Network Information API (instant, limited info)
  useEffect(() => {
    const nav = navigator as NavigatorWithConnection;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;

    if (!conn) return;

    function update() {
      const c = conn!;
      const connType = (c.type ?? "unknown") as string;
      const isWifi = connType === "wifi";
      const eff = (c.effectiveType ?? "") as string;
      const dl = c.downlink ?? null;

      // Estimate signal strength from effectiveType and downlink
      let signalStrength = "unknown";
      if (eff === "4g" && dl && dl > 5) signalStrength = "excellent";
      else if (eff === "4g") signalStrength = "good";
      else if (eff === "3g") signalStrength = "fair";
      else if (eff === "2g" || eff === "slow-2g") signalStrength = "poor";

      setInfo((prev) => ({
        ...prev,
        connectionType: isWifi ? "wifi" : connType === "cellular" ? "cellular" : "unknown",
        effectiveType: eff,
        downlink: dl,
        signalStrength,
      }));
    }

    update();
    conn.addEventListener("change", update);
    return () => conn.removeEventListener("change", update);
  }, []);

  // Phase 2: Backend ISP/carrier detection via IP lookup
  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    fetch(`${apiBase}/api/detect-network`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed");
        return res.json() as Promise<ISPResponse>;
      })
      .then((data) => {
        // Map ISP name to TelecomMode
        let provider: TelecomMode = "all";
        const ispLower = (data.carrier || data.isp || "").toLowerCase();
        if (/\b(jio|reliance)\b/.test(ispLower)) provider = "jio";
        else if (/\b(airtel|bharti)\b/.test(ispLower)) provider = "airtel";
        else if (/\b(vodafone|idea|vi)\b/.test(ispLower)) provider = "vi";

        // A VPN/CDN exit (e.g. Cloudflare WARP) says nothing about the user's SIM
        const displayType = data.carrier || (data.is_vpn ? "unknown" : data.isp) || "unknown";

        setInfo((prev) => ({
          ...prev,
          type: displayType,
          isp: data.isp,
          detectedProvider: provider,
          isVPN: data.is_vpn,
          connectionType: data.connection_type === "wifi" ? "wifi" : data.connection_type === "cellular" ? "cellular" : prev.connectionType,
        }));
      })
      .catch(() => {
        // Silently fail -- use browser-only detection
      })
      .finally(() => clearTimeout(timeoutId));
  }, []);

  return info;
}

type NetworkConnection = {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  addEventListener: (event: string, fn: () => void) => void;
  removeEventListener: (event: string, fn: () => void) => void;
};

type NavigatorWithConnection = Navigator & {
  connection?: NetworkConnection;
  mozConnection?: NetworkConnection;
  webkitConnection?: NetworkConnection;
};
