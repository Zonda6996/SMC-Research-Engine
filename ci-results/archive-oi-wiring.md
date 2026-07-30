# Archive OI visualizer wiring

- Archive metrics enrich `/api/analyze` before heatmap detection.
- Live API values win on overlap; archive fills older bars.
- Archive failures preserve API/volume fallback.
- Production heatmap formula/defaults/version unchanged pending magnet validation.
- Full test, TypeScript and frontend syntax gates passed.
