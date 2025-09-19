Great, this works. First I need you to remove the autoloading of json browser storage setting in the ui.
These are the default parameters I want you to init with:
Move Speed Min (frames)
60

Move Speed Max (frames)
180

Drag Amount
0.05

Drag Speed Min (frames)
30

Drag Speed Max (frames)
120

Particles
Random Size Min 0.01
Random Size Max 0.03
Target Size 0.03
Softness (0=soft, 1=hard) 1
Fade Range 0.3

Visibility
Visible % 1.00
Fade Speed Min (frames) 30
Fade Speed Max (frames) 90

Turbulence 1
Amount 3.23
Speed 0.6
Scale 0.9
Evolution 0.3

Turbulence 2
Amount 0.5
Speed 0.3
Scale 2
Evolution 0.2

Rendering
backgroundColor #0a0a0a
blendMode additive
showFrame [ ]

Camera & Scroll
Camera X Offset 0
Camera Y Offset 0
Camera Z Offset 6
Camera FOV 70
Scroll Multiplier 0.01
Scroll Damping 0.05

Now I want you to create automatic scroll transitions like this:
Skip the section1 texture and particles for now.

Start with the section2 particels with move to target 1.0 (param target image: step2).
As the user scrolls past 65% of the html hero section height put move to target to 0.0 and visibility to 0.22
When the user has scrolled down to 35% of the section-2 html, switch the target to step3 and set move to target to 1.0 and visibility to 1.0
When the user scrolls past 65% of the section-2 html, set move to target to 0.0 and visibility to 0.22
When the user has scrolled down to 35% of the section-3 html, switch the target to step4 and set move to target to 1.0 and visibility to 1.0
When the user scrolls past 65% of the section-3 html, set move to target to 0.0 and visibility to 0.22
When the user has scrolled down to 35% of the section-4 html, switch the target to step5 and set move to target to 1.0 and visibility to 1.0
