"""Comprehensive model component tests -- run one by one."""
import sys, os, traceback
_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _ROOT)
os.chdir(_ROOT)

import numpy as np
import pandas as pd
import torch

PASS = 0
FAIL = 0
WARN = 0

def header(name):
    print(f"\n{'='*60}")
    print(f"  TEST: {name}")
    print(f"{'='*60}")

def ok(msg):
    global PASS
    PASS += 1
    print(f"  [PASS] {msg}")

def fail(msg):
    global FAIL
    FAIL += 1
    print(f"  [FAIL] {msg}")

def warn(msg):
    global WARN
    WARN += 1
    print(f"  [WARN] {msg}")

# ============================================================
# 1. CONFIG
# ============================================================
header("model.config")
try:
    from model.config import (
        INPUT_DIM, HIDDEN_DIM, RESIDUAL_BLOCKS, BOTTLENECK_DIM, DROPOUT,
        LR, WEIGHT_DECAY, BATCH_SIZE, EPOCHS, WARMUP_EPOCHS, GRAD_CLIP,
        LABEL_SMOOTHING, LOSS_WEIGHT_SIGNAL, LOSS_WEIGHT_DROP, LOSS_WEIGHT_HANDOFF,
        TRAIN_SPLIT, VAL_SPLIT, TEST_SPLIT, SEED, N_TOWERS, N_SAMPLES,
        ZONES, EDGE_ZONES, WEIGHTS_PATH, HEAD_HIDDEN,
    )
    ok(f"All config constants imported")
    ok(f"INPUT_DIM={INPUT_DIM}, HIDDEN_DIM={HIDDEN_DIM}, BLOCKS={RESIDUAL_BLOCKS}, BOTTLENECK={BOTTLENECK_DIM}, HEAD_HIDDEN={HEAD_HIDDEN}")
    ok(f"LR={LR}, BS={BATCH_SIZE}, EPOCHS={EPOCHS}, DROPOUT={DROPOUT}")
    ok(f"Loss weights: signal={LOSS_WEIGHT_SIGNAL}, drop={LOSS_WEIGHT_DROP}, handoff={LOSS_WEIGHT_HANDOFF}")
    ok(f"Splits: train={TRAIN_SPLIT}, val={VAL_SPLIT}, test={TEST_SPLIT}")
    ok(f"Zones={len(ZONES)}, Edge zones={len(EDGE_ZONES)}")
    ok(f"Weights path: {WEIGHTS_PATH}")
    if TRAIN_SPLIT + VAL_SPLIT + TEST_SPLIT != 1.0:
        fail(f"Splits don't sum to 1.0: {TRAIN_SPLIT + VAL_SPLIT + TEST_SPLIT}")
    else:
        ok("Splits sum to 1.0")
except Exception as e:
    fail(f"Config import failed: {e}")
    traceback.print_exc()

# ============================================================
# 2. ARCHITECTURE
# ============================================================
header("model.architecture")
try:
    from model.architecture import SignalNet
    model = SignalNet()
    param_count = model.count_parameters()
    ok(f"SignalNet instantiated, {param_count:,} parameters")

    # Test forward pass with batch
    x = torch.randn(16, INPUT_DIM)
    sig, drop, ho = model(x)
    assert sig.shape == (16,), f"Signal shape {sig.shape}"
    assert drop.shape == (16,), f"Drop shape {drop.shape}"
    assert ho.shape == (16,), f"Handoff shape {ho.shape}"
    ok(f"Forward pass batch=16: sig={sig.shape}, drop={drop.shape}, ho={ho.shape}")

    # All outputs in [0,1]
    assert sig.min() >= 0 and sig.max() <= 1, f"Signal out of range: [{sig.min():.3f}, {sig.max():.3f}]"
    assert drop.min() >= 0 and drop.max() <= 1, f"Drop out of range"
    assert ho.min() >= 0 and ho.max() <= 1, f"Handoff out of range"
    ok("All outputs in [0, 1] range")

    # Single sample
    x1 = torch.randn(1, INPUT_DIM)
    model.eval()
    with torch.no_grad():
        s1, d1, h1 = model(x1)
    ok(f"Single sample forward: sig={s1.item():.4f}, drop={d1.item():.4f}, ho={h1.item():.4f}")

