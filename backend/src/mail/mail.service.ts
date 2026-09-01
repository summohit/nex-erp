import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transports: nodemailer.Transporter[] = [];
  private readonly fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@nexerp.com';
  private readonly brevoApiKey = process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY;
  private readonly logger = new Logger(MailService.name);

  constructor() {
    const primaryHost = process.env.SMTP_HOST || 'smtp-relay.brevo.com';
    const primaryPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const primarySecure = process.env.SMTP_SECURE === 'true';

    const transportConfigs: Array<{
      host: string;
      port: number;
      secure: boolean;
      user: string | undefined;
      pass: string | undefined;
      name: string;
    }> = [];

    transportConfigs.push({
      host: primaryHost,
      port: primaryPort,
      secure: primarySecure,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      name: 'primary',
    });

    const fallbackHost = process.env.SMTP_FALLBACK_HOST;
    if (fallbackHost && fallbackHost !== primaryHost) {
      transportConfigs.push({
        host: fallbackHost,
        port: parseInt(process.env.SMTP_FALLBACK_PORT || String(primaryPort), 10),
        secure: process.env.SMTP_FALLBACK_SECURE === 'true',
        user: process.env.SMTP_FALLBACK_USER || process.env.SMTP_USER,
        pass: process.env.SMTP_FALLBACK_PASS || process.env.SMTP_PASS,
        name: 'fallback',
      });
    } else if (!fallbackHost && primaryHost === 'smtp-relay.brevo.com' && primaryPort === 587 && !primarySecure) {
      transportConfigs.push({
        host: primaryHost,
        port: 465,
        secure: true,
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        name: 'primary-secure',
      });
    }

    transportConfigs.forEach(config => {
      this.transports.push(nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.pass,
        },
      }));
      this.logger.log(`Configured ${config.name} mail transport: ${config.host}:${config.port} secure=${config.secure}`);
    });

    if (this.brevoApiKey) {
      this.logger.log('Brevo API key detected; outgoing mail will use Brevo HTTP API when possible.');
    } else {
      this.logger.log('Brevo API key not configured; outgoing mail will use SMTP transports.');
    }
  }

  private isTransientError(error: any): boolean {
    const msg = `${error?.code || ''} ${error?.response || ''} ${error?.message || ''}`;
    return /EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|421 |450 |451 |452 |551 /.test(msg);
  }

  private errorDetail(error: any): string {
    if (error?.response) return String(error.response);
    if (error?.code) return `${error.code} - ${error?.message || ''}`;
    return error?.message || 'unknown error';
  }

  private async sendWithRetry(mailOptions: nodemailer.SendMailOptions): Promise<nodemailer.SentMessageInfo> {
    const maxAttempts = 3;
    let lastError: any;

    for (let ti = 0; ti < this.transports.length; ti++) {
      const transporter = this.transports[ti];
      const label = ti === 0
        ? `primary (${process.env.SMTP_HOST || 'smtp-relay.brevo.com'})`
        : `fallback (${process.env.SMTP_FALLBACK_HOST})`;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const info = await transporter.sendMail(mailOptions);
          this.logger.log(`Email to ${mailOptions.to} sent via ${label}. MessageId: ${info.messageId}`);
          return info;
        } catch (error: any) {
          lastError = error;
          const transient = this.isTransientError(error);
          if (transient && attempt < maxAttempts) {
            this.logger.warn(
              `Email to ${mailOptions.to} failed on ${label} (attempt ${attempt}/${maxAttempts}) [transient]: ${this.errorDetail(error)}. Retrying in ${attempt * 1500}ms...`
            );
            await new Promise(resolve => setTimeout(resolve, attempt * 1500));
          } else {
            this.logger.error(`Email to ${mailOptions.to} failed on ${label}: ${this.errorDetail(error)}`);
            break;
          }
        }
      }
    }

    throw lastError;
  }

  private async sendBrevoEmail(mailOptions: { to: string; subject: string; html: string }): Promise<any> {
    if (!this.brevoApiKey) {
      throw new Error('Brevo API key is not configured.');
    }

    const url = 'https://api.brevo.com/v3/smtp/email';
    const payload = {
      sender: { email: this.fromEmail, name: 'NEX ERP' },
      to: [{ email: mailOptions.to }],
      subject: mailOptions.subject,
      htmlContent: mailOptions.html,
    };

    const response = await axios.post(url, payload, {
      headers: {
        'api-key': this.brevoApiKey,
        'Content-Type': 'application/json',
      },
    });

    this.logger.log(`Brevo API email sent to ${mailOptions.to}. Status: ${response.status}`);
    return response.data;
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
      if (this.brevoApiKey) {
        this.logger.log(`Sending verification email to ${email} via Brevo HTTP API.`);
        return await this.sendBrevoEmail({
          to: email,
          subject: 'Action Required: Verify Your Email',
          html: htmlContent,
        });
      }

      this.logger.log(`Sending verification email to ${email} via SMTP transport.`);
      const info = await this.sendWithRetry({
        from: `"NEX ERP" <${this.fromEmail}>`,
        to: email,
        envelope: { from: this.fromEmail, to: email },
        subject: 'Action Required: Verify Your Email',
        html: htmlContent,
      });
      this.logger.log(`Verification email sent to ${email}. MessageId: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}: ${this.errorDetail(error)}`);
      throw new Error(`Could not send verification email. (${this.errorDetail(error)})`);
    }
  }

  async sendPasswordResetOtpEmail(email: string, otp: string) {
    const baseUrl = process.env.APP_URL || 'http://localhost:4200';
    const resetLink = `${baseUrl}/auth/forgot-password`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #1e3a8a; text-align: center;">Reset Your NEX ERP Password</h2>
        <p style="color: #475569; font-size: 16px;">Hello,</p>
        <p style="color: #475569; font-size: 16px;">We received a request to reset the password for your NEX ERP account (<strong style="color: #1e3a8a;">${email}</strong>).</p>
        <p style="color: #475569; font-size: 16px;">Use the verification code below to confirm your identity and set a new password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="background-color: #f1f5f9; color: #1e3a8a; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 28px; letter-spacing: 8px;">${otp}</span>
        </div>
        <p style="color: #475569; font-size: 14px;">1. Go to the <a href="${resetLink}" style="color: #FF5200;">Forgot Password page</a> (or open <span style="color: #334155;">${resetLink}</span>).</p>
        <p style="color: #475569; font-size: 14px;">2. Enter your email address and this verification code, then choose your new password.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #FF5200; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">Reset Password</a>
        </div>
        <p style="color: #475569; font-size: 14px;"><strong>Already logged in?</strong> You can also reset your password from your <strong>My Profile</strong> page at any time after logging in.</p>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 40px; text-align: center;">
          This code will expire in 10 minutes. If you didn't request this email, you can safely ignore it.
        </p>
      </div>
    `;

    try {
      if (this.brevoApiKey) {
        this.logger.log(`Sending password reset OTP email to ${email} via Brevo HTTP API.`);
        return await this.sendBrevoEmail({
          to: email,
          subject: 'Your NEX ERP Password Reset Code',
          html: htmlContent,
        });
      }

      this.logger.log(`Sending password reset OTP email to ${email} via SMTP transport.`);
      const info = await this.sendWithRetry({
        from: `"NEX ERP" <${this.fromEmail}>`,
        to: email,
        envelope: { from: this.fromEmail, to: email },
        subject: 'Your NEX ERP Password Reset Code',
        html: htmlContent,
      });
      this.logger.log(`Password reset OTP email sent to ${email}. MessageId: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.error(`Failed to send password reset OTP email to ${email}: ${this.errorDetail(error)}`);
      throw new Error(`Could not send password reset email. (${this.errorDetail(error)})`);
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
      if (this.brevoApiKey) {
        this.logger.log(`Sending welcome email to ${email} via Brevo HTTP API.`);
        await this.sendBrevoEmail({
          to: email,
          subject: 'Welcome to NEX ERP 🚀',
          html: htmlContent,
        });
        this.logger.log(`Welcome email sent to ${email}`);
        return;
      }

      this.logger.log(`Sending welcome email to ${email} via SMTP transport.`);
      await this.sendWithRetry({
        from: `"NEX ERP" <${this.fromEmail}>`,
        to: email,
        envelope: { from: this.fromEmail, to: email },
        subject: 'Welcome to NEX ERP 🚀',
        html: htmlContent,
      });
      this.logger.log(`Welcome email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send welcome email to ${email}: ${this.errorDetail(error)}`);
    }
  }

  async sendCredentialsEmail(email: string, password: string) {
    const baseUrl = process.env.APP_URL || 'http://localhost:4200';
    const loginLink = `${baseUrl}/auth/login`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #1e3a8a; text-align: center;">Welcome to NEX ERP 🚀</h2>
        <p style="color: #475569; font-size: 16px;">Your account has been created. Here are your login credentials:</p>
        <div style="background-color: #f8fafc; border-radius: 6px; padding: 16px; margin: 20px 0;">
          <p style="margin: 4px 0; color: #1e293b;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 4px 0; color: #1e293b;"><strong>Password:</strong> ${password}</p>
        </div>
        <p style="color: #475569; font-size: 14px;">Please log in and change your password as soon as possible.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginLink}" style="background-color: #FF5200; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">Go to Login</a>
        </div>
      </div>
    `;

    try {
      if (this.brevoApiKey) {
        this.logger.log(`Sending credentials email to ${email} via Brevo HTTP API.`);
        await this.sendBrevoEmail({
          to: email,
          subject: 'Your NEX ERP Login Credentials',
          html: htmlContent,
        });
        this.logger.log(`Credentials email sent to ${email}`);
        return;
      }

      this.logger.log(`Sending credentials email to ${email} via SMTP transport.`);
      await this.sendWithRetry({
        from: `"NEX ERP" <${this.fromEmail}>`,
        to: email,
        envelope: { from: this.fromEmail, to: email },
        subject: 'Your NEX ERP Login Credentials',
        html: htmlContent,
      });
      this.logger.log(`Credentials email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send credentials email to ${email}: ${this.errorDetail(error)}`);
      throw error;
    }
  }

  async sendTicketAssignedEmail(email: string, ticketNumber: string, ticketTitle: string) {
    const baseUrl = process.env.APP_URL || 'http://localhost:4200';
    const ticketLink = `${baseUrl}/crm/tickets`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #1e3a8a; text-align: center;">New Ticket Assigned</h2>
        <p style="color: #475569; font-size: 16px;">Hello,</p>
        <p style="color: #475569; font-size: 16px;">A new ticket has been assigned to you.</p>
        <div style="background-color: #f8fafc; border-radius: 6px; padding: 16px; margin: 20px 0;">
          <p style="margin: 4px 0; color: #1e293b;"><strong>Ticket:</strong> ${ticketNumber}</p>
          <p style="margin: 4px 0; color: #1e293b;"><strong>Title:</strong> ${ticketTitle}</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${ticketLink}" style="background-color: #3b82f6; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">View Ticket</a>
        </div>
      </div>
    `;

    try {
      if (this.brevoApiKey) {
        this.logger.log(`Sending ticket assignment email to ${email} via Brevo HTTP API.`);
        await this.sendBrevoEmail({
          to: email,
          subject: `Ticket Assigned: ${ticketNumber} - ${ticketTitle}`,
          html: htmlContent,
        });
        return;
      }
      this.logger.log(`Sending ticket assignment email to ${email} via SMTP transport.`);
      await this.sendWithRetry({
        from: `"NEX ERP Support" <${this.fromEmail}>`,
        to: email,
        envelope: { from: this.fromEmail, to: email },
        subject: `Ticket Assigned: ${ticketNumber} - ${ticketTitle}`,
        html: htmlContent,
      });
    } catch (error) {
      this.logger.error(`Failed to send ticket assignment email to ${email}: ${this.errorDetail(error)}`);
    }
  }
}
