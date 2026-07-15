/**
 * Avatar upload (Multer).
 *
 * File upload is the most reliably exploited feature in any internal web app.
 * The defences here, in order of importance:
 *
 *  1. MAGIC-BYTE SNIFFING, not just the MIME header. `Content-Type: image/png`
 *     is attacker-controlled; the first eight bytes of the file are not. We read
 *     the real signature and reject anything that is not a genuine PNG/JPEG/WebP.
 *  2. GENERATED FILENAMES. The client's filename is never used — that is how you
 *     get `../../.env` or `avatar.php`.
 *  3. SIZE CAP enforced by Multer before the bytes reach disk.
 *  4. Files are served from a dedicated static route with `Content-Disposition`
 *     and no script execution (see app.js).
 */
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { BadRequestError } from '../core/errors.js';

const uploadRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);
const avatarDir = path.join(uploadRoot, 'avatars');
fs.mkdirSync(avatarDir, { recursive: true });

const ALLOWED = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
]);

/** True file signatures. The header the browser sent is irrelevant. */
const MAGIC = [
  { ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  // WebP = "RIFF" .... "WEBP"; we check RIFF here and WEBP at offset 8 below.
  { ext: '.webp', bytes: [0x52, 0x49, 0x46, 0x46] },
];

export const detectImageType = (buffer) => {
  for (const { ext, bytes } of MAGIC) {
    if (bytes.every((b, i) => buffer[i] === b)) {
      if (ext === '.webp') {
        const tag = buffer.subarray(8, 12).toString('ascii');
        if (tag !== 'WEBP') continue;
      }
      return ext;
    }
  }
  return null;
};

/**
 * Memory storage, deliberately: we must inspect the bytes BEFORE anything is
 * written to disk. Writing first and validating second means a malicious file
 * exists on the filesystem, however briefly.
 */
const storage = multer.memoryStorage();

export const uploadAvatar = multer({
  storage,
  limits: {
    fileSize: env.MAX_AVATAR_SIZE_MB * 1024 * 1024,
    files: 1,
    fields: 4,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(
        new BadRequestError('Only PNG, JPEG and WebP images are allowed', {
          code: 'UNSUPPORTED_FILE_TYPE',
        }),
      );
    }
    cb(null, true);
  },
}).single('avatar');

/**
 * Runs after Multer. Verifies the real type, writes with a generated name, and
 * hands the service a relative path (never an absolute one — absolute paths in
 * the DB break the moment the container's mount point changes).
 *
 * @returns {Promise<string>} relative path, e.g. 'avatars/9f3c…-.png'
 */
export const persistAvatar = async (file, userId) => {
  if (!file?.buffer?.length) {
    throw new BadRequestError('No image was uploaded', { code: 'FILE_REQUIRED' });
  }

  const realExt = detectImageType(file.buffer);
  if (!realExt) {
    throw new BadRequestError(
      'That file is not a valid image. Its contents do not match an image format.',
      { code: 'FILE_CONTENT_MISMATCH' },
    );
  }

  const filename = `${userId}-${randomUUID()}${realExt}`;
  await fs.promises.writeFile(path.join(avatarDir, filename), file.buffer, { mode: 0o644 });
  return path.posix.join('avatars', filename);
};

/** Best-effort removal of a superseded avatar. Never throws — a stale file is
 *  a housekeeping problem, not a reason to fail the user's request. */
export const removeAvatar = async (relativePath) => {
  if (!relativePath) return;
  // Defence in depth: even though we generated this name, refuse to unlink
  // anything that resolves outside the upload root.
  const target = path.resolve(uploadRoot, relativePath);
  if (!target.startsWith(uploadRoot)) return;
  await fs.promises.unlink(target).catch(() => {});
};

export const UPLOAD_ROOT = uploadRoot;
