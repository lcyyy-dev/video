---
name: live-clips
description: Cut a supplied livestream or long recording into a focused OpenFilm highlight clip. Find a complete moment, preserve the speaker's meaning and context, remove waiting and unrelated material, add captions and a clear opening, and deliver an editable film or requested export.
---

# Livestream clips

Make a publishable clip from a long livestream, webinar, class or recording without taking words out of context.

For a direct template request, keep the path short: inspect the supplied recording, read this skill, select the requested
complete moment, assemble the timeline, report the result immediately. Do not create alternate cuts or export
unless requested.

## Find a complete moment

Read the OpenFilm manual and inspect the entire recording with `openfilm look`; never choose a highlight from a
filename, thumbnail or the first minute alone. Read the source-analysis index when present. Search for a complete
idea with a clear setup, useful explanation and satisfying ending. Record the source range, transcript, reason for
selection and any context that must remain in `live-plan.json`.

Do not splice together sentences from unrelated moments, remove a qualification that changes the meaning, or invent
a hook that the speaker did not support. Remove greetings, waiting, repeated answers and technical dead time only
when the resulting clip remains understandable. If a short opening needs context, use a concise title that states
what the clip is about rather than a misleading claim.

## Shape the clip

Prefer a complete highlight around the requested length; if no natural boundary meets it, report the actual duration.
Use hard cuts and natural speed by default. Keep the main recording's voice and relevant screen or camera image;
crop or reframe only when the speaker and important content remain visible. Add captions from the actual speech,
split at natural phrases, and keep them inside safe margins. Text generation follows the template's `textStyleIds`:
when it has selections, use only those style IDs; when it is empty, use automatic combinations from the element library.
Use supplied B-roll or screenshots only when they clarify
the spoken point. Music must remain below speech and is optional.

## Check and deliver

Check the opening, every removed range, every caption boundary, the final sentence and the audio mix. Confirm the
clip does not imply a claim that the longer recording qualifies or contradicts. Preserve manual edits and locked
selections on revisions. Report the result immediately after changes. The following checks are performed only on explicit request: Render MP4 only when requested; otherwise leave the
editable film or use the existing Jianying/CapCut exporter. Report source range, duration, captions, audio limits and
any context that could not fit.

Default workflow: receive the command, execute the command, and report the result immediately. Do not automatically run quick previews, full checks, repeated-frame rendering or audio-mix verification after execution. Run preview or verification commands only on explicit user request, and never claim skipped checks passed.
