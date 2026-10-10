"""Model inference: load trained weights and expose predict / predict_single."""

import sys
import threading
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import torch

from model.config import INPUT_DIM, WEIGHTS_PATH, MC_SAMPLES
from model.architecture import SignalNet

# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_model: SignalNet | None = None
_device: torch.device | None = None
_load_lock = threading.Lock()  # routes are scored in parallel threads


def _load_model():
    """Load the best model weights (lazily, once)."""
    global _model, _device
    if _model is not None:
        return
    with _load_lock:
        if _model is None:
            _load_model_locked()


def _load_model_locked():
    global _model, _device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = SignalNet(input_dim=INPUT_DIM).to(device)

    if WEIGHTS_PATH.exists():
        try:
            ckpt = torch.load(WEIGHTS_PATH, map_location=device, weights_only=True)
            model.load_state_dict(ckpt["model_state_dict"])
            print(f"[inference] Loaded model from {WEIGHTS_PATH} on {device}")
        except RuntimeError as e:
            print(f"[inference] WARNING: Weights incompatible (likely INPUT_DIM changed) -- using random init. Re-train to fix. Error: {e}")
    else:
        print(f"[inference] WARNING: No weights at {WEIGHTS_PATH} -- using random init")
    model.eval()

    # Publish only once fully loaded so other threads never see random weights
    _device = device
    _model = model


def predict(features: np.ndarray) -> dict:
    """Predict signal metrics for a batch of feature vectors.

    Parameters
    ----------
    features : (N, 22) float32 array

    Returns
    -------
    dict with keys:
        signal_strength  : (N,) array, 0-100 scale
        drop_probability : (N,) array, 0-1 scale
        handoff_risk     : (N,) array, 0-1 scale
    """
    _load_model()

    if features.ndim == 1:
        features = features.reshape(1, -1)

    x = torch.tensor(features, dtype=torch.float32).to(_device)
    with torch.no_grad():
        sig, drop, handoff = _model(x)

    return {
        "signal_strength": sig.cpu().numpy() * 100.0,
        "drop_probability": drop.cpu().numpy(),
        "handoff_risk": handoff.cpu().numpy(),
    }


def predict_with_uncertainty(features: np.ndarray, n_samples: int = MC_SAMPLES) -> dict:
    """MC Dropout inference: run model multiple times with dropout enabled.

    Returns mean predictions plus uncertainty (std) for each output.
    """
    _load_model()

    if features.ndim == 1:
        features = features.reshape(1, -1)

    x = torch.tensor(features, dtype=torch.float32).to(_device)

    # Enable dropout only (keep BatchNorm in eval mode to avoid batch_size=1 crash)
    _model.eval()
    for m in _model.modules():
        if isinstance(m, torch.nn.Dropout):
            m.train()

    sigs, drops, handoffs = [], [], []
    with torch.no_grad():
        for _ in range(n_samples):
            s, d, h = _model(x)
            sigs.append(s.cpu().numpy())
            drops.append(d.cpu().numpy())
            handoffs.append(h.cpu().numpy())

    # Restore full eval mode
    _model.eval()

    sigs = np.stack(sigs)       # (n_samples, N)
    drops = np.stack(drops)     # (n_samples, N)
    handoffs = np.stack(handoffs)

    return {
        "signal_strength": np.mean(sigs, axis=0) * 100.0,
        "drop_probability": np.mean(drops, axis=0),
        "handoff_risk": np.mean(handoffs, axis=0),
        "signal_uncertainty": np.std(sigs, axis=0) * 100.0,
        "drop_uncertainty": np.std(drops, axis=0),
        "handoff_uncertainty": np.std(handoffs, axis=0),
    }


def predict_single(features: np.ndarray) -> dict:
    """Predict for a single (22,) feature vector. Returns scalar values."""
    result = predict(features.reshape(1, -1))
    return {
        "signal_strength": float(result["signal_strength"][0]),
        "drop_probability": float(result["drop_probability"][0]),
        "handoff_risk": float(result["handoff_risk"][0]),
    }


def predict_single_with_uncertainty(features: np.ndarray, n_samples: int = MC_SAMPLES) -> dict:
    """MC Dropout prediction for a single point with uncertainty."""
    result = predict_with_uncertainty(features.reshape(1, -1), n_samples=n_samples)
    return {
        "signal_strength": float(result["signal_strength"][0]),
        "drop_probability": float(result["drop_probability"][0]),
        "handoff_risk": float(result["handoff_risk"][0]),
        "signal_uncertainty": float(result["signal_uncertainty"][0]),
        "drop_uncertainty": float(result["drop_uncertainty"][0]),
        "handoff_uncertainty": float(result["handoff_uncertainty"][0]),
    }


def reload_model():
    """Force-reload the model (e.g. after re-training)."""
    global _model
    _model = None
    _load_model()
