import { describe, expect, it } from "vitest";
import { type SmtpDraft, SmtpSchema } from "./smtp";

const DRAFT: SmtpDraft = {
  smtp_host: "smtp.example.com",
  smtp_port: "587",
  smtp_username: "mailer",
  smtp_from_email: "library@example.com",
  smtp_password: "",
  smtp_security: "starttls",
};

describe("SmtpSchema", () => {
  describe("port", () => {
    it.each([
      ["a blank port", ""],
      ["a non-numeric port", "smtp"],
      ["a port of zero", "0"],
      ["a negative port", "-1"],
      ["a decimal port", "587.5"],
      ["a port in exponent form", "1e3"],
      ["one past the largest port", "65536"],
    ])("refuses %s", (_condition, port) => {
      const result = SmtpSchema.safeParse({ ...DRAFT, smtp_port: port });

      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ["smtp_port"],
          message: "Port must be a number between 1 and 65535.",
        }),
      ]);
    });

    it.each([
      ["the smallest port", " 1 ", 1],
      ["the largest port", "65535", 65535],
    ])("accepts %s", (_condition, port, sent) => {
      expect(SmtpSchema.parse({ ...DRAFT, smtp_port: port })).toMatchObject({
        port: sent,
      });
    });
  });

  describe("fields", () => {
    it("trims the host, username and from address", () => {
      expect(
        SmtpSchema.parse({
          ...DRAFT,
          smtp_host: " smtp.example.com ",
          smtp_username: " mailer ",
          smtp_from_email: " library@example.com ",
        }),
      ).toEqual({
        host: "smtp.example.com",
        port: 587,
        username: "mailer",
        from_email: "library@example.com",
        security: "starttls",
      });
    });

    it("sends no password when the field is blank", () => {
      expect(SmtpSchema.parse(DRAFT)).not.toHaveProperty("password");
    });

    it("sends the typed password untrimmed", () => {
      expect(
        SmtpSchema.parse({
          ...DRAFT,
          smtp_password: " pass word ",
          smtp_security: "tls",
        }),
      ).toMatchObject({ password: " pass word ", security: "tls" });
    });
  });
});
