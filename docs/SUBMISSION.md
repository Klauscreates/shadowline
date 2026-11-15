# Space Apps project page — text to paste

Deadline: Sunday, November 15, 2026, 11:59 PM Arizona time (10:59 PM in Los Angeles).

## Project name
Shadowline

## Challenge
Lunar Landing Site Navigator

## Links
- **Demo (7 slides):** https://klauscreates.github.io/shadowline/demo/
- **Final project (live app):** https://klauscreates.github.io/shadowline/
- **Code:** https://github.com/Klauscreates/shadowline

## High-level summary
Shadowline is an interactive 3D map of the Moon's south pole that shows where a lander can stay powered and stay in contact with Earth. It draws real sunlight and shadows on NASA laser-altimeter terrain for any date, adds them up into heat maps of sunlight and Earth visibility, and scores any spot you click. One button scans the whole region and pins the three best sites. At the pole the Sun stays within about 1.5° of the horizon, so a few hundred metres can separate months of light from permanent dark. Shadowline makes that visible to anyone with a browser, with nothing to install.

## Project details

**What it does**
- **Live light:** for any date and time, shows which ground is sunlit and which is in shadow, on real terrain, in real time.
- **Heat maps:** share of a chosen window (one lunar day, three months or a year) that each spot is sunlit, has Earth above the horizon, or both together. A fourth layer shows slope.
- **Site test:** click any point to get a 0–100 score, sunlight %, the longest dark stretch, Earth-in-view %, the longest loss of contact, slope, a 360° horizon view with the Sun and Earth paths, and a timeline you can click to jump in time.
- **Find best sites:** scans the whole map and pins the three best-scoring, well-separated spots.
- **Compare:** up to four sites side by side.

**How it works**
- Terrain is NASA's LOLA south-pole elevation model, 512 km across, resampled to 250 m per pixel.
- The positions of the Sun and Earth in the Moon's sky are computed in the browser from an orbit model and the IAU lunar rotation model.
- For every map point, a ray is marched towards the Sun and towards Earth over the curved lunar surface. If terrain rises above the ray, that point is blocked. The Sun is treated as a disk, so partial sunlight is counted.
- Heat maps repeat that test across the window on the graphics card. The site test measures the horizon in 720 directions around the clicked point and steps through the window hour by hour.
- Score: 45% sunlight share, 35% Earth-in-view share, 20% gentle slope (full marks under 5°, none over 15°; halved above 15°). The formula is shown in the app.

**How I checked it**
- Sun and Earth positions agree with NASA's SPICE toolkit (DE440 ephemeris, Moon mean-Earth frame) to 0.004° across 134 dates over 13 months.
- The GPU heat maps agree with the separate site-by-site calculation to 0.1% on average (1% worst case) over 60 random points.
- The best-site search lands on places known for long sunlight, such as the de Gerlache rim and Malapert Massif.

**Limits (also stated in the app)**
- 250 m terrain grid: boulders, small craters and local ridges are not seen.
- "Earth in view" means the centre of Earth is above the terrain horizon for an antenna 2 m above ground. It is not a radio link budget.
- The score is a comparison aid, not a mission rule. Research and education only.

**Tools:** JavaScript, WebGL2 (three.js), astronomy-engine, Python (NumPy, SciPy, rasterio) for the one-time terrain conversion.

## Use of artificial intelligence
The code was written with Claude (Anthropic) as an AI coding assistant, directed and reviewed by me. AI was not used to generate any data: terrain comes from NASA LOLA, and Sun and Earth positions come from a published orbit model checked against NASA SPICE. Screenshots are real captures of the running app.

## Prior work
I explored this idea earlier in a separate personal project. No code from it is used. Everything in this repository, including the terrain file (regenerated from the NASA source), was made during the hackathon.

## NASA and space agency data
- LOLA south-pole digital elevation model `LDEM_60S_240MPP_ADJ`, NASA Goddard Planetary Geodesy Data Archive (Lunar Reconnaissance Orbiter, LOLA team): https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/
- NASA NAIF SPICE kernels (DE440 ephemeris and lunar orientation), used to check the Sun and Earth positions: https://naif.jpl.nasa.gov/naif/data.html

## References
- three.js (MIT): https://threejs.org
- astronomy-engine (MIT): https://github.com/cosinekitty/astronomy
