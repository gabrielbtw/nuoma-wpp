import { API_URL } from "./api-url.js";

export function mediaAssetUrl(mediaAssetId: number | null | undefined): string | null {
  if (!mediaAssetId) return null;
  return `${API_URL}/api/media/assets/${mediaAssetId}`;
}
