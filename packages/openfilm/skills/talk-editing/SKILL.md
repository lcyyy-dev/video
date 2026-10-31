---
name: talk-editing
description: Edit a presenter or talking-head recording into a clear OpenFilm video. Remove dead air and mistakes, preserve the speaker's meaning, add readable captions and optional cover or supporting footage, and deliver the requested film or editable Jianying/CapCut draft.
---

# Talking-head edit

Turn supplied presenter footage into a clean, understandable video without changing what the speaker said.

For a direct template request, use the shortest path: inspect the recording, read this skill and the supplied transcript,
make the requested cuts and captions, report the result immediately. Do not create alternate edits or export
unless requested.

## Understand the recording

Read the OpenFilm manual and inspect the existing project before editing. Use `openfilm look` on the complete
recording and on candidate ranges; filenames and the first frame are not evidence of what a clip contains. Read
`.film/source-analysis/index.json` when it is available. Keep `talk-plan.json` in the project with the source files,
selected ranges, transcript or supplied copy, removed ranges, caption settings and output checks.

Use the supplied recording and transcript as the source of truth. Mark natural sentence boundaries, long pauses,
repeated phrases and clear mistakes. Remove dead air and accidental starts only when the cut remains intelligible;
do not silently rewrite a claim, change a number or join words from unrelated takes. Preserve a speaker's intended
order unless the person asks for a restructure. If no transcript exists, listen to the recording or use the available
local transcription path and mark uncertain words for review.

## Build the edit

Keep the speaker's face and gestures visible. Use hard cuts by default, preserve natural speed, and avoid jump cuts
that hide a meaningful movement. Supporting photos, screen recordings or supplied B-roll may cover a cut only when
they match what is being said; never invent evidence or fetch replacement media. Keep the main talking track on one
video track and its original sound on one audio track. Mute camera noise only when it is unwanted and keep speech
intelligible over music.

Captions must come from the actual speech. Split them at natural phrases, keep lines short enough to read, and check
their position against faces, hands and platform-safe margins. Use `openfilm text-styles` and structured text pages
for editable captions. When the template's `textStyleIds` is non-empty, choose only those IDs; with an empty list,
use the element library's automatic combinations. A cover is optional and uses only supplied or project material; do not invent a person's name,
role or credentials. TTS is not connected. Do not synthesize narration; use original video audio only.

## Check and deliver

Report the result immediately after changes. The following checks are performed only on explicit request: Check the beginning, every cut, caption timing, the last spoken word and the
audio mix. Confirm all source ranges are in bounds and that no caption covers the speaker's face. Keep manual edits
and locked selections during revisions. Render MP4 only when requested; otherwise leave the editable OpenFilm film
and use the existing Jianying/CapCut exporter for an editable draft. Report removed sections, unresolved words,
audio limitations and output paths instead of claiming a finished video when any remain.

Default workflow: receive the command, execute the command, and report the result immediately. Do not automatically run quick previews, full checks, repeated-frame rendering or audio-mix verification after execution. Run preview or verification commands only on explicit user request, and never claim skipped checks passed.

## Copy and audio execution policy

When TTS is unavailable, skip audio generation immediately, retain original video audio, and create no empty narration track. Do not stop to ask about narration.
Preserve every character of supplied final titles and body copy. Never ask whether to shorten, use only the title, or retain the full copy. For an authorized source rewrite, use the complete resulting script. Keep the requested duration and arrange all copy across text clips by adapting layout and timing. Missing TTS imposes no spoken-duration constraint. Complete the edit without asking the person to choose between shortened copy, title-only and a longer duration; report any readability limitation afterward.

A frame may show two or more sentences simultaneously, grouped by meaning in multiple lines or text blocks. Do not enforce one sentence per screen or exclusive time intervals per sentence. For a short video with long copy, prefer related sentences together and allocate display time per group, preserving all copy and the requested duration while avoiding the subject. A single-line headline rule does not limit the number of body sentences on screen.

