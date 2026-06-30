-- 027_email_templates.sql
-- Admin-editable bilingual email templates (EN + AR) used by the notification
-- service for OTP delivery, payment alerts, and subscription status emails.
-- Seeds 10 rows (5 types x 2 languages) on first run; idempotent on re-run
-- because every INSERT uses ON CONFLICT (type, language) DO NOTHING, so admin
-- edits made through the panel are never overwritten by re-running migrations.

CREATE TABLE IF NOT EXISTS email_templates (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    type        VARCHAR(64)  NOT NULL,
    language    VARCHAR(5)   NOT NULL,
    subject     VARCHAR(255) NOT NULL,
    body_html   TEXT         NOT NULL,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    updated_by  UUID         REFERENCES users(id),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (type, language)
);

-- Idempotent language CHECK: drop + re-add so re-runs never fail on the
-- constraint already existing (mirrors the pattern in 025_user_language.sql).
ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_language_check;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_language_check
    CHECK (language IN ('en', 'ar'));

-- Index on type for O(log n) template lookups by type in the email service.
CREATE INDEX IF NOT EXISTS idx_email_templates_type ON email_templates(type);

-- Auto-update updated_at on every admin edit.
CREATE OR REPLACE TRIGGER trg_email_templates_updated_at
    BEFORE UPDATE ON email_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- Seed: 5 types x 2 languages = 10 rows
-- HTML bodies use {placeholder} tokens; the email service substitutes values
-- at send time.  Arabic containers carry dir="rtl".
-- =============================================================================

-- 1. verification_otp (EN) ── tokens: {name}, {otp}
-- HTML mirrors the existing sendVerificationOtp body in email.service.ts,
-- parameterised so the admin can localise the copy without a code deploy.
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'verification_otp',
  'en',
  'Wasel - Verify Your Email',
  '<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">Welcome to Wasel!</h2>
  <p>Hi {name},</p>
  <p>Your email verification code is:</p>
  <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e;">{otp}</span>
  </div>
  <p>This code expires in <strong>24 hours</strong>.</p>
  <p style="color: #666; font-size: 13px;">If you did not create a Wasel account, you can safely ignore this email.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 2. verification_otp (AR) ── tokens: {name}, {otp}
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'verification_otp',
  'ar',
  'وصل - تحقق من بريدك الإلكتروني',
  '<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">أهلاً بك في وصل!</h2>
  <p>مرحباً {name}،</p>
  <p>رمز التحقق من بريدك الإلكتروني هو:</p>
  <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e;">{otp}</span>
  </div>
  <p>ينتهي هذا الرمز خلال <strong>24 ساعة</strong>.</p>
  <p style="color: #666; font-size: 13px;">إذا لم تقم بإنشاء حساب في وصل، يمكنك تجاهل هذا البريد بأمان.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 3. password_reset_otp (EN) ── tokens: {otp}
-- HTML mirrors the existing sendPasswordResetOtp body in email.service.ts.
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'password_reset_otp',
  'en',
  'Wasel - Password Reset Code',
  '<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">Password Reset</h2>
  <p>You requested a password reset for your Wasel account.</p>
  <p>Your reset code is:</p>
  <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e;">{otp}</span>
  </div>
  <p>This code expires in <strong>15 minutes</strong>.</p>
  <p style="color: #666; font-size: 13px;">If you did not request this, you can safely ignore this email. Your password will not change.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 4. password_reset_otp (AR) ── tokens: {otp}
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'password_reset_otp',
  'ar',
  'وصل - رمز إعادة تعيين كلمة المرور',
  '<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">إعادة تعيين كلمة المرور</h2>
  <p>لقد طلبت إعادة تعيين كلمة المرور لحساب وصل الخاص بك.</p>
  <p>رمز إعادة التعيين هو:</p>
  <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e;">{otp}</span>
  </div>
  <p>ينتهي هذا الرمز خلال <strong>15 دقيقة</strong>.</p>
  <p style="color: #666; font-size: 13px;">إذا لم تطلب ذلك، يمكنك تجاهل هذا البريد. لن تتغير كلمة المرور الخاصة بك.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 5. payment_submitted_admin (EN) ── tokens: {user_name}, {user_email}, {plan}, {amount}, {currency}, {reference}