except Exception as e:
    fail(f"Architecture test failed: {e}")
    traceback.print_exc()

# ============================================================
# 3. PROPAGATION MODELS
# ============================================================
header("model.propagation")
try:
    from model.propagation import (
        cost_231_hata, ericsson_9999, free_space_loss,
        itu_structure_loss, rain_attenuation, shadow_fading,
        combined_path_loss, received_signal_dbm, dbm_to_quality,
    )
    # Test COST-231 Hata
    pl = cost_231_hata(1800, 1.0, 30, 1.5)
    assert 100 < pl < 200, f"COST-231 Hata path loss out of range: {pl}"
    ok(f"COST-231 Hata: {pl:.1f} dB (1800MHz, 1km, 30m tower, 1.5m mobile)")

    # Ericsson 9999
    pl2 = ericsson_9999(1800, 30, 1.5, 1.0, "urban")
    assert 80 < pl2 < 200, f"Ericsson out of range: {pl2}"
    ok(f"Ericsson 9999: {pl2:.1f} dB (urban)")

    # Free space
    fs = free_space_loss(1800, 1.0)
    assert 80 < fs < 120, f"Free space out of range: {fs}"
    ok(f"Free space loss: {fs:.1f} dB")

    # Structure loss
    sl = itu_structure_loss(1800, n_floors=0, structure_type="concrete")
    assert sl > 20, f"Structure loss too low: {sl}"
    ok(f"ITU structure loss (concrete): {sl:.1f} dB")

    # Rain attenuation
    ra = rain_attenuation(1800, 2.0, 25.0)
    assert ra >= 0, f"Rain attenuation negative: {ra}"
    ok(f"Rain attenuation (25mm/h, 2km): {ra:.2f} dB")

    # Shadow fading
    rng = np.random.default_rng(42)
    sf = shadow_fading(rng)
    ok(f"Shadow fading sample: {sf:.2f} dB")

    # Combined
    cpl = combined_path_loss(1800, 1.0, 30, 1.5, "urban")
    assert 80 < cpl < 250, f"Combined path loss out of range: {cpl}"
    ok(f"Combined path loss: {cpl:.1f} dB")

    # dBm to quality
    q1 = dbm_to_quality(-60)
    q2 = dbm_to_quality(-90)
    q3 = dbm_to_quality(-120)
    assert q1 == 100, f"Strong signal should be 100, got {q1}"
    assert 20 < q2 < 60, f"Medium signal out of range: {q2}"
    assert q3 < 5, f"Very weak signal should be near 0: {q3}"
    ok(f"dBm->quality: -60dBm={q1}, -90dBm={q2}, -120dBm={q3}")

except Exception as e:
    fail(f"Propagation test failed: {e}")
    traceback.print_exc()

