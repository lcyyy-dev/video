---
name: ad-editing
description: Edit a short promotional video from supplied footage and advertising copy in OpenFilm. Match meaningful source intervals to sentences, time shots to narration, apply packaged text presets, and deliver the requested film or editable Jianying/CapCut draft. Use for footage-based ads, fitness coach promotions, service introductions and product promos.
---

# Advertising edit

Make the supplied footage tell the supplied message using relevant shots and editable on-screen copy. Choose shot,
text and narration boundaries independently to serve the message. Reuse OpenFilm's existing agent, media tools, film
format and exporter.

## Start from the brief

Read the OpenFilm manual (`openfilm`) and existing project before editing. Respect the person's footage, copy,
style, voice, timing and deliverables. Use explicitly requested output parameters first. Otherwise preserve an
existing project's format; for a new film, probe the main footage and choose its dominant displayed aspect ratio,
resolution and frame rate. Account for rotation metadata. For mixed sources, select one coherent output format
based on the main shots and record the reason; avoid unnecessary upscaling, forced portrait crops or an automatic
30 FPS conversion. Use a supported export frame rate close to the main footage if its rate cannot be preserved,
and disclose that conversion. Do not assume 1080×1920 or 30 FPS. Aim for roughly 15 seconds unless requested otherwise,
letting natural narration determine final length. An exact length is a constraint to check after narration,
not permission to cut speech. Normal speed and hard cuts are the default.

The desktop app already opened the project. Use `openfilm look` for progress and inspection. Read
[production-plan.md](references/production-plan.md) and keep `ad-plan.json` in the project: skill version, inputs,
sentences, measured narration, shot selections, resolved styles and actual output status. This is an execution
record; `film.html` remains the editable film. Reuse confirmed analysis and choices when continuing a project.

## Find the shots

Split the copy into semantic message units and natural speaking pauses; assign stable unit IDs. Punctuation is only a
hint: do not make one shot or one title for every comma or full stop. Keep closely related clauses together, and let a
short ad use roughly four to six meaningful visual units rather than many repetitive short clips. A unit may contain
two or three related sentences when they express one point. Keep the full narration wording unless rewriting was
requested, but save a concise display text separately when the screen copy would otherwise be too long.

Probe supplied media for duration, dimensions and sound. Use `openfilm look <media-file>` for a contact sheet,
then `look <media-file> <seconds>` or `look <media-file> <from>-<to>` to inspect candidate intervals. Look across each
recording; filenames or first frames do not establish its contents. Record useful ranges and observed actions.
Use supplied descriptions, but verify the selected range against actual footage.

Match actions and scene meaning to each message unit, considering framing, clarity and complete movements. A text
unit can span several consecutive video clips: change shots while the same text and narration continue when it improves
the story. Limit each video clip to at most 3 seconds on the timeline unless the user explicitly requests a longer
shot. Choose cuts independently of text boundaries rather than forcing a one-to-one correspondence. Preserve natural
playback speed; for longer narration or text, use multiple relevant shots instead of accelerating the footage. Save
each chosen source, range and a short reason. Do not use every file just to fill a quota, manufacture visual evidence,
or silently fill shortages with unrelated shots. If nothing fits, identify the sentence and continue usable work.

## Time narration before final cuts

Use supplied sentence recordings when available. Continuous recordings need real sentence boundaries from a
transcript or listening; do not divide evenly or estimate timing from character counts.

Reuse supplied recordings when available. When the host provides local TTS, synthesize one file per semantic message unit (a coherent sentence or a short group of closely related sentences) and
measure each real file's duration before choosing shot ranges. If local TTS is unavailable, continue the edit with
the supplied copy and available source audio or silent timing, and record narration as pending; missing narration
alone must not block a usable video edit. Cloud TTS is outside this client's current scope unless a provider is
explicitly configured. Keep simulated or fallback audio distinguishable in the project and delivery report.
A requested silent video may use explicitly recorded shot durations and must be labeled accordingly.

Place each line after the previous line's actual end plus any separately specified pause. Do not add pauses already
in the audio. Keep precision until converting boundaries to frames. Video and text cover the spoken line; narration
stays intact. One uninterrupted text clip may cover multiple shots, with video cuts placed at natural visual moments.
If footage is too short, prefer another relevant interval. Multiple shots, holds or speed changes
must fit the brief and be recorded. If an exact total length cannot be met naturally, report the mismatch and
obtain any needed copy or speech-rate change instead of truncating voice.

## Apply the local text library

Before creating text, read:

```sh
openfilm text-styles list
openfilm text-styles show default
openfilm text-styles generation-rules
openfilm text-styles rules
```

An explicit style wins. Otherwise start from the saved default, applying scene-informed choices from the suggested
ranges. Give the film a coherent visual direction without requiring identical styles for every text clip. Vary color,
size, weight, emphasis, placement or background where the message and footage call for it; preserve legibility and
respect explicit user choices. Inspect the footage behind the intended text area when choosing fill and outline
colors, including every shot beneath a text clip that spans cuts; check readability across the interval. Record concrete values and selection rationale.
Backgrounds and shadows are optional according to the scene.

