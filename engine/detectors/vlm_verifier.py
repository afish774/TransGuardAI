"""Shared GPU FP16 Vision-Language Verifier (SigLIP patch16 / CLIP fallback).

A single model instance (~400 MB VRAM in FP16) serves BOTH:
  - Pillar 4 (Weapon Detection): rejects smartphones, umbrellas, bottles,
    handrails, selfie sticks, wallets, and newspapers on 1.25x context crops.
  - Pillar 5 (Stage-2 Violence Verification): rejects calm talking, hugging,
    helping hands, and crowded standing at 0 MB extra VRAM.

Why ``google/siglip-base-patch16-224`` over ``clip-vit-base-patch32``:
  1. 16x16 patches give 4x finer spatial resolution on small CCTV knives/guns.
  2. Independent sigmoid scoring avoids forced softmax competition across
     negative labels, yielding cleaner separation between true threats and
     transit background objects.
"""

import logging
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

try:
    from transformers import pipeline
    from PIL import Image
    VLM_DEPS_AVAILABLE = True
except ImportError:
    pipeline = None
    Image = None
    VLM_DEPS_AVAILABLE = False

from engine.config import (
    VLM_FALLBACK_MODELS,
    VLM_VERIFIER_MODEL,
    resolve_compute_device,
)

log = logging.getLogger("trans-guard-engine")

# ---------------------------------------------------------------------------
# Prompt banks calibrated for transit CCTV interiors
# ---------------------------------------------------------------------------
WEAPON_NEGATIVE_PROMPTS: Tuple[str, ...] = (
    "a photo of an umbrella or walking stick",
    "a photo of a smartphone or mobile phone",
    "a photo of a water bottle or thermos",
    "a photo of a wallet purse or handbag",
    "a photo of plain clothing fabric or empty hand",
    "a photo of a rolled newspaper or magazine",
    "a photo of a tool or household object",
    "a photo of a bus handrail strap or metal pole",
    "a photo of a selfie stick or camera tripod",
)

VIOLENCE_POSITIVE_PROMPTS: Tuple[str, ...] = (
    "a photo of two people physically fighting, punching, or kicking each other",
    "a photo of a violent physical assault, brawl, or aggressive grappling struggle",
)

VIOLENCE_NEGATIVE_PROMPTS: Tuple[str, ...] = (
    "a photo of people standing, walking, or sitting calmly inside a bus",
    "a photo of two people talking casually or gesturing during conversation",
    "a photo of two people hugging, shaking hands, or helping each other",
    "a photo of crowded passengers standing close together in public transit",
)

# Contrastive thresholds (SigLIP sigmoid vs CLIP softmax)
_SIGLIP_WEAPON_MIN_SCORE = 0.12
_SIGLIP_WEAPON_MIN_MARGIN = 0.06
_SIGLIP_WEAPON_MIN_RATIO = 1.50

_CLIP_WEAPON_MIN_SCORE = 0.28
_CLIP_WEAPON_MIN_MARGIN = 0.08

_SIGLIP_VIOLENCE_MIN_SCORE = 0.10
_SIGLIP_VIOLENCE_MIN_MARGIN = 0.05
_SIGLIP_VIOLENCE_MIN_RATIO = 1.35

_CLIP_VIOLENCE_MIN_SCORE = 0.28
_CLIP_VIOLENCE_MIN_MARGIN = 0.08


def evaluate_weapon_scores(
    result: Sequence[Dict[str, object]],
    weapon_prompt: str,
    predicted_class: str,
    is_siglip: bool = False,
) -> Tuple[bool, float, float, float]:
    """Evaluate contrastive weapon score vs strongest negative prompt.

    Returns ``(passed, weapon_score, best_neg_score, margin)``.
    """
    if not result:
        return (False, 0.0, 0.0, 0.0)

    top_label = str(result[0].get("label", ""))
    weapon_score = 0.0
    best_neg_score = 0.0
    for item in result:
        label = str(item.get("label", ""))
        score = float(item.get("score", 0.0))
        if label == weapon_prompt or predicted_class in label:
            weapon_score = max(weapon_score, score)
        else:
            best_neg_score = max(best_neg_score, score)

    margin = weapon_score - best_neg_score
    is_top = (top_label == weapon_prompt) or (predicted_class in top_label)

    if is_siglip:
        passed = (
            is_top
            and weapon_score >= _SIGLIP_WEAPON_MIN_SCORE
            and margin >= _SIGLIP_WEAPON_MIN_MARGIN
            and weapon_score >= best_neg_score * _SIGLIP_WEAPON_MIN_RATIO
        )
    else:
        passed = (
            is_top
            and weapon_score >= _CLIP_WEAPON_MIN_SCORE
            and margin >= _CLIP_WEAPON_MIN_MARGIN
        )
    return (passed, weapon_score, best_neg_score, margin)


