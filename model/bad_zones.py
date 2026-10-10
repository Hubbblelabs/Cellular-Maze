"""Detect contiguous low-signal zones along a route and estimate timing."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bisect import bisect_left

import numpy as np
from model.utils import haversine, detect_edge_zone
from model.config import BAD_ZONE_THRESHOLD


def detect_bad_zones(
    path: list[dict],
    segment_signals: list[float],
    avg_speed_kmh: float = 40.0,
    threshold: float = BAD_ZONE_THRESHOLD,
) -> list[dict]:
    """Find contiguous stretches of weak signal and estimate arrival / duration.

    Returns list of zone dicts:
      start_index, end_index, length_km, min_signal,
      time_to_zone_min, zone_duration_min, edge_zone_name (if applicable),
      warning_message
    """
    n = len(segment_signals)
    if n == 0 or len(path) == 0:
        return []

    # Compute cumulative distance along route
    cum_dist = [0.0]
    for i in range(1, len(path)):
        d = haversine(path[i - 1]["lat"], path[i - 1]["lng"], path[i]["lat"], path[i]["lng"])
        cum_dist.append(cum_dist[-1] + d)

    # score_route subsamples long paths (path[::step]), so signal sample i is
    # generally NOT path[i]. Map every sample to its position on the full path.
    if n == len(path):
        sample_idx = list(range(n))
    else:
        sample_idx = [round(i * (len(path) - 1) / max(n - 1, 1)) for i in range(n)]
    sample_km = [cum_dist[j] for j in sample_idx]

    zones = []
    i = 0
    while i < n:
        if segment_signals[i] < threshold:
            start = i
            while i < n and segment_signals[i] < threshold:
                i += 1
            end = i - 1  # inclusive

            # A weak sample represents the stretch halfway to its neighbours,
            # so even a single weak sample yields a zone of realistic length.
            zone_start_km = (sample_km[start - 1] + sample_km[start]) / 2 if start > 0 else sample_km[start]
            zone_end_km = (sample_km[end] + sample_km[end + 1]) / 2 if end < n - 1 else sample_km[end]
            zone_len = zone_end_km - zone_start_km
            dist_to_zone = zone_start_km
            start_pt = min(bisect_left(cum_dist, zone_start_km), len(path) - 1)
            end_pt = min(bisect_left(cum_dist, zone_end_km), len(path) - 1)

            speed_kpm = max(avg_speed_kmh / 60.0, 0.1)  # km per minute
            time_to = dist_to_zone / speed_kpm
            duration = max(zone_len / speed_kpm, 0.1)

            min_sig = min(segment_signals[start:end + 1])

            # Check if the zone overlaps a known edge zone
            mid_idx = (start_pt + end_pt) // 2
            _, _, edge_name, _ = detect_edge_zone(path[mid_idx]["lat"], path[mid_idx]["lng"])

            if edge_name:
                reason = f"due to {edge_name}"
            elif min_sig < 10:
                reason = "no tower coverage in this stretch"
            else:
                reason = "sparse tower density"

            warning = (
                f"Network drop expected in ~{time_to:.0f} min, "
                f"lasting ~{duration:.1f} min ({reason})"
            )

            zones.append({
                "start_index": start_pt,
                "end_index": end_pt,
                "start_coord": path[start_pt],
                "end_coord": path[end_pt],
                "length_km": round(zone_len, 2),
                "min_signal": round(min_sig, 1),
                "avg_signal": round(float(np.mean(segment_signals[start:end + 1])), 1),
                "time_to_zone_min": round(time_to, 1),
                "zone_duration_min": round(duration, 1),
                "edge_zone_name": edge_name,
                "reason": reason,
                "warning": warning,
            })
        else:
            i += 1

    return zones


def assess_task_feasibility(
    segment_signals: list[float],
    task_type: str = "call",
    task_duration_min: float = 10.0,
    avg_speed_kmh: float = 40.0,
    total_distance_km: float = 10.0,
) -> dict:
    """Check whether a connectivity-dependent task can be completed on this route.

    task_type: "call" (needs continuous signal > 40),
               "meeting" (needs continuous signal > 60 for task_duration_min),
               "download" (needs avg signal > 50)

    Returns feasibility dict.
    """
    n = len(segment_signals)
    if n == 0:
        return {"feasible": False, "reason": "No signal data available"}

    route_time_min = (total_distance_km / max(avg_speed_kmh / 60.0, 0.1))
    time_per_segment = route_time_min / max(n, 1)

    thresholds = {"call": 40, "meeting": 60, "download": 50}
    thresh = thresholds.get(task_type, 40)

    if task_type == "download":
        avg = float(np.mean(segment_signals))
        feasible = avg >= thresh
        return {
            "feasible": feasible,
            "task_type": task_type,
            "avg_signal": round(avg, 1),
            "required_signal": thresh,
            "reason": "Sufficient average signal" if feasible
                      else f"Average signal ({avg:.0f}) below required ({thresh})",
        }

    # For call / meeting: need continuous window of adequate signal
    required_segments = max(1, int(task_duration_min / time_per_segment))
    longest_window = 0
    current = 0
    for s in segment_signals:
        if s >= thresh:
            current += 1
            longest_window = max(longest_window, current)
        else:
            current = 0

    longest_window_min = longest_window * time_per_segment
    feasible = longest_window >= required_segments

    return {
        "feasible": feasible,
        "task_type": task_type,
        "required_duration_min": round(task_duration_min, 1),
        "longest_stable_window_min": round(longest_window_min, 1),
        "required_signal": thresh,
        "reason": (
            f"Stable window of {longest_window_min:.1f} min available"
            if feasible else
            f"Longest stable window ({longest_window_min:.1f} min) is shorter "
            f"than required ({task_duration_min:.1f} min)"
        ),
    }
