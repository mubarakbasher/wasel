-- 039_support_email_templates.sql
-- Seeds 4 email template rows for support-chat notifications:
--   support_message_admin (EN + AR) — admin alert when a user sends a support message
--   support_reply_user (EN + AR)    — user notification when an admin replies
-- Idempotent: ON CONFLICT (type, language) DO NOTHING, so admin edits are never
-- overwritten by re-running migrations (mirrors 027_email_templates.sql).

-- 1. support_message_admin (EN) ── tokens: {user_name}, {user_email}, {message}
-- Sent to every active admin when a user submits a new support/contact message.
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'support_message_admin',
  'en',
  'New support message from {user_name}',
  '<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">New Support Message</h2>
  <p>A user has sent a support message that requires your attention.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr>
      <td style="padding: 8px; color: #666;">Name</td>
      <td style="padding: 8px; font-weight: bold;">{user_name}</td>
    </tr>
    <tr style="background: #f0f0f5;">
      <td style="padding: 8px; color: #666;">Email</td>
      <td style="padding: 8px;">{user_email}</td>
    </tr>
  </table>
  <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0; color: #1a1a2e;">{message}</p>
  </div>
  <p>Reply from the Wasel admin panel.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 2. support_message_admin (AR) ── tokens: {user_name}, {user_email}, {message}
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'support_message_admin',
  'ar',
  'رسالة دعم جديدة من {user_name}',
  '<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">رسالة دعم جديدة</h2>
  <p>أرسل مستخدم رسالة دعم تستدعي اهتمامك.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr>
      <td style="padding: 8px; color: #666;">الاسم</td>
      <td style="padding: 8px; font-weight: bold;">{user_name}</td>
    </tr>
    <tr style="background: #f0f0f5;">
      <td style="padding: 8px; color: #666;">البريد الإلكتروني</td>
      <td style="padding: 8px;">{user_email}</td>
    </tr>
  </table>
  <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0; color: #1a1a2e;">{message}</p>
  </div>
  <p>الرد من لوحة إدارة وصل.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 3. support_reply_user (EN) ── tokens: {name}, {message}
-- Sent to the user when an admin replies to their support thread.
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'support_reply_user',
  'en',
  'Wasel support replied to your message',
  '<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">Support Reply</h2>
  <p>Hi {name},</p>
  <p>The Wasel support team has replied to your message:</p>
  <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0; color: #1a1a2e;">{message}</p>
  </div>
  <p>Open the Wasel app (Settings &#8594; Contact) to continue the conversation.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 4. support_reply_user (AR) ── tokens: {name}, {message}
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'support_reply_user',
  'ar',
  'وصل ردّ على رسالتك',
  '<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">رد فريق الدعم</h2>
  <p>مرحباً {name}،</p>
  <p>ردّ فريق دعم وصل على رسالتك:</p>
  <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0; color: #1a1a2e;">{message}</p>
  </div>
  <p>افتح تطبيق وصل (الإعدادات &#8592; تواصل معنا) لمتابعة المحادثة.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;
