# Builder tools

Every part type can be added from the website's admin page (Add a Part tab): dials, chronograph dials, bezel inserts,
cases, bracelets, straps, hands and GMT hands. The photo is fitted in the browser (sized and placed on the shared
1500 px canvas to match the existing parts of that type), can be fine-tuned with sliders, is previewed on whole watches,
and is published through the API (`/builder/add-part`), which commits the image(s) plus registry/families changes in
one commit. Bracelets and straps get one picture per case shape (`@c` Chronograph, `@d` Dress, `@w` Women's).
The Remove a Part tab takes a part off the builder (`/builder/remove-part`); it moves to `removed` in registry.json,
keeps its picture, and can be put back (`/builder/restore-part`). The last part of a kind on a live watch cannot be removed.
`tools/tests/admin_part_fit_test.py` checks the fitting code against fake photos made from the existing parts.

## Adding a part

```
python3 tools/add_part.py bezel photo.png --family diver    --scale diver --label "Red & White"
python3 tools/add_part.py bezel photo.png --family gmt      --scale gmt --label "Pepsi"
python3 tools/add_part.py bezel photo.png --family diver --family satdiver --scale diver --label "Blue"
python3 tools/add_part.py dial  photo.png --label "Salmon"
```

One command finds the part in the photo, fits it to the shared canvas, saves it, registers it,
writes a preview (steel and gold case) to `tools/previews/`, and regenerates `builds.json`.
It never commits or pushes. Use `--replace` to redo a part, `--id` to choose the file name.

Dials go to every 28.5 mm family (Diver, GMT, Saturation, Dress, Women's).
(This command-line tool still covers bezel inserts and dials only; use the admin page for the other part types.)

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
The Saturation Diver is the Diver case plus an engraved helium-valve ring (`parts/rings/ring-hev`, gold `@g`, black `@b`, picked by case). Its inserts are hand-picked in `families.json` under `pick`; adding `--family satdiver` puts a new insert on that list.

Every bezel insert is marked `diver` (60-minute) or `gmt` (24-hour). The Diver only takes dive inserts and the GMT only 24-hour
ones. The Saturation Diver / GMT takes both: with a 24-hour insert it shows the GMT hand option, with a dive insert it hides it.
