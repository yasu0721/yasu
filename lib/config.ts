import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { prisma } from "./prisma";
import type { AppConfig } from "./types";

const SPEC_CONFIG_PATH = path.join(process.cwd(), "spec", "config.yaml");

function loadDefaultConfig(): AppConfig {
  const raw = fs.readFileSync(SPEC_CONFIG_PATH, "utf-8");
  return loadYaml(raw) as AppConfig;
}

const SETTINGS_ROW_ID = "default";

/**
 * Returns the live config: the DB-backed override if one has been saved
 * (via the Settings screen), otherwise the shipped spec/config.yaml
 * defaults. The DB row is seeded from the yaml on first read so that
 * settings edits persist immediately (per 要件定義書.md §14).
 */
export async function getConfig(): Promise<AppConfig> {
  const row = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ROW_ID },
  });
  if (row) {
    return JSON.parse(row.configJson) as AppConfig;
  }
  const defaults = loadDefaultConfig();
  await prisma.appSettings.create({
    data: { id: SETTINGS_ROW_ID, configJson: JSON.stringify(defaults) },
  });
  return defaults;
}

export async function updateConfig(next: AppConfig): Promise<AppConfig> {
  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ROW_ID },
    update: { configJson: JSON.stringify(next) },
    create: { id: SETTINGS_ROW_ID, configJson: JSON.stringify(next) },
  });
  return next;
}

export function getDefaultConfig(): AppConfig {
  return loadDefaultConfig();
}
