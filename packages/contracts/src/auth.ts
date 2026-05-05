import { z } from "zod";

import { isoDateTimeSchema } from "./common.js";
import { userSchema } from "./users.js";

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authSessionSchema = z.object({
  user: userSchema,
  csrfToken: z.string().min(32),
  accessTokenExpiresAt: isoDateTimeSchema,
  refreshTokenExpiresAt: isoDateTimeSchema,
});

export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});

export const requestPasswordResetInputSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordInputSchema = z.object({
  token: z.string().min(32),
  newPassword: z.string().min(12),
});

export const passwordResetRequestResponseSchema = z.object({
  ok: z.literal(true),
  resetToken: z.string().min(32).optional(),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetInputSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;
export type PasswordResetRequestResponse = z.infer<typeof passwordResetRequestResponseSchema>;
