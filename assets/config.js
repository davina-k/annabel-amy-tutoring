/* ==========================================================================
   Site configuration
   --------------------------------------------------------------------------
   Fill these two values in from your Supabase project:
     Supabase dashboard → Project Settings → API
       SUPABASE_URL      = "Project URL"
       SUPABASE_ANON_KEY = "anon / public" key

   The anon key is designed to be public — it is safe in front-end code
   PROVIDED row level security is switched on. supabase/schema.sql sets that
   up. Never put the `service_role` key in this file.

   Until both values are filled in, the site runs in preview mode: the
   timetable shows example times and the forms fall back to opening the
   visitor's email client.
   ========================================================================== */

window.SITE_CONFIG = {
  SUPABASE_URL: "https://zycybioxswhvszjxpaxx.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_aneBum5xY4bg24rDGqKDqA__nk3aCKk",

  // Where enquiries land if Supabase is not configured (the mailto fallback).
  FALLBACK_EMAIL: "aamathtutor36@gmail.com",

  // How far ahead the timetable looks.
  DAYS_AHEAD: 21,

  // Example availability used only in preview mode, before Supabase is wired
  // up. Once it is, real slots come from the `slots` table instead.
  // hours are 24h, local time. Day 0 = Sunday.
  PREVIEW_AVAILABILITY: [
    { day: 1, times: ["16:00", "17:00", "18:00"], tutor: "Annabel" },
    { day: 2, times: ["17:00", "18:00", "19:00"], tutor: "Amy" },
    { day: 3, times: ["16:00", "17:00"],          tutor: "Annabel" },
    { day: 4, times: ["18:00", "19:00"],          tutor: "Amy" },
    { day: 6, times: ["10:00", "11:00", "12:00"], tutor: "Annabel" },
    { day: 6, times: ["14:00", "15:00"],          tutor: "Amy" }
  ]
};
