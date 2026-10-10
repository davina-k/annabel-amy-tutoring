# Annabel and Amy's Maths Tutoring — website MVP

A static site, no build step. Drop the folder on Netlify and it works. Add
Supabase credentials and the timetable and forms go live.

**To look at it offline:** double-click `START-HERE-view-offline.html` in the
zip's top level. That's a single self-contained copy with the CSS and
JavaScript inlined, so it opens straight from disk with no server. It is a
*viewer*, not the source — make edits in this folder, and regenerate the
offline copy only if you want a fresh one to show someone.

```
index.html              the whole page
assets/styles.css       all styling
assets/config.js        ← the only file you must edit
assets/app.js           timetable rendering, booking, enquiries
supabase/schema.sql     tables, row-level security, booking function
netlify.toml            security headers and caching
```

---

## Before you go live — fill these in

One thing is still a placeholder.

| What | Where | Currently |
|---|---|---|
| **Real availability** | Supabase, once connected | showing example evenings and Saturday mornings |

Already filled in:

| What | Where | Value |
|---|---|---|
| **Enquiry email address** | `assets/config.js` → `FALLBACK_EMAIL`, and the `mailto:` link in `index.html` | `aamathtutor36@gmail.com` |
| **Facebook page URL** | three links in `index.html` | kept as the share link: `facebook.com/share/1cswsV95vJ/` |
| **Rates** | `index.html`, the "How it works" section | intentionally left as "message us for pricing" |
| **Online vs in person** | `index.html`, "How it works" | sessions are online by video call; in-person available for students local to Manchester |
| **Exam boards** | `index.html`, the GCSE and A Level cards | AQA, Edexcel, OCR |

The wording throughout is drawn from your Facebook About section. Nothing is
claimed that isn't already on the page — qualifications, the 3,000 hours each,
the 13 reviews at 100%, London, and the phone number.

---

## 1. Deploy to Netlify

**Quickest:** go to [app.netlify.com/drop](https://app.netlify.com/drop) and drag
this folder onto the page. You get a live URL in about thirty seconds.

**Better, for updates:** push the folder to a GitHub repo, then in Netlify
choose *Add new site → Import an existing project*. Leave the build command
empty and set the publish directory to `.`. Every push then redeploys.

Add your own domain under *Domain management*; Netlify handles the HTTPS
certificate itself.

---

## 2. Connect Supabase

1. Create a project at [supabase.com](https://supabase.com) (the free tier is
   ample for this).
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, Run.
3. **Project Settings → API**, copy the *Project URL* and the *anon public* key.
4. Paste both into `assets/config.js` and redeploy.

The anon key is meant to be public — it is safe in front-end code *because*
row level security is on. The schema sets that up: the public can read free
slots and submit enquiries, and can do nothing else. **Never put the
`service_role` key in this repo.**

### Add your availability

In the SQL editor, one line per weekly pattern. Day numbers are ISO:
1 = Monday, 7 = Sunday. Times are Europe/London, so BST is handled for you.

```sql
select public.add_weekly_slots('Annabel', 1, array['16:00','17:00','18:00'], 8);
select public.add_weekly_slots('Amy',     2, array['17:00','18:00','19:00'], 8);
select public.add_weekly_slots('Annabel', 6, array['10:00','11:00','12:00'], 8);
```

That creates eight weeks at a time. Re-run it when you want to extend further —
it skips any slot that already exists.

### Read what comes in

- **Table Editor → `booking_inbox`** — session requests, newest sessions first.
- **Table Editor → `enquiries`** — contact-form messages.

Requested slots are marked `held`, so they disappear from the public timetable
straight away. When you've confirmed with the family, set the booking's
`status` to `confirmed` and the slot's to `booked`. To release a slot again,
set it back to `available`.

### Get told when something arrives

Supabase won't email you by itself. Either check the dashboard, or add a
Database Webhook (*Database → Webhooks*) on insert to `bookings` and
`enquiries`, pointing at a Netlify Function or a Zapier/Make hook that emails
you. That's the one piece worth adding after launch.

---

## How it behaves before Supabase is connected

Nothing breaks. The timetable shows the example pattern in
`config.js → PREVIEW_AVAILABILITY`, and both forms open the visitor's email
client with the details filled in, addressed to `FALLBACK_EMAIL`. So the site
is usable from the moment it's deployed — connecting Supabase upgrades it
rather than switching it on.

---

## Notes on the build

- No framework and no build step; the Supabase client is the only dependency
  and it loads from a CDN, lazily, so the page renders even if it fails.
- Responsive to ~360px, dark mode included, keyboard-navigable, skip link,
  visible focus states, `prefers-reduced-motion` respected.
- Colours and the atom mark are drawn from your Facebook branding — the
  exercise-book blue, the amber atom, the slate logo card. The atom is inline
  SVG, so no image files and nothing to load.
- Anything a student submits is treated as untrusted: text is inserted with
  `textContent`, and the database enforces its own length and format checks
  rather than trusting the browser.
