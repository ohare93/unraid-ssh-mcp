import { Request } from 'express';

export interface AuthResult {
  authenticated: boolean;
  error?: string;
  clientId?: string;
}

/**
 * Authenticate an HTTP request using OAuth Bearer token
 * @param req - Express request object
 * @param oauthTokens - Map of valid OAuth tokens
 * @param requireAuth - Whether to require authentication (true/false/"development")
 * @returns AuthResult indicating whether request is authenticated
 */
export function authenticateRequest(
  req: Request,
  oauthTokens: Map<string, any>,
  requireAuth: boolean | "development"
): AuthResult {
  const authHeader = req.headers.authorization;

  // No auth header provided
  if (!authHeader) {
    return {
      authenticated: false,
      error: "No authorization header provided. Include 'Authorization: Bearer YOUR_TOKEN' header."
    };
  }

  // Extract token from "Bearer TOKEN" format
  if (!authHeader.startsWith("Bearer ")) {
    return {
      authenticated: false,
      error: "Invalid authorization header format. Must be 'Bearer YOUR_TOKEN'."
    };
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  // Check if token exists
  const tokenData = oauthTokens.get(token);
  if (!tokenData) {
    return {
      authenticated: false,
      error: "Invalid access token. Token not found or has been revoked."
    };
  }

  // Check if token is expired
  if (tokenData.expires_at < Date.now()) {
    oauthTokens.delete(token); // Clean up expired token
    return {
      authenticated: false,
      error: "Access token has expired. Use refresh token to obtain a new access token."
    };
  }

  // Token is valid
  return {
    authenticated: true,
    clientId: tokenData.client_id
  };
}