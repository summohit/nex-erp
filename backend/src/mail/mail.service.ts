import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendVerificationEmail(email: string, token: string) {
    const baseUrl = process.env.APP_URL || 'http://localhost:4200';
    const verifyLink = `${baseUrl}/auth/verify-email?token=${token}`;
    
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #1e3a8a; text-align: center;">Welcome to NEX ERP! 🚀</h2>
        <p style="color: #475569; font-size: 16px;">Hello,</p>
        <p style="color: #475569; font-size: 16px;">Thank you for signing up. Please verify your email address to activate your account and get started.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyLink}" style="background-color: #FF5200; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">Verify Email Address</a>
        </div>
        <p style="color: #475569; font-size: 14px;">Or copy and paste this link into your browser:</p>
        <p style="background-color: #f1f5f9; padding: 10px; border-radius: 4px; word-break: break-all; font-size: 14px; color: #334155;">
          <a href="${verifyLink}" style="color: #FF5200;">${verifyLink}</a>
        </p>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 40px; text-align: center;">
          This link will expire in 24 hours. If you didn't request this email, you can safely ignore it.
        </p>
      </div>
    `;

    try {
      const info = await this.transporter.sendMail({
        from: `"NEX ERP" <${process.env.FROM_EMAIL || 'noreply@nexerp.com'}>`,
        to: email,
        subject: 'Action Required: Verify Your Email',
        html: htmlContent,
      });

      this.logger.log(`Verification email sent to ${email}. MessageId: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}`, error);
      throw new Error('Could not send verification email.');
    }
  }

  async sendWelcomeEmail(email: string) {
    const baseUrl = process.env.APP_URL || 'http://localhost:4200';
    const loginLink = `${baseUrl}/auth/login`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #1e3a8a; text-align: center;">You're All Set! 🎉</h2>
        <p style="color: #475569; font-size: 16px;">Your email has been verified successfully.</p>
        <p style="color: #475569; font-size: 16px;">Welcome to NEX ERP. You can now log in and complete your onboarding process.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginLink}" style="background-color: #FF5200; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">Go to Login</a>
        </div>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: `"NEX ERP" <${process.env.FROM_EMAIL || 'noreply@nexerp.com'}>`,
        to: email,
        subject: 'Welcome to NEX ERP 🚀',
        html: htmlContent,
      });
      this.logger.log(`Welcome email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send welcome email to ${email}`, error);
    }
  }
}
