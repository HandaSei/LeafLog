import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = "LeafLog <onboarding@resend.dev>";

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function emailTemplate(title: string, code: string, message: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #faf7f2; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; background: #8B9E8B; color: white; font-size: 20px; font-weight: 700; padding: 10px 20px; border-radius: 8px; letter-spacing: 1px;">
          LeafLog
        </div>
      </div>
      <div style="background: white; border-radius: 8px; padding: 24px; border: 1px solid #e8dcc4;">
        <h2 style="color: #2d3a2d; margin: 0 0 12px 0; font-size: 18px;">${title}</h2>
        <p style="color: #5a6b5a; margin: 0 0 20px 0; font-size: 14px; line-height: 1.5;">${message}</p>
        <div style="text-align: center; padding: 20px; background: #f5f0e8; border-radius: 8px; margin-bottom: 16px;">
          <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #8B9E8B; font-family: monospace;">${code}</div>
        </div>
        <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">This code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
      <p style="color: #bbb; font-size: 11px; text-align: center; margin-top: 16px;">LeafLog — Shift Management</p>
    </div>
  `;
}

export async function sendVerificationEmail(to: string, code: string, type: "registration" | "recovery" | "employee-upgrade"): Promise<boolean> {
  const configs = {
    registration: {
      subject: "Verify your LeafLog account",
      title: "Verify Your Email",
      message: "Enter this code to complete your registration:",
    },
    recovery: {
      subject: "Reset your LeafLog password",
      title: "Password Reset",
      message: "Enter this code to reset your password:",
    },
    "employee-upgrade": {
      subject: "Verify your LeafLog account",
      title: "Create Your Account",
      message: "Enter this code to finish setting up your permanent account:",
    },
  };

  const config = configs[type];

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: config.subject,
      html: emailTemplate(config.title, code, config.message),
    });

    if (error) {
      console.error("Resend error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Email send failed:", err);
    return false;
  }
}

export { generateCode };
