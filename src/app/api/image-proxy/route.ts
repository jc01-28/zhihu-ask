import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 知乎图片（picx.zhimg.com 等）有防盗链，浏览器直连会 403。
 * 这个代理只放行知乎自己的图片域名，避免变成开放代理。
 */
const ALLOWED_HOSTS = ['.zhimg.com', '.zhihu.com'];

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url');
  if (!target) return new NextResponse('missing url', { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new NextResponse('invalid url', { status: 400 });
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.some((h) => parsed.hostname.endsWith(h))) {
    return new NextResponse('host not allowed', { status: 403 });
  }

  const upstream = await fetch(parsed.toString(), {
    headers: { Referer: 'https://www.zhihu.com/' },
    cache: 'no-store',
  });

  if (!upstream.ok || !upstream.body) {
    return new NextResponse('upstream error', { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
