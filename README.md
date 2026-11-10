# Media evaluation study

Participants watch three anonymous videos per scene, compare them against the requested sound timeline, and tap to rank them. The site is static (`docs/`, served by GitHub Pages) and responses go to Supabase.

## Add scenes

Create `.private/study_source.json` (git-ignored, because it names the methods):

```json
{
  "version": "v1",
  "question": "Rank the three videos from best (1) to worst (3).",
  "scenes": [
    {
      "key": "clockwork_airship",
      "title": "Clockwork airship",
      "summary": "Inside a brass airship cabin, a knock is followed by the captain's footsteps and order while a guitarist keeps playing.",
      "prompt": "Optional full description, shown collapsed.",
      "requested": [
        { "label": "Door knock", "windows": [{ "start": 0.4, "end": 2.8 }] },
        { "label": "Captain", "windows": [{ "start": 6, "end": 9.2, "text": "Set a course above the storm" }] },
        { "label": "Guitar", "windows": [{ "start": 0, "end": 9.96, "text": "Continuous" }] }
      ],
      "videos": { "method_a": "/path/a.mp4", "method_b": "/path/b.mp4", "method_c": "/path/c.mp4" }
    }
  ]
}
```

Then run `python3 tools/build_study.py`. Change `version` whenever scenes change, so old browser drafts are not reused.

## Set up Supabase

1. Apply `supabase/001_study_responses.sql`.
2. Insert a long random access value into `study_settings`.
3. Deploy `supabase/functions/study-api` with JWT verification off, and put its URL in `docs/config.js`. Never commit a Supabase key: the function reads its key from the Supabase runtime.

## Links

- Participants: `https://<pages-site>/?k=<access value>`
- Review without gates: add `&debug=1`. These rows are flagged `is_debug` and left out of `study_rankings`. Without `k`, debug runs send nothing and show the payload instead.

## Analysis

Sign in at `/admin/` for the results panel. The password and the output-to-method map exist only in Supabase (see `supabase/002_admin_access.sql`), so results stay private even though this repo is public.

If a participant's submission fails, the study shows them their response as JSON to send you. Add it in the Supabase SQL editor with `select public.submit_study_response('<access value>', '<their JSON>'::jsonb);`.

For custom queries, use the `study_rankings` view in the Supabase SQL editor, and join `output_id` to `study_codebook` for method names.