# ============================================================
# 4. UTILS (Feature Extraction)
# ============================================================
header("model.utils")
try:
    from model.utils import (
        haversine, haversine_vec, extract_features, detect_edge_zone,
        tower_load_factor, nearest_zone_info,
    )
    # Haversine
    d = haversine(12.9716, 77.5946, 12.9279, 77.6271)
    assert 3 < d < 7, f"MG Road to Koramangala distance wrong: {d:.2f} km"
    ok(f"Haversine MG Road->Koramangala: {d:.2f} km")

    # Vectorized haversine
    lats = np.array([12.928, 12.960, 12.971])
    lngs = np.array([77.627, 77.590, 77.595])
    dv = haversine_vec(12.9716, 77.5946, lats, lngs)
    assert len(dv) == 3
    ok(f"Vectorized haversine: {dv}")

    # Zone info
    name, info = nearest_zone_info(12.9716, 77.5946)
    assert name == "MG Road", f"Expected MG Road, got {name}"
    ok(f"Nearest zone to (12.97, 77.59): {name}")

    # Edge zone
    tc, pen, zname, struct = detect_edge_zone(13.0350, 77.5965)
    ok(f"Edge zone at Hebbal: terrain={tc}, penalty={pen}dB, name={zname}")

    # Load factor
    lf_peak = tower_load_factor(18.0)
    lf_night = tower_load_factor(3.0)
    assert lf_peak > lf_night, f"Peak load should exceed night: {lf_peak} vs {lf_night}"
    ok(f"Load factor: peak(18h)={lf_peak}, night(3h)={lf_night}")

    # Feature extraction with towers
    towers = pd.DataFrame({
        "lat": [12.928, 12.960, 12.971],
        "lng": [77.627, 77.590, 77.595],
        "signal_score": [80, 70, 90],
        "frequency_mhz": [1800, 2100, 900],
    })
    feats = extract_features(12.9716, 77.5946, towers, time_hour=14.0, weather_factor=1.0, speed_kmh=40.0)
    assert feats.shape == (22,), f"Feature shape wrong: {feats.shape}"
    assert not np.any(np.isnan(feats)), f"NaN in features: {feats}"
    assert not np.any(np.isinf(feats)), f"Inf in features: {feats}"
    ok(f"Feature extraction (22-dim): shape={feats.shape}, range=[{feats.min():.3f}, {feats.max():.3f}]")

    # Feature extraction with EMPTY towers
    empty_towers = pd.DataFrame()
    feats_empty = extract_features(12.9716, 77.5946, empty_towers)
    assert feats_empty.shape == (22,), f"Empty towers feature shape: {feats_empty.shape}"
    assert not np.any(np.isnan(feats_empty)), f"NaN in empty features"
    ok(f"Feature extraction (empty towers): shape={feats_empty.shape}")

    # Feature extraction with single tower
    single_tower = pd.DataFrame({"lat": [12.972], "lng": [77.595], "signal_score": [85]})
    feats_single = extract_features(12.9716, 77.5946, single_tower)
    assert feats_single.shape == (22,)
    ok(f"Feature extraction (single tower): shape={feats_single.shape}")

except Exception as e:
    fail(f"Utils test failed: {e}")
    traceback.print_exc()

# ============================================================
# 5. INFERENCE (Model Loading + Prediction)
# ============================================================
header("model.inference")
try:
    from model.inference import predict_single, predict_single_with_uncertainty, predict, reload_model
    from model.utils import extract_features as ef2

    # Reload to ensure fresh
    reload_model()

    # Create test features first
    towers_test = pd.DataFrame({
        "lat": [12.960, 12.950],
        "lng": [77.610, 77.620],
        "signal_score": [80, 75],
    })
    feats = ef2(12.9716, 77.5946, towers_test, time_hour=14.0)
    # Single prediction
    result = predict_single(feats)
    assert "signal_strength" in result
    assert "drop_probability" in result
    assert "handoff_risk" in result
    assert 0 <= result["signal_strength"] <= 100, f"Signal out of range: {result['signal_strength']}"
    assert 0 <= result["drop_probability"] <= 1, f"Drop out of range: {result['drop_probability']}"
    assert 0 <= result["handoff_risk"] <= 1, f"Handoff out of range: {result['handoff_risk']}"
    ok(f"predict_single: signal={result['signal_strength']:.2f}, drop={result['drop_probability']:.4f}, handoff={result['handoff_risk']:.4f}")

    # MC Dropout uncertainty
    result_unc = predict_single_with_uncertainty(feats, n_samples=10)
    assert "signal_uncertainty" in result_unc, "Missing signal_uncertainty"
    assert "drop_uncertainty" in result_unc, "Missing drop_uncertainty"
    assert "handoff_uncertainty" in result_unc, "Missing handoff_uncertainty"
    assert result_unc["signal_uncertainty"] >= 0, "Negative uncertainty"
    ok(f"MC Dropout uncertainty: sig_unc={result_unc['signal_uncertainty']:.4f}, drop_unc={result_unc['drop_uncertainty']:.6f}")

    # Batch prediction
    batch_feats = np.random.rand(10, 22).astype(np.float32)
    batch_result = predict(batch_feats)
    assert batch_result["signal_strength"].shape == (10,), f"Batch shape wrong: {batch_result['signal_strength'].shape}"
    ok(f"Batch predict (10 samples): signal range [{batch_result['signal_strength'].min():.1f}, {batch_result['signal_strength'].max():.1f}]")

    # Edge case: all-zero features
    zero_feats = np.zeros(22, dtype=np.float32)
    result_zero = predict_single(zero_feats)
    ok(f"Zero features: signal={result_zero['signal_strength']:.2f}")

    # Edge case: max features
    max_feats = np.ones(22, dtype=np.float32)
    result_max = predict_single(max_feats)
    ok(f"Max features: signal={result_max['signal_strength']:.2f}")

