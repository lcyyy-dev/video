# Production record

Keep a project-relative `ad-plan.json` as an agent execution record, not a new engine or alternative film format.
Update it after meaningful stages. On a rerun, inspect `film.html` and preserve manual changes before rebuilding.
Keep paths project-relative; never store credentials or machine cache paths.

Use this minimal shape; add fields only as needed. Null means not yet measured or selected, not an estimate.
The example contains no completed production data.

```json
{
  "version": 1,
  "workflow": { "id": "ad-editing", "version": "0.1.0" },
  "brief": {
    "copy": "The user's original copy",
    "width": null, "height": null, "fps": null,
    "formatReason": null,
    "targetSeconds": 15, "exactDuration": false,
    "deliverables": ["project"]
  },
  "media": [
    { "id": "v01", "src": "assets/video/clip.mov", "duration": null, "candidates": [] }
  ],
  "sentences": [
    {
      "id": "s01",
      "narrationText": "The original sentence",
      "displayText": "The original sentence",
      "intent": "Action or scene the line needs",
      "voice": null, "selection": null, "timeline": null, "textPage": null,
      "locked": false, "status": "pending", "issues": []
    }
  ],
  "outputs": []
}
```

Populate values as work proceeds:

- `brief.width`, `height`, `fps`: resolve from the user's output instructions, else an existing project, else the
  main footage's displayed dimensions and frame rate. Record the source or mixed-footage decision in `formatReason`;
  null is an unresolved format, never a fixed portrait/30 FPS default. Include rotation in the displayed dimensions.
- `media[].candidates`: source `from`/`to`, observed action and framing. Reuse analysis for unchanged media; invalidate
  it when the source changes. Keep confirmed file facts alongside the analysis.
- `voice`: `src`, measured `duration`, source (`recording` or `tts`), text used and effective provider/voice/settings.
  Continuous recordings also need measured sentence boundaries. No secrets.
- `selection`: media ID, source `from`/`to` and reason. Record speed or multiple shots when used.
- `timeline`: `start`/`end` in seconds, from real voice durations and explicit pauses. Round boundaries consistently
  to project FPS when writing the film; do not accumulate rounding per duration.
- `textPage`: relative file, preset ID/version, resolved appearance and placement rationale, including inspected times
  and how copy avoids the subject/action. Re-read page data instead of maintaining a conflicting text representation.
- `status`: `pending`, `ready` or `blocked`; `issues` explains missing audio, insufficient footage or unsupported
  effects. A blocked sentence stays in the final report. Preserve confirmed `locked` selections.
- `outputs`: actual paths, kind, completed/failed state and checks performed. Distinguish native-text file checks,
  visual preview and actual Jianying opening. Record fallback reasons with the output.

Display-copy or style changes do not invalidate voice. Narration changes invalidate that sentence's audio and
dependent timing. Recheck later cuts and source bounds after timing changes; do not simply shift a stale plan.