def evaluate_violence_scores(
    result: Sequence[Dict[str, object]],
    positive_prompts: Sequence[str] = VIOLENCE_POSITIVE_PROMPTS,
    is_siglip: bool = False,
) -> Tuple[bool, float, float, float]:
    """Evaluate contrastive violence score vs calm/friendly/transit prompts.

    Returns ``(passed, pos_score, best_neg_score, margin)``.
    """
    if not result:
        return (False, 0.0, 0.0, 0.0)

    pos_set = set(positive_prompts)
    top_label = str(result[0].get("label", ""))
    pos_score = 0.0
    best_neg_score = 0.0

    for item in result:
        label = str(item.get("label", ""))
        score = float(item.get("score", 0.0))
        if label in pos_set:
            pos_score = max(pos_score, score)
        else:
            best_neg_score = max(best_neg_score, score)

    margin = pos_score - best_neg_score
    is_top = top_label in pos_set

    if is_siglip:
        passed = (
            is_top
            and pos_score >= _SIGLIP_VIOLENCE_MIN_SCORE
            and margin >= _SIGLIP_VIOLENCE_MIN_MARGIN
            and pos_score >= best_neg_score * _SIGLIP_VIOLENCE_MIN_RATIO
        )
    else:
        passed = (
            is_top
            and pos_score >= _CLIP_VIOLENCE_MIN_SCORE
            and margin >= _CLIP_VIOLENCE_MIN_MARGIN
        )
    return (passed, pos_score, best_neg_score, margin)


