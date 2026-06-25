# HTTP Benchmark Summary

Authenticated requests using session cookies from `auth-state.json`.

## Post-cold-visit oak-spike (not pre-navigation baseline)

**URL:** `http://127.0.0.1:3000/shuv1337/oak-spike`

| Metric | Value |
|--------|-------|
| HTTP status | 200 |
| Redirect | none |
| Time total | 0.685s |
| TTFB (starttransfer) | 0.634s |
| Body size | 780,774 bytes |
| Body type | Rendered HTML (`<!DOCTYPE html>`) |

Raw: `benchmarks/http-post-cold-visit-oak-spike.txt`

Legacy `benchmarks/http-cold.txt` is deprecated (misleading header); retained with deprecation comment only.

**Labeling note:** This sample was captured **after** browser Step 2 cold run 1 had already populated partial server cache. It is **not** a pre-navigation cold HTTP baseline. No pre-visit HTTP sample was captured before Step 2 run 1.

## Steady-state better-hub

**URL:** `http://127.0.0.1:3000/shuv1337/better-hub`

| Metric | Value |
|--------|-------|
| HTTP status | 200 |
| Redirect | none |
| Time total | 1.218s |
| TTFB (starttransfer) | 0.528s |
| Body size | 1,002,317 bytes |
| Body type | Rendered HTML (`<!DOCTYPE html>`) |

Raw: `benchmarks/http-warm.txt`

**Labeling note:** better-hub was partially warm (`stale`/`fresh` mix) at Step 1. HTTP sample reflects steady-state navigation, not a debug-warmed baseline.

## Notes

- Both endpoints returned **200** with rendered pages (no auth redirect).
- HTTP timings are supporting evidence only; browser benchmarks capture streaming/RSC behavior more accurately.
- Plan called for before-and-after HTTP samples; only post-visit / steady-state samples exist in this pass.