Read SPEC.md's “Text style validation status” for unsupported or uncalibrated settings. Panel values are not preview
pixels: do not apply outline thickness 30–45 directly as pixels or invent draft mappings. Structured text pages
support backgroundColor, backgroundOpacity, borderRadius and outline fields; when the user asks to remove a text
background, set backgroundOpacity to 0 and preserve the text itself. Treat explicit user style requests as executable
text-track edits and return the updated film rather than refusing or switching to a chat-only response. Range rules
guide the agent; they are not an automatic vision engine.

Use structured text pages matching the film canvas for native editable export. For example:

```sh
openfilm text-styles page titles/s01.html --text 'Your line' --duration 3.2 --size 1080x1920 --preset xinqingnian-yellow
```

Use unique output names: this command refuses overwrites. Update pages with `openfilm/text-page` when changing
placement, wrapping or resolved appearance; preserve font embedding. For programmatic generation, pass
`textFontCss(families, true)` from `openfilm/text-fonts` as `textPageHtml(page, { fontCss })`. Keep packaged fonts as
`openfilm-font:<id>` references. Save full styles rather than live preset references. Do not replace structured copy with arbitrary HTML or a text MOV to
conceal an unsupported property.

### Composition and readability

- Protect faces, the main person/product and key actions, including working limbs and equipment in fitness shots.
  Reframing, text and overlays must not hide them; preserve proportions and avoid crops that lose the action.
- Put copy in stable empty space. Keep the whole wrapped text, outline and shadow inside frame margins and clear
  of other captions and known platform controls. Do not assume a fixed bottom position is safe for every shot.
- Check contrast at normal viewing size against the changing footage. Use readable type, intentional line breaks
  and enough display time; keep styles visually related while allowing purposeful variation between text clips.
  Avoid distracting position changes within a shot.
- For a 1080×1920 ad, prefer a prominent display size around 88–120px. Choose fill and outline/shadow colors from
  the actual frames: light copy over dark footage and dark copy over bright footage. Avoid pale colors over bright
  backgrounds even when they match the brand palette.
- Inspect the start, middle, end and major movements of each selected interval, including text animation bounds.
  If obstructed, reposition, reflow or choose another relevant interval; never solve it with unreadably small text.
- Record inspected times and a short placement reason. If no clear layout works, report the limitation. Frame
  sampling is a practical check, not continuous subject tracking or a guarantee for unknown platform overlays.

## Build and revise

Use source references and trim ranges in `film.html`, preserving originals. Keep sequential clips together: one main
video track, one text track, one narration track and optional music. Add tracks only for real overlap. Normally use
the line's display copy once, without duplicating it in both title and subtitle layers. If separate subtitles are
requested, use OpenFilm's transcript/caption path and check their independent timing.

Set narration and music levels independently; keep speech intelligible and unwanted source sound muted. Use existing
audio fades and mixing tools. Transitions, speed changes, picture-in-picture and animation are optional; consult
native-export rules and disclose rendered fallbacks.

For revisions, preserve manual edits and locked selections. Display-copy or style changes reuse audio; narration
changes regenerate that sentence's voice, then recalculate dependent timing and source lengths. Refresh the plan
from the actual film after checking for differences. If reconciliation is unclear, preserve a project copy before
rebuilding and state what will be recreated. The plan does not authorize overwriting an edited timeline.

When the person explicitly asks to regenerate the whole edit, replace the previous generated arrangement rather
than appending another set of tracks. Keep original uploads. After the replacement is validated, remove generated
title pages and narration files that are no longer referenced by the current film, including other page references;
never delete a file still in use. Remove empty tracks. A normal narrated ad has text, video and narration tracks,
with additional tracks only when their content is needed. Deleting narration means removing its clips or track,
not synthesizing a replacement. A style-only change edits the existing text pages and preserves video and audio.

User instructions override template defaults and style suggestions. Without an explicit style, choose suitable
values from the text library's suggested ranges after inspecting the footage; a regenerated version can use a
different coherent style. Explicit colors, font sizes and requests for no background must survive generation and
revision exactly. Check the actual saved text pages and representative rendered frames before reporting success.

## Check and deliver

Use `look` on representative frames and cut boundaries to check the rules above, sentence/shot relevance and
unintended blank frames. Listen to the mix for cut-off or overlapping words, clipping and music masking speech;
check source bounds, audio duration and missing files. Fix objective errors before exporting;
record limitations and unfinished sentences rather than reporting a finished ad.

Deliver what was requested. Keep the OpenFilm project. Use `openfilm render` for a requested MP4 and existing
Studio Jianying/CapCut export for a requested editable draft; do not hand-build a second exporter. Inspect actual
files before marking output complete: canvas, FPS, duration, media/font paths, independent video/text/audio segments
and `native-text-report.json` when present. A text MOV is a rendered fallback, not native editable text. Record file
checks and opening the draft in Jianying as distinct validation statuses.

Report output locations, runtime, major choices, blockers and editability limits concisely. This workflow does not
include uploading, publishing, installing external assets or modifying unrelated projects.
