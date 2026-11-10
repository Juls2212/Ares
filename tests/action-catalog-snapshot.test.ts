import { describe, expect, it } from "vitest";

import { ENABLED_ASSISTANT_CAPABILITIES } from "../src/main/actions/capability-registry";

/**
 * Inventory of every registered action: name, domain, approval class, executor category, enabled flag.
 * Adding or removing a capability must update this table deliberately.
 */
const EXPECTED_CATALOG: ReadonlyArray<readonly [string, string, string, string, boolean]> = [
  ["CREATE_TASK", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["UPDATE_TASK", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["COMPLETE_TASK", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["DELETE_TASK", "INTERNAL_MEMORY", "REINFORCED_CONFIRMATION_REQUIRED", "PLANNER", true],
  ["CREATE_EVENT", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["UPDATE_EVENT", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["DELETE_EVENT", "INTERNAL_MEMORY", "REINFORCED_CONFIRMATION_REQUIRED", "PLANNER", true],
  ["CREATE_REMINDER", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["GET_TODAY_SCHEDULE", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["GET_WEEK_SCHEDULE", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["GET_WEEKLY_SCHEDULE_DETAILS", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["ANALYZE_WEEKLY_SCHEDULE", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["GET_TODAY_AVAILABILITY", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["CREATE_WEEKLY_SCHEDULE", "INTERNAL_MEMORY", "CONFIRMATION_REQUIRED", "PLANNER", true],
  ["UPDATE_WEEKLY_SCHEDULE", "INTERNAL_MEMORY", "CONFIRMATION_REQUIRED", "PLANNER", true],
  ["CREATE_WEEKLY_ROUTINE", "INTERNAL_MEMORY", "CONFIRMATION_REQUIRED", "PLANNER", true],
  ["UPDATE_WEEKLY_ROUTINE", "INTERNAL_MEMORY", "CONFIRMATION_REQUIRED", "PLANNER", true],
  ["GET_CURRENT_DATE_TIME", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["GET_HABIT_PROGRESS", "INTERNAL_MEMORY", "DIRECT", "PLANNER", true],
  ["CREATE_HABIT", "INTERNAL_MEMORY", "CONFIRMATION_REQUIRED", "PLANNER", true],
  ["UPDATE_HABIT", "INTERNAL_MEMORY", "CONFIRMATION_REQUIRED", "PLANNER", true],
  ["COMPLETE_HABIT", "INTERNAL_MEMORY", "CONFIRMATION_REQUIRED", "PLANNER", true],
  ["OPEN_APPLICATION", "APPLICATIONS", "DIRECT", "APPLICATION", true],
  ["SEARCH_SPOTIFY_APP", "APPLICATIONS", "DIRECT", "APPLICATION", true],
  ["REGISTER_CATALOG_APPLICATION", "APPLICATIONS", "CONFIRMATION_REQUIRED", "APPLICATION", true],
  ["REQUEST_CUSTOM_APPLICATION_REGISTRATION", "APPLICATIONS", "CONFIRMATION_REQUIRED", "APPLICATION", true],
  ["OPEN_APPROVED_PAGE", "WEB", "DIRECT", "WEB", true],
  ["SEARCH_APPROVED_SITE", "WEB", "DIRECT", "WEB", true],
  ["SEARCH_FILES", "FILES", "DIRECT", "FILES", true],
  ["REVEAL_FOUND_FILE", "FILES", "DIRECT", "FILES", true],
  ["OPEN_FOUND_FILE", "FILES", "CONFIRMATION_REQUIRED", "FILES", true],
  ["CREATE_FOLDER", "FILES", "CONFIRMATION_REQUIRED", "FILES", true],
  ["RENAME_FOUND_ITEM", "FILES", "CONFIRMATION_REQUIRED", "FILES", true],
  ["MOVE_FOUND_ITEMS", "FILES", "CONFIRMATION_REQUIRED", "FILES", true],
  ["ORGANIZE_FOUND_ITEMS", "FILES", "CONFIRMATION_REQUIRED", "FILES", true],
  ["DELETE_FOUND_ITEM", "FILES", "REINFORCED_CONFIRMATION_REQUIRED", "FILES", true],
  ["SAVE_CONTACT", "MESSAGING", "CONFIRMATION_REQUIRED", "MESSAGING", true],
  ["LIST_CONTACTS", "MESSAGING", "DIRECT", "MESSAGING", true],
  ["DELETE_CONTACT", "MESSAGING", "REINFORCED_CONFIRMATION_REQUIRED", "MESSAGING", true],
  ["PREPARE_MESSAGE_DRAFT", "MESSAGING", "DIRECT", "MESSAGING", true],
  ["EDIT_MESSAGE_DRAFT", "MESSAGING", "DIRECT", "MESSAGING", true],
  ["DISCARD_MESSAGE_DRAFT", "MESSAGING", "DIRECT", "MESSAGING", true],
  ["OPEN_WHATSAPP_CHAT_WITH_DRAFT", "MESSAGING", "CONFIRMATION_REQUIRED", "MESSAGING", true],
  ["CONNECT_SPOTIFY", "MUSIC", "CONFIRMATION_REQUIRED", "MUSIC", true],
  ["DISCONNECT_SPOTIFY", "MUSIC", "CONFIRMATION_REQUIRED", "MUSIC", true],
  ["GET_SPOTIFY_STATUS", "MUSIC", "DIRECT", "MUSIC", true],
  ["PLAY_SPOTIFY_MUSIC", "MUSIC", "DIRECT", "MUSIC", true],
  ["PAUSE_SPOTIFY", "MUSIC", "DIRECT", "MUSIC", true],
  ["RESUME_SPOTIFY", "MUSIC", "DIRECT", "MUSIC", true],
  ["NEXT_SPOTIFY_TRACK", "MUSIC", "DIRECT", "MUSIC", true],
  ["PREVIOUS_SPOTIFY_TRACK", "MUSIC", "DIRECT", "MUSIC", true],
  ["SET_SPOTIFY_VOLUME", "MUSIC", "DIRECT", "MUSIC", true],
  ["WHAT_IS_PLAYING", "MUSIC", "DIRECT", "MUSIC", true]
];

describe("action catalog snapshot", () => {
  it("registers exactly the actions in the inline table, in order", () => {
    const actual = ENABLED_ASSISTANT_CAPABILITIES.map((entry) => [entry.action, entry.domain, entry.approval, entry.executor, entry.enabled]);
    expect(actual).toEqual(EXPECTED_CATALOG.map((row) => [...row]));
  });

  it("has unique action names and a consistent domain-to-executor mapping", () => {
    const names = ENABLED_ASSISTANT_CAPABILITIES.map((entry) => entry.action);
    expect(new Set(names).size).toBe(names.length);
    const pairs = new Set(ENABLED_ASSISTANT_CAPABILITIES.map((entry) => `${entry.domain}:${entry.executor}`));
    expect([...pairs].sort()).toEqual([
      "APPLICATIONS:APPLICATION",
      "FILES:FILES",
      "INTERNAL_MEMORY:PLANNER",
      "MESSAGING:MESSAGING",
      "MUSIC:MUSIC",
      "WEB:WEB"
    ]);
  });

  it("counts the actions per domain and approval class", () => {
    const count = (key: "domain" | "approval") =>
      Object.fromEntries(
        [...new Set(ENABLED_ASSISTANT_CAPABILITIES.map((entry) => entry[key]))].sort().map((value) => [
          value,
          ENABLED_ASSISTANT_CAPABILITIES.filter((entry) => entry[key] === value).length
        ])
      );
    expect(count("domain")).toEqual({"APPLICATIONS":4,"FILES":8,"INTERNAL_MEMORY":22,"MESSAGING":7,"MUSIC":10,"WEB":2});
    expect(count("approval")).toEqual({"CONFIRMATION_REQUIRED":18,"DIRECT":31,"REINFORCED_CONFIRMATION_REQUIRED":4});
  });

  it("enables every entry", () => {
    expect(ENABLED_ASSISTANT_CAPABILITIES.every((entry) => entry.enabled === true)).toBe(true);
  });
});
