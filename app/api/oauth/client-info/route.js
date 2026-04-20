import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth.js';
import { findOAuthClient } from '@/lib/oauthClients.js';

/**
 * GET /api/oauth/client-info?client_id=xxx&redirect_uri=xxx
 * 供同意页读取应用信息 + 当前用户信息。
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const client_id = searchParams.get('client_id');
  const redirect_uri = searchParams.get('redirect_uri');

  const client = findOAuthClient(client_id);
  if (!client || client.status !== 'active') {
    return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
  }
  if (redirect_uri && Array.isArray(client.redirectUris)
      && !client.redirectUris.includes(redirect_uri)) {
    return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
  }

  const session = await getSession();

  return NextResponse.json({
    client: {
      clientId: client.clientId,
      name: client.name || client.clientId,
      description: client.description || '',
      homepageUrl: client.homepageUrl || '',
      logoUrl: client.logoUrl || '',
      minLevel: client.minLevel ?? 0,
    },
    user: session ? {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      avatar: session.user.avatar || '',
    } : null,
  });
}