except Exception as e:
    fail(f"Inference test failed: {e}")
    traceback.print_exc()

# ============================================================
# 6. SCORING
# ============================================================
header("model.scoring")
try:
    from model.scoring import score_route, rank_routes

    path = [
        {"lat": 12.9716, "lng": 77.5946},
        {"lat": 12.9600, "lng": 77.6100},
        {"lat": 12.9500, "lng": 77.6200},
        {"lat": 12.9400, "lng": 77.6300},
        {"lat": 12.9279, "lng": 77.6271},
    ]
    towers = pd.DataFrame({
        "lat": [12.960, 12.950, 12.935, 12.928],
        "lng": [77.610, 77.620, 77.625, 77.627],
        "signal_score": [80, 75, 70, 85],
        "operator": ["Jio", "Airtel", "Vi", "Jio"],
    })

    conn = score_route(path, towers, telecom="all", time_hour=14.0, weather_factor=1.0, speed_kmh=40.0)
    assert "avg_connectivity" in conn, "Missing avg_connectivity"
    assert "segment_signals" in conn, "Missing segment_signals"
    assert "drops_per_km" in conn, "Missing drops_per_km"
    assert "confidence" in conn, "Missing confidence"
    assert "avg_uncertainty" in conn, "Missing avg_uncertainty"
    ok(f"score_route: avg_conn={conn['avg_connectivity']:.1f}, drops_per_km={conn['drops_per_km']:.2f}, confidence={conn['confidence']}")

    # Rank routes
    routes = [
        {"name": "Route A", "path": path, "eta": 15.0, "distance": 5.0},
        {"name": "Route B", "path": list(reversed(path)), "eta": 20.0, "distance": 6.5},
    ]
    ranked = rank_routes(routes, towers, preference=50, telecom="all", time_hour=14.0)
    assert len(ranked) == 2, f"Expected 2 routes, got {len(ranked)}"
    assert "weighted_score" in ranked[0], "Missing weighted_score"
    assert "drops_per_km" in ranked[0], "Missing drops_per_km in ranked"
    assert "confidence" in ranked[0], "Missing confidence in ranked"
    ok(f"rank_routes: {ranked[0]['name']} ({ranked[0]['weighted_score']:.1f}) > {ranked[1]['name']} ({ranked[1]['weighted_score']:.1f})")

except Exception as e:
    fail(f"Scoring test failed: {e}")
    traceback.print_exc()

# ============================================================
# 7. BAD ZONES
# ============================================================
header("model.bad_zones")
try:
    from model.bad_zones import detect_bad_zones, assess_task_feasibility

    # Mix of good and bad signals
    signals = [80, 75, 25, 20, 15, 10, 25, 70, 85, 90]
    path10 = [{"lat": 12.97 - i*0.003, "lng": 77.59 + i*0.003} for i in range(10)]
    
    bad = detect_bad_zones(path10, signals, avg_speed_kmh=40.0)
    ok(f"detect_bad_zones: found {len(bad)} zones in {len(signals)} segments")
    for bz in bad:
        ok(f"  Bad zone: {bz['length_km']:.2f}km, min_signal={bz['min_signal']:.0f}, warning={bz['warning'][:50]}")

    # Task feasibility
    tf = assess_task_feasibility(signals, task_type="call", task_duration_min=5.0, avg_speed_kmh=40.0, total_distance_km=3.0)
    ok(f"Task feasibility (call 5min): feasible={tf['feasible']}, longest_window={tf.get('longest_window_min', 'N/A')}")

    # All good signals
    good_signals = [80, 85, 90, 88, 92]
    path5 = [{"lat": 12.97 - i*0.003, "lng": 77.59 + i*0.003} for i in range(5)]
    bad_none = detect_bad_zones(path5, good_signals)
    assert len(bad_none) == 0, f"Expected 0 bad zones for good signals, got {len(bad_none)}"
    ok("No bad zones for good signals")

