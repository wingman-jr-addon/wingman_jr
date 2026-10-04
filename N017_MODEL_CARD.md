# N017 — MobileNetV4 Hybrid-M image-safety model

N017 is the selected **plain supervised MobileNetV4 Hybrid-M** candidate from
the Experiment 017 endpoint comparison. The name starts a new model series so
that it is not confused with the earlier EfficientNet-Lite0-based SQRXR line.

![N017 comparison with SQRXR 112 and 153/154](n017_docs/n017_three_way_comparison.png)

## Historical endpoint

The directly comparable 84,744-example historical endpoint uses Q, R, or X as
the positive “unsafe” class.

| Model | ROC AUC | standardized pAUC at FPR≤0.10 | accuracy | Brier | ECE20 | R→S | X→S |
|---|---:|---:|---:|---:|---:|---:|---:|
| SQRXR 153/154 | 0.977128 | 0.929327 | 0.834608 | 0.057350 | 0.008409 | 0.081634 | 0.024781 |
| **N017** | **0.982737** | **0.948576** | **0.865760** | **0.047835** | **0.008248** | 0.115902 | 0.027329 |

At fixed FPR ceilings, N017 reaches TPR 0.772090 at
0.4%, 0.853488 at 1.5%, and
0.953719 at 10%.

## Directional diagnostic

On the reused swimming directional slice, N017 reduced the perturbation-weighted
mode rate from 0.043388 to
0.016529, unsafe jitter from
0.031055 to
0.012813, and SQRX
L1 jitter from 0.101260 to
0.023705. This panel had
already been opened and is evidence about behavior, not a pristine selection set.

## Deployment contract

- Input: one `224×224` RGB image, padded to square with RGB `(128,128,128)`,
  scaled to `[0,1]`, then normalized by ImageNet mean `(0.485,0.456,0.406)`
  and standard deviation `(0.229,0.224,0.225)`.
- Tensor layout at the TensorFlow.js boundary: NHWC `[1,224,224,3]`.
- Outputs, in add-on order: unsafe probability `[1,1]`, followed by S/Q/R/X
  probabilities `[1,4]`.
- `roc.js` contains the thinned ROC lookup and trusted, neutral, and untrusted
  policy points. The full archival curve remains in the standalone N017
  artifact package.
- The standalone artifact package's `tfjs311_parity.json` records numerical
  parity against the exact TensorFlow.js 3.11 runtime used by this add-on.

## Provenance and limitations

The backbone is `timm/mobilenetv4_hybrid_medium.e500_r224_in1k`, whose model
card and timm implementation identify Apache-2.0 licensing. N017 is a
fine-tuned checkpoint, not an official Google TensorFlow release. Underlying
training-image rights remain separate from the code/checkpoint license.

The historical endpoint is in-domain and oversampled to the established
6:1:2:3 S/Q/R/X evaluation mixture. The directional panel is intentionally
small and diagnostic. Neither result establishes performance on every image
distribution found on the public internet.
