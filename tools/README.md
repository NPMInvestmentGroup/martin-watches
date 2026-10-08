# Builder tools

## Adding a part

```
python3 tools/add_part.py bezel photo.png --family diver    --label "Red & White"
python3 tools/add_part.py bezel photo.png --family gmt      --label "Blue & Red"
python3 tools/add_part.py bezel photo.png --family satdiver --label "Blue"
python3 tools/add_part.py dial  photo.png --label "Salmon"
```

One command finds the part in the photo, fits it to the shared canvas, saves it, registers it,
writes a preview (steel and gold case) to `tools/previews/`, and regenerates `builds.json`.
It never commits or pushes. Use `--replace` to redo a part, `--id` to choose the file name.

Dials go to every 28.5 mm family (Diver, GMT, Saturation, Dress, Women's).
Not covered yet: cases, straps and bracelets, hands, chronograph dials.

**Best photos:** one part per image, straight on, plain white background, as large as possible.

## Checking

```
sh tools/check_site.sh
```

Regenerates `builds.json`, serves the site locally and runs every test in `tools/tests/`.

## Setup in a fresh environment

```
pip install numpy pillow opencv-python-headless scipy playwright --break-system-packages
python3 -m playwright install chromium
npm i --prefix /tmp/tools sharp
```

## How the layers fit together

Every part is a transparent 1500 x 1500 px image on one shared centre, stacked:
dial, bracelet, case, bezel frame, bezel insert, GMT hand, hands.

Diver and GMT share one toothed bezel frame (`parts/frames/frame-diver.webp`, gold version `@g`).
The page picks steel or gold from the case, so a bezel file is just the coloured insert ring.
The Saturation Diver's teeth are part of its case.
