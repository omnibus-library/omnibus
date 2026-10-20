import { describe, expect, it } from "vitest";
import { type SmtpDraft, smtpUpdate } from "./smtp";

const DRAFT: SmtpDraft = {
  host: "smtp.example.com",
  port: "587",
  username: "mailer",
  fromEmail: "library@example.com",
  password: "",
  security: "starttls",
};

const BAD_PORT = "Port must be a number between 1 and 65535.";

describe("smtpUpdate", () => {
  describe("loading", () => {
    it("refuses before the saved settings have loaded", () => {
      expect(smtpUpdate(false, DRAFT)).toEqual({
        refused:
          "The current SMTP settings haven’t loaded, so saving now would overwrite them.",
      });
    });
  });

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
      expect(smtpUpdate(true, { ...DRAFT, port })).toEqual({
        refused: BAD_PORT,
      });
    });

    it.each([
      ["the smallest port", " 1 ", 1],
      ["the largest port", "65535", 65535],
    ])("accepts %s", (_condition, port, sent) => {
      expect(smtpUpdate(true, { ...DRAFT, port })).toMatchObject({
        refused: null,
        update: { port: sent },
      });
    });
  });

  describe("fields", () => {
    it("trims the host, username and from address", () => {
      expect(
        smtpUpdate(true, {
          ...DRAFT,
          host: " smtp.example.com ",
          username: " mailer ",
          fromEmail: " library@example.com ",
        }),
      ).toEqual({
        refused: null,
        update: {
          host: "smtp.example.com",
          port: 587,
          username: "mailer",
          from_email: "library@example.com",
          security: "starttls",
        },
      });
    });

    it("sends no password when the field is blank", () => {
      const result = smtpUpdate(true, DRAFT);

      expect(result.refused).toBeNull();
      expect(result).not.toHaveProperty("update.password");
    });

    it("sends the typed password untrimmed", () => {
      expect(
        smtpUpdate(true, {
          ...DRAFT,
          password: " pass word ",
          security: "tls",
        }),
      ).toMatchObject({
        refused: null,
        update: { password: " pass word ", security: "tls" },
      });
    });
  });
});
