import * as path from "node:path";

export const safariExtensionVersion = "0.39.0";
export const safariCompanionAppName = "Nuoma Safari Companion";
export const safariBundleIdentifier = "com.nuoma.wpp.safari";
export const safariBuildSummaryFilename = "M39_SAFARI_EXTENSION_SUMMARY.json";

export interface SafariConverterPlanInput {
  converterBin?: string | null;
  sourceDir: string;
  outputDir: string;
  appName?: string;
  bundleIdentifier?: string;
}

export interface SafariConverterPlan {
  command: string;
  args: string[];
  usesXcrun: boolean;
  sourceDir: string;
  outputDir: string;
  appName: string;
  bundleIdentifier: string;
}

export interface ProcessError extends Error {
  code?: number | string;
  stderr?: string;
  stdout?: string;
}

export function createSafariConverterPlan(input: SafariConverterPlanInput): SafariConverterPlan {
  const command = input.converterBin?.trim() || "xcrun";
  const usesXcrun = path.basename(command) === "xcrun";
  const appName = input.appName?.trim() || safariCompanionAppName;
  const bundleIdentifier = input.bundleIdentifier?.trim() || safariBundleIdentifier;
  const converterArgs = [
    input.sourceDir,
    "--project-location",
    input.outputDir,
    "--app-name",
    appName,
    "--bundle-identifier",
    bundleIdentifier,
    "--swift",
    "--macos-only",
    "--no-open",
    "--force",
  ];

  return {
    command,
    args: usesXcrun ? ["safari-web-extension-converter", ...converterArgs] : converterArgs,
    usesXcrun,
    sourceDir: input.sourceDir,
    outputDir: input.outputDir,
    appName,
    bundleIdentifier,
  };
}

export function isSafariConverterUnavailable(error: unknown): boolean {
  if (!isProcessError(error)) {
    return false;
  }
  const message = `${error.message}\n${error.stderr ?? ""}`.toLowerCase();
  return (
    error.code === "ENOENT" ||
    error.code === 72 ||
    message.includes("unable to find utility") ||
    message.includes("not a developer tool or in path")
  );
}

export function formatSafariConverterUnavailableMessage(
  plan: SafariConverterPlan,
  error: unknown,
): string {
  const details = isProcessError(error) ? error.stderr || error.message : String(error);
  return [
    "M39 Safari Extension Companion bloqueado: safari-web-extension-converter indisponivel.",
    `Comando tentado: ${plan.command} ${plan.args.join(" ")}`,
    "Instale/ative o Xcode completo e valide com `xcrun --find safari-web-extension-converter`,",
    "ou defina SAFARI_WEB_EXTENSION_CONVERTER_BIN=/abs/path/do/converter para smokes controlados.",
    `Erro original: ${details.trim() || "sem stderr"}`,
  ].join("\n");
}

function isProcessError(error: unknown): error is ProcessError {
  return error instanceof Error;
}
