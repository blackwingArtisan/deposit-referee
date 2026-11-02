# Demo photo credits

The demo pair is in `public/demo-photos/`. The app shows this source under each photo.

| File | Base image | Author | Licence |
|---|---|---|---|
| `cabin-check-in.jpg` | [Wooden Lounge](https://polyhaven.com/a/wooden_lounge) (Poly Haven) | Greg Zaal | CC0 1.0 |
| `cabin-check-out.jpg` | [Wooden Lounge](https://polyhaven.com/a/wooden_lounge) (Poly Haven) | Greg Zaal | CC0 1.0 |
| `cabin-check-out-faint.jpg` | [Wooden Lounge](https://polyhaven.com/a/wooden_lounge) (Poly Haven) | Greg Zaal | CC0 1.0 |

Poly Haven's licence statement: https://polyhaven.com/license ("Our assets are all licensed as CC0."). CC0 needs no attribution and allows commercial use; it is credited anyway. Neither Poly Haven nor the author endorses this project.

## How the files were made

Both files are modified. They come from one real indoor panorama (2016 capture).

- Each is an independent rectilinear view of the panorama (its own yaw, pitch, roll, focal length and lens distortion), with a small non-rigid warp standing in for parallax, then its own camera simulation (exposure, white balance, contrast, vignette, blur, sensor noise, JPEG quality).
- **The floor gouge in `cabin-check-out.jpg` is not real.** It was synthesized from a height map and composited into the panorama for that frame only.
- **The faint scratch marks in `cabin-check-out-faint.jpg` are not real.** They were painted onto `cabin-check-in.jpg`, which was then slightly rotated, scaled and re-exposed to stand in for a retaken photo. They're there to show a mark the AI flags but doesn't charge.

These are the same files as pair 1 in the TK-39 vision spike. That spike scored Claude Sonnet 5.5 on them three times: it found the gouge every time, with box IoU of 0.89 to 0.96 against the true region, and proposed $150 each time. The spike covered obvious damage only, which is why this pair is the demo pair.
