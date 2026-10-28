---
name: copy-rewrite
description: Turn supplied source copy into a short OpenFilm video while preserving its facts and requested meaning. Rewrite only within the selected direction, structure the message for spoken delivery and on-screen text, match supplied footage and audio, and deliver an editable film or requested export.
---

# Copy rewrite edit

Use this workflow when the person has source copy and wants a stronger, shorter or more conversational video script.

For a template generation request, inspect the supplied footage, read this skill and the exact template copy, produce
only the requested spoken audio and timeline, run one final check, and report. Do not research, add claims or create
alternate versions.

## Lock the source

Read the OpenFilm manual and inspect the project. Save `copy-plan.json` with the original copy, the selected rewrite
direction, a sentence-by-sentence mapping, source facts that must remain unchanged, footage ranges, audio status and
the final checks. The original copy is evidence: do not add prices, guarantees, locations, dates, testimonials or
product claims that were not supplied. If a statement is ambiguous, keep it cautious and report the question.

If the template contains the final wording, treat it as locked source copy: preserve every character and do not
compress, summarize, rewrite, add or remove words. Split that exact wording into complete sentences and make one TTS
file per sentence. Apply a rewrite direction only when the user explicitly asks for a rewrite in the current request;
even then, keep the original and the final script as separate records and never merge or truncate sentences.

## Time the video

Inspect all supplied footage with `openfilm look` and match each script unit to a meaningful shot. Use supplied voice
recordings when available; otherwise use local simulated narration only when explicitly requested, or leave narration
pending and make a usable silent/text edit. Measure every audio file before setting shot and caption boundaries.
Keep speech intact, make cuts at natural pauses, and keep captions derived from the final spoken script. Use the local
text-style library and structured text pages so titles and captions remain editable.

## Check and deliver

Check facts against the source copy, pronunciation and timing against the actual audio, every shot against the sentence
it illustrates, and captions against safe margins. Preserve manual edits and locked selections during revisions. Run
`openfilm look` after changes. Render MP4 only when requested; otherwise leave the editable film or use the existing
Jianying/CapCut exporter. Report any missing audio, unsupported style, unresolved fact or requested output that remains.
