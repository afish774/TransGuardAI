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
    import torch
    from transformers import AutoConfig, AutoModel, AutoProcessor
    from transformers.utils import logging as hf_logging
    from PIL import Image
    hf_logging.set_verbosity_error()
    VLM_DEPS_AVAILABLE = True
except ImportError:
    torch = None
    AutoConfig = None
    AutoModel = None
    AutoProcessor = None
    Image = None
    VLM_DEPS_AVAILABLE = False

from engine.config import (
    VLM_FALLBACK_MODELS,
    VLM_VERIFIER_MODEL,
    resolve_compute_device,
)
from engine.detectors.violence_head import TrainedViolenceHead

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

# Open-vocabulary Pose-Guided Hand-Weapon Patrol prompts & strict gates.
# Catches butcher knives, kitchen blades, and handguns held edge-on or in low
# contrast even when lightweight yolov8n-weapons.pt misses them, while requiring
# high contrastive confidence + multi-scan confirmation to avoid false alarms.
HAND_WEAPON_POSITIVE_PROMPTS: Tuple[Tuple[str, str], ...] = (
    ("knife", "a photo of a real knife weapon being held"),
    ("gun", "a photo of a real gun or firearm weapon being held"),
)

HAND_WEAPON_NEGATIVE_PROMPTS: Tuple[str, ...] = (
    *WEAPON_NEGATIVE_PROMPTS,
    "a photo of a person with empty hands and no weapon",
    "a photo of a person standing casually with relaxed empty hands at their side",
)

_HAND_PATROL_MIN_SCORE = 0.64
_HAND_PATROL_MIN_MARGIN = 0.48
_HAND_PATROL_MIN_RATIO = 4.20

