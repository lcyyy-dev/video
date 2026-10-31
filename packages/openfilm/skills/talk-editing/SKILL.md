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
role or credentials. Local simulated narration is allowed only when explicitly requested and must be labeled.

## Check and deliver

Report the result immediately after changes. The following checks are performed only on explicit request: Check the beginning, every cut, caption timing, the last spoken word and the
audio mix. Confirm all source ranges are in bounds and that no caption covers the speaker's face. Keep manual edits
and locked selections during revisions. Render MP4 only when requested; otherwise leave the editable OpenFilm film
and use the existing Jianying/CapCut exporter for an editable draft. Report removed sections, unresolved words,
audio limitations and output paths instead of claiming a finished video when any remain.

Default workflow: receive the command, execute the command, and report the result immediately. Do not automatically run quick previews, full checks, repeated-frame rendering or audio-mix verification after execution. Run preview or verification commands only on explicit user request, and never claim skipped checks passed.
