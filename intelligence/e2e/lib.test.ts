import { describe, expect, test } from "bun:test";
import { saidUnavailable } from "./lib";

describe("saidUnavailable", () => {
  test.each([
    "Opportunities aren't available to you. You can open Accounts.",
    "The report isn't available to you, so I can't run it.",
    "That is not available to you.",
    "I don't have access to that.",
    "I was unable to open it.",
  ])("hears a refusal in: %s", (text) => expect(saidUnavailable(text)).toBe(true));

  test.each(["I opened Account 1 (ACC-0001) beside the conversation.", "I found the Accounts list and opened it."])(
    "does not hear one in: %s",
    (text) => expect(saidUnavailable(text)).toBe(false)
  );
});
