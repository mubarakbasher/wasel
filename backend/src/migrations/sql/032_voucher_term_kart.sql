-- 032_voucher_term_kart.sql
-- Finish the قسيمة → كرت Arabic terminology rename in seeded email-template copy.
-- 027 seeds payment_approved (ar) with "وإصدار القسائم"; that migration is immutable and
-- its rows are already seeded (ON CONFLICT DO NOTHING), so update the wording here.
-- Idempotent: the LIKE guard makes it a no-op once already renamed (e.g. after an admin edit).
-- Replacing قسائم also fixes القسائم (ال + قسائم -> ال + كروت = الكروت); قسيمة likewise covers القسيمة.
UPDATE email_templates
SET body_html = REPLACE(REPLACE(body_html, 'قسائم', 'كروت'), 'قسيمة', 'كرت')
WHERE language = 'ar'
  AND (body_html LIKE '%قسائم%' OR body_html LIKE '%قسيمة%');