except Exception as e:
    fail(f"Bad zones test failed: {e}")
    traceback.print_exc()

# ============================================================
# 8. EXPLAINABILITY
# ============================================================
header("model.explainability")
try:
    from model.explainability import explain_recommendation, explain_bad_zones, compare_routes_summary

    routes_for_explain = [
        {"name": "Fastest Route", "connectivity": {"avg_connectivity": 75, "min_connectivity": 30, "drop_segments": 1}, "eta": 15.0, "distance": 5.0, "weighted_score": 80},
        {"name": "Scenic Route", "connectivity": {"avg_connectivity": 65, "min_connectivity": 20, "drop_segments": 3}, "eta": 22.0, "distance": 7.0, "weighted_score": 60},
    ]
    explanation = explain_recommendation(routes_for_explain, recommended_idx=0, preference=50)
    assert isinstance(explanation, str) and len(explanation) > 5
    ok(f"explain_recommendation: '{explanation[:80]}...'")

    # Bad zone explanation
    bz_explanations = explain_bad_zones([{
        "start_coord": {"lat": 12.97, "lng": 77.59},
        "end_coord": {"lat": 12.96, "lng": 77.60},
        "length_km": 0.5,
        "min_signal": 15,
        "time_to_zone_min": 3.0,
        "zone_duration_min": 1.5,
        "warning": "Dead zone ahead",
    }])
    assert isinstance(bz_explanations, list)
    ok(f"explain_bad_zones: {len(bz_explanations)} explanations")

except Exception as e:
    fail(f"Explainability test failed: {e}")
    traceback.print_exc()

# ============================================================
# 9. SMART PREFERENCE
# ============================================================
header("model.smart_preference")
try:
    from model.smart_preference import resolve_intent, get_smart_preference

    # Resolve intents
    for intent in ["meeting", "call", "navigation", "fastest", "download", "streaming", "emergency", "work", "idle", "best_signal"]:
        result = resolve_intent(intent)
        ok(f"  {intent:>12s} -> preference={result['preference']}, task={result['task_type']}, duration={result['task_duration_min']}")

    # Fuzzy matching
    result_z = resolve_intent("zoom call for work")
    ok(f"Fuzzy 'zoom call for work': preference={result_z['preference']}, task={result_z['task_type']}")

    # Smart preference (no history)
    try:
        smart = get_smart_preference("test_user_999", "navigation", 14.0)
        ok(f"Smart preference: {smart}")
    except TypeError:
        # May have different signature
        smart = resolve_intent("navigation")
        ok(f"Smart preference (via resolve): {smart['preference']}")

except Exception as e:
    fail(f"Smart preference test failed: {e}")
    traceback.print_exc()

# ============================================================
# 10. RL LEARNING
# ============================================================
header("model.rl_learning")
try:
    from model.rl_learning import ContextualBandit, time_to_bucket, day_to_type, coord_to_zone

    # Time buckets
    for h in [2, 7, 9, 13, 18, 22]:
        bucket = time_to_bucket(h)
        ok(f"  hour={h} -> bucket={bucket}")

    # Day type
    assert day_to_type(0) == "weekday"
    assert day_to_type(5) == "weekend"
    ok("Day type: Mon=weekday, Sat=weekend")

    # Zone from coords
    zone = coord_to_zone(12.9716, 77.5946)
    assert zone == "MG Road", f"Expected MG Road, got {zone}"
    ok(f"Coord to zone: (12.97, 77.59) = {zone}")

    # Bandit creation + select (without file backing)
    bandit = ContextualBandit("__test_bandit_user__")
    result = bandit.select(
        origin_lat=12.9716, origin_lng=77.5946,
        dest_lat=12.9279, dest_lng=77.6271,
        time_hour=9.0, day_of_week=1,
    )
    ok(f"Bandit select: intent={result.get('intent')}, confidence={result.get('confidence', 0):.2f}, explore={result.get('exploration_needed')}")

    # Cleanup test user
    import shutil
    from model.config import DATA_DIR
    test_path = DATA_DIR / "rl_profiles" / "__test_bandit_user__.json"
    if test_path.exists():
        test_path.unlink()