Use distinct text fill colors for the headline, multiple subheadings and body copy. Different text blocks on the same screen should not all have the same color; assign clearly distinguishable colors by role and meaning with sufficient contrast. Prefer differently colored selected presets; if all selected presets have the same color, preserve their font and outline but adjust fill colors to satisfy this requirement without asking. Prefer one horizontal line per text block. Fit all body blocks in the same group to one shared absolute pixel font size based on the longest line, capped by the title size. Keep safe side margins, never clip text or stretch glyphs to fill space. Multiple sentences may appear simultaneously on separate lines; do not force different sentences onto one line. Preserve all copy and readability.

Measure actual glyph width after the resolved font loads, including outline/shadow; JSON box width is not glyph width. Resize fontSize, not just the box. With clear space, target about 90% of canvas width with approximately 5% side margins; enlarge short headlines accordingly. Prefer separate sentence blocks, one sentence per line using a shared body font size, rather than a small paragraph occupying only part of the frame. All text, including titles, subtitles, body and location labels, plus outlines/shadows, must avoid the entire person: head, torso, limbs and action area. Choose positions using subject movement across the selected source interval, not only its first frame; neither top nor bottom is automatically safe. Reuse source analysis and cached frames first. Subject avoidance takes priority over line width: regroup copy, reposition or use another relevant shot when space is limited, rather than covering people or using unreadably small text. These are generation-time layout decisions, not an added final preview pass.

Independent clause layout: split supplied copy at natural clause boundaries such as commas, semicolons, periods, question marks and exclamation marks, preserving wording and original order while removing sentence punctuation from displayed text. Each clause must be an independent entry in structured JSON texts with its own text, x, y, width and fontSize. Never pack several clauses into one text string or stack them with newline characters inside one box. Fit each clause to a single line using one shared font size per body group, based on the longest line. Related clauses may appear simultaneously, vertically distributed in available space outside the people, with independently chosen positions and spacing, rather than one dense horizontal strip or fixed bottom paragraph. Keep glyphs and outlines separate and adjacent clauses distinguishable in color. Subject avoidance takes priority. If space is insufficient, distribute clauses into consecutive simultaneous groups while preserving all copy and the requested total duration without asking to shorten it.

Full-canvas footage rule: the main video must fill the canvas. Never shrink footage into a centered inset, add black borders, or reserve black header/footer areas to make room for titles, location or body text. Preserve aspect ratio with cover sizing; adjust crop position when necessary to protect people and complete actions, and never stretch disproportionately. Overlay text on the full-canvas footage, avoiding people by repositioning, independently fitting font sizes, splitting clauses into independent elements and scheduling successive groups. No text-layout rule authorizes shrinking the main video. If space is limited, show fewer clauses simultaneously while retaining all copy within the requested duration; do not switch to an inset-video poster layout.

Display punctuation policy: preserve raw input and template configuration unchanged. When generating JSON texts[].text for titles, subheadings and body copy, first split at original punctuation, then remove sentence punctuation including commas, periods, enumeration commas, semicolons, colons, question/exclamation marks, quotes, brackets, ellipses and dashes. Preserve all wording and order. Keep clauses as independent elements. Retain semantically necessary symbols in decimal numbers, percentages, signs, dates, URLs, model identifiers and proper names to avoid changing facts. Measure and export the punctuation-free display JSON, not merely a preview-only stripped string. This is the explicit display exception to verbatim-copy rules.

Body typography hierarchy: all clauses in the same body group must use the exact same fontSize, fitted against the longest line and available space; never enlarge a short clause independently. Subheading and body font sizes must not exceed the main title size. Arrange actual rendered glyph bounds including outline and shadow with compact clear gaps of about 8–12% of the shared body font size between adjacent body lines, measured outside outline/shadow bounds; avoid oversized paragraph gaps. Titles, subheadings and body must never overlap. If space is insufficient, schedule fewer clauses per simultaneous group without dropping copy or shrinking footage. Body fills must be clearly different from the title, avoiding the same or adjacent hues: a yellow title must not be paired with yellow, gold or similar orange body copy. Prefer clearly contrasting white, cyan or another distinct hue suited to the background. This takes priority over independently enlarging every line to fill width.
