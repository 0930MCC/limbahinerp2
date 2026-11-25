/**
 * Resolves and normalizes image URLs — including Google Drive share links —
 * for safe browser rendering with referrerPolicy="no-referrer".
 */

const SAFE_DRIVE_ID_RE = /^[a-zA-Z0-9_-]{10,120}$/;

export function extractGoogleDriveFileId(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    if (host === 'drive.google.com' || host === 'docs.google.com') {
      // /file/d/<FILE_ID>/view or /d/<FILE_ID>
      const pathMatch = /\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,120})/.exec(parsed.pathname);
      if (pathMatch && SAFE_DRIVE_ID_RE.test(pathMatch[1])) {
        return pathMatch[1];
      }
      // /open?id=<FILE_ID>, /uc?id=<FILE_ID>, /thumbnail?id=<FILE_ID>
      const idParam = parsed.searchParams.get('id');
      if (idParam && SAFE_DRIVE_ID_RE.test(idParam)) {
        return idParam;
      }
    }

    if (host === 'lh3.googleusercontent.com') {
      const pathMatch = /\/d\/([a-zA-Z0-9_-]{10,120})/.exec(parsed.pathname);
      if (pathMatch && SAFE_DRIVE_ID_RE.test(pathMatch[1])) {
        return pathMatch[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function isSafeDisplayUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/assets/') || trimmed.startsWith('/uploads/')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Returns an ordered list of image source candidates for <img> rendering.
 * For Google Drive links, uses lh3.googleusercontent.com/d/<ID> first, then
 * falls back to drive.google.com/thumbnail?id=<ID>&sz=w1000.
 */
export function resolveImageCandidates(rawUrl?: string | null): string[] {
  if (!isSafeDisplayUrl(rawUrl)) return [];
  const trimmed = rawUrl!.trim();
  const driveId = extractGoogleDriveFileId(trimmed);
  if (driveId) {
    return [
      `https://lh3.googleusercontent.com/d/${driveId}`,
      `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`,
    ];
  }
  return [trimmed];
}

export function isGoogleDriveLink(rawUrl?: string | null): boolean {
  return Boolean(extractGoogleDriveFileId(rawUrl));
}