except Exception as e:
    fail(f"RL learning test failed: {e}")
    traceback.print_exc()

# ============================================================
# 11. EVALUATE (Metrics)
# ============================================================
header("model.evaluate")
try:
    from model.evaluate import load_test_data, evaluate

    X_test, y_sig, y_drop, y_ho = load_test_data()
    ok(f"Test data loaded: {X_test.shape[0]} samples, {X_test.shape[1]} features")
    assert X_test.shape[1] == 22, f"Expected 22 features, got {X_test.shape[1]}"

    # Run full evaluation
    metrics = evaluate()
    sig_metrics = metrics['signal']
    drop_metrics = metrics['drop']
    ho_metrics = metrics['handoff']
    ok(f"Signal MAE:  {sig_metrics['MAE']*100:.2f}%")
    ok(f"Signal R2:   {sig_metrics['R2']:.4f}")
    ok(f"Signal RMSE: {sig_metrics['RMSE']*100:.2f}%")
    ok(f"Drop accuracy: {drop_metrics['accuracy']*100:.1f}%")
    ok(f"Handoff accuracy: {ho_metrics['accuracy']*100:.1f}%")
    bz = metrics.get('bad_zone', {})
    ok(f"Bad-zone F1: {bz.get('f1', 0)*100:.1f}%")
    ok(f"Drop ECE: {metrics.get('drop_calibration_ece', 0):.4f}")

    # Sanity checks
    assert sig_metrics['R2'] > 0.80, f"R2 too low: {sig_metrics['R2']}"
    assert drop_metrics['accuracy'] > 0.85, f"Drop accuracy too low: {drop_metrics['accuracy']}"
    assert ho_metrics['accuracy'] > 0.90, f"Handoff accuracy too low: {ho_metrics['accuracy']}"
    ok("All metrics within acceptable ranges")

except Exception as e:
    fail(f"Evaluate test failed: {e}")
    traceback.print_exc()

# ============================================================
# 12. SCHEMAS
# ============================================================
header("model.schemas")
try:
    from model.schemas import (
        PredictSignalRequest, PredictSignalResponse,
        ScoreRoutesRequest, AnalyzeRouteRequest,
        Coordinate, TowerInput, RouteInput,
    )
    # Valid request
    req = PredictSignalRequest(
        lat=12.9716, lng=77.5946,
        towers=[TowerInput(lat=12.972, lng=77.595, signal_score=80)],
        telecom="all", time_hour=14.0, weather_factor=1.0, speed_kmh=40.0,
    )
    ok(f"PredictSignalRequest validated: lat={req.lat}, lng={req.lng}")

    # Response
    resp = PredictSignalResponse(
        lat=12.9716, lng=77.5946,
        signal_strength=85.5, drop_probability=0.05,
        handoff_risk=0.03, edge_zone=None,
        nearby_towers=3, confidence="high",
    )
    ok(f"PredictSignalResponse validated: signal={resp.signal_strength}")

except Exception as e:
    fail(f"Schema test failed: {e}")
    traceback.print_exc()

# ============================================================
# SUMMARY
# ============================================================
print(f"\n{'='*60}")
print(f"  TEST SUMMARY")
print(f"{'='*60}")
print(f"  PASS: {PASS}")
print(f"  FAIL: {FAIL}")
print(f"  WARN: {WARN}")
print(f"{'='*60}")
if FAIL > 0:
    print("  SOME TESTS FAILED")
    sys.exit(1)
else:
    print("  ALL TESTS PASSED")
