import { describe, expect, it } from "vitest";
import { type RequestsDraft, RequestsSchema } from "./requests";

const DRAFT: RequestsDraft = {
  prowlarr_url: "http://prowlarr:9696",
  prowlarr_api_key: "",
  download_client_url: "http://qbittorrent:8080",
  download_client_username: "admin",
  download_client_password: "",
  download_client_category: "books",
  download_client_path_prefix: "/downloads",
  download_path_prefix: "/mnt/completed",
};

describe("RequestsSchema", () => {
  describe("urls", () => {
    it.each([
      ["a bare host", "prowlarr:9696"],
      ["an ftp address", "ftp://prowlarr"],
      ["a scheme with no host", "http://"],
    ])("refuses %s", (_condition, url) => {
      const result = RequestsSchema.safeParse({ ...DRAFT, prowlarr_url: url });

      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ["prowlarr_url"],
          message: "Enter an http:// or https:// address.",
        }),
      ]);
    });

    it("accepts a blank url, which clears the field", () => {
      expect(
        RequestsSchema.parse({ ...DRAFT, download_client_url: "  " }),
      ).toMatchObject({ download_client_url: "" });
    });
  });

  describe("fields", () => {
    it("trims every text field", () => {
      expect(
        RequestsSchema.parse({
          ...DRAFT,
          prowlarr_url: " https://prowlarr.example.com ",
          download_client_username: " admin ",
          download_client_category: " books ",
          download_client_path_prefix: " /downloads ",
          download_path_prefix: " /mnt/completed ",
        }),
      ).toEqual({
        prowlarr_url: "https://prowlarr.example.com",
        download_client_kind: "qbittorrent",
        download_client_url: "http://qbittorrent:8080",
        download_client_username: "admin",
        download_client_category: "books",
        download_client_path_prefix: "/downloads",
        download_path_prefix: "/mnt/completed",
      });
    });

    it("sends neither secret when its field is blank", () => {
      const update = RequestsSchema.parse(DRAFT);

      expect(update).not.toHaveProperty("prowlarr_api_key");
      expect(update).not.toHaveProperty("download_client_password");
    });

    it("sends a typed secret as typed", () => {
      expect(
        RequestsSchema.parse({
          ...DRAFT,
          prowlarr_api_key: "key-1",
          download_client_password: " pass word ",
        }),
      ).toMatchObject({
        prowlarr_api_key: "key-1",
        download_client_password: " pass word ",
      });
    });
  });
});
