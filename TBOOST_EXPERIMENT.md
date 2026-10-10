# TBOOST sustained-backlog experiment

## Question

Does a four-image tiled pre-scan make Wingman Jr. feel materially faster during sustained image backlogs, despite the known recall loss from shrinking each image into one quadrant?

This branch is intended as a short, experiential performance test rather than a production accuracy validation. TBOOST is implemented as a normal, default-on option so the same workload can be compared with it enabled and disabled.

## Treatment

- Continue normal individual scanning unless at least four completed image requests remain queued continuously for five seconds.
- Once eligible, take the oldest four queued images and compose them into a 2x2, 224x224 image.
- Run one pre-scan at the active model's **untrusted-zone threshold**.
- If the pre-scan passes, pass all four original image responses through without individual predictions.
- If the pre-scan triggers, rescan all four images individually using each request's original zone threshold.
- Tiny or unreadable images make that group fall back to four ordinary scans.
- Dropping below four queued images resets the five-second clock.

The pre-scan is deliberately not recorded as an individual adaptive or audit score. A composite score does not describe any one image, and treating it as one would contaminate those systems.

## Quick comparison

Use the same image-heavy pages and browser state for both runs:

1. Enable **Sustained backlog acceleration** (the default), reload the extension if needed, and exercise an image-heavy workload until `TBOOST: ACTIVE` appears.
2. Note whether the page becomes usable sooner, how long the backlog persists, and the cumulative `netModelCallsSaved` in the `TBOOST` logs.
3. Disable the option and repeat the workload.
4. Prefer browser task-manager/GPU timing and end-to-end page feel over isolated inference timing; WebGL setup, readback, image decode, and response-filter latency are all part of the result.

`TBOOST: PASS` means one model call replaced four. `TBOOST: RESCAN` means the pre-scan triggered and the group used five model calls instead of four. The cumulative `netModelCallsSaved` therefore captures the actual inference-call tradeoff for eligible groups.

## Decision rule

Keep pursuing the design only if the enabled run produces an obvious improvement under a real sustained backlog and `netModelCallsSaved` is consistently positive. If the improvement is not perceptible, the known accuracy loss and added cascade complexity are not justified. A promising performance result should lead to a larger paired accuracy evaluation before release; this branch does not attempt to re-establish the recall already characterized in the earlier four-up study.