-- Sent to the platform admin inbox when a user uploads a bank-transfer receipt.
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'payment_submitted_admin',
  'en',
  '[Wasel Admin] New Payment Submission from {user_name}',
  '<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">New Payment Submission</h2>
  <p>A user has submitted a payment that requires your review.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr>
      <td style="padding: 8px; color: #666;">Name</td>
      <td style="padding: 8px; font-weight: bold;">{user_name}</td>
    </tr>
    <tr style="background: #f0f0f5;">
      <td style="padding: 8px; color: #666;">Email</td>
      <td style="padding: 8px;">{user_email}</td>
    </tr>
    <tr>
      <td style="padding: 8px; color: #666;">Plan</td>
      <td style="padding: 8px;">{plan}</td>
    </tr>
    <tr style="background: #f0f0f5;">
      <td style="padding: 8px; color: #666;">Amount</td>
      <td style="padding: 8px; font-weight: bold;">{amount} {currency}</td>
    </tr>
    <tr>
      <td style="padding: 8px; color: #666;">Reference</td>
      <td style="padding: 8px;">{reference}</td>
    </tr>
  </table>
  <p>Please log in to the admin panel to approve or reject this payment.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 6. payment_submitted_admin (AR) ── tokens: {user_name}, {user_email}, {plan}, {amount}, {currency}, {reference}
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'payment_submitted_admin',
  'ar',
  '[وصل - إدارة] طلب دفع جديد من {user_name}',
  '<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">طلب دفع جديد</h2>
  <p>قام مستخدم بتقديم طلب دفع يحتاج إلى مراجعتك.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr>
      <td style="padding: 8px; color: #666;">الاسم</td>
      <td style="padding: 8px; font-weight: bold;">{user_name}</td>
    </tr>
    <tr style="background: #f0f0f5;">
      <td style="padding: 8px; color: #666;">البريد الإلكتروني</td>
      <td style="padding: 8px;">{user_email}</td>
    </tr>
    <tr>
      <td style="padding: 8px; color: #666;">الخطة</td>
      <td style="padding: 8px;">{plan}</td>
    </tr>
    <tr style="background: #f0f0f5;">
      <td style="padding: 8px; color: #666;">المبلغ</td>
      <td style="padding: 8px; font-weight: bold;">{amount} {currency}</td>
    </tr>
    <tr>
      <td style="padding: 8px; color: #666;">المرجع</td>
      <td style="padding: 8px;">{reference}</td>
    </tr>
  </table>
  <p>يرجى تسجيل الدخول إلى لوحة الإدارة لقبول أو رفض هذه العملية.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 7. payment_approved (EN) ── tokens: {name}, {plan}, {amount}, {currency}
-- Sent to the operator when an admin approves their bank-transfer payment.
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'payment_approved',
  'en',
  'Wasel - Your Payment Has Been Approved',
  '<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">Payment Approved</h2>
  <p>Hi {name},</p>
  <p>Your payment has been approved. Your <strong>{plan}</strong> subscription is now active.</p>
  <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <p style="margin: 0; color: #666; font-size: 13px;">Amount paid: <strong>{amount} {currency}</strong></p>
  </div>
  <p>Thank you for choosing Wasel. You can now manage your routers and issue vouchers.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 8. payment_approved (AR) ── tokens: {name}, {plan}, {amount}, {currency}
-- Arabic phrasing aligned with payment_confirmed strings in notificationStrings.ts.
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'payment_approved',
  'ar',
  'وصل - تمت الموافقة على دفعتك',
  '<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">تم تأكيد الدفع</h2>
  <p>مرحباً {name}،</p>
  <p>تمت الموافقة على دفعتك. اشتراك <strong>{plan}</strong> الخاص بك أصبح نشطاً الآن.</p>
  <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <p style="margin: 0; color: #666; font-size: 13px;">المبلغ المدفوع: <strong>{amount} {currency}</strong></p>
  </div>
  <p>شكراً لاختيارك وصل. يمكنك الآن إدارة راوتراتك وإصدار القسائم.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 9. payment_rejected (EN) ── tokens: {name}, {plan}, {reason}
-- Sent to the operator when an admin rejects their payment; includes a call to
-- action to re-upload the receipt.
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'payment_rejected',
  'en',
  'Wasel - Payment Could Not Be Verified',
  '<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">Payment Rejected</h2>
  <p>Hi {name},</p>
  <p>Unfortunately your payment for the <strong>{plan}</strong> plan could not be verified.</p>
  <div style="background: #fff3f3; border-left: 4px solid #e53e3e; border-radius: 4px; padding: 12px 16px; margin: 16px 0;">
    <p style="margin: 0; color: #c53030; font-size: 14px;"><strong>Reason:</strong> {reason}</p>
  </div>
  <p>You can re-upload your receipt and resubmit your payment from the app.</p>
  <p style="color: #666; font-size: 13px;">If you believe this is an error, please contact our support team.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;

-- 10. payment_rejected (AR) ── tokens: {name}, {plan}, {reason}
INSERT INTO email_templates (type, language, subject, body_html) VALUES (
  'payment_rejected',
  'ar',
  'وصل - لم يتم التحقق من دفعتك',
  '<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">تم رفض الدفع</h2>
  <p>مرحباً {name}،</p>
  <p>للأسف، لم يتم التحقق من دفعتك لخطة <strong>{plan}</strong>.</p>
  <div style="background: #fff3f3; border-right: 4px solid #e53e3e; border-radius: 4px; padding: 12px 16px; margin: 16px 0;">
    <p style="margin: 0; color: #c53030; font-size: 14px;"><strong>السبب:</strong> {reason}</p>
  </div>
  <p>يمكنك إعادة رفع إيصال الدفع وإعادة تقديم طلبك من التطبيق.</p>
  <p style="color: #666; font-size: 13px;">إذا كنت تعتقد أن هذا خطأ، يرجى التواصل مع فريق الدعم.</p>
</div>'
) ON CONFLICT (type, language) DO NOTHING;
