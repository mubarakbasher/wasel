import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import logger from '../config/logger';

let transporter: Transporter;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      auth:
        config.SMTP_USER && config.SMTP_PASS
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined,
    });
  }
  return transporter;
}

export async function sendVerificationOtp(email: string, name: string, otp: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1a1a2e;">Welcome to Wasel!</h2>
      <p>Hi ${name},</p>
      <p>Your email verification code is:</p>
      <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e;">${otp}</span>
      </div>
      <p>This code expires in <strong>24 hours</strong>.</p>
      <p style="color: #666; font-size: 13px;">If you didn't create a Wasel account, you can safely ignore this email.</p>
    </div>
  `;

  try {
    await getTransporter().sendMail({
      from: config.SMTP_FROM,
      to: email,
      subject: 'Wasel - Verify Your Email',
      html,
    });
    logger.info('Verification OTP email sent', { email });
  } catch (error) {
    logger.error('Failed to send verification email', { email, error });
    throw error;
  }
}

export async function sendPasswordResetOtp(email: string, otp: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1a1a2e;">Password Reset</h2>
      <p>You requested a password reset for your Wasel account.</p>
      <p>Your reset code is:</p>
      <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e;">${otp}</span>
      </div>
      <p>This code expires in <strong>15 minutes</strong>.</p>
      <p style="color: #666; font-size: 13px;">If you didn't request this, you can safely ignore this email. Your password will not change.</p>
    </div>
  `;

  try {
    await getTransporter().sendMail({
      from: config.SMTP_FROM,
      to: email,
      subject: 'Wasel - Password Reset Code',
      html,
    });
    logger.info('Password reset OTP email sent', { email });
  } catch (error) {
    logger.error('Failed to send password reset email', { email, error });
    throw error;
  }
}