VIOLENCE_POSITIVE_PROMPTS: Tuple[str, ...] = (
    "a photo of two people physically fighting, punching, or kicking each other",
    "a photo of a violent physical assault, brawl, or aggressive grappling struggle",
    "a photo of two people wrestling, pushing, hitting, or slapping each other",
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
_SIGLIP_VIOLENCE_MIN_MARGIN = 0.04
_SIGLIP_VIOLENCE_MIN_RATIO = 1.25

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


def evaluate_hand_weapon_scores(
    result: Sequence[Dict[str, object]],
    positive_prompts: Sequence[Tuple[str, str]] = HAND_WEAPON_POSITIVE_PROMPTS,
) -> Optional[Tuple[str, float, float, float]]:
    """Strict contrastive evaluator for pose-guided open-vocabulary hand scans.

    Returns ``(weapon_class, pos_score, best_neg_score, margin)`` on a clear
    high-margin weapon win, or ``None`` when hands look normal/ambiguous.
    """
    if not result:
        return None

    pos_lookup = {prompt: cls_name for cls_name, prompt in positive_prompts}
    top_label = str(result[0].get("label", ""))
    if top_label not in pos_lookup:
        return None

    best_cls = pos_lookup[top_label]
    best_pos = float(result[0].get("score", 0.0))
    best_neg = 0.0
    for item in result:
        label = str(item.get("label", ""))
        score = float(item.get("score", 0.0))
        if label not in pos_lookup:
            best_neg = max(best_neg, score)

    margin = best_pos - best_neg
    if (
        best_pos >= _HAND_PATROL_MIN_SCORE
        and margin >= _HAND_PATROL_MIN_MARGIN
        and best_pos >= best_neg * _HAND_PATROL_MIN_RATIO
    ):
        return (best_cls, best_pos, best_neg, margin)
    return None


def _sanitize_vlm_config(config) -> None:
    """Fix out-of-vocabulary bos/eos token IDs shipped in some upstream SigLIP configs."""
    text_cfg = getattr(config, "text_config", config)
    vocab_size = getattr(text_cfg, "vocab_size", None)
    if not isinstance(vocab_size, int) or vocab_size <= 0:
        return
    for attr in ("bos_token_id", "eos_token_id"):
        val = getattr(text_cfg, attr, None)
        if isinstance(val, int) and (val < 0 or val >= vocab_size):
            setattr(text_cfg, attr, None)


def _load_vlm_offline_first(model_id: str, use_gpu: bool, use_half: bool = True):
    """Load AutoConfig, AutoProcessor, and AutoModel from local cache first (0 HTTP probes),
    falling back to HuggingFace Hub only when the model is not yet cached locally."""
    for local_only in (True, False):
        try:
            config = AutoConfig.from_pretrained(model_id, local_files_only=local_only)
            _sanitize_vlm_config(config)
            processor = AutoProcessor.from_pretrained(model_id, local_files_only=local_only)
            load_kwargs = {"config": config, "local_files_only": local_only}
            if use_gpu and use_half and torch is not None:
                try:
                    model = AutoModel.from_pretrained(model_id, dtype=torch.float16, **load_kwargs)
                except TypeError:
                    model = AutoModel.from_pretrained(model_id, torch_dtype=torch.float16, **load_kwargs)
            else:
                model = AutoModel.from_pretrained(model_id, **load_kwargs)
            return processor, model, local_only
        except OSError:
            if not local_only:
                raise
    raise RuntimeError(f"Failed to load model '{model_id}'")


class VisionLanguageVerifier:
    """Shared async GPU FP16 SigLIP/CLIP verifier using direct AutoModel + cached text embeddings."""

    def __init__(
        self,
        preferred_model: Optional[str] = None,
        pipe_override: Optional[Callable] = None,
        is_siglip_override: Optional[bool] = None,
    ):
        self._device, self._use_half, self._device_label = resolve_compute_device()
        self.pipe: Optional[Callable] = pipe_override
        self._model = None
        self._processor = None
        self._torch_device = None
        self._violence_head: Optional[TrainedViolenceHead] = None
        self._text_cache: Dict[Tuple[str, ...], object] = {}
        self.model_name: str = preferred_model or VLM_VERIFIER_MODEL
        self.is_siglip: bool = (
            is_siglip_override
            if is_siglip_override is not None
            else ("siglip" in self.model_name.lower())
        )
        self._executor: Optional[ThreadPoolExecutor] = None

        if pipe_override is not None:
            return

        if not VLM_DEPS_AVAILABLE or AutoModel is None or AutoProcessor is None or torch is None:
            log.warning("transformers/PyTorch/Pillow missing; Vision-Language verification disabled.")
            return

        # Build deduplicated model fallback chain
        candidates: List[str] = []
        for name in (self.model_name, *VLM_FALLBACK_MODELS):
            if name and name not in candidates:
                candidates.append(name)

        use_gpu = self._device.startswith("cuda")
        target_device = torch.device(self._device if use_gpu else "cpu")

        for model_id in candidates:
            try:
                log.info(
                    "Loading Vision-Language Verifier '%s' on %s...",
                    model_id,
                    self._device_label if use_gpu else "CPU",
                )
                processor, model, loaded_offline = _load_vlm_offline_first(
                    model_id, use_gpu, self._use_half
                )
                model.to(target_device)
                model.eval()

                self._processor = processor
                self._model = model
                self._torch_device = target_device
                self._text_cache.clear()
                self.model_name = model_id
                self.is_siglip = "siglip" in model_id.lower()
                self.pipe = self._classify_direct
                self._executor = ThreadPoolExecutor(
                    max_workers=1, thread_name_prefix="vlm-verify"
                )
                if self.is_siglip:
                    head = TrainedViolenceHead(device=target_device)
                    self._violence_head = head if head.available else None
                log.info(
                    "Vision-Language Verifier '%s' loaded on %s (mode=%s, cache=%s, direct-GPU + cached text).",
                    self.model_name,
                    self._device_label if use_gpu else "CPU",
                    "SigLIP-sigmoid" if self.is_siglip else "CLIP-softmax",
                    "offline-local" if loaded_offline else "hub-downloaded",
                )
                return
            except Exception as exc:
                log.warning(
                    "Could not load VLM verifier '%s' (%s); trying fallback...",
                    model_id,
                    exc,
                )
                self._model = None
                self._processor = None
                self.pipe = None

        log.warning("All Vision-Language Verifier models failed to load; VLM verification disabled.")

    def _get_text_features(self, candidate_labels: Sequence[str]):
        """Encode and L2-normalize prompt bank once per unique label tuple."""
        key = tuple(candidate_labels)
        cached = self._text_cache.get(key)
        if cached is not None:
            return cached

        text_kwargs = {"text": list(key), "return_tensors": "pt", "truncation": True}
        text_kwargs["padding"] = "max_length" if self.is_siglip else True
        text_inputs = self._processor(**text_kwargs)
        text_inputs = {
            k: v.to(self._torch_device)
            for k, v in text_inputs.items()
            if hasattr(v, "to")
        }
        with torch.inference_mode():
            text_out = self._model.get_text_features(**text_inputs)
            if not isinstance(text_out, torch.Tensor):
                text_out = getattr(text_out, "pooler_output", text_out[0])
            text_embeds = text_out / text_out.norm(p=2, dim=-1, keepdim=True).clamp(min=1e-6)
        self._text_cache[key] = text_embeds
        return text_embeds

    def _classify_direct(
        self, pil_img, candidate_labels: Sequence[str]
    ) -> List[Dict[str, object]]:
        """Run direct GPU vision-only inference against cached normalized text embeddings."""
        text_embeds = self._get_text_features(candidate_labels)
        img_inputs = self._processor(images=pil_img, return_tensors="pt")
        model_dtype = next(self._model.parameters()).dtype
        pixel_values = img_inputs["pixel_values"].to(device=self._torch_device, dtype=model_dtype)

        with torch.inference_mode():
            img_out = self._model.get_image_features(pixel_values=pixel_values)
            if not isinstance(img_out, torch.Tensor):
                img_out = getattr(img_out, "pooler_output", img_out[0])
            image_embeds = img_out / img_out.norm(p=2, dim=-1, keepdim=True).clamp(min=1e-6)

            logit_scale = self._model.logit_scale.exp().to(image_embeds.dtype)
            raw_logits = torch.matmul(image_embeds, text_embeds.t()) * logit_scale
            logit_bias = getattr(self._model, "logit_bias", None)
            biased_logits = (
                raw_logits + logit_bias.to(raw_logits.dtype)
                if logit_bias is not None
                else raw_logits
            )

            # Guard against completely blank/black frames while using contrastive
            # softmax across the mutually-exclusive prompt bank (so SigLIP's ~-12.9
            # scalar logit_bias never crushes indoor CCTV weapon/fight scores to ~0.004).
            if self.is_siglip and float(torch.sigmoid(biased_logits).max().item()) < 1e-5:
                probs = [0.0 for _ in candidate_labels]
            else:
                probs = torch.softmax(raw_logits, dim=-1)[0].float().cpu().tolist()

        ranked = [
            {"label": label, "score": float(score)}
            for label, score in zip(candidate_labels, probs)
        ]
        ranked.sort(key=lambda item: item["score"], reverse=True)
        return ranked

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

    def _encode_crops_batch(self, crops_bgr: Sequence[np.ndarray]) -> Optional[np.ndarray]:
        """Batch-encode BGR crops into L2-normalized SigLIP embeddings (T, 768)."""
        if self._model is None or self._processor is None or torch is None or not crops_bgr:
            return None
        pil_imgs = [self._to_pil(c) for c in crops_bgr if c is not None and c.size > 0]
        if not pil_imgs:
            return None
        img_inputs = self._processor(images=pil_imgs, return_tensors="pt")
        model_dtype = next(self._model.parameters()).dtype
        pixel_values = img_inputs["pixel_values"].to(device=self._torch_device, dtype=model_dtype)
        with torch.inference_mode():
            img_out = self._model.get_image_features(pixel_values=pixel_values)
            if not isinstance(img_out, torch.Tensor):
                img_out = getattr(img_out, "pooler_output", img_out[0])
            embeds = img_out / img_out.norm(p=2, dim=-1, keepdim=True).clamp(min=1e-6)
        return embeds.float().cpu().numpy()

    def encode_crop(self, crop_bgr: np.ndarray) -> Optional[np.ndarray]:
        """Encode 1 BGR crop into a single L2-normalized (768,) float32 SigLIP vector."""
        if crop_bgr is None or crop_bgr.size == 0:
            return None
        batch = self._encode_crops_batch([crop_bgr])
        if batch is None or len(batch) == 0:
            return None
        return batch[0]

    def verify_violence_step(
        self,
        new_crop_bgr: np.ndarray,
        prev_embeds: Sequence[np.ndarray],
        max_len: int = 4,
    ) -> Tuple[bool, Optional[np.ndarray]]:
        """Encode ONLY 1 new frame and score it with cached prior embeddings (~72ms GPU).

        Returns ``(passed, new_embed)``; falls back cleanly to zero-shot/prompt path
        when running without the full GPU backbone (e.g. unit test pipe overrides).
        """
        if self.pipe is None or new_crop_bgr is None or new_crop_bgr.size == 0:
            return (True, None)
        head = getattr(self, "_violence_head", None)
        if head is not None and head.available and self._model is not None:
            try:
                new_emb = self.encode_crop(new_crop_bgr)
                if new_emb is not None:
                    hist = list(prev_embeds)[-(max_len - 1):] if max_len > 1 else []
                    seq = np.stack([*hist, new_emb], axis=0)
                    passed, prob = head.predict_sequence(seq)
                    thr = head.threshold if len(seq) >= 2 else head.single_frame_threshold
                    log.debug(
                        "Bus-Violence Incremental Head (%s, T=%d): prob=%.3f thr=%.2f -> %s",
                        head.arch,
                        len(seq),
                        prob,
                        thr,
                        "VIOLENCE" if passed else "CALM",
                    )
                    return (bool(passed), new_emb)
            except Exception as exc:
                log.warning("Incremental violence head failed; falling back to zero-shot VLM: %s", exc)
        return (bool(self.verify_violence(new_crop_bgr)), None)

    def submit_violence_step(
        self,
        new_crop_bgr: np.ndarray,
        prev_embeds: Sequence[np.ndarray],
        max_len: int = 4,
    ) -> Optional[Future]:
        """Submit non-blocking 1-frame incremental violence check on the GPU worker."""
        executor = getattr(self, "_executor", None)
        if executor is None or self.pipe is None or new_crop_bgr is None or new_crop_bgr.size == 0:
            return None
        hist_copy = [np.asarray(e, dtype=np.float32).copy() for e in prev_embeds]
        return executor.submit(self.verify_violence_step, new_crop_bgr.copy(), hist_copy, max_len)

    def verify_violence(self, crop_bgr: np.ndarray) -> bool:
        """Synchronously verify a 2-person interaction crop for real physical violence."""
        if self.pipe is None or crop_bgr is None or crop_bgr.size == 0:
            return True
        head = getattr(self, "_violence_head", None)
        if head is not None and head.available and self._model is not None:
            return self.verify_violence_sequence([crop_bgr])
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

    def verify_violence_sequence(self, crops_bgr: Sequence[np.ndarray]) -> bool:
        """Verify a temporal sequence (1-8 frames) of a fighting pair using the
        fine-tuned Bus-Violence Temporal SigLIP head (falls back to zero-shot prompts)."""
        valid = [c for c in crops_bgr if c is not None and c.size > 0]
        if not valid:
            return True
        head = getattr(self, "_violence_head", None)
        if head is not None and head.available and self._model is not None:
            try:
                embeds = self._encode_crops_batch(valid)
                if embeds is not None and len(embeds) > 0:
                    passed, prob = head.predict_sequence(embeds)
                    log.debug(
                        "Bus-Violence Temporal Head (%s, T=%d): prob=%.3f thr=%.2f -> %s",
                        head.arch,
                        len(embeds),
                        prob,
                        head.threshold if len(embeds) >= 2 else head.single_frame_threshold,
                        "VIOLENCE" if passed else "CALM",
                    )
                    return passed
            except Exception as exc:
                log.warning("Trained violence head failed; falling back to zero-shot VLM: %s", exc)
        return self.verify_violence(valid[-1])

    def submit_violence_sequence(self, crops_bgr: Sequence[np.ndarray]) -> Optional[Future]:
        """Submit non-blocking async temporal violence verification job."""
        executor = getattr(self, "_executor", None)
        if executor is None or self.pipe is None:
            return None
        copied = [c.copy() for c in crops_bgr if c is not None and c.size > 0]
        if not copied:
            return None
        return executor.submit(self.verify_violence_sequence, copied)

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

    def scan_hand_weapon(self, crop_bgr: np.ndarray) -> Optional[Tuple[str, float]]:
        """Open-vocabulary VLM check on a pose-guided wrist/hand crop.

        Returns ``(weapon_class, confidence)`` (e.g. ``('knife', 0.92)``) when
        a knife or gun clearly dominates all negative transit/empty-hand prompts,
        otherwise ``None``.
        """
        if self.pipe is None or crop_bgr is None or crop_bgr.size == 0:
            return None
        try:
            pil_img = self._to_pil(crop_bgr)
            candidate_labels = [
                *(prompt for _, prompt in HAND_WEAPON_POSITIVE_PROMPTS),
                *HAND_WEAPON_NEGATIVE_PROMPTS,
            ]
            result = self.pipe(pil_img, candidate_labels=candidate_labels)
            verdict = evaluate_hand_weapon_scores(result, HAND_WEAPON_POSITIVE_PROMPTS)
            if verdict is None:
                return None
            w_cls, pos_score, neg_score, margin = verdict
            log.debug(
                "VLM hand-patrol hit '%s': pos=%.3f neg=%.3f margin=%.3f",
                w_cls,
                pos_score,
                neg_score,
                margin,
            )
            return (w_cls, pos_score)
        except Exception as exc:
            log.debug("VLM hand-weapon patrol error: %s", exc)
            return None

    def submit_hand_weapon(self, crop_bgr: np.ndarray) -> Optional[Future]:
        """Submit non-blocking async pose-guided hand-weapon scan."""
        executor = getattr(self, "_executor", None)
        if executor is None or self.pipe is None:
            return None
        return executor.submit(self.scan_hand_weapon, crop_bgr.copy())