class VisionLanguageVerifier:
    """Shared async GPU FP16 SigLIP/CLIP verifier for Weapons and Violence."""

    def __init__(
        self,
        preferred_model: Optional[str] = None,
        pipe_override: Optional[Callable] = None,
        is_siglip_override: Optional[bool] = None,
    ):
        self._device, self._use_half, self._device_label = resolve_compute_device()
        self.pipe: Optional[Callable] = pipe_override
        self.model_name: str = preferred_model or VLM_VERIFIER_MODEL
        self.is_siglip: bool = (
            is_siglip_override
            if is_siglip_override is not None
            else ("siglip" in self.model_name.lower())
        )
        self._executor: Optional[ThreadPoolExecutor] = None

        if pipe_override is not None:
            return

        if not VLM_DEPS_AVAILABLE or pipeline is None:
            log.warning("transformers/Pillow missing; Vision-Language verification disabled.")
            return

        # Build deduplicated model fallback chain
        candidates: List[str] = []
        for name in (self.model_name, *VLM_FALLBACK_MODELS):
            if name and name not in candidates:
                candidates.append(name)

        vlm_device = 0 if self._device.startswith("cuda") else -1
        for model_id in candidates:
            try:
                log.info(
                    "Loading Vision-Language Verifier '%s' on %s...",
                    model_id,
                    self._device_label if vlm_device == 0 else "CPU",
                )
                if vlm_device == 0:
                    import torch
                    try:
                        self.pipe = pipeline(
                            "zero-shot-image-classification",
                            model=model_id,
                            device=vlm_device,
                            dtype=torch.float16,
                        )
                    except TypeError:
                        self.pipe = pipeline(
                            "zero-shot-image-classification",
                            model=model_id,
                            device=vlm_device,
                            torch_dtype=torch.float16,
                        )
                else:
                    self.pipe = pipeline(
                        "zero-shot-image-classification",
                        model=model_id,
                        device=-1,
                    )
                self.model_name = model_id
                self.is_siglip = "siglip" in model_id.lower()
                self._executor = ThreadPoolExecutor(
                    max_workers=1, thread_name_prefix="vlm-verify"
                )
                log.info(
                    "Vision-Language Verifier '%s' loaded on %s (mode=%s, async enabled).",
                    self.model_name,
                    self._device_label if vlm_device == 0 else "CPU",
                    "SigLIP-sigmoid" if self.is_siglip else "CLIP-softmax",
                )
                return
            except Exception as exc:
                log.warning(
                    "Could not load VLM verifier '%s' (%s); trying fallback...",
                    model_id,
                    exc,
                )
                self.pipe = None

        log.warning("All Vision-Language Verifier models failed to load; VLM verification disabled.")

    @property
    def available(self) -> bool:
        return self.pipe is not None

    def close(self) -> None:
        executor = getattr(self, "_executor", None)
        if executor is not None:
            executor.shutdown(wait=False, cancel_futures=True)
            self._executor = None

    def _to_pil(self, crop_bgr: np.ndarray):
        rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        return Image.fromarray(rgb) if Image is not None else rgb

    def verify_weapon(self, crop_bgr: np.ndarray, predicted_class: str) -> bool:
        """Synchronously verify a weapon candidate crop against 9 transit negative classes."""
        if self.pipe is None or crop_bgr is None or crop_bgr.size == 0:
            return True
        try:
            pil_img = self._to_pil(crop_bgr)
            weapon_prompt = f"a photo of a real {predicted_class} weapon being held"
            candidate_labels = [weapon_prompt, *WEAPON_NEGATIVE_PROMPTS]
            result = self.pipe(pil_img, candidate_labels=candidate_labels)
            passed, w_score, neg_score, margin = evaluate_weapon_scores(
                result, weapon_prompt, predicted_class, is_siglip=self.is_siglip
            )
            if not passed:
                top = result[0] if result else {}
                log.debug(
                    "VLM(%s) rejected weapon '%s': pos=%.3f neg=%.3f margin=%.3f (top='%s' %.3f)",
                    "SigLIP" if self.is_siglip else "CLIP",
                    predicted_class,
                    w_score,
                    neg_score,
                    margin,
                    top.get("label", ""),
                    float(top.get("score", 0.0)),
                )
            return passed
        except Exception as exc:
            # Fail-closed so errors never promote weak weapon detections
            log.warning("VLM weapon verification failed; rejecting '%s': %s", predicted_class, exc)
            return False

    def verify_violence(self, crop_bgr: np.ndarray) -> bool:
        """Synchronously verify a 2-person interaction crop for real physical violence."""
        if self.pipe is None or crop_bgr is None or crop_bgr.size == 0:
            return True
        try:
            pil_img = self._to_pil(crop_bgr)
            candidate_labels = [*VIOLENCE_POSITIVE_PROMPTS, *VIOLENCE_NEGATIVE_PROMPTS]
            result = self.pipe(pil_img, candidate_labels=candidate_labels)
            passed, p_score, neg_score, margin = evaluate_violence_scores(
                result, VIOLENCE_POSITIVE_PROMPTS, is_siglip=self.is_siglip
            )
            if not passed:
                top = result[0] if result else {}
                log.debug(
                    "VLM(%s) rejected violence pair: pos=%.3f neg=%.3f margin=%.3f (top='%s' %.3f)",
                    "SigLIP" if self.is_siglip else "CLIP",
                    p_score,
                    neg_score,
                    margin,
                    top.get("label", ""),
                    float(top.get("score", 0.0)),
                )
            return passed
        except Exception as exc:
            # Fail-closed: next frame can retry
            log.warning("VLM violence verification failed; suppressing candidate: %s", exc)
            return False

    def submit_weapon(self, crop_bgr: np.ndarray, predicted_class: str) -> Optional[Future]:
        """Submit non-blocking async weapon verification job on the shared GPU worker."""
        executor = getattr(self, "_executor", None)
        if executor is None or self.pipe is None:
            return None
        return executor.submit(self.verify_weapon, crop_bgr.copy(), predicted_class)

    def submit_violence(self, crop_bgr: np.ndarray) -> Optional[Future]:
        """Submit non-blocking async violence verification job on the shared GPU worker."""
        executor = getattr(self, "_executor", None)
        if executor is None or self.pipe is None:
            return None
        return executor.submit(self.verify_violence, crop_bgr.copy())
